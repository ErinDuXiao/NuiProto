import { describe, it, expect, beforeEach } from "vitest";
import {
  createCrane, startDrop, tickCrane, resolveWin, MIN_ADVANCE,
} from "./craneMachine";
// commitWin だけ別ファイル。craneMachine を store から独立させておくため
import { commitWin } from "./commitWin";
import { step, DEFAULT_PIT, STEP, atRest, type Body, type FallenPrize } from "./physics";
import { getPlush } from "../data/plushies";
import { store } from "../state/store";

const prize = (x: number, z: number, id = "rabbit_01#0"): Body => ({
  id, defId: "rabbit_01", x, z, y: 0, vx: 0, vy: 0, vz: 0,
  r: getPlush("rabbit_01").size, spin: 0, held: false,
});

/** 実際の物理と状態機械を回して1回 DROP し、獲得したらその景品を返す。 */
function runAttempt(
  c: ReturnType<typeof createCrane>,
  bodies: Body[],
  ax: number,
  az: number
): FallenPrize | null {
  c.armX = ax;
  c.armZ = az;
  startDrop(c, bodies, DEFAULT_PIT);
  let won: FallenPrize | null = null;
  let flush = -1;
  for (let i = 0; i < 120 * 30; i++) {
    for (const f of step(bodies, DEFAULT_PIT, STEP).fallen) won ??= f;
    for (const e of tickCrane(c, bodies, DEFAULT_PIT, STEP)) {
      if (e.kind === "won" && e.bodyId && e.defId) {
        won ??= { id: e.bodyId, defId: e.defId };
      }
    }
    if (flush >= 0) {
      if (++flush >= 40) break;
    } else if (c.state === "idle" && atRest(bodies)) {
      flush = 0;
    }
  }
  return won;
}

/**
 * ちょうど n 回目の DROP で獲得する状況を作る。
 *
 * 各試行で出口距離は MIN_ADVANCE 以上縮み、
 * before <= exit.r + MIN_ADVANCE になった試行で獲得する。
 * 数値は定数から導く（直接埋め込むと、定数が変わったとき静かに壊れる）。
 */
function winOnAttempt(n: number) {
  const dist = DEFAULT_PIT.exit.r + MIN_ADVANCE * n - 5;
  const bodies = [prize(DEFAULT_PIT.exit.x + dist, DEFAULT_PIT.exit.z)];
  const c = createCrane();
  for (let i = 1; i <= n; i++) {
    const won = runAttempt(c, bodies, 9999, 9999); // 常に外す
    if (won) return { crane: c, won, attempt: i };
  }
  throw new Error(`${n} 回で獲得できなかった（開始距離 ${dist}）`);
}

beforeEach(() => {
  localStorage.clear();
  store.resetAll();
});

describe("来歴が実フローを通して正しく保存される", () => {
  for (const n of [1, 2, 3, 4]) {
    it(`${n} 回目で取れた子の attemptsToAcquire が ${n} になる`, () => {
      const { crane, won, attempt } = winOnAttempt(n);
      // テストの前提が崩れていたらここで落ちる
      expect(attempt, `${n} 回目のはずが ${attempt} 回目で取れた`).toBe(n);
      expect(crane.attemptsOnBoard).toBe(n);

      const resolved = resolveWin(crane, won, "watcher-1");
      expect(resolved.attemptsToAcquire).toBe(n);
      expect(resolved.plushTypeId).toBe("rabbit_01");
      expect(resolved.witnessedBy).toBe("watcher-1");

      const id = store.winPlush(resolved);
      const saved = store.get().instances.find((i) => i.instanceId === id)!;
      expect(saved.attemptsToAcquire).toBe(n);
      expect(saved.witnessedBy).toBe("watcher-1");
      expect(saved.origin).toBe("crane");
    });
  }

  it("獲得後に盤面が補充されても、保存済みの値は書き換わらない", () => {
    const { crane, won } = winOnAttempt(2);
    const id = commitWin(crane, won, null);
    crane.attemptsOnBoard = 0; // 盤面を作り直した状況
    store.saveBoard(null);
    expect(
      store.get().instances.find((i) => i.instanceId === id)!.attemptsToAcquire
    ).toBe(2);
  });

  it("種類は ID 文字列ではなく景品そのものから決まる", () => {
    const { crane } = winOnAttempt(1);
    // ID の形が変わっても種類は壊れない
    const odd: FallenPrize = { id: "whatever-42", defId: "penguin_01" };
    expect(resolveWin(crane, odd, null).plushTypeId).toBe("penguin_01");
  });

  it("見守り役がいない場合は witnessedBy が null になる", () => {
    const { crane, won } = winOnAttempt(1);
    expect(resolveWin(crane, won, null).witnessedBy).toBeNull();
  });
});

describe("commitWin の順序", () => {
  it("盤面を捨てる前に来歴を保存する", () => {
    const { crane, won } = winOnAttempt(1);
    const order: string[] = [];
    const realWin = store.winPlush.bind(store);
    const realSave = store.saveBoard.bind(store);
    store.winPlush = (i) => {
      order.push("win");
      return realWin(i);
    };
    store.saveBoard = (b) => {
      order.push("save");
      realSave(b);
    };
    try {
      commitWin(crane, won, null);
    } finally {
      store.winPlush = realWin;
      store.saveBoard = realSave;
    }
    expect(order).toEqual(["win", "save"]);
  });

  /**
   * 順序を入れ替えたら結果が変わることを、構造ではなく値で示す。
   *
   * 盤面を捨てる処理が試行カウンタのリセットを伴う場合、
   * 先に捨ててから来歴を読むと 3 回目で取れた子が 1 回目で取れたことになる。
   * 上の順序テストだけだと「順序が意味を持つ」ことが値として証明されない。
   */
  it("盤面の破棄が試行カウンタを巻き戻しても、保存される回数は変わらない", () => {
    const { crane, won } = winOnAttempt(3);
    const realSave = store.saveBoard.bind(store);
    store.saveBoard = (b) => {
      crane.attemptsOnBoard = 0; // 盤面を捨てる＝カウンタも消える
      realSave(b);
    };
    let id: string;
    try {
      id = commitWin(crane, won, null);
    } finally {
      store.saveBoard = realSave;
    }
    expect(
      store.get().instances.find((i) => i.instanceId === id)!.attemptsToAcquire
    ).toBe(3);
  });
});
