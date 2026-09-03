/**
 * セリフ辞書。
 *
 * 世界観は「かわいいが、過剰にエモーショナルではない」（依頼書9章）。
 * クエスト化する台詞（「〇〇を取ってきて！」等）は絶対に入れない。
 * 友達が増えたら嬉しい、程度の温度に保つ。
 */
export const LINES = {
  /** 棚でぼんやりしているとき */
  shelfIdle: ["今日は誰かいるかな？", "おだやかだね。", "……ふぁ。", "いいお天気。"],

  /** 棚でクリックされたとき */
  shelfTouch: ["ん？", "なあに？", "ここ、いごこちいいよ。", "えへへ。", "なでてくれるの？"],

  /** 新しい子を迎える先輩 */
  welcomeHost: ["はじめまして！", "ようこそ。", "あたらしい子だ！", "きてくれたんだ。"],

  /** 迎えられた新入り */
  welcomeGuest: ["……よろしくね。", "わぁ。", "おじゃまします。"],

  /** クレーン: 待機 */
  craneIdle: ["あの子、気になる。", "どの子にしようかな。"],

  /** クレーン: 狙っている */
  craneAiming: ["そこ……！", "もうちょっと右かも。", "いけるかな。"],

  /** クレーン: 掴んだ */
  craneGrabbed: ["きた！"],

  /** クレーン: 落とした */
  craneMissed: ["あっ！"],

  /** クレーン: 出口に近づいた */
  craneNearExit: ["もうちょっとかも。", "おしい！"],

  /** クレーン: 獲得 */
  craneSuccess: ["やった！"],
} as const;

export type LineKey = keyof typeof LINES;

/**
 * seed から決定論的にセリフを選ぶ。
 * 同じ個体が同じ場面で毎回同じことを言うほうが、性格があるように感じられる。
 */
export function pickLine(key: LineKey, seed: number, offset = 0): string {
  const list = LINES[key];
  const i = Math.floor(Math.abs(seed * 1000 + offset)) % list.length;
  return list[i];
}
