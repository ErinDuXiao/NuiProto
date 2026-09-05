import { describe, it, expect } from "vitest";
import {
  computeNeighbors, pairKey, shelfPointOf,
  NEIGHBOR_LINK_DISTANCE, NEIGHBOR_BREAK_DISTANCE,
} from "./neighbors";
import { SHELF } from "./shelfLayout";
import { SLOT_SPACING } from "../state/persist";
import type { PlushInstance } from "../state/types";

const inst = (id: string, x: number, row: number, type = "bear_01"): PlushInstance => ({
  instanceId: id, plushTypeId: type, acquiredAt: 0,
  attemptsToAcquire: null, witnessedBy: null, origin: "crane",
  x, shelfRow: row, personalitySeed: 0.5,
});

const fresh = (instances: PlushInstance[], now = 1000) =>
  computeNeighbors(instances, [], {}, now);

describe("隣接の距離条件（仕様5.1）", () => {
  it("同じ段の隣は隣接する", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 78 + SLOT_SPACING, 1)]);
    expect(r.links).toHaveLength(1);
  });

  it("真上・真下は隣接する", () => {
    const r = fresh([inst("a", 160, 1), inst("b", 160, 2)]);
    expect(r.links).toHaveLength(1);
  });

  it("斜めは隣接しない（配置が読み取れるようにするため）", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 78 + SLOT_SPACING, 2)]);
    expect(r.links).toHaveLength(0);
  });

  it("段の間隔とスロット間隔が前提どおり", () => {
    expect(SLOT_SPACING).toBeLessThanOrEqual(NEIGHBOR_LINK_DISTANCE);
    const rowGap = SHELF.rowY[1] - SHELF.rowY[0];
    expect(rowGap).toBeLessThanOrEqual(NEIGHBOR_LINK_DISTANCE);
    expect(Math.hypot(SLOT_SPACING, rowGap)).toBeGreaterThan(NEIGHBOR_BREAK_DISTANCE);
  });

  it("箱の中（shelfRow < 0）は隣接判定に入らない", () => {
    const r = fresh([inst("a", 160, 1), inst("b", 160, -1)]);
    expect(r.links).toHaveLength(0);
  });
});

describe("ヒステリシス（点滅させない）", () => {
  it("一度隣になったら、少し離れただけでは切れない", () => {
    const a = inst("a", 100, 1);
    const b = inst("b", 100 + NEIGHBOR_LINK_DISTANCE - 2, 1);
    const first = computeNeighbors([a, b], [], {}, 0);
    expect(first.links).toHaveLength(1);

    const bFar = { ...b, x: 100 + NEIGHBOR_LINK_DISTANCE + 8 }; // 118 < 124
    const second = computeNeighbors([a, bFar], first.links, first.neighborSince, 100);
    expect(second.links, "解消閾値の内側なのに切れた").toHaveLength(1);
  });

  it("解消閾値を超えれば切れる", () => {
    const a = inst("a", 100, 1);
    const b = inst("b", 100 + NEIGHBOR_LINK_DISTANCE - 2, 1);
    const first = computeNeighbors([a, b], [], {}, 0);
    const bFar = { ...b, x: 100 + NEIGHBOR_BREAK_DISTANCE + 6 };
    const second = computeNeighbors([a, bFar], first.links, first.neighborSince, 100);
    expect(second.links).toHaveLength(0);
    expect(second.removed).toContain(pairKey("a", "b"));
  });
});

describe("リンクの生成と消滅", () => {
  it("新しいリンクを created で報告する", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 160, 1)]);
    expect(r.created).toEqual([pairKey("a", "b")]);
  });

  it("既存のリンクは created に入らない", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = fresh(list);
    const second = computeNeighbors(list, first.links, first.neighborSince, 2000);
    expect(second.created).toEqual([]);
  });

  it("切れたリンクの neighborSince を削除する", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = fresh(list);
    expect(Object.keys(first.neighborSince)).toHaveLength(1);
    const apart = [list[0], { ...list[1], x: 300 }];
    const second = computeNeighbors(apart, first.links, first.neighborSince, 2000);
    expect(second.neighborSince).toEqual({});
  });

  it("pairKey は順序に依存しない", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});

describe("togetherMs は連続して隣にいる時間", () => {
  it("時間とともに増える", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 1000);
    expect(first.links[0].togetherMs).toBe(0);
    const later = computeNeighbors(list, first.links, first.neighborSince, 6000);
    expect(later.links[0].togetherMs).toBe(5000);
  });

  it("一度離すと 0 に戻る", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 0);
    const apart = [list[0], { ...list[1], x: 300 }];
    const gone = computeNeighbors(apart, first.links, first.neighborSince, 60_000);
    const again = computeNeighbors(list, gone.links, gone.neighborSince, 61_000);
    expect(again.links[0].togetherMs).toBe(0);
  });
});

describe("親密度", () => {
  it("近いほど高い", () => {
    const near = fresh([inst("a", 100, 1), inst("b", 160, 1)]).links[0];
    const far = fresh([inst("a", 100, 1), inst("b", 205, 1)]).links[0];
    expect(near.affinity).toBeGreaterThan(far.affinity);
  });

  it("同じ種類のほうが高い", () => {
    const same = fresh([inst("a", 78, 1, "bear_01"), inst("b", 160, 1, "bear_01")]).links[0];
    const diff = fresh([inst("a", 78, 1, "bear_01"), inst("b", 160, 1, "fox_01")]).links[0];
    expect(same.affinity).toBeGreaterThan(diff.affinity);
    expect(same.sameType).toBe(true);
  });

  it("一緒に迎えた関係のほうが高い", () => {
    const a = inst("a", 78, 1);
    const b = { ...inst("b", 160, 1), witnessedBy: "a" };
    const together = fresh([a, b]).links[0];
    const apart = fresh([a, inst("b", 160, 1)]).links[0];
    expect(together.cameHomeTogether).toBe(true);
    expect(together.affinity).toBeGreaterThan(apart.affinity);
  });

  it("長く隣にいるほど高い", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 0);
    const later = computeNeighbors(list, first.links, first.neighborSince, 200_000);
    expect(later.links[0].affinity).toBeGreaterThan(first.links[0].affinity);
  });
});

describe("隣接は各方向でいちばん近い1匹だけ（仕様5.1）", () => {
  it("同じ段に3匹並ぶと、端どうしは隣接しない", () => {
    const r = fresh([
      inst("l", 78, 1),
      inst("m", 78 + SLOT_SPACING, 1),
      inst("rr", 78 + SLOT_SPACING * 2, 1),
    ]);
    const keys = r.links.map((k) => pairKey(k.a, k.b));
    expect(keys).toContain(pairKey("l", "m"));
    expect(keys).toContain(pairKey("m", "rr"));
    // 端どうしは間に m がいるので隣ではない
    expect(keys).not.toContain(pairKey("l", "rr"));
  });

  it("重なって置かれても、隣は左右上下でそれぞれ1匹まで", () => {
    // 距離だけで判定すると 3 匹が総当たりで 3 本張ってしまう
    const r = fresh([inst("a", 160, 1), inst("b", 168, 1), inst("c", 176, 1)]);
    for (const id of ["a", "b", "c"]) {
      const degree = r.links.filter((k) => k.a === id || k.b === id).length;
      expect(degree, `${id} の隣が多すぎる`).toBeLessThanOrEqual(4);
    }
    expect(r.links.map((k) => pairKey(k.a, k.b))).not.toContain(pairKey("a", "c"));
  });

  it("リンクは対称。片方から見て隣なら、もう片方から見ても隣", () => {
    const r = fresh([inst("a", 100, 1), inst("b", 170, 1), inst("c", 240, 1)]);
    for (const k of r.links) {
      expect(k.a < k.b, "リンクの端点は辞書順に正規化されている").toBe(true);
    }
    expect(new Set(r.links.map((k) => pairKey(k.a, k.b))).size).toBe(r.links.length);
  });
});

describe("規模", () => {
  it("棚が満杯でもリンクは幾何的な上界を超えない", () => {
    const all: PlushInstance[] = [];
    for (let row = 0; row < SHELF.rows; row++) {
      for (let col = 0; col < 3; col++) {
        all.push(inst(`p${row}-${col}`, 78 + col * SLOT_SPACING, row));
      }
    }
    const r = fresh(all);
    // 各個体の隣は左右上下の最大4つ。12 * 4 / 2 = 24
    expect(r.links.length).toBeLessThanOrEqual(24);
    expect(r.links.length).toBeGreaterThan(0);
  });

  it("全員が同座標でも、リンクが総当たりにならない", () => {
    // 距離だけで判定すると C(12,2) = 66 本になる。それは「隣にいる」ではない。
    const all = Array.from({ length: 12 }, (_, i) => inst(`p${i}`, 160, 1));
    const r = fresh(all);
    expect(r.links.length, "総当たりになっている").toBeLessThanOrEqual(24);
    expect(Object.keys(r.neighborSince).length).toBeLessThanOrEqual(24);
  });

  it("0匹・1匹でも落ちない", () => {
    expect(fresh([]).links).toEqual([]);
    expect(fresh([inst("a", 160, 1)]).links).toEqual([]);
  });
});

describe("shelfPointOf", () => {
  it("段のY座標を返す", () => {
    expect(shelfPointOf(inst("a", 160, 2))).toEqual({ x: 160, y: SHELF.rowY[2] });
  });
});
