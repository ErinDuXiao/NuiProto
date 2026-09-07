/**
 * 吹き出しの配置。
 *
 * WHY THIS EXISTS: Phase 1 で、出会いの演出のクライマックスで吹き出しが
 * クマの顔に被ったことがあった。この機能が作りたい体験全体が懸かっている
 * 一瞬に顔を隠すのは、見た目の些細なバグではなく演出そのものを壊す。
 * `plushTop(def)` はそのときの応急処置として `pose.ts` に足された。
 * この関数はそれを一般化し、タップのリアクションと出会いの演出という
 * 「吹き出しを使ってよい2箇所」だけが呼ぶ、純粋な配置計算にする。
 *
 * **吹き出しは棚の関係リアクション（挿話）には使わない。** 動きだけで表す
 * という決定（Global Constraint）はここでは扱わない — 呼び出す/呼び出さない
 * の判断は呼び出し側の責務で、この関数は「呼ばれたら安全な場所を返す」
 * ことだけをする。
 *
 * 純粋関数。React・DOM・タイマー・モジュールスコープの可変状態を持たない
 * — 呼び出し側（棚・演出・見守り）の再レンダーとは無関係にテストできる。
 *
 * 座標系: 呼び出し側の絶対座標（y は下向きが正）で受け取り、同じ座標系で
 * 返す。`headTopY` は頭のてっぺんの絶対 y（`pose.ts` の `plushTopOf(def, seed)`
 * を呼び出し側の原点に足したもの）。**素の `plushTop(def)` を渡さないこと** —
 * `PlushSVG` は個体差で ±5% 拡縮したサイズで描くので、素の値を渡すと
 * クマで約4px、頭上の余白を実際より広く見積もる。天井が近い見守りでは、
 * その4pxが「上に出す／下に出す」の分岐をひっくり返す。
 * `bounds` は吹き出しが出てよい範囲。下端 (`maxY`) は意図的に持たない —
 * 呼び出し側の画面はどれも「下側には十分な余白がある」前提（棚の部屋、演出、
 * 見守りのどれも上端側だけが窮屈になる作り）なので、要らない自由度を
 * 持ち込まない。
 */

/** 吹き出しを避けさせたい、他の子の顔の位置。 */
export type BubbleNeighbor = {
  x: number;
  /** その子の頭のてっぺんの絶対 y。 */
  headTopY: number;
};

/** 吹き出しが出てよい範囲。 */
export type BubbleBounds = {
  minX: number;
  maxX: number;
  minY: number;
};

export type PlaceBubbleOptions = {
  /** 吹き出しの相手（喋っている子）の x。 */
  anchorX: number;
  /** 喋っている子の頭のてっぺんの絶対 y。 */
  headTopY: number;
  /** 吹き出しの横幅の見積り（本文の描画幅）。 */
  textWidth: number;
  bounds: BubbleBounds;
  /** 顔を隠したくない、他の子たち。喋っている本人は含めないこと。 */
  others: BubbleNeighbor[];
};

export type BubblePlacement = {
  x: number;
  /** 吹き出しの先端（しっぽの付け根）の絶対 y。 */
  y: number;
  /** true なら頭の下側に出している（上端が窮屈だったとき）。 */
  below: boolean;
};

/** 頭のてっぺんと吹き出しの先端（返り値 y）の間に空ける隙間。 */
const GAP = 14;

/**
 * 吹き出しの絵の寸法。**すべて返り値 y からの相対**で持つ。
 *
 * WHY: ここが実際に描かれる形とずれると、この関数の「上に出せるか」の
 * 見積りが静かに嘘になる。実際 Task 8 の初版はここを
 * 「隙間 + 矩形の高さ + しっぽ = 49px」と見積もっていたが、
 * **しっぽは y から下向き（頭の方）に伸びるので上には要らない**し、
 * 矩形も上へは 21px しか伸びない。上に必要なのは 21px だったのに 49px を
 * 要求したせいで、上に出せる場面で下へ回し、吹き出しが目の上に乗った。
 * 3箇所の JSX がこの定数から寸法を導くこと（`bubbleShape` を使う）で、
 * 同じずれが二度と起きないようにする。
 */
export const BUBBLE_SHAPE = {
  /** 上に出したとき、y から本体（角丸矩形）の上端まで。 */
  bodyTop: 21,
  /** 上に出したとき、y から本体の下端まで。 */
  bodyBottom: 5,
  /** y からしっぽの先まで。上出しは下向き、下出しは上向きに伸びる。 */
  tail: 11,
  /** しっぽの付け根の半幅。 */
  tailHalfW: 5,
} as const;

/** 本体（角丸矩形）の高さ。 */
const BODY_H = BUBBLE_SHAPE.bodyTop + BUBBLE_SHAPE.bodyBottom;

/**
 * 上に出した吹き出しの本体が、頭のてっぺんより下へ食い込んでよい量。
 *
 * WHY: 天井が近いとき（見守りの viewBox は足元から 112px しか上が無い）、
 * 選択肢は「上に出して頭のてっぺんに少し乗せる」か「下に出す」の二択に
 * なる。**下に出す方が圧倒的に危険**で、下側は頭のすぐ下＝目のある高さ
 * なので、そのまま表情を隠す。一方てっぺん側にあるのは耳や頭の丸みで、
 * 少し隠れても表情は死なない。
 *
 * どの種類・どの個体差でも「頭のてっぺん → 目の上端」は 14px 以上ある
 * （耳の無い blob 体型のカエル・くらげが最小）。10px なら目には届かない。
 * この余裕は `bubble.test.ts` の「全種類 × 個体差の両端 × 全ムード」の
 * 総当たりで実測して見張っている。
 */
const HEAD_ROOM = 10;

/**
 * 上に出すのに必要な頭上の余白。これを下回ったときだけ下側へ回す。
 * 本体の高さ 26px のうち `HEAD_ROOM` ぶんは頭に乗せてよいので、
 * 実際に天井との間に要るのはその差だけ。
 */
const MIN_SPACE_ABOVE = BODY_H - HEAD_ROOM;

/** 他の子の顔として避ける横幅（半径）。個体ごとのサイズ差を吸収する概算値。 */
const FACE_HALF_W = 50;
/** 他の子の顔として避ける縦の届き。頭のてっぺんから下へこれだけを顔とみなす。 */
const FACE_REACH_Y = 90;
/** 横へ逃がすときの刻み。 */
const STEP = 8;

/** 有限でなければ既定値へ落とす。保存データや演出タイマーの計算誤差で NaN が来ても描画を壊さない。 */
function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** x を `[lo, hi]` に収める。`lo > hi`（幅が textWidth より狭い）なら中央へ落とす。 */
function clampX(x: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * `x` に置いたとき、他の子の顔ボックスへ横からどれだけ食い込むかの合計 (px)。
 * 0 なら誰にも被っていない。
 */
function penetration(x: number, y: number, halfW: number, others: BubbleNeighbor[]): number {
  let sum = 0;
  for (const o of others) {
    if (!Number.isFinite(o?.x) || !Number.isFinite(o?.headTopY)) continue;
    if (Math.abs(y - o.headTopY) >= FACE_REACH_Y) continue;
    const clear = halfW + FACE_HALF_W;
    const d = Math.abs(x - o.x);
    if (d < clear) sum += clear - d;
  }
  return sum;
}

/**
 * 誰の顔にも被らない x を探す。
 *
 * **完全に避けられないときは「いちばん食い込みが小さい x」を返す。**
 * WHY: 以前は「完全に避けられる候補が無ければ元の位置をそのまま返す」
 * 実装だったが、実際に起きる配置ではそれが常に起きていた。棚のスロット
 * 間隔は 82px、完全に避けるのに要る幅は `halfW + 50`（吹き出しが広いと
 * 113px）で、部屋の幅 320px の内側には条件を満たす x が存在しない。
 * つまり出会いの演出でも満席の段でも、この回避は一度も働かないまま
 * 黙って諦めていた（機能があるように見えて何もしない、がいちばん悪い）。
 * 食い込み量が最小の x を選べば、完全には避けられなくても必ず顔から
 * 遠い方へ寄る。`lo`/`hi` の外へは出ないので画面外にも出ない。
 */
function resolveX(
  base: number,
  halfW: number,
  lo: number,
  hi: number,
  y: number,
  others: BubbleNeighbor[]
): number {
  if (others.length === 0) return base;

  let bestX = base;
  let best = penetration(base, y, halfW, others);
  if (best === 0) return base;

  /** 候補を評価する。完全に避けられたら true。 */
  const consider = (cand: number): boolean => {
    if (!(cand >= lo && cand <= hi)) return false;
    const p = penetration(cand, y, halfW, others);
    // 同点なら先に見た方（= base に近い方）を残す。無駄に遠くへ飛ばさない。
    if (p < best) {
      best = p;
      bestX = cand;
    }
    return p === 0;
  };

  const span = Math.max(1, hi - lo);
  for (let d = STEP; d <= span; d += STEP) {
    if (consider(base + d)) return bestX;
    if (consider(base - d)) return bestX;
  }
  // 刻みの都合で端そのものは試されないことがある。端まできっちり逃げられるように。
  consider(lo);
  consider(hi);
  return bestX;
}

/**
 * 吹き出しの位置を決める。
 *
 * 1. 原則として頭の上に出す。天井 (`bounds.minY`) にぶつかるなら、
 *    下へずらして収める（`HEAD_ROOM` までは頭のてっぺんに乗ってよい）。
 * 2. それでも収まらないほど頭上が狭ければ下側へ回す（`below: true`）。
 * 3. 横は喋っている子の真上を基準に、`bounds` の内側へ収める。
 * 4. その位置が他の子の顔に被るなら、いちばん被らない位置へ横へずらす。
 */
export function placeBubble(opts: PlaceBubbleOptions): BubblePlacement {
  const { bounds, others } = opts;
  const anchorX = finite(opts.anchorX, (bounds.minX + bounds.maxX) / 2);
  const headTopY = finite(opts.headTopY, bounds.minY);
  const textWidth = finite(opts.textWidth, 80);
  const halfW = Math.max(10, textWidth) / 2;

  const spaceAbove = headTopY - bounds.minY;
  const below = spaceAbove < MIN_SPACE_ABOVE;
  // 上出しは本体の上端が、下出しはしっぽの先が、それぞれ天井にぶつかる。
  const y = below
    ? Math.max(bounds.minY + BUBBLE_SHAPE.tail, headTopY + GAP)
    : Math.max(bounds.minY + BUBBLE_SHAPE.bodyTop, headTopY - GAP);

  const lo = bounds.minX + halfW;
  const hi = bounds.maxX - halfW;
  const clampedAnchor = clampX(anchorX, lo, hi);
  const x = resolveX(clampedAnchor, halfW, lo, hi, y, others);

  return { x, y, below };
}

/**
 * 吹き出しの絵の寸法（返り値 y を原点とする局所座標）。
 *
 * 棚・演出・見守りの3箇所はこれを使って `<rect>` と `<path>` を描く。
 * `placeBubble` が余白を見積もるのに使っているのと同じ `BUBBLE_SHAPE` から
 * 導くので、絵と見積りがずれることがない。
 */
export function bubbleShape(below: boolean): {
  rectY: number;
  height: number;
  tail: string;
  textY: number;
} {
  const { bodyTop, bodyBottom, tail, tailHalfW } = BUBBLE_SHAPE;
  // 下に出すときは上下を反転する。下に出しているのに上向きのしっぽのままでは
  // 誰が喋っているのか読めない。
  const s = below ? -1 : 1;
  const rectY = below ? -bodyBottom : -bodyTop;
  const centerY = rectY + BODY_H / 2;
  return {
    rectY,
    height: BODY_H,
    tail: `M ${-tailHalfW} ${s * 4} L 0 ${s * tail} L ${tailHalfW} ${s * 4} Z`,
    // 文字のベースラインは矩形の中心より少し下。
    textY: centerY + 5,
  };
}

export type BubbleBox = { left: number; right: number; top: number; bottom: number };

/**
 * 実際に描かれる吹き出しの矩形（絶対座標）。
 *
 * `body` は不透明な角丸矩形 = **顔を隠しうる部分**。
 * `outer` はしっぽまで含めた全体 = **画面外へはみ出していないかを見る部分**。
 * しっぽを `body` に含めないのは、しっぽは頭を指すためのものであり、
 * 頭に少し掛かるのが正しい形だから。
 */
export function bubbleBoxes(
  p: BubblePlacement,
  textWidth: number
): { body: BubbleBox; outer: BubbleBox } {
  const halfW = Math.max(10, finite(textWidth, 80)) / 2;
  const { rectY, height } = bubbleShape(p.below);
  const body = {
    left: p.x - halfW,
    right: p.x + halfW,
    top: p.y + rectY,
    bottom: p.y + rectY + height,
  };
  const tailY = p.y + (p.below ? -BUBBLE_SHAPE.tail : BUBBLE_SHAPE.tail);
  return {
    body,
    outer: {
      left: body.left,
      right: body.right,
      top: Math.min(body.top, tailY),
      bottom: Math.max(body.bottom, tailY),
    },
  };
}
