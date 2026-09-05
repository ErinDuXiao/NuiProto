import { useSyncExternalStore } from "react";
import { getPlush } from "../data/plushies";
import { pushLog } from "./log";
import {
  clearSave,
  initialSave,
  loadSave,
  makeInstanceId,
  PER_ROW,
  SHELF_CAPACITY,
  SHELF_ROWS,
  SLOT_SPACING,
  SLOT_X0,
  writeSave,
} from "./persist";
import type { CraneBoardSave, LogEventType, PlushInstance, SaveV2 } from "./types";

type LogExtra = {
  plushId?: string;
  attempt?: number;
  meta?: Record<string, number | string | boolean>;
};

const SESSION_ID = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let state: SaveV2 = loadSave();
const listeners = new Set<() => void>();

/** 直近の永続化に成功したか。失敗し続けている場合は UI から知らせる。 */
let persistOk = true;

/**
 * 状態を差し替えて永続化し、購読者に通知する。
 *
 * updater は必ず新しいオブジェクトを返すこと。useSyncExternalStore は
 * 参照の同一性で変更を検出するため、既存の state を書き換えてはならない。
 *
 * 順序は「メモリ更新 → 永続化 → 通知」。永続化を通知より先に行うことで、
 * 画面に出た変化が保存されていないという状態を最小にする。保存に失敗しても
 * プレイは続けられるようにするが、成否は persistOk で観測できるようにする。
 *
 * 購読者の例外は握りつぶす。1人が落ちても他の購読者への通知を止めない。
 */
function set(updater: (s: SaveV2) => SaveV2): void {
  const next = updater(state);
  if (next === state) return;
  state = next;
  persistOk = writeSave(state);
  for (const l of listeners) {
    try {
      l();
    } catch {
      // 購読者の都合でストアを壊さない
    }
  }
}

function makeLog(
  s: SaveV2,
  type: LogEventType,
  extra: LogExtra = {}
): SaveV2["log"] {
  return pushLog(s.log, {
    type,
    t: Date.now(),
    sessionId: SESSION_ID,
    ...extra,
  });
}

/** 有効な段に置かれている個体だけを数える。 */
function displayed(instances: PlushInstance[]): PlushInstance[] {
  return instances.filter(
    (o) => Number.isInteger(o.shelfRow) && o.shelfRow >= 0 && o.shelfRow < SHELF_ROWS
  );
}

/**
 * 新しい子を置く場所を探す。SHELF_ROWS 段 × PER_ROW 匹。
 *
 * **既にいる子の隣を選ぶ。** これは見た目の都合ではなく、出会いの演出
 * （仕様8章）が「2匹が並ぶ」ことを前提にしているため。離れた段に置くと
 * 演出そのものが成立しない。同じ距離なら右側を選ぶ。
 *
 * 自由配置で格子から外れた子がいてもぶつからないよう、
 * 格子のキーではなく実際の距離で占有を判定する。
 * 空きが無ければ shelfRow: -1（箱の中）を返す。個体を捨てることはしない。
 */
function findSlot(instances: PlushInstance[]): { x: number; shelfRow: number } {
  const onShelf = displayed(instances);
  if (onShelf.length >= SHELF_CAPACITY) return { x: 160, shelfRow: -1 };

  let best: { x: number; shelfRow: number; cost: number } | null = null;

  for (let row = 0; row < SHELF_ROWS; row++) {
    const inRow = onShelf.filter((o) => o.shelfRow === row);
    if (inRow.length >= PER_ROW) continue;
    for (let col = 0; col < PER_ROW; col++) {
      const x = SLOT_X0 + col * SLOT_SPACING;
      if (!inRow.every((o) => Math.abs(o.x - x) >= SLOT_SPACING * 0.8)) continue;

      // 既存の子との近さでコストを決める。段が違えば大きく不利にする。
      let cost = 0;
      if (onShelf.length > 0) {
        cost = Infinity;
        for (const o of onShelf) {
          const d = Math.abs(o.x - x) + (o.shelfRow === row ? 0 : 400);
          // 同距離なら右隣を選ぶ
          cost = Math.min(cost, d + (x < o.x ? 1 : 0));
        }
      } else {
        cost = col;
      }
      if (!best || cost < best.cost) best = { x, shelfRow: row, cost };
    }
  }

  return best ? { x: best.x, shelfRow: best.shelfRow } : { x: 160, shelfRow: -1 };
}

export const store = {
  get(): SaveV2 {
    return state;
  },

  /** 直近の永続化に成功したか。false なら「保存できていない」ことを画面で伝える。 */
  isPersisted(): boolean {
    return persistOk;
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },

  /**
   * クレーンで景品を獲得する。
   *
   * 所持品への追加・出会い演出フラグの設定・ログ記録を 1 回の更新でまとめて行う。
   * 途中の状態が外から見えないため、演出中にリロードしても
   * pendingWelcome が残り、演出は必ず 1 回だけ再生される（仕様 5.3）。
   *
   * 来歴（何回目で取れたか・そのとき誰が見守っていたか）は**呼び出し側が渡す**。
   * `attemptsOnBoard` は獲得すると 0 に戻る盤面カウンタなので、
   * リセットが起きる前に読んだ値でなければ意味がない（仕様 4.3）。
   * ストアが盤面の事情を知る必要はない。
   *
   * @returns 追加された個体の instanceId
   */
  winPlush(input: {
    plushTypeId: string;
    attemptsToAcquire: number;
    witnessedBy: string | null;
  }): string {
    // 未知の plushTypeId ならここで落ちる。状態を触る前に検証する。
    getPlush(input.plushTypeId);
    const instanceId = makeInstanceId();
    set((s) => {
      const slot = findSlot(s.instances);
      const plush: PlushInstance = {
        instanceId,
        plushTypeId: input.plushTypeId,
        acquiredAt: Date.now(),
        attemptsToAcquire: input.attemptsToAcquire,
        witnessedBy: input.witnessedBy,
        origin: "crane",
        x: slot.x,
        shelfRow: slot.shelfRow,
        personalitySeed: Math.random(),
      };
      const instances = [...s.instances, plush];
      return {
        ...s,
        instances,
        pendingWelcome: instanceId,
        log: makeLog(s, "plush_won", { plushId: input.plushTypeId, attempt: s.attempts }),
      };
    });
    return instanceId;
  },

  /** 出会い演出の再生完了。pendingWelcome のクリアと初回完了の記録を同時に行う。 */
  finishWelcome(skipped: boolean): void {
    set((s) => {
      if (!s.pendingWelcome) return s;
      return {
        ...s,
        pendingWelcome: null,
        firstMeetingDone: true,
        log: makeLog(s, "welcome_played", {
          meta: { count: s.instances.length, skipped },
        }),
      };
    });
  },

  /**
   * 棚の中で個体を動かす。
   *
   * ストアが棚の不変条件を守る唯一の場所。呼び出し側が何を渡しても
   * 「段が範囲外」「定員13匹目」「x が NaN」といった状態にはならない。
   */
  movePlush(instanceId: string, x: number, shelfRow: number): void {
    set((s) => {
      const idx = s.instances.findIndex((o) => o.instanceId === instanceId);
      if (idx < 0) return s;
      const before = s.instances[idx];

      const row = Number.isFinite(shelfRow)
        ? Math.min(SHELF_ROWS - 1, Math.max(-1, Math.round(shelfRow)))
        : before.shelfRow;
      const nx = Number.isFinite(x) ? Math.min(2000, Math.max(-2000, x)) : before.x;

      // 箱の中から棚へ出すときだけ定員を確認する
      if (row >= 0 && before.shelfRow < 0 && displayed(s.instances).length >= SHELF_CAPACITY) {
        return s;
      }
      if (row === before.shelfRow && nx === before.x) return s;

      const instances = [...s.instances];
      instances[idx] = { ...before, x: nx, shelfRow: row };
      return {
        ...s,
        instances,
        log: makeLog(s, "plush_repositioned", {
          plushId: before.plushTypeId,
          meta: { fromRow: before.shelfRow, toRow: row },
        }),
      };
    });
  },

  saveBoard(board: CraneBoardSave | null): void {
    set((s) => ({ ...s, craneBoard: board }));
  },

  bumpAttempts(): void {
    set((s) => ({ ...s, attempts: s.attempts + 1 }));
  },

  log(type: LogEventType, extra: LogExtra = {}): void {
    set((s) => ({ ...s, log: makeLog(s, type, extra) }));
  },

  /**
   * DevMenu 用。出会い演出を起こさずに追加する。
   *
   * クレーンを経ていないので試行回数も見守り役も存在しない。
   * それらしい数字を入れると、プロフィールがありもしない物語を語る。
   */
  grantPlush(plushTypeId: string): void {
    getPlush(plushTypeId);
    set((s) => {
      const slot = findSlot(s.instances);
      return {
        ...s,
        instances: [
          ...s.instances,
          {
            instanceId: makeInstanceId(),
            plushTypeId,
            acquiredAt: Date.now(),
            attemptsToAcquire: null,
            witnessedBy: null,
            origin: "granted",
            x: slot.x,
            shelfRow: slot.shelfRow,
            personalitySeed: Math.random(),
          },
        ],
      };
    });
  },

  resetAll(): void {
    clearSave();
    set(() => initialSave());
  },

  startSession(): void {
    set((s) => ({
      ...s,
      sessionCount: s.sessionCount + 1,
      log: makeLog(s, "session_start", { meta: { session: s.sessionCount + 1 } }),
    }));
  },
};

export function useGame(): SaveV2 {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export { SESSION_ID };
