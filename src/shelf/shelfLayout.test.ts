import { describe, it, expect } from "vitest";
import { clampToShelf, defaultSlot, resolveOverlaps, rowCapacity, rowFromY, snapPlacement, SHELF } from "./shelfLayout";
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

const item = (uid: string, x: number, shelfRow = 0, r = 32) => ({ uid, x, shelfRow, r });

describe("rowFromY", () => {
  it("各段のY座標が対応する段に落ちる", () => {
    for (let row = 0; row < SHELF.rows; row++) {
      expect(rowFromY(SHELF.rowY[row]), `row ${row}`).toBe(row);
    }
  });
  it("範囲外のYは端の段にクランプされる", () => {
    expect(rowFromY(-9999)).toBe(0);
    expect(rowFromY(9999)).toBe(SHELF.rows - 1);
  });
  it("NaNでも有効な段を返す", () => {
    expect(rowFromY(Number.NaN)).toBeGreaterThanOrEqual(0);
  });
});

describe("rowCapacity", () => {
  it("1段あたり3匹以上入る", () => {
    expect(rowCapacity(0)).toBeGreaterThanOrEqual(3);
  });
});

describe("resolveOverlaps", () => {
  it("重なった2匹を離す", () => {
    const [a, b] = resolveOverlaps([item("a", 100), item("b", 110)]);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(64 * 0.9);
  });

  it("解消後も全員が棚の内側にいる", () => {
    const out = resolveOverlaps([item("a", 100), item("b", 102), item("c", 104)]);
    for (const o of out) {
      expect(o.x).toBeGreaterThanOrEqual(SHELF.frameLeft);
      expect(o.x).toBeLessThanOrEqual(SHELF.frameRight);
    }
  });

  it("1段に入りきらない分は別の段へ移す", () => {
    const many = Array.from({ length: 6 }, (_, i) => item(`p${i}`, 160, 0, 32));
    expect(new Set(resolveOverlaps(many).map((o) => o.shelfRow)).size).toBeGreaterThan(1);
  });

  it("重ならない配置はそのまま保つ", () => {
    const input = [item("a", 78), item("b", 160), item("c", 242)];
    expect(resolveOverlaps(input).map((o) => o.x)).toEqual([78, 160, 242]);
  });

  it("個体を失わない", () => {
    const input = [item("a", 100), item("b", 105), item("c", 110)];
    expect(new Set(resolveOverlaps(input).map((o) => o.uid))).toEqual(new Set(["a", "b", "c"]));
  });

  it("全段が満杯でも終了し、個体を失わない（無限ループしない）", () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`p${i}`, 160, 1, 34));
    expect(resolveOverlaps(many)).toHaveLength(20);
  });

  it("完全に同座標が多数あっても終了する", () => {
    const same = Array.from({ length: 8 }, (_, i) => item(`s${i}`, 160, 0, 32));
    expect(() => resolveOverlaps(same)).not.toThrow();
    expect(resolveOverlaps(same)).toHaveLength(8);
  });

  it("入力を書き換えない", () => {
    const input = [item("a", 100), item("b", 105)];
    resolveOverlaps(input);
    expect(input[1].x).toBe(105);
  });
});

describe("snapPlacement", () => {
  const others = [item("a", 160, 1, 32)];

  it("空いている場所にはそのまま置ける", () => {
    expect(snapPlacement("b", 240, 1, 32, others).x).toBeCloseTo(240, 0);
    expect(snapPlacement("b", 240, 1, 32, others).reverted).toBe(false);
  });

  it("重なる位置に置くと押し出される", () => {
    const p = snapPlacement("b", 168, 1, 32, others);
    expect(Math.abs(p.x - 160)).toBeGreaterThanOrEqual(60);
  });

  it("棚の外には置けない", () => {
    expect(snapPlacement("b", -500, 1, 32, others).x).toBeGreaterThanOrEqual(SHELF.frameLeft);
    expect(snapPlacement("b", 9999, 1, 32, others).x).toBeLessThanOrEqual(SHELF.frameRight);
  });

  it("自分自身とは衝突しない", () => {
    const p = snapPlacement("a", 160, 1, 32, others);
    expect(p.x).toBeCloseTo(160, 0);
    expect(p.reverted).toBe(false);
  });

  it("段がいっぱいなら空いている隣の段へ移す", () => {
    const full = [item("x", 78, 1, 34), item("y", 160, 1, 34), item("z", 242, 1, 34)];
    const p = snapPlacement("n", 160, 1, 34, full);
    expect(p.reverted).toBe(false);
    expect(p.shelfRow).not.toBe(1);
  });

  it("全段が満杯なら移動を取り消す（無言で消えたり重なったりしない）", () => {
    const full = Array.from({ length: 12 }, (_, i) =>
      item(`f${i}`, 78 + (i % 3) * 82, Math.floor(i / 3), 34)
    );
    const p = snapPlacement("newcomer", 160, 2, 34, full);
    expect(p.reverted).toBe(true);
  });

  it("NaNの座標でも有限の結果を返す", () => {
    const p = snapPlacement("b", Number.NaN, Number.NaN, 32, others);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(p.shelfRow).toBeGreaterThanOrEqual(0);
  });
});
