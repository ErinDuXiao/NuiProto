import { getPlush } from "../data/plushies";
import { LINES, pickLine, type LineKey } from "../data/lines";
import { PlushSVG } from "../render/PlushSVG";
import { plushTop } from "../render/pose";
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
      {showLine && <Bubble x={52} y={plushTop(def) - 14 - pose.hop} text={line} />}
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

function Bubble({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.min(170, text.length * 13 + 22);
  const cx = Math.max(w / 2 + 4, x);
  return (
    <g transform={`translate(${cx} ${y})`}>
      <rect x={-w / 2} y={-21} width={w} height={26} rx={13} fill="#fffaf3" />
      <path d="M -5 4 L 0 11 L 5 4 Z" fill="#fffaf3" />
      <text x={0} y={-3} textAnchor="middle" fontSize={13} fill="#6b5a4e">
        {text}
      </text>
    </g>
  );
}
