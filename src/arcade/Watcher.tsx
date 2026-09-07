import { getPlush } from "../data/plushies";
import { LINES, pickLine, type LineKey } from "../data/lines";
import { PlushSVG } from "../render/PlushSVG";
import { plushTopOf } from "../render/pose";
import { bubbleShape, placeBubble } from "../render/bubble";
import type { PlushInstance } from "../state/types";
import { lineKeyFor, watcherPose, type WatcherMood } from "./watcherState";

type Props = {
  plush: PlushInstance;
  mood: WatcherMood;
  /** その気持ちになってからの経過時間 (ms) */
  elapsed: number;
  /** 気持ちが変わった回数。同じセリフを繰り返さないために使う */
  moodCount: number;
};

/**
 * 見守りの `<svg>` の寸法。
 *
 * **ここが唯一の定義。** `ArcadeScreen.tsx` の `<svg className="watcher">` の
 * viewBox と `<g transform="translate(0 …)">` もこれを使う。このリポジトリは
 * 過去に棚のレイアウト定数を二重に持って二度事故を起こしている
 * （`shelfLayout.ts` / `persist.ts` のコメント参照）。ここも同じ形で、
 * 片方だけ直しても何のエラーも出ず、見守りの吹き出しだけが静かに画面外へ
 * 出るか顔に乗るという壊れ方をする。
 */
export const WATCHER_VIEW = {
  width: 200,
  height: 120,
  /** ぬいぐるみの足元ライン（viewBox 上端からの距離）。 */
  baseY: 112,
  /** ぬいぐるみを置く x。 */
  x: 52,
} as const;

/**
 * 吹き出しが出てよい範囲（足元原点、上が負）。見守りは常に1匹だけなので
 * `others` は空でよい（避けるべき他の子の顔が存在しない）。
 */
const WATCHER_BOUNDS = {
  minX: 0,
  maxX: WATCHER_VIEW.width,
  minY: -WATCHER_VIEW.baseY,
};

/**
 * 見守りぬいぐるみ（依頼書 8 章）。
 *
 * クレーン盤面の手前に、プレイヤーが既に持っている子を 1 匹置く。
 * この子が居ることで「景品を取る」が「この子に友達を連れて帰る」になる。
 * 落としたときも 0.8 秒で立ち直り、悲しみを引きずらせない。
 */
export function Watcher({ plush, mood, elapsed, moodCount }: Props) {
  const def = getPlush(plush.plushTypeId);
  const pose = watcherPose(mood, elapsed);
  const key = lineKeyFor(mood);
  const line = key && key in LINES ? pickLine(key as LineKey, plush.personalitySeed, moodCount) : null;
  const showLine = line !== null && elapsed < 2400;

  return (
    <g>
      <g transform={`translate(${WATCHER_VIEW.x} 0)`}>
        <PlushSVG def={def} pose={pose} seed={plush.personalitySeed} />
        {mood === "success" && <Sparkle r={def.size} />}
      </g>
      {showLine && (
        <Bubble
          anchorX={WATCHER_VIEW.x}
          // 個体差の拡縮を含めた実寸の頭のてっぺん。跳ねている分だけ上へ。
          headTopY={plushTopOf(def, plush.personalitySeed) - pose.hop}
          text={line}
        />
      )}
    </g>
  );
}

function Sparkle({ r }: { r: number }) {
  const pts = [
    { x: -r * 1.05, y: -r * 1.8, s: 2.4 },
    { x: r * 1.0, y: -r * 2.1, s: 3 },
    { x: r * 0.15, y: -r * 2.5, s: 2 },
  ];
  return (
    <g>
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.s} fill="#e8c98a" opacity={0.8} />
      ))}
    </g>
  );
}

/** 見守りの吹き出し。位置は `placeBubble` に一本化する。 */
function Bubble({
  anchorX,
  headTopY,
  text,
}: {
  anchorX: number;
  headTopY: number;
  text: string;
}) {
  const w = Math.min(170, text.length * 13 + 22);
  const { x, y, below } = placeBubble({
    anchorX,
    headTopY,
    textWidth: w,
    bounds: WATCHER_BOUNDS,
    others: [],
  });
  // 絵の寸法は placeBubble と同じ定数から導く。手で書くと余白の見積りとずれる。
  const { rectY, height, tail, textY } = bubbleShape(below);
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={rectY} width={w} height={height} rx={height / 2} fill="#fffaf3" />
      <path d={tail} fill="#fffaf3" />
      <text x={0} y={textY} textAnchor="middle" fontSize={13} fill="#6b5a4e">
        {text}
      </text>
    </g>
  );
}
