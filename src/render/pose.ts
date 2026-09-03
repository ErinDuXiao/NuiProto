import type { PlushDef } from "../state/types";

/**
 * ぬいぐるみの姿勢。棚・見守り・クレーン盤面のすべてでこの型を使う。
 * PlushSVG は PlushDef と Pose だけを受け取る純粋な描画であり、状態を持たない。
 */
export type Pose = {
  /** 1.0 = 通常, <1 潰れ, >1 伸び */
  squash: number;
  /** 傾き (deg) */
  tilt: number;
  /** 0-1。0 で目を閉じる */
  eyeOpen: number;
  /** -1(左) .. 0(正面) .. 1(右) */
  lookAt: number;
  /** 0-1。1 で万歳 */
  armRaise: number;
  /** 縦オフセット (px)。正で上に浮く */
  hop: number;
};

export const NEUTRAL_POSE: Pose = {
  squash: 1,
  tilt: 0,
  eyeOpen: 1,
  lookAt: 0,
  armRaise: 0,
  hop: 0,
};

export function lerp(a: number, b: number, t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return a + (b - a) * c;
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    squash: lerp(a.squash, b.squash, t),
    tilt: lerp(a.tilt, b.tilt, t),
    eyeOpen: lerp(a.eyeOpen, b.eyeOpen, t),
    lookAt: lerp(a.lookAt, b.lookAt, t),
    armRaise: lerp(a.armRaise, b.armRaise, t),
    hop: lerp(a.hop, b.hop, t),
  };
}

/** 0-1 に収める。 */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export type Individuality = {
  /** 本体色の色相ずれ (deg, ±10) */
  hueShift: number;
  /** 彩度の倍率 (0.75-1.25) */
  satMul: number;
  /** 明度の加算 (±0.05) */
  lightAdd: number;
  /** サイズ倍率 (±5%) */
  scale: number;
  /** 呼吸周期 (秒, 2.4-3.2) */
  breathPeriod: number;
  /** 瞬きの基準間隔 (秒, 3-7) */
  blinkBase: number;
  /** おしゃべりの頻度 0-1 */
  chatty: number;
  /** セリフ選択用 0-1 */
  linePick: number;
};

/**
 * seed から決定論的に個体差を導く（仕様 5.4）。
 *
 * 同種を2匹持ったとき「どっちも同じ」に見えると、個体への愛着が成立しない。
 * 名前や個体ステータスを持たせる代わりに、この微差だけで別の子に見せる。
 *
 * 色相だけをずらしても、ミルクラビットのような彩度の低い体色では
 * 見た目がほとんど変わらず、個体差が成立しなかった。
 * そのため彩度と明度も併せてずらしている。
 */
export function individuality(seed: number): Individuality {
  // NaN / Infinity / 巨大値が来ても SVG 属性に NaN を流さない。
  // seed は保存データ由来なので、何が入っていても描画は壊れてはならない。
  const s = Number.isFinite(seed) ? Math.abs(seed) % 1 : 0;
  const f = (n: number) => {
    const x = Math.sin(s * 9973 + n * 137.13) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    hueShift: (f(1) * 2 - 1) * 10,
    satMul: 1 + (f(7) * 2 - 1) * 0.25,
    lightAdd: (f(8) * 2 - 1) * 0.05,
    scale: 1 + (f(2) * 2 - 1) * 0.05,
    breathPeriod: 2.4 + f(3) * 0.8,
    blinkBase: 3 + f(4) * 4,
    chatty: f(5),
    linePick: f(6),
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return [hue(hn + 1 / 3) * 255, hue(hn) * 255, hue(hn - 1 / 3) * 255];
}

const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * hex 色を HSL 空間でずらす。外部ライブラリを使わない純粋関数。
 * 不正な色や非有限の値が来た場合は入力をそのまま返す。
 * SVG の fill に "#NaNNaNNaN" を流さないことを最優先する。
 */
export function tintColor(
  hex: string,
  opts: { hue?: number; satMul?: number; lightAdd?: number }
): string {
  const hue = opts.hue ?? 0;
  const satMul = opts.satMul ?? 1;
  const lightAdd = opts.lightAdd ?? 0;
  if (typeof hex !== "string" || !HEX_RE.test(hex.trim())) return hex;
  if (!Number.isFinite(hue) || !Number.isFinite(satMul) || !Number.isFinite(lightAdd)) return hex;
  const [r, g, b] = hexToRgb(hex.trim());
  const [h, sat, l] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(
    h + hue,
    Math.min(1, Math.max(0, sat * satMul)),
    Math.min(0.97, Math.max(0.08, l + lightAdd))
  );
  return rgbToHex(nr, ng, nb);
}

/** 色相だけを回す。tintColor の薄いラッパ。 */
export function shiftHue(hex: string, deg: number): string {
  return tintColor(hex, { hue: deg });
}

/**
 * ぬいぐるみの頭のてっぺんの y（足元原点、上が負）。
 *
 * 吹き出しやリングをぬいぐるみに被せないために使う。
 * 顔が隠れると表情が見えず、演出の意味がなくなる。
 */
export function plushTop(def: PlushDef): number {
  const ratioY =
    def.art.shape === "long" ? 1.18 : def.art.shape === "pear" ? 1.04 : def.art.shape === "blob" ? 0.88 : 1.0;
  const ears =
    def.art.ears === "long"
      ? def.size * 0.95
      : def.art.ears === "pointed"
        ? def.size * 0.75
        : def.art.ears === "round"
          ? def.size * 0.32
          : 0;
  return -(def.size * ratioY * 2 + ears);
}

/**
 * 個体差を反映した表示用の PlushDef を返す。元の定義は決して変更しない。
 * 呼び出し側は毎フレームこれを呼ぶのではなく、必要なときだけ使うこと。
 */
export function applyIndividuality(def: PlushDef, seed: number): PlushDef {
  const iv = individuality(seed);
  const size = Number.isFinite(def.size) ? def.size * iv.scale : 30;
  return {
    ...def,
    size,
    art: {
      ...def.art,
      body: tintColor(def.art.body, {
        hue: iv.hueShift,
        satMul: iv.satMul,
        lightAdd: iv.lightAdd,
      }),
      accent: tintColor(def.art.accent, {
        hue: iv.hueShift,
        satMul: iv.satMul,
        lightAdd: iv.lightAdd * 0.6,
      }),
    },
  };
}
