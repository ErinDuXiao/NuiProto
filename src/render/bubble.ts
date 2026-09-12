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

import type { PlushDef } from "../state/types";
import { applyIndividuality, type Pose } from "./pose";

export type BubbleBox = { left: number; right: number; top: number; bottom: number };

/**
 * 吹き出しに隠させたくない、他の子の顔。
 *
 * - `{ face }`: 実際に描かれる顔の箱（`plushFaceBox` で作る）。**呼び出し側は
 *   原則こちらを渡す。** 種類・個体差・姿勢が分かっていれば、顔の位置は
 *   正確に出せるので、見積りで避ける理由がない。
 * - `{ x, headTopY }`: 相手の種類が分からないとき。どの種類のどの姿勢の顔も
 *   覆う安全側の箱（`UNKNOWN_FACE`）として扱う。広めに見るぶん、実際には
 *   被っていないのに避けることがある — 分からないものを楽観的に扱って顔に
 *   乗せるよりはよい。
 */
export type BubbleNeighbor = { face: BubbleBox } | { x: number; headTopY: number };

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
 * どの種類・どの個体差・どのムードでも「頭のてっぺん → 目の上端」は
 * 最小 13.971px（傾きによる目の持ち上がりを含む。耳の無い blob 体型の
 * カエル・くらげが最小。seed 3000 点 × 全ムードの独立した再計算による値）。
 * 10px なら目には届かないが、**余裕は 4px ではなく 3.97px しかない。**
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

/** 有限でなければ既定値へ落とす。保存データや演出タイマーの計算誤差で NaN が来ても描画を壊さない。 */
function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** x を `[lo, hi]` に収める。`lo > hi`（幅が textWidth より狭い）なら中央へ落とす。 */
function clampX(x: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, x));
}

/* ------------------------------------------------------------------ *
 * 顔の箱
 * ------------------------------------------------------------------ */

/**
 * `PlushSVG` の SHAPE_RATIO の写し。
 *
 * WHY 写しなのか: `PlushSVG` は React のコンポーネントで、この純粋な
 * モジュールから import すると React を引き込む。写しがずれると顔の箱が
 * 静かに嘘をつくので、`bubble.test.ts` が**実際に `PlushSVG` をレンダリング
 * して目の属性を読み**、この関数の出す箱と突き合わせて見張っている。
 */
const SHAPE_RATIO: Record<PlushDef["art"]["shape"], { x: number; y: number }> = {
  round: { x: 1.0, y: 1.0 },
  pear: { x: 0.92, y: 1.04 },
  long: { x: 0.8, y: 1.18 },
  blob: { x: 1.1, y: 0.88 },
};

/**
 * `pose.tilt` の分だけ顔の箱を広げる量。
 *
 * `PlushSVG` の傾きは胴の中心を軸にした回転なので、目は主に左右へ振れる
 * （最大 12°・軸から約 40px で 8px 強）。上端が持ち上がる量は 1px 未満。
 * 回転を厳密に解く代わりに、その上限を常に足して安全側に倒す
 * （判定を緩めるのではなく厳しくする方向の近似）。
 */
const TILT_MARGIN_X = 9;
const TILT_MARGIN_Y = 2;

/**
 * 実際に描かれる顔（両目）の当たり判定の箱（絶対座標）。
 *
 * `x` / `footY` はその子の足元の絶対座標。`PlushSVG` と同じく
 * `applyIndividuality` を通したサイズで、`pose` の潰れ・目の開き・視線・
 * 跳ねを反映する。**顔として守るのは目**: 表情はまず目で読まれ、
 * 吹き出しは上から来るので、口より先に必ず目に掛かる。
 */
export function plushFaceBox(
  def: PlushDef,
  seed: number,
  pose: Pose,
  x: number,
  footY: number
): BubbleBox {
  const d = applyIndividuality(def, seed);
  const r = d.size;
  const ratio = SHAPE_RATIO[d.art.shape] ?? SHAPE_RATIO.round;
  const rx = r * ratio.x * (2 - pose.squash);
  const ry = r * ratio.y * pose.squash;
  const cy = -ry;
  const eyeR = 3.4;
  // 目を閉じているときは高さ 1.6 の線（<rect y={eyeY-0.8} height={1.6}>）になる。
  const eyeRy = pose.eyeOpen > 0.08 ? eyeR * pose.eyeOpen : 0.8;
  const eyeY = cy - ry * 0.14;
  const eyeX = rx * 0.32;
  const eyeDx = pose.lookAt * rx * 0.12;
  // hop は PlushSVG が外側の <g translate(0 -hop)> で掛ける。
  return {
    left: x - eyeX + eyeDx - eyeR - TILT_MARGIN_X,
    right: x + eyeX + eyeDx + eyeR + TILT_MARGIN_X,
    top: footY + eyeY - eyeRy - pose.hop - TILT_MARGIN_Y,
    bottom: footY + eyeY + eyeRy - pose.hop + TILT_MARGIN_Y,
  };
}

/**
 * 種類の分からない相手の顔を、頭のてっぺんからの相対でどこまで見るか。
 *
 * どの種類・個体差の両端・実際に使われる姿勢（見守りの全ムード、出会いの
 * 演出、タップの潰れ）の `plushFaceBox` も、この箱の内側に収まる。
 * `bubble.test.ts` がカタログ全体で見張っているので、種類を足してはみ出したら
 * テストが落ちる — そのときはここを広げる（狭い方へ直すと顔に乗る）。
 */
export const UNKNOWN_FACE = {
  /** 頭のてっぺんから目の箱の上端まで（下向き正）。実測の最小は 11.94px。 */
  top: 11,
  /** 頭のてっぺんから目の箱の下端まで。実測の最大は 80.79px（ミルクラビット）。 */
  bottom: 82,
  /** 中心から目の箱の端まで。実測の最大は 29.26px。 */
  halfW: 30,
} as const;

function neighborFace(o: BubbleNeighbor): BubbleBox | null {
  if (o === null || typeof o !== "object") return null;
  let box: BubbleBox;
  if ("face" in o) {
    box = o.face;
  } else {
    box = {
      left: o.x - UNKNOWN_FACE.halfW,
      right: o.x + UNKNOWN_FACE.halfW,
      top: o.headTopY + UNKNOWN_FACE.top,
      bottom: o.headTopY + UNKNOWN_FACE.bottom,
    };
  }
  const ok =
    box !== null &&
    typeof box === "object" &&
    Number.isFinite(box.left) &&
    Number.isFinite(box.right) &&
    Number.isFinite(box.top) &&
    Number.isFinite(box.bottom);
  return ok ? box : null;
}

/** 吹き出しの本体（不透明な角丸矩形）の絶対座標の箱。 */
function bodyBox(x: number, y: number, below: boolean, halfW: number): BubbleBox {
  const rectY = below ? -BUBBLE_SHAPE.bodyBottom : -BUBBLE_SHAPE.bodyTop;
  return { left: x - halfW, right: x + halfW, top: y + rectY, bottom: y + rectY + BODY_H };
}

/** 2つの箱が重なっている面積 (px²)。接しているだけなら 0。 */
function overlapArea(a: BubbleBox, b: BubbleBox): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 本体を `x` に置いたとき、他の子の顔の箱と重なる面積の合計 (px²)。
 *
 * WHY 面積なのか: 以前はここを「吹き出しの先端 y と相手の頭のてっぺんの
 * 距離が 90px 未満なら、横に ±50px を顔とみなす」という代理指標で測って
 * いた。同じ段の隣は頭のてっぺんの高さがほぼ同じなので、本体が相手の目より
 * ずっと上にあっても常に「被っている」と判定され、出会いの演出では
 * 何にも被っていない吹き出しが 15〜32px 押しのけられていた。
 * 本物の本体の箱と本物の顔の箱を交差させれば、重なっていないときは
 * 厳密に 0 になり、動く理由が無くなる。
 */
function penetration(
  x: number,
  y: number,
  below: boolean,
  halfW: number,
  faces: BubbleBox[]
): number {
  const body = bodyBox(x, y, below, halfW);
  let sum = 0;
  for (const f of faces) sum += overlapArea(body, f);
  return sum;
}

/**
 * 顔の箱から、ちょうど離れた位置に置くときに空ける隙間 (px)。
 * 箱の縁にぴったり接する位置は浮動小数の丸めで 1e-14 程度だけ重なることがあるので、
 * 必ず少しだけ外に置く。
 */
const CLEARANCE = 1;

/**
 * 誰の顔にも被らない位置を探す。
 *
 * **重なりを厳密に減らせるときだけ動く。** 今の位置で重なりが 0 なら
 * 1px も動かさない。候補は重なりが真に小さいときだけ採り、同点なら
 * 元の位置から近い方を残す。
 *
 * 探し方は2段階:
 *
 * 1. **横にずらす。** 喋っている子の頭の上という関係はそのまま保てる。
 * 2. 横だけでは消せないときに限り、**自分の頭の方へ下げる**（上出しのみ、
 *    `HEAD_ROOM` まで）。WHY: 背の高い子（耳の長いミルクラビット）の
 *    真上の段に子が並んでいると、上の段の目がちょうど吹き出しの高さに来る。
 *    上の段が埋まっていれば部屋の幅 320px の中に横の逃げ場は無く、横だけの
 *    回避では吹き出しが上の子の目に乗ったままになる（全10種 × 全スロットの
 *    総当たりで実際に見つかった）。下げる量は天井へのクランプと同じ
 *    `HEAD_ROOM` の範囲に留めるので、自分の目には決して届かない。
 *    横を先にするのは、下げると自分の頭のてっぺんに乗り、その余裕
 *    （目まで 3.97px）を使うことになるため。横で済むなら横で済ませる。
 *    下出しのときは縦に動かさない — 下出しになるのは天井が迫っている
 *    ときだけで、上にも下にも余白が無い。
 *
 * **完全に避けられないときは「いちばん重なりが小さい位置」を返す。**
 * 完全には避けられなくても必ず顔から遠い方へ寄る。`lo`/`hi` の外へは
 * 出ないので画面外にも出ない。
 *
 * 候補は刻みで舐めるのではなく、重なり面積の折れ目（本体の縁が顔の箱の
 * 縁と揃う位置。顔から離れる側は `CLEARANCE` だけ外）と範囲の端だけを試す。
 * 重なり面積は x についても y についても折れ線なので、最小値は折れ目か端で
 * 取る — 以前の 8px 刻みのように、刻み幅の都合で「避けられるのに避けない」
 * 「必要以上に遠くへ飛ぶ」が起きない（例外は、顔と顔の隙間が本体より
 * `CLEARANCE` 未満しか広くない場合で、そのときは接する位置の代わりに
 * 1px 未満だけ重なる位置になりうる）。
 */
function resolvePosition(
  baseX: number,
  baseY: number,
  halfW: number,
  lo: number,
  hi: number,
  maxY: number,
  below: boolean,
  faces: BubbleBox[]
): { x: number; y: number } {
  const stay = { x: baseX, y: baseY };
  if (faces.length === 0) return stay;
  let best = penetration(baseX, baseY, below, halfW, faces);
  if (best === 0) return stay;

  // 本体の上端・下端が y からどれだけ離れているか（bodyBox と同じ）。
  const up = below ? BUBBLE_SHAPE.bodyBottom : BUBBLE_SHAPE.bodyTop;
  const down = BODY_H - up;

  // 顔から離れる側の折れ目（本体の縁が顔の箱の縁に接する位置）は、ぴったりでは
  // なく CLEARANCE だけ外を試す。ぴったりの位置は計算の順序しだいで 1e-14 だけ
  // 重なる側に転ぶ — 実際、独立に書いた顔の箱で検査すると「接しているだけ」が
  // 「被った」と判定された。顔の中へ入る側の折れ目は重なりの台の角なので、
  // 最小値を取りこぼさないようにぴったりのまま試す。
  const xs = [baseX];
  if (lo <= hi) {
    xs.push(lo, hi);
    for (const f of faces) {
      xs.push(
        f.left - halfW - CLEARANCE,
        f.right + halfW + CLEARANCE,
        f.left + halfW,
        f.right - halfW
      );
    }
  }
  const xCands = xs.filter((x) => x === baseX || (x >= lo && x <= hi));

  const ys = [baseY];
  if (!below && maxY > baseY) {
    ys.push(maxY);
    for (const f of faces) {
      ys.push(f.bottom + up + CLEARANCE, f.top - down - CLEARANCE, f.top + up, f.bottom - down);
    }
  }
  const yCands = ys.filter((y) => y === baseY || (y >= baseY && y <= maxY));

  let bestPos = stay;
  let bestMove = 0;
  const consider = (x: number, y: number) => {
    const p = penetration(x, y, below, halfW, faces);
    const move = Math.abs(x - baseX) + Math.abs(y - baseY);
    if (p < best || (p === best && move < bestMove)) {
      best = p;
      bestPos = { x, y };
      bestMove = move;
    }
  };

  // 1. 横だけ。
  for (const x of xCands) consider(x, baseY);
  if (best === 0) return bestPos;
  // 2. 横で消せなければ、頭の方へ下げる（下げつつ横にずらす組み合わせも含む）。
  for (const y of yCands) {
    if (y === baseY) continue;
    for (const x of xCands) consider(x, y);
  }
  return bestPos;
}

/**
 * 吹き出しの位置を決める。
 *
 * 1. 原則として頭の上に出す。天井 (`bounds.minY`) にぶつかるなら、
 *    下へずらして収める（`HEAD_ROOM` までは頭のてっぺんに乗ってよい）。
 * 2. それでも収まらないほど頭上が狭ければ下側へ回す（`below: true`）。
 * 3. 横は喋っている子の真上を基準に、`bounds` の内側へ収める。
 * 4. その位置で本体が他の子の顔の箱と実際に重なるときだけ、いちばん
 *    重ならない位置へずらす（まず横、横で消せなければ `HEAD_ROOM` の範囲で
 *    自分の頭の方へ下げる）。重なっていなければ一切動かさない。
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
  const baseY = below
    ? Math.max(bounds.minY + BUBBLE_SHAPE.tail, headTopY + GAP)
    : Math.max(bounds.minY + BUBBLE_SHAPE.bodyTop, headTopY - GAP);
  // 顔を避けるために下げてよい限界。本体の下端が頭のてっぺんから
  // `HEAD_ROOM` までしか食い込まない位置（天井へのクランプと同じ保証）。
  const maxY = headTopY + HEAD_ROOM - BUBBLE_SHAPE.bodyBottom;

  const lo = bounds.minX + halfW;
  const hi = bounds.maxX - halfW;
  const clampedAnchor = clampX(anchorX, lo, hi);
  const faces: BubbleBox[] = [];
  for (const o of Array.isArray(others) ? others : []) {
    const f = neighborFace(o);
    if (f) faces.push(f);
  }
  const { x, y } = resolvePosition(clampedAnchor, baseY, halfW, lo, hi, maxY, below, faces);

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
  // 回避の判定（penetration）と同じ箱。見積りと検証で別の式を持たない。
  const body = bodyBox(p.x, p.y, p.below, halfW);
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
