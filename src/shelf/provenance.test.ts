import { describe, it, expect } from "vitest";
import { provenanceLines } from "./provenance";
import type { PlushInstance } from "../state/types";

const base: PlushInstance = {
  instanceId: "r1", plushTypeId: "rabbit_01",
  acquiredAt: new Date("2026-09-04T10:00:00").getTime(),
  attemptsToAcquire: 3, witnessedBy: "b1", origin: "crane",
  x: 160, shelfRow: 1, personalitySeed: 0.5,
};
const bear: PlushInstance = {
  ...base, instanceId: "b1", plushTypeId: "bear_01",
  attemptsToAcquire: null, witnessedBy: null, origin: "starter",
};
const NOW = new Date("2026-09-10T10:00:00").getTime();

describe("provenanceLines", () => {
  it("いつ・何回目で・誰が見ていたかを出す", () => {
    const lines = provenanceLines(base, [base, bear], NOW);
    expect(lines).toContain("9月4日にやってきた");
    expect(lines).toContain("3回目でおうちに来た");
    expect(lines).toContain("ブラウンベアが一緒に見ていた");
  });

  it("1回で取れた子は「1回目で」と書かない", () => {
    const lines = provenanceLines({ ...base, attemptsToAcquire: 1 }, [base, bear], NOW);
    expect(lines.some((l) => l.includes("1回目"))).toBe(false);
    expect(lines).toContain("すぐにおうちに来た");
  });

  it("starter は1行だけ", () => {
    expect(provenanceLines(bear, [bear], NOW)).toEqual(["はじめからここにいた"]);
  });

  it("unknown は来歴を捏造しない", () => {
    const u = { ...base, origin: "unknown" as const, attemptsToAcquire: null, witnessedBy: null };
    expect(provenanceLines(u, [u], NOW)).toEqual(["いつからか、ここにいる"]);
  });

  it("granted は来歴を捏造しない", () => {
    const g = { ...base, origin: "granted" as const, attemptsToAcquire: null, witnessedBy: null };
    expect(provenanceLines(g, [g], NOW)).toEqual(["いつからか、ここにいる"]);
  });

  it("見守り役が居なくなっていたらその行を出さない", () => {
    const lines = provenanceLines(base, [base], NOW);
    expect(lines.some((l) => l.includes("見ていた"))).toBe(false);
    expect(lines).toContain("3回目でおうちに来た");
  });

  it("今日来た子は「きょう」と書く", () => {
    const lines = provenanceLines({ ...base, acquiredAt: NOW - 60_000 }, [base, bear], NOW);
    expect(lines[0]).toBe("きょう、やってきた");
  });

  it("いつ来たか分からない子には日付を捏造しない", () => {
    // 保存データが壊れて acquiredAt が失われた場合。以前はここが
    // 現在時刻で埋められ「きょう、やってきた」と断定していた。
    const lines = provenanceLines({ ...base, acquiredAt: null }, [base, bear], NOW);
    expect(lines.some((l) => l.includes("きょう"))).toBe(false);
    expect(lines.some((l) => /\d+月\d+日/.test(l))).toBe(false);
    expect(lines).toContain("いつからか、ここにいる");
  });

  it("日付が分からなくても、回数と見守り役は語る", () => {
    // 分からない1つを隠すために、分かっている残りまで捨てない。
    const lines = provenanceLines({ ...base, acquiredAt: null }, [base, bear], NOW);
    expect(lines).toContain("3回目でおうちに来た");
    expect(lines).toContain("ブラウンベアが一緒に見ていた");
  });

  it("数値・レアリティ・能力値を出さない", () => {
    const all = provenanceLines(base, [base, bear], NOW).join(" ");
    expect(/rare|common|special|レア|Lv|ポイント|好感度/i.test(all)).toBe(false);
  });

  it("どの入力でも空配列にならない", () => {
    for (const o of ["starter", "crane", "granted", "unknown"] as const) {
      expect(provenanceLines({ ...base, origin: o }, [base], NOW).length).toBeGreaterThan(0);
      // 何も分からない状態でも「言うことが無い」空欄にはしない
      const blank = { ...base, origin: o, acquiredAt: null, attemptsToAcquire: null, witnessedBy: null };
      expect(provenanceLines(blank, [base], NOW).length).toBeGreaterThan(0);
    }
  });
});
