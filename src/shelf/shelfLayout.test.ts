import { describe, it, expect } from "vitest";
import { clampToShelf, defaultSlot, SHELF } from "./shelfLayout";

describe("clampToShelf", () => {
  it("左端をはみ出さない", () => {
    expect(clampToShelf(-100, 32)).toBeGreaterThanOrEqual(32);
  });
  it("右端をはみ出さない", () => {
    expect(clampToShelf(9999, 32)).toBeLessThanOrEqual(SHELF.width - 32);
  });
  it("内側の値はそのまま", () => {
    expect(clampToShelf(160, 32)).toBe(160);
  });
  it("棚より大きい個体でも有限の値を返す", () => {
    expect(Number.isFinite(clampToShelf(100, 9999))).toBe(true);
  });
});

describe("defaultSlot", () => {
  it("最初の12匹は同じ段で互いに重ならない", () => {
    const slots = Array.from({ length: 12 }, (_, i) => defaultSlot(i));
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[i].shelfRow !== slots[j].shelfRow) continue;
        expect(Math.abs(slots[i].x - slots[j].x), `${i}-${j}`).toBeGreaterThanOrEqual(68);
      }
    }
  });

  it("全スロットが棚の内側にある", () => {
    for (let i = 0; i < 12; i++) {
      const s = defaultSlot(i);
      expect(s.x).toBeGreaterThanOrEqual(34);
      expect(s.x).toBeLessThanOrEqual(SHELF.width - 34);
      expect(s.shelfRow).toBeGreaterThanOrEqual(0);
      expect(s.shelfRow).toBeLessThan(SHELF.rows);
    }
  });

  it("2匹目は1匹目の隣に来る（出会いの演出で並んで見えること）", () => {
    const a = defaultSlot(0);
    const b = defaultSlot(1);
    expect(b.shelfRow).toBe(a.shelfRow);
    expect(Math.abs(b.x - a.x)).toBeLessThan(120);
  });

  it("12匹を超えたら箱の中を表す -1 を返す", () => {
    expect(defaultSlot(12).shelfRow).toBe(-1);
    expect(defaultSlot(99).shelfRow).toBe(-1);
  });
});

describe("SHELF", () => {
  it("3段あり、段のY座標が上から下に並ぶ", () => {
    expect(SHELF.rows).toBe(3);
    expect(SHELF.rowY).toHaveLength(3);
    expect(SHELF.rowY[0]).toBeLessThan(SHELF.rowY[1]);
    expect(SHELF.rowY[1]).toBeLessThan(SHELF.rowY[2]);
  });
});
