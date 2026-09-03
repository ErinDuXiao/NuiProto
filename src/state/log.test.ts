import { describe, it, expect } from "vitest";
import { pushLog, LOG_LIMIT } from "./log";
import type { LogEvent } from "./types";

const ev = (n: number): LogEvent => ({ type: "shelf_view", t: n, sessionId: "s" });

describe("pushLog", () => {
  it("追加できる", () => {
    expect(pushLog([], ev(1))).toHaveLength(1);
  });

  it("上限を超えたら古いものから捨てる", () => {
    let log: LogEvent[] = [];
    for (let i = 0; i < LOG_LIMIT + 50; i++) log = pushLog(log, ev(i));
    expect(log).toHaveLength(LOG_LIMIT);
    expect(log[0].t).toBe(50);
    expect(log[log.length - 1].t).toBe(LOG_LIMIT + 49);
  });

  it("元の配列を変更しない", () => {
    const a: LogEvent[] = [ev(1)];
    pushLog(a, ev(2));
    expect(a).toHaveLength(1);
  });
});
