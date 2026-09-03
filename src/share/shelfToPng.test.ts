import { describe, it, expect } from "vitest";
import { encodeShelf, decodeShelf, buildShelfSvg, SHARE_W, SHARE_H } from "./shelfToPng";
import type { OwnedPlush } from "../state/types";

const owned: OwnedPlush[] = [
  { uid: "u1", defId: "bear_01", acquiredAt: 1, x: 78, shelfRow: 1, seed: 0.3 },
  { uid: "u2", defId: "rabbit_01", acquiredAt: 2, x: 160, shelfRow: 1, seed: 0.7 },
];

describe("encodeShelf / decodeShelf", () => {
  it("往復して一致する", () => {
    const back = decodeShelf(encodeShelf(owned));
    expect(back).toHaveLength(2);
    expect(back![0].defId).toBe("bear_01");
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

  it("未知のdefIdを含む文字列は無視する", () => {
    const s = encodeShelf([
      ...owned,
      { uid: "u3", defId: "dragon_99", acquiredAt: 3, x: 0, shelfRow: 0, seed: 0.1 },
    ]);
    expect(decodeShelf(s)).toHaveLength(2);
  });

  it("箱の中(shelfRow=-1)は含めない", () => {
    const s = encodeShelf([
      ...owned,
      { uid: "u3", defId: "fox_01", acquiredAt: 3, x: 0, shelfRow: -1, seed: 0.1 },
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
    const many: OwnedPlush[] = Array.from({ length: 12 }, (_, i) => ({
      uid: `u${i}`,
      defId: "duck_01",
      acquiredAt: i,
      x: 78 + (i % 3) * 82,
      shelfRow: Math.floor(i / 3),
      seed: i / 12,
    }));
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
    const withBoxed: OwnedPlush[] = [
      ...owned,
      { uid: "u3", defId: "fox_01", acquiredAt: 3, x: 0, shelfRow: -1, seed: 0.1 },
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
