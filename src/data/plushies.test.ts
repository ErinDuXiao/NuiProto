import { describe, it, expect } from "vitest";
import { PLUSHIES, getPlush, plushCoefficient } from "./plushies";

describe("plush data", () => {
  it("10種ある", () => {
    expect(PLUSHIES).toHaveLength(10);
  });

  it("idが重複しない", () => {
    const ids = PLUSHIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("全個体がパラメータレンジを守る", () => {
    for (const p of PLUSHIES) {
      expect(p.weight, p.id).toBeGreaterThanOrEqual(0.8);
      expect(p.weight, p.id).toBeLessThanOrEqual(1.2);
      expect(p.softness, p.id).toBeGreaterThanOrEqual(0);
      expect(p.softness, p.id).toBeLessThanOrEqual(1);
      expect(p.size, p.id).toBeGreaterThanOrEqual(26);
      expect(p.size, p.id).toBeLessThanOrEqual(34);
    }
  });

  it("個体係数kが1.8倍幅に収まる", () => {
    const ks = PLUSHIES.map(plushCoefficient);
    expect(Math.min(...ks)).toBeGreaterThanOrEqual(0.65);
    expect(Math.max(...ks)).toBeLessThanOrEqual(1.18);
  });

  it("bear_01とrabbit_01が存在する", () => {
    expect(getPlush("bear_01").name).toBeTruthy();
    expect(getPlush("rabbit_01").name).toBeTruthy();
  });

  it("rabbit_01は最も掴みやすい部類（k>=1.05）", () => {
    expect(plushCoefficient(getPlush("rabbit_01"))).toBeGreaterThanOrEqual(1.05);
  });

  it("2シリーズに分かれている", () => {
    const s = new Set(PLUSHIES.map((p) => p.series));
    expect(s).toEqual(new Set(["forest_friends", "ocean_friends"]));
  });

  it("未知のidはエラーになる", () => {
    expect(() => getPlush("dragon_99")).toThrow();
  });
});
