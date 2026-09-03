import { describe, it, expect } from "vitest";
import { individuality, applyIndividuality, shiftHue, NEUTRAL_POSE, lerp, lerpPose } from "./pose";
import { getPlush } from "../data/plushies";

describe("individuality", () => {
  it("seedが違えば別の個体差になる", () => {
    const a = individuality(0.1);
    const b = individuality(0.9);
    expect(a.hueShift).not.toBe(b.hueShift);
  });

  it("同じseedなら常に同じ", () => {
    expect(individuality(0.42)).toEqual(individuality(0.42));
  });

  it("色相ずれは±6度以内", () => {
    for (let s = 0; s <= 1; s += 0.05) {
      expect(Math.abs(individuality(s).hueShift)).toBeLessThanOrEqual(6);
    }
  });

  it("サイズずれは±4%以内", () => {
    for (let s = 0; s <= 1; s += 0.05) {
      expect(Math.abs(individuality(s).scale - 1)).toBeLessThanOrEqual(0.04);
    }
  });

  it("呼吸周期と瞬き間隔が仕様のレンジに入る", () => {
    for (let s = 0; s <= 1; s += 0.05) {
      const iv = individuality(s);
      expect(iv.breathPeriod).toBeGreaterThanOrEqual(2.4);
      expect(iv.breathPeriod).toBeLessThanOrEqual(3.2);
      expect(iv.blinkBase).toBeGreaterThanOrEqual(3);
      expect(iv.blinkBase).toBeLessThanOrEqual(7);
    }
  });

  it("applyIndividualityは元のdefを変更しない", () => {
    const def = getPlush("bear_01");
    const before = def.art.body;
    const beforeSize = def.size;
    applyIndividuality(def, 0.7);
    expect(def.art.body).toBe(before);
    expect(def.size).toBe(beforeSize);
  });

  it("applyIndividualityはsizeとbody色を変える", () => {
    const def = getPlush("bear_01");
    const v = applyIndividuality(def, 0.7);
    expect(v.size).not.toBe(def.size);
    expect(v.art.body).not.toBe(def.art.body);
  });

  it("個体差を適用しても有効なhex色のまま", () => {
    for (let s = 0; s <= 1; s += 0.07) {
      const v = applyIndividuality(getPlush("frog_01"), s);
      expect(v.art.body, `seed=${s}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(v.art.accent, `seed=${s}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("NaN / Infinity / 巨大なseedでもNaNを返さない", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, Number.MAX_VALUE, -0]) {
      const iv = individuality(bad);
      for (const [k, v] of Object.entries(iv)) {
        expect(Number.isFinite(v), `${k} @ ${bad}`).toBe(true);
      }
    }
  });

  it("壊れたseedでもdefのsizeと色が有効なまま", () => {
    for (const bad of [Number.NaN, Infinity, Number.MAX_VALUE]) {
      const v = applyIndividuality(getPlush("bear_01"), bad);
      expect(Number.isFinite(v.size), `${bad}`).toBe(true);
      expect(v.art.body, `${bad}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("同種2匹はseedが違えば見た目が違う（愛着の前提）", () => {
    const a = applyIndividuality(getPlush("rabbit_01"), 0.2);
    const b = applyIndividuality(getPlush("rabbit_01"), 0.8);
    expect(a.art.body).not.toBe(b.art.body);
  });
});

describe("shiftHue", () => {
  it("正常な色を回せる", () => {
    expect(shiftHue("#c9a37c", 10)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(shiftHue("#abc", 10)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("不正な色や角度は入力をそのまま返す（NaNを描画しない）", () => {
    for (const bad of ["", "not-a-color", "#12", "#1234567", "rgb(1,2,3)"]) {
      expect(shiftHue(bad, 10)).toBe(bad);
    }
    expect(shiftHue("#c9a37c", Number.NaN)).toBe("#c9a37c");
    expect(shiftHue("#c9a37c", Infinity)).toBe("#c9a37c");
  });
});

describe("NEUTRAL_POSE", () => {
  it("無変形である", () => {
    expect(NEUTRAL_POSE).toEqual({
      squash: 1,
      tilt: 0,
      eyeOpen: 1,
      lookAt: 0,
      armRaise: 0,
      hop: 0,
    });
  });
});

describe("lerp", () => {
  it("端点を返す", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });
  it("範囲外のtはクランプされる", () => {
    expect(lerp(0, 10, -5)).toBe(0);
    expect(lerp(0, 10, 5)).toBe(10);
  });
  it("lerpPoseは全フィールドを補間する", () => {
    const a = NEUTRAL_POSE;
    const b = { squash: 0.5, tilt: 10, eyeOpen: 0, lookAt: 1, armRaise: 1, hop: 20 };
    const mid = lerpPose(a, b, 0.5);
    expect(mid.squash).toBeCloseTo(0.75);
    expect(mid.tilt).toBeCloseTo(5);
    expect(mid.hop).toBeCloseTo(10);
  });
});
