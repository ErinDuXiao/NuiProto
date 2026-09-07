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
 * 返す。`headTopY` は頭のてっぺんの絶対 y（`pose.ts` の `plushTop(def)` を
 * 呼び出し側の原点に足したもの）。`bounds` は吹き出しが出てよい範囲。
 * 下端 (`maxY`) は意図的に持たない — 呼び出し側の画面はどれも「下側には
 * 十分な余白がある」前提（棚の部屋、演出、見守りのどれも上端側だけが
 * 窮屈になる作り）なので、要らない自由度を持ち込まない。
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
  /** 吹き出しの先端（しっぽの先）の絶対 y。 */
  y: number;
  /** true なら頭の下側に出している（上端が窮屈だったとき）。 */
  below: boolean;
};

/** 頭のてっぺんと吹き出しの間に空ける、しっぽぶんの隙間。 */
const GAP = 14;
/** 吹き出し本体のだいたいの高さ（角丸の矩形 + しっぽ）。 */
const BUBBLE_H = 26;
const TAIL_H = 9;
/** 上に出すのに必要な最小の余白。これより頭上が狭ければ下側へ回す。 */
const MIN_SPACE_ABOVE = GAP + BUBBLE_H + TAIL_H;

/** 他の子の顔として避ける横幅（半径）。個体ごとのサイズ差を吸収する概算値。 */
const FACE_HALF_W = 50;
/** 他の子の顔として避ける縦の届き。頭のてっぺんから下へこれだけを顔とみなす。 */
const FACE_REACH_Y = 90;

/** 有限でなければ既定値へ落とす。保存データや演出タイマーの計算誤差で NaN が来ても描画を壊さない。 */
function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** x を `[lo, hi]` に収める。`lo > hi`（幅が textWidth より狭い）なら中央へ落とす。 */
function clampX(x: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, x));
}

/** 吹き出しが `other` の顔と重なりそうか（矩形の概算での当たり判定）。 */
function overlapsFace(x: number, y: number, halfW: number, other: BubbleNeighbor): boolean {
  const dx = Math.abs(x - other.x);
  const dy = Math.abs(y - other.headTopY);
  return dx < halfW + FACE_HALF_W && dy < FACE_REACH_Y;
}

/**
 * 誰の顔にも被らない x を探す。`base` から左右へ広げながら探し、
 * 見つからなければ `base` をそのまま返す — 「置き場所が見つからない」より
 * 「多少は近いが必ずどこかに出る」ほうを優先する（有限の値を返す約束）。
 */
function resolveX(
  base: number,
  halfW: number,
  lo: number,
  hi: number,
  y: number,
  others: BubbleNeighbor[]
): number {
  if (others.length === 0 || !others.some((o) => overlapsFace(base, y, halfW, o))) return base;

  const span = Math.max(1, hi - lo);
  for (let d = 8; d <= span; d += 8) {
    for (const cand of [base + d, base - d]) {
      const clamped = clampX(cand, lo, hi);
      if (clamped !== cand) continue; // 範囲外まで逃げてよいのは最後の手段。まずは範囲内で探す。
      if (!others.some((o) => overlapsFace(clamped, y, halfW, o))) return clamped;
    }
  }
  return base;
}

/**
 * 吹き出しの位置を決める。
 *
 * 1. 頭上に十分な余白があれば頭の上、無ければ下側へ回す（画面外に出さない）。
 * 2. 横は喋っている子の真上を基準に、`bounds` の内側へ収める。
 * 3. その位置が他の子の顔に被るなら、被らなくなるまで横へずらす。
 */
export function placeBubble(opts: PlaceBubbleOptions): BubblePlacement {
  const { bounds, others } = opts;
  const anchorX = finite(opts.anchorX, (bounds.minX + bounds.maxX) / 2);
  const headTopY = finite(opts.headTopY, bounds.minY);
  const textWidth = finite(opts.textWidth, 80);
  const halfW = Math.max(10, textWidth) / 2;

  const spaceAbove = headTopY - bounds.minY;
  const below = spaceAbove < MIN_SPACE_ABOVE;
  const y = below ? Math.max(bounds.minY, headTopY + GAP) : headTopY - GAP;

  const lo = bounds.minX + halfW;
  const hi = bounds.maxX - halfW;
  const clampedAnchor = clampX(anchorX, lo, hi);
  const x = resolveX(clampedAnchor, halfW, lo, hi, y, others);

  return { x, y, below };
}
