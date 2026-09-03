import { describe, it, expect } from "vitest";
import { moodFor, watcherPose, MISSED_DURATION, MOODS, type WatcherMood } from "./watcherState";
import { AUTO_DROP_RANGE } from "./craneMachine";

describe("moodFor (仕様7.9)", () => {
  it("待機中はidle", () => {
    expect(moodFor("idle", null, 200)).toBe("idle");
  });
  it("狙っている間はaiming", () => {
    expect(moodFor("aimX", null, 200)).toBe("aiming");
    expect(moodFor("aimZ", null, 200)).toBe("aiming");
  });
  it("下降中はdropping", () => {
    expect(moodFor("descend", null, 200)).toBe("dropping");
  });
  it("掴んだ瞬間はgrabbed", () => {
    expect(moodFor("lift", { kind: "grabbed" }, 200)).toBe("grabbed");
  });
  it("運んでいる間もgrabbedのまま", () => {
    expect(moodFor("carry", { kind: "grabbed" }, 200)).toBe("grabbed");
  });
  it("落とした瞬間はmissed", () => {
    expect(moodFor("settle", { kind: "released" }, 200)).toBe("missed");
  });
  it("空振りもmissed", () => {
    expect(moodFor("settle", { kind: "nudged" }, 200)).toBe("missed");
  });
  it("獲得したらsuccess", () => {
    expect(moodFor("idle", { kind: "won" }, 0)).toBe("success");
  });
  it("出口に近づいたらnearExit", () => {
    expect(moodFor("idle", { kind: "settled" }, AUTO_DROP_RANGE - 10)).toBe("nearExit");
  });
  it("出口から遠ければ落ち着いてidleに戻る", () => {
    expect(moodFor("idle", { kind: "settled" }, 300)).toBe("idle");
  });
  it("successはmissedより優先される（喜びを打ち消さない）", () => {
    expect(moodFor("settle", { kind: "won" }, 10)).toBe("success");
  });
});

describe("watcherPose", () => {
  it("aimingは目が大きく身を乗り出す", () => {
    const p = watcherPose("aiming", 100);
    expect(p.eyeOpen).toBeGreaterThan(1);
  });

  it("aimingは左右に揺れる（じっとしていない）", () => {
    const a = watcherPose("aiming", 0).tilt;
    const b = watcherPose("aiming", 400).tilt;
    expect(a).not.toBeCloseTo(b, 3);
  });

  it("droppingは瞬きを止めて静止する（時間で一切変化しない）", () => {
    const a = watcherPose("dropping", 0);
    for (const t of [100, 400, 800, 5000]) {
      expect(watcherPose("dropping", t), `t=${t}`).toEqual(a);
    }
    expect(a.hop).toBe(0);
    expect(a.tilt).toBe(0);
    // 息を呑んで見つめる。目は開いたまま
    expect(a.eyeOpen).toBeGreaterThanOrEqual(1);
  });

  it("grabbedは大きく跳ねる", () => {
    expect(watcherPose("grabbed", 120).hop).toBeGreaterThan(0);
  });

  it("successは万歳して跳ねる", () => {
    const p = watcherPose("success", 200);
    expect(p.armRaise).toBeGreaterThan(0.5);
    expect(p.hop).toBeGreaterThan(0);
  });

  it("missedはのけぞってから0.8秒で戻る（悲しみを引きずらない）", () => {
    expect(Math.abs(watcherPose("missed", 60).tilt)).toBeGreaterThan(4);
    expect(Math.abs(watcherPose("missed", MISSED_DURATION + 10).tilt)).toBeLessThan(2);
  });

  it("missedでも目を閉じたり泣いたりしない（悲しませすぎない）", () => {
    for (let t = 0; t <= MISSED_DURATION; t += 40) {
      expect(watcherPose("missed", t).eyeOpen).toBeGreaterThan(0.5);
    }
  });

  it("どのmoodでもsquashが正で、全フィールドが有限", () => {
    for (const m of MOODS) {
      for (const t of [0, 40, 100, 500, 3000, 100000]) {
        const p = watcherPose(m, t);
        expect(p.squash, `${m}@${t}`).toBeGreaterThan(0);
        for (const [k, v] of Object.entries(p)) {
          expect(Number.isFinite(v), `${m}@${t} ${k}`).toBe(true);
        }
      }
    }
  });

  it("hopが負にならない（床にめり込まない）", () => {
    for (const m of MOODS) {
      for (let t = 0; t <= 3000; t += 20) {
        expect(watcherPose(m, t).hop, `${m}@${t}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("MOODS", () => {
  it("仕様7.9の7状態をすべて持つ", () => {
    const expected: WatcherMood[] = [
      "idle",
      "aiming",
      "dropping",
      "grabbed",
      "missed",
      "nearExit",
      "success",
    ];
    expect(new Set(MOODS)).toEqual(new Set(expected));
  });
});
