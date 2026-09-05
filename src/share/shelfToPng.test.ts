import { describe, it, expect } from "vitest";
import { encodeShelf, decodeShelf, buildShelfSvg, SHARE_W, SHARE_H } from "./shelfToPng";
import type { PlushInstance } from "../state/types";

/** テスト用の個体を組み立てる。来歴は共有画像に関係しないので既定値でよい。 */
function inst(
  instanceId: string,
  plushTypeId: string,
  acquiredAt: number,
  x: number,
  shelfRow: number,
  personalitySeed: number
): PlushInstance {
  return {
    instanceId,
    plushTypeId,
    acquiredAt,
    attemptsToAcquire: null,
    witnessedBy: null,
    origin: "unknown",
    x,
    shelfRow,
    personalitySeed,
  };
}

const owned: PlushInstance[] = [
  inst("u1", "bear_01", 1, 78, 1, 0.3),
  inst("u2", "rabbit_01", 2, 160, 1, 0.7),
];

describe("encodeShelf / decodeShelf", () => {
  it("往復して一致する", () => {
    const back = decodeShelf(encodeShelf(owned));
    expect(back).toHaveLength(2);
    expect(back![0].plushTypeId).toBe("bear_01");
    expect(back![1].x).toBe(160);
    expect(back![1].shelfRow).toBe(1);
  });

  it("URLに載せられる文字だけを使う", () => {
    expect(encodeShelf(owned)).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("壊れた文字列にはnullを返す", () => {
    expect(decodeShelf("!!!!")).toBeNull();
    expect(decodeShelf("")).toBeNull();
    expect(decodeShelf("bm90LWpzb24")).toBeNull();
  });

  it("空の棚も往復できる", () => {
    expect(decodeShelf(encodeShelf([]))).toEqual([]);
  });

  it("未知のplushTypeIdを含む文字列は無視する", () => {
    const s = encodeShelf([
      ...owned,
      inst("u3", "dragon_99", 3, 0, 0, 0.1),
    ]);
    expect(decodeShelf(s)).toHaveLength(2);
  });

  it("箱の中(shelfRow=-1)は含めない", () => {
    const s = encodeShelf([
      ...owned,
      inst("u3", "fox_01", 3, 0, -1, 0.1),
    ]);
    expect(decodeShelf(s)).toHaveLength(2);
  });

  it("段が整数でない・座標が非有限な入力を拒む", () => {
    const bad = btoa(JSON.stringify([["bear_01", 100, 1.5, 0.5], ["bear_01", 1e9, 1, 0.5]]))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeShelf(bad)).toEqual([]);
  });

  it("極端に長い入力を拒む（資源を食わせない）", () => {
    expect(decodeShelf("A".repeat(20000))).toBeNull();
  });

  it("多数所持でも壊れない", () => {
    const many: PlushInstance[] = Array.from({ length: 12 }, (_, i) =>
      inst(`u${i}`, "duck_01", i, 78 + (i % 3) * 82, Math.floor(i / 3), i / 12)
    );
    expect(decodeShelf(encodeShelf(many))).toHaveLength(12);
  });
});

describe("buildShelfSvg 直列化制約 (仕様10章)", () => {
  const svg = buildShelfSvg(owned);

  it("スタンドアロンSVGとして完結している", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox`);
  });

  it("文字を含まない（文字はcanvas側で描く）", () => {
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("@font-face");
    expect(svg).not.toContain("font-family");
  });

  it("外部参照を含まない", () => {
    expect(svg).not.toContain("<use");
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("url(");
    expect(svg).not.toContain("<filter");
    expect(svg).not.toContain("xlink");
  });

  it("classに依存しない", () => {
    expect(svg).not.toContain("class=");
  });

  it("全ぬいぐるみが描かれる", () => {
    expect(svg.length).toBeGreaterThan(buildShelfSvg([]).length);
  });

  it("箱の中(shelfRow=-1)は描かない", () => {
    const withBoxed: PlushInstance[] = [
      ...owned,
      inst("u3", "fox_01", 3, 0, -1, 0.1),
    ];
    expect(buildShelfSvg(withBoxed).length).toBe(svg.length);
  });

  it("日本語を含まない（フォント解決に依存しない）", () => {
    expect(/[ぁ-んァ-ヶ一-龠]/.test(svg)).toBe(false);
  });

  it("NaN を含まない", () => {
    expect(svg).not.toContain("NaN");
  });

  it("縦4:5で書き出す（部屋が縦長なので余白が出にくい）", () => {
    expect(svg).toContain(`viewBox="0 0 ${SHARE_W} ${SHARE_H}"`);
    expect(SHARE_H / SHARE_W).toBeCloseTo(1.25, 2);
  });
});
