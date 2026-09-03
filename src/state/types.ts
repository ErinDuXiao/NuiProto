export type Rarity = "common" | "rare" | "special";

export type PlushShape = "round" | "pear" | "long" | "blob";
export type PlushEars = "round" | "long" | "pointed" | "none";
export type PlushExtra = "beak" | "tentacles" | "flipper" | "tail";

export type PlushArt = {
  /** 本体色 */
  body: string;
  /** 耳の内側・お腹などの色 */
  accent: string;
  /** 目・鼻・口の色 */
  face: string;
  shape: PlushShape;
  ears: PlushEars;
  extras?: PlushExtra[];
};

export type PlushDef = {
  id: string;
  name: string;
  series: string;
  rarity: Rarity;
  /** 描画・当たり判定の基準半径 26-34 (px) */
  size: number;
  /** 掴み保持のしにくさ 0.8-1.2。レンジ厳守（仕様 7.5） */
  weight: number;
  /** 変形量・掴まれやすさ 0-1 */
  softness: number;
  art: PlushArt;
};
