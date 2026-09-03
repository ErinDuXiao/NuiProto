import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PlushSVG } from "./PlushSVG";
import { NEUTRAL_POSE, type Pose } from "./pose";
import { PLUSHIES, getPlush } from "../data/plushies";

function renderPlush(id: string, pose: Pose = NEUTRAL_POSE, seed = 0.5) {
  const { container } = render(
    <svg>
      <PlushSVG def={getPlush(id)} pose={pose} seed={seed} />
    </svg>
  );
  return container.querySelector("svg")!;
}

describe("PlushSVG 直列化制約 (仕様10章)", () => {
  it("全種で <use> / <image> / <text> を使わない", () => {
    for (const p of PLUSHIES) {
      const svg = renderPlush(p.id);
      expect(svg.querySelector("use"), p.id).toBeNull();
      expect(svg.querySelector("image"), p.id).toBeNull();
      expect(svg.querySelector("text"), p.id).toBeNull();
    }
  });

  it("全種で外部参照フィルタを使わない", () => {
    for (const p of PLUSHIES) {
      const svg = renderPlush(p.id);
      expect(svg.querySelector("filter"), p.id).toBeNull();
      expect(svg.innerHTML.includes("url("), p.id).toBe(false);
    }
  });

  it("classNameに依存せず色をインラインで持つ", () => {
    const svg = renderPlush("bear_01");
    expect(svg.innerHTML).toContain("#");
    expect(svg.querySelector("[class]")).toBeNull();
  });

  it("全種が描画され、要素が複数ある", () => {
    for (const p of PLUSHIES) {
      expect(renderPlush(p.id).querySelectorAll("*").length, p.id).toBeGreaterThan(3);
    }
  });

  it("数値属性にNaNが混入しない", () => {
    for (const p of PLUSHIES) {
      for (const pose of [
        NEUTRAL_POSE,
        { squash: 0.6, tilt: -20, eyeOpen: 0, lookAt: -1, armRaise: 1, hop: 14 },
        { squash: 1.3, tilt: 20, eyeOpen: 1, lookAt: 1, armRaise: 0, hop: 0 },
      ]) {
        expect(renderPlush(p.id, pose).innerHTML, `${p.id}`).not.toContain("NaN");
      }
    }
  });
});

describe("PlushSVG ポーズ", () => {
  it("eyeOpen=0 のとき瞳の楕円が閉じた線に置き換わる", () => {
    const open = renderPlush("bear_01", NEUTRAL_POSE);
    const shut = renderPlush("bear_01", { ...NEUTRAL_POSE, eyeOpen: 0 });
    const eyes = (svg: SVGElement) => svg.querySelectorAll('[data-part="eye"]').length;
    const lids = (svg: SVGElement) => svg.querySelectorAll('[data-part="eyelid"]').length;
    expect(eyes(open)).toBe(2);
    expect(lids(open)).toBe(0);
    expect(eyes(shut)).toBe(0);
    expect(lids(shut)).toBe(2);
  });

  it("tiltがtransformに反映される", () => {
    const svg = renderPlush("bear_01", { ...NEUTRAL_POSE, tilt: 12 });
    expect(svg.querySelector("g")!.getAttribute("transform")).toContain("rotate(12");
  });

  it("lookAtで瞳が左右にずれる", () => {
    const left = renderPlush("bear_01", { ...NEUTRAL_POSE, lookAt: -1 });
    const right = renderPlush("bear_01", { ...NEUTRAL_POSE, lookAt: 1 });
    const cx = (svg: SVGElement) =>
      Number(svg.querySelector('[data-part="eye"]')!.getAttribute("cx"));
    expect(cx(left)).toBeLessThan(cx(right));
  });

  it("armRaiseで手の位置が上がる", () => {
    const down = renderPlush("bear_01", { ...NEUTRAL_POSE, armRaise: 0 });
    const up = renderPlush("bear_01", { ...NEUTRAL_POSE, armRaise: 1 });
    const cy = (svg: SVGElement) =>
      Number(svg.querySelector('[data-part="arm"]')!.getAttribute("cy"));
    expect(cy(up)).toBeLessThan(cy(down));
  });

  it("影を feGaussianBlur ではなく楕円で表現する", () => {
    const svg = renderPlush("bear_01");
    expect(svg.querySelector("feGaussianBlur")).toBeNull();
    expect(svg.querySelector('[data-part="shadow"]')).not.toBeNull();
  });
});
