import { describe, it, expect } from "vitest";
import {
  createCrane,
  startDrop,
  tickCrane,
  advanceGoal,
  MIN_ADVANCE,
  AUTO_DROP_RANGE,
  type Crane,
  type CraneEvent,
} from "./craneMachine";
import { step, DEFAULT_PIT, STEP, exitDistance, atRest, type Body } from "./physics";
import { getPlush } from "../data/plushies";

const prize = (x: number, z: number, id = "p1"): Body => ({
  id,
  defId: "rabbit_01",
  x,
  z,
  y: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  r: getPlush("rabbit_01").size,
  spin: 0,
  held: false,
});

/**
 * アームを (ax, az) に置いて1回 DROP し、静止して idle に戻るまで進める。
 * 本番の ArcadeScreen と同じく step と tickCrane の両方を毎ステップ回す。
 * 完走できなければ例外を投げる（黙って通過させない）。
 */
function runAttempt(c: Crane, bodies: Body[], ax: number, az: number): CraneEvent[] {
  c.armX = ax;
  c.armZ = az;
  startDrop(c, bodies, DEFAULT_PIT);
  const events: CraneEvent[] = [];
  const LIMIT = 120 * 30;
  for (let i = 0; i < LIMIT; i++) {
    const r = step(bodies, DEFAULT_PIT, STEP);
    for (const id of r.fallen) events.push({ kind: "won", bodyId: id });
    events.push(...tickCrane(c, bodies, DEFAULT_PIT, STEP));
    if (c.state === "idle" && atRest(bodies)) return events;
  }
  throw new Error(`runAttempt が完走しなかった: state=${c.state} atRest=${atRest(bodies)}`);
}

const find = (bodies: Body[], id: string) => bodies.find((b) => b.id === id);

describe("不変条件: 試行後は獲得済みか、出口距離が MIN_ADVANCE 以上縮む (仕様7.7)", () => {
  it("掴んで落とした場合", () => {
    for (let trial = 0; trial < 20; trial++) {
      const b = [prize(200 + trial * 3, 120)];
      const before = exitDistance(b[0], DEFAULT_PIT);
      const evs = runAttempt(createCrane(), b, b[0].x, b[0].z);
      const t = find(b, "p1");
      if (!t) {
        expect(
          evs.some((e) => e.kind === "won"),
          `trial ${trial} 消えたのに won が無い`
        ).toBe(true);
        continue;
      }
      expect(exitDistance(t, DEFAULT_PIT), `trial ${trial}`).toBeLessThanOrEqual(
        advanceGoal(before) + 0.5
      );
    }
  });

  it("完全に空振りした場合も同じ不変条件を満たす（何も起きないの禁止）", () => {
    const b = [prize(280, 150)];
    const before = exitDistance(b[0], DEFAULT_PIT);
    runAttempt(createCrane(), b, 20, 20);
    const t = find(b, "p1");
    expect(t).toBeDefined();
    expect(exitDistance(t!, DEFAULT_PIT)).toBeLessThanOrEqual(advanceGoal(before) + 0.5);
    expect(Number.isFinite(t!.x) && Number.isFinite(t!.z)).toBe(true);
  });

  it("他の景品に真正面から阻まれても満たす", () => {
    const b = [prize(200, 120, "p1"), prize(160, 96, "block")];
    const before = exitDistance(b[0], DEFAULT_PIT);
    const evs = runAttempt(createCrane(), b, 200, 120);
    const t = find(b, "p1");
    if (!t) {
      expect(evs.some((e) => e.kind === "won")).toBe(true);
      return;
    }
    expect(exitDistance(t, DEFAULT_PIT)).toBeLessThanOrEqual(advanceGoal(before) + 0.5);
  });

  it("景品に囲まれていても満たす", () => {
    const b = [
      prize(200, 120, "p1"),
      prize(150, 100, "b1"),
      prize(170, 60, "b2"),
      prize(250, 110, "b3"),
      prize(210, 170, "b4"),
    ];
    const before = exitDistance(b[0], DEFAULT_PIT);
    runAttempt(createCrane(), b, 200, 120);
    const t = find(b, "p1");
    if (t) {
      expect(exitDistance(t, DEFAULT_PIT)).toBeLessThanOrEqual(advanceGoal(before) + 0.5);
    }
  });

  it("壁際でも満たす", () => {
    const b = [prize(DEFAULT_PIT.maxX - 34, DEFAULT_PIT.maxZ - 34, "p1")];
    const before = exitDistance(b[0], DEFAULT_PIT);
    runAttempt(createCrane(), b, b[0].x, b[0].z);
    const t = find(b, "p1");
    if (t) expect(exitDistance(t, DEFAULT_PIT)).toBeLessThanOrEqual(advanceGoal(before) + 0.5);
  });

  it("既に出口の真上にある景品は獲得として扱う（方向ベクトル零で保証が壊れない）", () => {
    const b = [prize(DEFAULT_PIT.exit.x, DEFAULT_PIT.exit.z, "p1")];
    const evs = runAttempt(createCrane(), b, 9999, 9999);
    expect(find(b, "p1")).toBeUndefined();
    expect(evs.filter((e) => e.kind === "won").length).toBeGreaterThanOrEqual(1);
  });

  it("出口より近い距離の景品も必ず獲得され、距離が負にならない", () => {
    const b = [prize(DEFAULT_PIT.exit.x + 20, DEFAULT_PIT.exit.z, "p1")];
    runAttempt(createCrane(), b, 9999, 9999);
    expect(find(b, "p1")).toBeUndefined();
  });

  it("解決後も景品同士が重ならず、盤面の内側にいる", () => {
    const b = [prize(180, 110, "p1"), prize(150, 90, "b1"), prize(215, 135, "b2")];
    runAttempt(createCrane(), b, 180, 110);
    for (let i = 0; i < b.length; i++) {
      expect(b[i].x).toBeGreaterThanOrEqual(DEFAULT_PIT.minX - 0.5);
      expect(b[i].x).toBeLessThanOrEqual(DEFAULT_PIT.maxX + 0.5);
      expect(b[i].z).toBeGreaterThanOrEqual(DEFAULT_PIT.minZ - 0.5);
      expect(b[i].z).toBeLessThanOrEqual(DEFAULT_PIT.maxZ + 0.5);
      for (let j = i + 1; j < b.length; j++) {
        const gap = Math.hypot(b[i].x - b[j].x, b[i].z - b[j].z);
        expect(gap, `${b[i].id}-${b[j].id}`).toBeGreaterThan((b[i].r + b[j].r) * 0.8);
      }
    }
  });
});

describe("4回以内の構造的保証 (仕様7.7)", () => {
  it("狙いを毎回外しても、毎試行 MIN_ADVANCE 縮み、4回以内に獲得する", () => {
    const b = [prize(DEFAULT_PIT.exit.x + 140, DEFAULT_PIT.exit.z)];
    const c = createCrane();
    let won = false;
    for (let n = 1; n <= 4 && !won; n++) {
      const before = exitDistance(b[0], DEFAULT_PIT);
      const evs = runAttempt(c, b, 9999, 9999);
      const t = find(b, "p1");
      if (!t) {
        expect(evs.filter((e) => e.kind === "won").length, `n=${n}`).toBeGreaterThanOrEqual(1);
        won = true;
        break;
      }
      expect(exitDistance(t, DEFAULT_PIT), `n=${n} で前進していない`).toBeLessThanOrEqual(
        advanceGoal(before) + 0.5
      );
    }
    expect(won, "4回外し続けても獲得できなかった").toBe(true);
  });

  it("D0の上限140pxなら3回失敗した時点でAUTO_DROP_RANGE圏内に入る", () => {
    const b = [prize(DEFAULT_PIT.exit.x + 140, DEFAULT_PIT.exit.z)];
    const c = createCrane();
    for (let n = 1; n <= 3 && b.length > 0; n++) runAttempt(c, b, 9999, 9999);
    if (b.length > 0) {
      expect(exitDistance(b[0], DEFAULT_PIT)).toBeLessThanOrEqual(AUTO_DROP_RANGE);
    }
  });

  it("MIN_ADVANCE が仕様値", () => {
    expect(MIN_ADVANCE).toBe(30);
  });
});

describe("端から端までの獲得シミュレーション (仕様7.8)", () => {
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rnd: () => number) {
    return Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  }

  /** 実際に crane を駆動し、won が出た試行数を数える。 */
  function play(sigma: number, sessions: number) {
    const rnd = mulberry32(20260903);
    let firstTry = 0;
    let within4 = 0;
    for (let s = 0; s < sessions; s++) {
      const b = [prize(DEFAULT_PIT.exit.x + 120, DEFAULT_PIT.exit.z + 20)];
      const c = createCrane();
      for (let n = 1; n <= 4; n++) {
        const target = b[0];
        if (!target) break;
        const evs = runAttempt(c, b, target.x + gauss(rnd) * sigma, target.z + gauss(rnd) * sigma);
        if (evs.some((e) => e.kind === "won")) {
          if (n === 1) firstTry++;
          within4++;
          break;
        }
      }
    }
    return { firstTry: firstTry / sessions, within4: within4 / sessions };
  }

  it("初見(σ=18px): 4回以内獲得率 >= 0.95", () => {
    expect(play(18, 150).within4).toBeGreaterThanOrEqual(0.95);
  });

  it("初見(σ=18px): 1回目獲得率が 0.10〜0.55 に収まる（下手すぎず簡単すぎず）", () => {
    const r = play(18, 150);
    expect(r.firstTry).toBeGreaterThanOrEqual(0.1);
    expect(r.firstTry).toBeLessThanOrEqual(0.55);
  });

  it("上手いプレイヤー(σ=9px)のほうが1回目獲得率が高い", () => {
    expect(play(9, 150).firstTry).toBeGreaterThan(play(18, 150).firstTry);
  });
});

describe("状態機械", () => {
  it("DROPからidleへ必ず戻る（状態が詰まらない）", () => {
    const b = [prize(200, 120)];
    const c = createCrane();
    runAttempt(c, b, 200, 120);
    expect(c.state).toBe("idle");
  });

  it("試行カウンタは結果に関わらず1回だけ増える", () => {
    const b = [prize(280, 150)];
    const c = createCrane();
    runAttempt(c, b, 9999, 9999);
    expect(c.attemptsOnBoard).toBe(1);
    if (b.length > 0) {
      runAttempt(c, b, b[0].x, b[0].z);
      expect(c.attemptsOnBoard).toBe(2);
    }
  });

  it("獲得時に won イベントが出る", () => {
    const b = [prize(DEFAULT_PIT.exit.x + 90, DEFAULT_PIT.exit.z)];
    const c = createCrane();
    let evs: CraneEvent[] = [];
    for (let n = 1; n <= 4 && b.length > 0; n++) evs = evs.concat(runAttempt(c, b, 9999, 9999));
    expect(evs.filter((e) => e.kind === "won").length).toBeGreaterThanOrEqual(1);
    expect(b).toHaveLength(0);
  });

  it("盤面が空でもクラッシュせず idle に戻る", () => {
    const b: Body[] = [];
    const c = createCrane();
    expect(() => runAttempt(c, b, 100, 100)).not.toThrow();
    expect(c.state).toBe("idle");
  });

  it("掴んだ景品が途中で盤面から消えても壊れない", () => {
    const b = [prize(200, 120)];
    const c = createCrane();
    c.armX = 200;
    c.armZ = 120;
    startDrop(c, b, DEFAULT_PIT);
    for (let i = 0; i < 600; i++) {
      step(b, DEFAULT_PIT, STEP);
      tickCrane(c, b, DEFAULT_PIT, STEP);
      if (c.heldId) {
        b.length = 0;
        break;
      }
    }
    expect(() => {
      for (let i = 0; i < 1200; i++) {
        step(b, DEFAULT_PIT, STEP);
        tickCrane(c, b, DEFAULT_PIT, STEP);
      }
    }).not.toThrow();
    expect(c.state).toBe("idle");
    expect(c.heldId).toBeNull();
  });

  it("startDrop 以外で attemptsOnBoard が変わらない", () => {
    const b = [prize(200, 120)];
    const c = createCrane();
    for (let i = 0; i < 500; i++) {
      step(b, DEFAULT_PIT, STEP);
      tickCrane(c, b, DEFAULT_PIT, STEP);
    }
    expect(c.attemptsOnBoard).toBe(0);
  });
});
