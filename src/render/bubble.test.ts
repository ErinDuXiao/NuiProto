import { describe, it, expect } from "vitest";
import { placeBubble } from "./bubble";

const bounds = { minX: 0, maxX: 320, minY: 0 };

describe("placeBubble", () => {
  it("通常は頭の上に出る", () => {
    const r = placeBubble({ anchorX: 160, headTopY: 200, textWidth: 100, bounds, others: [] });
    expect(r.below).toBe(false);
    expect(r.y).toBeLessThan(200);
  });

  it("上端に近ければ下側へ回す（画面外に出ない）", () => {
    const r = placeBubble({ anchorX: 160, headTopY: 10, textWidth: 100, bounds, others: [] });
    expect(r.below).toBe(true);
    expect(r.y).toBeGreaterThanOrEqual(bounds.minY);
  });

  it("左右の端をはみ出さない", () => {
    for (const x of [0, 5, 315, 320]) {
      const r = placeBubble({ anchorX: x, headTopY: 200, textWidth: 140, bounds, others: [] });
      expect(r.x - 70).toBeGreaterThanOrEqual(bounds.minX);
      expect(r.x + 70).toBeLessThanOrEqual(bounds.maxX);
    }
  });

  it("他の子の顔に被らないよう横へずらす", () => {
    const others = [{ x: 160, headTopY: 150 }];
    const clean = placeBubble({ anchorX: 160, headTopY: 250, textWidth: 100, bounds, others: [] });
    const avoid = placeBubble({ anchorX: 160, headTopY: 250, textWidth: 100, bounds, others });
    expect(avoid.x).not.toBeCloseTo(clean.x, 1);
  });

  it("どの入力でも有限の値を返す", () => {
    for (const anchorX of [-1000, 0, 160, 5000, Number.NaN]) {
      for (const headTopY of [-500, 0, 300, Number.NaN]) {
        const r = placeBubble({ anchorX, headTopY, textWidth: 100, bounds, others: [] });
        expect(Number.isFinite(r.x)).toBe(true);
        expect(Number.isFinite(r.y)).toBe(true);
      }
    }
  });
});
