import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../audio/sfx";
import { getPlush } from "../data/plushies";
import { pickLine } from "../data/lines";
import { PlushSVG } from "../render/PlushSVG";
import { NEUTRAL_POSE, plushTop } from "../render/pose";
import { useGame } from "../state/store";
import type { PlushDef, PlushInstance } from "../state/types";
import { ceremonyAt, ceremonyDuration, pickHost, type CeremonyPhase } from "./ceremonyTimeline";
import { SHELF, rowY } from "./shelfLayout";

export type Ceremony = {
  active: boolean;
  phase: CeremonyPhase;
  host?: PlushInstance;
  guest?: PlushInstance;
  /** 演出が描画を受け持つ個体。棚側はこれらを描かない（二重描画の防止） */
  stagedIds: Set<string>;
  skip: () => void;
};

const IDLE: Ceremony = {
  active: false,
  phase: ceremonyAt(0, true),
  stagedIds: new Set(),
  skip: () => {},
};

/**
 * 出会いの演出（Priority 1）のタイムラインを進める。
 *
 * 「2匹が並んだ瞬間に嬉しさがあるか」がこのMVPの中心仮説であり、
 * その瞬間を作るのがこの機能の唯一の責務である。自由配置とは混ぜない。
 *
 * 描画は部屋の SVG の中で行う（CeremonyActors）。
 * 別の SVG に重ねるとレイアウト箱が違って座標系がずれ、
 * ぬいぐるみが棚板から浮いてしまうため、必ず同じ SVG に描く。
 */
export function useCeremony(
  guestId: string | null,
  isFirstMeeting: boolean,
  onDone: (skipped: boolean) => void
): Ceremony {
  const game = useGame();
  const [phase, setPhase] = useState<CeremonyPhase>(IDLE.phase);
  /** 完了済みの guestId。同じ個体の演出を二度走らせないための番人 */
  const doneRef = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const guest = guestId ? game.instances.find((o) => o.instanceId === guestId) : undefined;
  const host = useMemo(
    () => (guestId ? pickHost(game.instances, guestId) : undefined),
    [game.instances, guestId]
  );

  const duration = ceremonyDuration(isFirstMeeting);
  const playable = Boolean(guestId && guest && guest.shelfRow >= 0 && host);

  // 同じ子が続けて迎え役になっても毎回同じことを言わないように、
  // 個体の seed と現在の所持数からセリフを選ぶ（仕様8章）。
  const lines = useMemo(
    () => ({
      host: pickLine("welcomeHost", host?.personalitySeed ?? 0, game.instances.length),
      guest: pickLine("welcomeGuest", guest?.personalitySeed ?? 0, game.instances.length),
    }),
    [host?.personalitySeed, guest?.personalitySeed, game.instances.length]
  );
  const linesRef = useRef(lines);
  linesRef.current = lines;

  useEffect(() => {
    if (!guestId || doneRef.current === guestId) return;

    // 迎える相手が居ない／新入りが箱の中／rAF が無い環境では演出せず即座に終える
    if (!playable || typeof requestAnimationFrame !== "function") {
      doneRef.current = guestId;
      onDoneRef.current(false);
      return;
    }

    const started = performance.now();
    let raf = 0;
    let finishTimer = 0;
    let landed = false;

    const finish = () => {
      if (doneRef.current === guestId) return;
      doneRef.current = guestId;
      onDoneRef.current(false);
    };

    const tick = (now: number) => {
      const t = now - started;
      const next = ceremonyAt(t, isFirstMeeting, linesRef.current);
      // 新入りが着地した瞬間に一度だけ「ころん」
      if (!landed && next.guestDrop === 0) {
        landed = true;
        sfx.koron();
      }
      setPhase(next);
      if (t >= duration) {
        // 最終状態を一瞬見せてから配置操作を解放する
        finishTimer = window.setTimeout(finish, 500);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(finishTimer);
    };
  }, [guestId, isFirstMeeting, duration, playable]);

  const stagedIds = useMemo(() => {
    if (!guestId || !playable) return new Set<string>();
    return new Set(host ? [guestId, host.instanceId] : [guestId]);
  }, [guestId, playable, host]);

  if (!guestId || !playable) return IDLE;

  return {
    active: true,
    phase,
    host,
    guest,
    stagedIds,
    skip: () => {
      if (doneRef.current === guestId) return;
      doneRef.current = guestId;
      setPhase(ceremonyAt(duration, isFirstMeeting, linesRef.current));
      onDoneRef.current(true);
    },
  };
}

/**
 * 演出中の2匹。**部屋の SVG の中に置くこと。**
 * 棚のぬいぐるみと同じ座標系で描くことで、棚板からの浮きが起きない。
 */
export function CeremonyActors({ ceremony }: { ceremony: Ceremony }) {
  const { phase, host, guest } = ceremony;
  if (!ceremony.active || !host || !guest) return null;

  const guestDef = getPlush(guest.plushTypeId);
  const hostDef = getPlush(host.plushTypeId);
  const guestY = rowY(guest.shelfRow);
  const hostY = rowY(host.shelfRow);
  const lookDir = Math.sign(guest.x - host.x) || 1;

  return (
    <g>
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
          seed={host.personalitySeed}
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
          seed={guest.personalitySeed}
        />
        {phase.sparkle && <Sparkle r={guestDef.size} />}
      </g>

      {phase.hostLine && (
        <CeremonyBubble x={host.x} y={hostY + bubbleY(hostDef)} text={phase.hostLine} />
      )}
      {phase.guestLine && !phase.hostLine && (
        <CeremonyBubble
          x={guest.x}
          y={guestY + bubbleY(guestDef) - phase.guestHop}
          text={phase.guestLine}
        />
      )}
    </g>
  );
}

function bubbleY(def: PlushDef): number {
  return plushTop(def) - 14;
}

/** 小さな粒3つ。キラキラを過剰にしない（依頼書18章）。 */
function Sparkle({ r }: { r: number }) {
  const pts = [
    { x: -r * 0.95, y: -r * 1.7, s: 2.4 },
    { x: r * 0.9, y: -r * 2.0, s: 3 },
    { x: r * 0.2, y: -r * 2.4, s: 2 },
  ];
  return (
    <g>
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.s} fill="#e8c98a" opacity={0.75} />
      ))}
    </g>
  );
}

function CeremonyBubble({ x, y, text }: { x: number; y: number; text: string }) {
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

/**
 * 演出中に画面を覆う層。タップでスキップし、キャプションを出す。
 * 繰り返し遊ぶ人にとって強制演出は待ち時間に変わるので、逃げ道を必ず用意する。
 */
export function CeremonyOverlay({ ceremony }: { ceremony: Ceremony }) {
  if (!ceremony.active) return null;
  return (
    <div className="ceremony" onPointerDown={ceremony.skip} role="presentation">
      {ceremony.phase.caption && <p className="ceremony-caption">{ceremony.phase.caption}</p>}
    </div>
  );
}
