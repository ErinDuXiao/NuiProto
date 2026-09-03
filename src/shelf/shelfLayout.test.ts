import { describe, it, expect } from "vitest";
import { clampToShelf, defaultSlot, SHELF } from "./shelfLayout";
import { SHELF_CAPACITY, SHELF_ROWS, SLOT_SPACING } from "../state/persist";

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
  it("定員分のスロットは同じ段で互いに重ならない", () => {
    const slots = Array.from({ length: SHELF_CAPACITY }, (_, i) => defaultSlot(i));
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[i].shelfRow !== slots[j].shelfRow) continue;
        expect(Math.abs(slots[i].x - slots[j].x), `${i}-${j}`).toBeGreaterThanOrEqual(72);
      }
    }
  });

  it("全スロットがキャビネットの内側にある（側板からはみ出さない）", () => {
    const MAX_R = 36; // 最大サイズ34 × 個体差1.05
    for (let i = 0; i < SHELF_CAPACITY; i++) {
      const s = defaultSlot(i);
      expect(s.x - MAX_R, `slot ${i} 左`).toBeGreaterThanOrEqual(SHELF.frameLeft);
      expect(s.x + MAX_R, `slot ${i} 右`).toBeLessThanOrEqual(SHELF.frameRight);
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

  it("定員を超えたら箱の中を表す -1 を返す", () => {
    expect(defaultSlot(SHELF_CAPACITY).shelfRow).toBe(-1);
    expect(defaultSlot(99).shelfRow).toBe(-1);
  });
});

describe("SHELF", () => {
  it("段数が定数と一致し、段のY座標が上から下に並ぶ", () => {
    expect(SHELF.rows).toBe(SHELF_ROWS);
    expect(SHELF.rowY).toHaveLength(SHELF_ROWS);
    for (let i = 1; i < SHELF.rowY.length; i++) {
      expect(SHELF.rowY[i - 1]).toBeLessThan(SHELF.rowY[i]);
    }
  });

  it("スロット間隔がぬいぐるみの直径より広い", () => {
    expect(SLOT_SPACING).toBeGreaterThan(72);
  });
});
