import { describe, it, expect } from "vitest";
import { buildLogJson } from "./devActions";
import { initialSave } from "../state/persist";

describe("buildLogJson", () => {
  it("正しいJSONを返す", () => {
    const s = initialSave();
    s.log.push({ type: "plush_won", t: 123, sessionId: "s1", plushId: "rabbit_01", attempt: 2 });
    const parsed = JSON.parse(buildLogJson(s));
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].plushId).toBe("rabbit_01");
  });

  it("あとで分析しやすいようサマリを含む", () => {
    const parsed = JSON.parse(buildLogJson(initialSave()));
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.ownedCount).toBe(1);
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.version).toBe(1);
  });

  it("愛着の代理指標を集計する（仕様17.2）", () => {
    const s = initialSave();
    s.log.push(
      { type: "shelf_dwell", t: 1, sessionId: "a", meta: { ms: 4000 } },
      { type: "shelf_dwell", t: 2, sessionId: "a", meta: { ms: 12000 } },
      { type: "shelf_dwell", t: 3, sessionId: "a", meta: { ms: 9000 } },
      { type: "plush_touched", t: 4, sessionId: "a" },
      { type: "plush_touched", t: 5, sessionId: "a" },
      { type: "plush_repositioned", t: 6, sessionId: "a" },
      { type: "welcome_played", t: 7, sessionId: "a", meta: { count: 2, skipped: false } },
      { type: "welcome_played", t: 8, sessionId: "a", meta: { count: 3, skipped: true } }
    );
    const p = JSON.parse(buildLogJson(s));
    expect(p.summary.shelfDwellMedianMs).toBe(9000);
    expect(p.summary.touches).toBe(2);
    expect(p.summary.repositions).toBe(1);
    expect(p.summary.welcomeSkippedAt).toEqual([3]);
    expect(p.summary.welcomePlayed).toBe(2);
  });

  it("空のログでも壊れない", () => {
    expect(() => JSON.parse(buildLogJson(initialSave()))).not.toThrow();
    const p = JSON.parse(buildLogJson(initialSave()));
    expect(p.summary.shelfDwellMedianMs).toBeNull();
    expect(p.summary.aimErrors).toEqual([]);
  });

  it("クレーンの照準誤差を集計する（σの較正に使う）", () => {
    const s = initialSave();
    s.log.push(
      { type: "crane_drop", t: 1, sessionId: "a", attempt: 1, meta: { d: 10 } },
      { type: "crane_drop", t: 2, sessionId: "a", attempt: 2, meta: { d: 30 } }
    );
    const p = JSON.parse(buildLogJson(s));
    expect(p.summary.aimErrors).toEqual([10, 30]);
    expect(p.summary.aimErrorMedian).toBe(20);
  });
});
