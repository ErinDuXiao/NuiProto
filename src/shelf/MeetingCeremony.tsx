import { useEffect, useMemo, useRef, useState } from "react";
import { getPlush } from "../data/plushies";
import { PlushSVG } from "../render/PlushSVG";
import { NEUTRAL_POSE } from "../render/pose";
import { useGame } from "../state/store";
import { ceremonyAt, ceremonyDuration, type CeremonyPhase } from "./ceremonyTimeline";
import { SHELF, rowY } from "./shelfLayout";

type Props = {
  guestUid: string;
  /** フル版か短縮版か。所持数から推測せず、firstMeetingDone を親が読んで渡す */
  isFirstMeeting: boolean;
  onDone: (skipped: boolean) => void;
};

const START: CeremonyPhase = ceremonyAt(0, true);

/**
 * 出会いの演出（Priority 1）。
 *
 * 「2匹が並んだ瞬間に嬉しさがあるか」がこのMVPの中心仮説であり、
 * その瞬間を作るのがこのコンポーネントの唯一の責務である。
 * 自由配置のロジックとは混ぜない。再生中は棚の操作を完全にロックする。
 *
 * 画面のどこをタップしてもスキップできる。繰り返し遊ぶ人にとって
 * 4秒の強制演出は待ち時間に変わるため、逃げ道を必ず用意する。
 */
export function MeetingCeremony({ guestUid, isFirstMeeting, onDone }: Props) {
  const game = useGame();
  const [phase, setPhase] = useState<CeremonyPhase>(START);
  const doneRef = useRef(false);

  const guest = game.owned.find((o) => o.uid === guestUid);

  // 先輩役は新入りの最近傍1匹
  const host = useMemo(() => {
    if (!guest) return undefined;
    const others = game.owned.filter((o) => o.uid !== guestUid && o.shelfRow >= 0);
    if (others.length === 0) return undefined;
    return others.reduce((best, o) => {
      const d = Math.hypot(o.x - guest.x, (o.shelfRow - guest.shelfRow) * 120);
      const bd = Math.hypot(best.x - guest.x, (best.shelfRow - guest.shelfRow) * 120);
      return d < bd ? o : best;
    });
  }, [game.owned, guest, guestUid]);

  const duration = ceremonyDuration(isFirstMeeting);

  useEffect(() => {
    // 迎える相手が居ない、あるいは新入りが箱の中なら演出せずに終える
    if (!guest || guest.shelfRow < 0 || !host) {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone(false);
      }
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      doneRef.current = true;
      onDone(false);
      return;
    }

    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - started;
      setPhase(ceremonyAt(t, isFirstMeeting));
      if (t >= duration) {
        if (!doneRef.current) {
          doneRef.current = true;
          // 最終状態を一瞬見せてから解放する
          window.setTimeout(() => onDone(false), 500);
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // onDone は毎レンダー変わりうるが、演出は1度きりなので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestUid, isFirstMeeting, duration, guest?.shelfRow, host?.uid]);

  const skip = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase(ceremonyAt(duration, isFirstMeeting));
    onDone(true);
  };

  if (!guest || !host) return null;

  const guestDef = getPlush(guest.defId);
  const hostDef = getPlush(host.defId);
  const guestY = rowY(guest.shelfRow);
  const hostY = rowY(host.shelfRow);
  const lookDir = Math.sign(guest.x - host.x) || 1;

  return (
    <div className="ceremony" onPointerDown={skip} role="presentation">
      <svg
        className="ceremony-stage"
        viewBox={`0 0 ${SHELF.width} ${SHELF.height + 40}`}
        aria-hidden="true"
      >
        {/* 先輩。新入りの方を向いて、つられて少し跳ねる */}
        <g transform={`translate(${host.x} ${hostY})`}>
          <PlushSVG
            def={hostDef}
            pose={{
              ...NEUTRAL_POSE,
              lookAt: phase.hostLook * lookDir,
              tilt: phase.hostLook * lookDir * 5,
              hop: phase.hostHop,
            }}
            seed={host.seed}
          />
        </g>

        {/* 新入り。上から落ちて、ころんと着地して、跳ねる */}
        <g transform={`translate(${guest.x} ${guestY})`}>
          <PlushSVG
            def={guestDef}
            pose={{
              ...NEUTRAL_POSE,
              squash: phase.guestSquash,
              hop: phase.guestDrop + phase.guestHop,
              lookAt: phase.guestHop > 0 ? -lookDir * 0.6 : 0,
            }}
            seed={guest.seed}
          />
          {phase.sparkle && <Sparkle r={guestDef.size} />}
        </g>

        {phase.hostLine && (
          <Bubble x={host.x} y={hostY - hostDef.size * 2.1} text={phase.hostLine} />
        )}
        {phase.guestLine && !phase.hostLine && (
          <Bubble x={guest.x} y={guestY - guestDef.size * 2.1} text={phase.guestLine} />
        )}
      </svg>

      {phase.caption && <p className="ceremony-caption">{phase.caption}</p>}
    </div>
  );
}

/** 小さな粒3つ。キラキラを過剰にしない（依頼書18章）。 */
function Sparkle({ r }: { r: number }) {
  const pts = [
    { x: -r * 0.9, y: -r * 1.6, s: 2.4 },
    { x: r * 0.85, y: -r * 1.9, s: 3 },
    { x: r * 0.2, y: -r * 2.3, s: 2 },
  ];
  return (
    <g>
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.s} fill="#e8c98a" opacity={0.75} />
      ))}
    </g>
  );
}

function Bubble({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.min(160, text.length * 13 + 22);
  const cx = Math.max(w / 2 + 4, Math.min(SHELF.width - w / 2 - 4, x));
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
