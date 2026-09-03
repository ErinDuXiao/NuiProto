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
  /** 本体色の色相ずれ (deg, ±6) */
  hueShift: number;
  /** サイズ倍率 (±4%) */
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
 */
export function individuality(seed: number): Individuality {
  const f = (n: number) => {
    const x = Math.sin(seed * 9973 + n * 137.13) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    hueShift: (f(1) * 2 - 1) * 6,
    scale: 1 + (f(2) * 2 - 1) * 0.04,
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

/** hex 色の色相を deg だけ回す。外部ライブラリを使わない純粋関数。 */
export function shiftHue(hex: string, deg: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(h + deg, s, l);
  return rgbToHex(nr, ng, nb);
}

/**
 * 個体差を反映した表示用の PlushDef を返す。元の定義は決して変更しない。
 * 呼び出し側は毎フレームこれを呼ぶのではなく、必要なときだけ使うこと。
 */
export function applyIndividuality(def: PlushDef, seed: number): PlushDef {
  const iv = individuality(seed);
  return {
    ...def,
    size: def.size * iv.scale,
    art: {
      ...def.art,
      body: shiftHue(def.art.body, iv.hueShift),
      accent: shiftHue(def.art.accent, iv.hueShift),
    },
  };
}
