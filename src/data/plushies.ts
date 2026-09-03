import type { PlushDef } from "../state/types";

/**
 * ぬいぐるみ定義。
 *
 * 新種を足すときはこの配列にオブジェクトを1つ追加するだけでよい。
 * コードの変更は不要（仕様 5.1 / 依頼書 23 章）。
 *
 * weight は必ず [0.8, 1.2]、softness は [0, 1]、size は [26, 34] に収めること。
 * このレンジが個体係数 k の幅を 1.8 倍に抑え、単一のアシスト表で
 * 全個体の難易度曲線を設計できるようにしている（仕様 7.5）。
 */
export const PLUSHIES: PlushDef[] = [
  {
    id: "bear_01",
    name: "ブラウンベア",
    series: "forest_friends",
    rarity: "common",
    size: 32,
    weight: 1.0,
    softness: 0.7,
    art: {
      body: "#c9a37c",
      accent: "#e8d3bd",
      face: "#5b4636",
      shape: "round",
      ears: "round",
    },
  },
  {
    id: "rabbit_01",
    name: "ミルクラビット",
    series: "forest_friends",
    rarity: "common",
    size: 33,
    weight: 0.85,
    softness: 0.9,
    art: {
      body: "#efe6dc",
      accent: "#e6bfc4",
      face: "#6b5a4e",
      shape: "pear",
      ears: "long",
    },
  },
  {
    id: "fox_01",
    name: "こぎつね",
    series: "forest_friends",
    rarity: "rare",
    size: 30,
    weight: 0.95,
    softness: 0.6,
    art: {
      body: "#d99a6c",
      accent: "#f3e7dc",
      face: "#5b4636",
      shape: "pear",
      ears: "pointed",
      extras: ["tail"],
    },
  },
  {
    id: "frog_01",
    name: "はっぱガエル",
    series: "forest_friends",
    rarity: "common",
    size: 28,
    weight: 0.9,
    softness: 0.85,
    art: {
      body: "#a9c49a",
      accent: "#e4eddc",
      face: "#4a5a44",
      shape: "blob",
      ears: "none",
    },
  },
  {
    id: "deer_01",
    name: "こじか",
    series: "forest_friends",
    rarity: "special",
    size: 31,
    weight: 1.1,
    softness: 0.5,
    art: {
      body: "#d8b89a",
      accent: "#f5ece2",
      face: "#5b4636",
      shape: "pear",
      ears: "pointed",
      extras: ["tail"],
    },
  },
  {
    id: "seal_01",
    name: "しろあざらし",
    series: "ocean_friends",
    rarity: "common",
    size: 32,
    weight: 1.05,
    softness: 0.8,
    art: {
      body: "#e3e6ea",
      accent: "#c9d3dc",
      face: "#4d5560",
      shape: "long",
      ears: "none",
      extras: ["flipper"],
    },
  },
  {
    id: "octopus_01",
    name: "たこさん",
    series: "ocean_friends",
    rarity: "rare",
    size: 29,
    weight: 0.9,
    softness: 0.95,
    art: {
      body: "#e0a9a9",
      accent: "#f4dcdc",
      face: "#6b4a4a",
      shape: "blob",
      ears: "none",
      extras: ["tentacles"],
    },
  },
  {
    id: "duck_01",
    name: "あひるのこ",
    series: "ocean_friends",
    rarity: "common",
    size: 27,
    weight: 0.85,
    softness: 0.75,
    art: {
      body: "#f0dda6",
      accent: "#f8efd2",
      face: "#5e5236",
      shape: "round",
      ears: "none",
      extras: ["beak"],
    },
  },
  {
    id: "jellyfish_01",
    name: "くらげ",
    series: "ocean_friends",
    rarity: "rare",
    size: 28,
    weight: 0.8,
    softness: 1.0,
    art: {
      body: "#c9bcdc",
      accent: "#ece5f4",
      face: "#544a63",
      shape: "blob",
      ears: "none",
      extras: ["tentacles"],
    },
  },
  {
    id: "penguin_01",
    name: "ペンギン",
    series: "ocean_friends",
    rarity: "special",
    size: 30,
    weight: 1.15,
    softness: 0.55,
    art: {
      body: "#7c8a99",
      accent: "#f2f4f6",
      face: "#3d4652",
      shape: "long",
      ears: "none",
      extras: ["flipper", "beak"],
    },
  },
];

const BY_ID = new Map(PLUSHIES.map((p) => [p.id, p]));

export function getPlush(id: string): PlushDef {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`unknown plush: ${id}`);
  return p;
}

export function hasPlush(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * 掴みやすさの個体係数 k = soft(s) / heft(w)（仕様 7.5）。
 *
 * softness と weight のレンジが固定されているため k は [0.652, 1.176] に収まる。
 * この 1.8 倍という狭さが、単一のアシスト表で全個体を設計できる根拠になっている。
 */
export function plushCoefficient(def: PlushDef): number {
  const soft = 0.75 + 0.25 * def.softness;
  const heft = 0.85 + 0.3 * ((def.weight - 0.8) / 0.4);
  return soft / heft;
}
