import { getPlush } from "../data/plushies";
import { LINES, pickLine, type LineKey } from "../data/lines";
import { PlushSVG } from "../render/PlushSVG";
import { plushTop } from "../render/pose";
import { placeBubble } from "../render/bubble";
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
 * 見守りぬいぐるみ（依頼書 8 章）。
 *
 * クレーン盤面の手前に、プレイヤーが既に持っている子を 1 匹置く。
 * この子が居ることで「景品を取る」が「この子に友達を連れて帰る」になる。
 * 落としたときも 0.8 秒で立ち直り、悲しみを引きずらせない。
 */
/**
 * 見守りの `<svg>` の viewBox（ArcadeScreen.tsx の `<svg className="watcher"
 * viewBox="0 0 200 120">` と、その中の `<g transform="translate(0 112)">`）
 * をここでも使う。見守りは常に1匹だけなので `others` は空でよい
 * （避けるべき他の子の顔が存在しない）。
 */
const WATCHER_X = 52;
const WATCHER_BOUNDS = { minX: 0, maxX: 200, minY: -112 };

export function Watcher({ plush, mood, elapsed, moodCount }: Props) {
  const def = getPlush(plush.plushTypeId);
  const pose = watcherPose(mood, elapsed);
  const key = lineKeyFor(mood);
  const line = key && key in LINES ? pickLine(key as LineKey, plush.personalitySeed, moodCount) : null;
  const showLine = line !== null && elapsed < 2400;

  return (
    <g>
      <g transform="translate(52 0)">
        <PlushSVG def={def} pose={pose} seed={plush.personalitySeed} />
        {mood === "success" && <Sparkle r={def.size} />}
      </g>
      {showLine && (
        <Bubble anchorX={WATCHER_X} headTopY={plushTop(def) - pose.hop} text={line} />
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
  const rectY = below ? -5 : -21;
  const tail = below ? "M -5 -4 L 0 -11 L 5 -4 Z" : "M -5 4 L 0 11 L 5 4 Z";
  const textY = below ? 14 : -3;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={rectY} width={w} height={26} rx={13} fill="#fffaf3" />
      <path d={tail} fill="#fffaf3" />
      <text x={0} y={textY} textAnchor="middle" fontSize={13} fill="#6b5a4e">
        {text}
      </text>
    </g>
  );
}
