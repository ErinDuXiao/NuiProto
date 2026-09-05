import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlush } from "../data/plushies";
import { pickLine } from "../data/lines";
import { PlushSVG } from "../render/PlushSVG";
import { NEUTRAL_POSE, plushTop, type Pose } from "../render/pose";
import { useAmbientLife, type AmbientTarget } from "../render/useAmbientLife";
import { sfx } from "../audio/sfx";
import { store, useGame } from "../state/store";
import { SHELF, rowY } from "./shelfLayout";
import { useDragPlacement } from "./useDragPlacement";
import { useCeremony, CeremonyActors, CeremonyOverlay } from "./MeetingCeremony";
import { PlushProfile } from "./PlushProfile";

type Props = {
  onGoArcade: () => void;
  onShare: () => void;
  /** 隅の小さなドット。3回押すと Developer Menu が開く（依頼書25章） */
  onSecretTap: () => void;
};

type Bubble = { instanceId: string; text: string; until: number };

/**
 * 棚画面 = ぬいぐるみたちが暮らしている小さな部屋。
 *
 * 「インベントリ」や「コレクション一覧」に見せてはいけない（依頼書4章A）。
 * グリッド線・枠・通し番号・収集率（"2/10"）は一切出さない。
 */
export function ShelfScreen({ onGoArcade, onShare, onSecretTap }: Props) {
  const game = useGame();
  const refs = useRef(new Map<string, SVGGElement | null>());
  const svgRef = useRef<SVGSVGElement>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [squashed, setSquashed] = useState<Record<string, number>>({});
  /** 演出中はタップのリアクションを止める。コールバックを作り直さずに済ませる */
  const ceremonyActiveRef = useRef(false);
  /** touch コールバックを作り直さずに最新の所持品を読むため */
  const instancesRef = useRef(game.instances);
  instancesRef.current = game.instances;
  /** ドラッグフックへ渡すタップ処理。実体は下で差し込む */
  const touchRef = useRef<(instanceId: string) => void>(() => {});
  /** アンマウント後に発火させないための後片付け */
  const squashTimers = useRef(new Set<number>());
  const ringTimer = useRef(0);
  /** 迎えたばかりの子。少しの間だけ淡いリングを出す（仕様8章） */
  const [ringId, setRingId] = useState<string | null>(null);
  /** タップ中の子。プロフィールカードを出す対象（仕様4.6: リアクションと同時に開く） */
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(
    () => () => {
      for (const t of squashTimers.current) window.clearTimeout(t);
      squashTimers.current.clear();
      window.clearTimeout(ringTimer.current);
    },
    []
  );

  const ceremonyId = game.pendingWelcome;
  const onShelf = useMemo(
    () => game.instances.filter((o) => o.shelfRow >= 0),
    [game.instances]
  );

  const ceremony = useCeremony(ceremonyId, !game.firstMeetingDone, (skipped) => {
    const arrived = store.get().pendingWelcome;
    store.finishWelcome(skipped);
    if (arrived) {
      setRingId(arrived);
      window.clearTimeout(ringTimer.current);
      ringTimer.current = window.setTimeout(() => setRingId(null), 2000);
    }
  });
  ceremonyActiveRef.current = ceremony.active;

  const targets: AmbientTarget[] = useMemo(
    () =>
      onShelf.map((o) => ({
        instanceId: o.instanceId,
        personalitySeed: o.personalitySeed,
        x: o.x,
        shelfRow: o.shelfRow,
      })),
    [onShelf]
  );

  const { onPointerDown, drag } = useDragPlacement({
    instances: game.instances,
    svgRef,
    enabled: !ceremony.active,
    onTap: (instanceId) => touchRef.current(instanceId),
  });

  // 演出中・ドラッグ中は環境アニメーションを止める。
  // ambient が transform を書き換えると、掴んだ位置とずれてしまう。
  useAmbientLife(refs, targets, !ceremony.active && drag === null);

  // 滞在時間を計る。「一覧として消費されている」か「眺めている」かを見分ける指標（仕様17.2）
  useEffect(() => {
    store.log("shelf_view");
    const enteredAt = Date.now();
    return () => {
      store.log("shelf_dwell", { meta: { ms: Date.now() - enteredAt } });
    };
  }, []);

  // 吹き出しの寿命管理
  useEffect(() => {
    if (bubbles.length === 0) return;
    const id = window.setTimeout(() => {
      setBubbles((b) => b.filter((x) => x.until > Date.now()));
    }, 400);
    return () => window.clearTimeout(id);
  }, [bubbles]);

  const touch = useCallback(
    (instanceId: string) => {
      if (ceremonyActiveRef.current) return;
      const target = instancesRef.current.find((o) => o.instanceId === instanceId);
      if (!target) return;
      const { plushTypeId, personalitySeed } = target;
      sfx.init();
      sfx.place();
      store.log("plush_touched", { plushId: plushTypeId });
      setBubbles((b) => [
        ...b.filter((x) => x.instanceId !== instanceId),
        {
          instanceId,
          text: pickLine("shelfTouch", personalitySeed, Math.floor(Date.now() / 1000)),
          until: Date.now() + 2200,
        },
      ]);
      setSquashed((s) => ({ ...s, [instanceId]: Date.now() }));
      // リアクション（潰れ＋セリフ）とプロフィールは同時に起きる（仕様4.6）。
      // どちらかを起こしてどちらかを起こさない、は「一連の動作」を壊す。
      setProfileId(instanceId);
      const timer = window.setTimeout(() => {
        squashTimers.current.delete(timer);
        setSquashed((s) => {
          const next = { ...s };
          delete next[instanceId];
          return next;
        });
      }, 460);
      squashTimers.current.add(timer);
    },
    []
  );

  touchRef.current = touch;

  return (
    <div className="screen shelf">
      <header className="shelf-header">
        <span className="shelf-title">ぬいぐるみのおうち</span>
        <span className="shelf-count">おともだち {game.instances.length}</span>
        <MuteToggle />
      </header>

      <div className="room-wrap">
      <svg
        ref={svgRef}
        className="room"
        viewBox={`0 0 ${SHELF.width} ${SHELF.height + 53}`}
        role="img"
        aria-label="ぬいぐるみの部屋"
      >
        <Room />

        <CeremonyActors ceremony={ceremony} />

        {onShelf.map((o) => {
          if (ceremony.stagedIds.has(o.instanceId)) return null;
          const def = getPlush(o.plushTypeId);
          const dragging = drag?.instanceId === o.instanceId && drag.moved;
          const x = dragging ? drag.x : o.x;
          const row = dragging ? drag.shelfRow : o.shelfRow;
          const y = rowY(row);
          const pose = poseFor(squashed[o.instanceId], dragging);
          const bubble = bubbles.find((b) => b.instanceId === o.instanceId);
          return (
            <g key={o.instanceId} transform={`translate(0 ${y})`} opacity={dragging ? 0.92 : 1}>
              <g
                ref={(el) => {
                  // React は外すときに null を渡す。消さないと棚から居なくなった
                  // 個体のエントリが残り続ける
                  if (el) refs.current.set(o.instanceId, el);
                  else refs.current.delete(o.instanceId);
                }}
                transform={`translate(${x} 0)`}
                onPointerDown={(e) => onPointerDown(o.instanceId, e)}
                style={{ cursor: dragging ? "grabbing" : "grab" }}
              >
                <PlushSVG def={def} pose={pose} seed={o.personalitySeed} />
              </g>
              {o.instanceId === ringId && <WelcomeRing x={x} r={def.size} />}
              {bubble && <Bubble x={x} y={plushTop(def) - 14} text={bubble.text} />}
            </g>
          );
        })}
      </svg>
      </div>

      {/*
        保存できていないことは、隠れた開発メニューではなくここで伝える。
        遊んだ結果が消えることを黙っているのは不誠実。
      */}
      {!store.isPersisted() && (
        <p className="persist-warn">
          このブラウザでは記録を保存できないみたい。とじると消えてしまいます。
        </p>
      )}

      {/* 演出中はナビゲーションを止める。途中で画面を離れると演出が中断される */}
      <nav className="shelf-actions">
        <button className="btn primary" onClick={onGoArcade} disabled={ceremony.active}>
          ゲームセンターへ
        </button>
        <button className="btn" onClick={onShare} disabled={ceremony.active}>
          棚をシェア
        </button>
      </nav>

      <CeremonyOverlay ceremony={ceremony} />

      {profileId && <PlushProfile instanceId={profileId} onClose={() => setProfileId(null)} />}

      {/* Developer Menu の入口。通常プレイヤーの目に触れない大きさにする */}
      <button className="secret-dot" aria-hidden="true" tabIndex={-1} onClick={onSecretTap} />
    </div>
  );
}

/** 音のオン・オフ。小さく、常に出しておく（仕様13章）。 */
function MuteToggle() {
  const [muted, setMuted] = useState(sfx.isMuted());
  return (
    <button
      className="mute-btn"
      aria-label={muted ? "音を出す" : "音を消す"}
      onClick={() => {
        sfx.init();
        const next = !muted;
        sfx.setMuted(next);
        setMuted(next);
      }}
    >
      {muted ? "♪ off" : "♪ on"}
    </button>
  );
}

/** クリックされた直後だけ潰れて、オーバーシュートしながら戻る。 */
function poseFor(touchedAt: number | undefined, dragging = false): Pose {
  // つままれている間は少し伸びて揺れる
  if (dragging) return { ...NEUTRAL_POSE, squash: 1.06, tilt: -4 };
  if (!touchedAt) return NEUTRAL_POSE;
  const t = (Date.now() - touchedAt) / 460;
  if (t >= 1) return NEUTRAL_POSE;
  const squash = 0.85 + 0.15 * t + Math.sin(t * Math.PI * 2) * 0.06;
  return { ...NEUTRAL_POSE, squash };
}

/**
 * 部屋の背景。
 *
 * 「棚の図」ではなく「小さな部屋」に見せるための背景（依頼書4章A）。
 * 棚板だけを並べると収納棚の設計図に見えてしまうので、
 * キャビネットの枠・窓・窓からの光・鉢植え・ラグを置いて生活の気配を作る。
 * 装飾は少なく、彩度は低く、影は薄く。
 */
function Room() {
  const w = SHELF.width;
  const h = SHELF.height;
  const { frameLeft: fl, frameRight: fr, frameTop: ft } = SHELF;

  return (
    <g>
      {/* 壁 */}
      <rect x={0} y={0} width={w} height={h + 40} fill="#efe7dc" />
      {/* 幅木 */}
      <rect x={0} y={h + 8} width={w} height={5} fill="#e0d3c0" />
      {/* 床 */}
      <rect x={0} y={h + 13} width={w} height={40} fill="#e5d8c5" />

      {/* 窓と、そこから差す光。キャビネットより上に置く */}
      <g>
        <rect x={22} y={14} width={74} height={58} rx={9} fill="#dde9ea" />
        <rect x={22} y={14} width={74} height={58} rx={9} fill="none" stroke="#dccfbb" strokeWidth={4} />
        <line x1={59} y1={14} x2={59} y2={72} stroke="#dccfbb" strokeWidth={3} />
        <path d={`M 24 74 L 106 74 L 168 ${h + 13} L 4 ${h + 13} Z`} fill="#fff8ea" opacity={0.3} />
      </g>

      {/* キャビネット。左右に部屋の余白を残して「部屋の中の家具」に見せる */}
      <rect x={fl - 9} y={ft - 12} width={fr - fl + 18} height={h + 25 - ft} rx={12} fill="#e4d3b8" />
      <rect x={fl} y={ft} width={fr - fl} height={h + 10 - ft} fill="#eae1d3" />
      {/* 側板の内側の陰 */}
      <rect x={fl} y={ft} width={6} height={h + 10 - ft} fill="#d7c6ae" opacity={0.5} />
      <rect x={fr - 6} y={ft} width={6} height={h + 10 - ft} fill="#d7c6ae" opacity={0.5} />
      {/* 天板 */}
      <rect x={fl - 13} y={ft - 19} width={fr - fl + 26} height={10} rx={5} fill="#d9c3a5" />
      {/* 脚 */}
      <rect x={fl + 2} y={h + 13} width={11} height={9} rx={3} fill="#c9ad8c" />
      <rect x={fr - 13} y={h + 13} width={11} height={9} rx={3} fill="#c9ad8c" />

      {/* 棚板 */}
      {SHELF.rowY.map((y) => (
        <g key={y}>
          <rect x={fl} y={y} width={fr - fl} height={9} rx={2} fill="#d9c3a5" />
          <rect x={fl} y={y + 9} width={fr - fl} height={5} rx={2} fill="#c3a884" opacity={0.5} />
        </g>
      ))}

      {/* 天板の上の小物。生活の気配 */}
      <g transform={`translate(${fr - 34} ${ft - 19})`}>
        <path d="M -8 0 L 8 0 L 6 -13 L -6 -13 Z" fill="#cbab8c" />
        <ellipse cx={0} cy={-13} rx={6.4} ry={2.3} fill="#bd9c7d" />
        <ellipse cx={-5} cy={-22} rx={5} ry={7.5} fill="#a9bd9a" transform="rotate(-22 -5 -22)" />
        <ellipse cx={5} cy={-24} rx={4.6} ry={8} fill="#9db08e" transform="rotate(20 5 -24)" />
        <ellipse cx={0} cy={-28} rx={4.2} ry={6.8} fill="#b3c4a4" />
      </g>

      {/* 床のかご */}
      <g transform={`translate(16 ${h + 30})`}>
        <path d="M -13 0 L 13 0 L 10 -18 L -10 -18 Z" fill="#dcc7a6" />
        <rect x={-11} y={-20} width={22} height={4} rx={2} fill="#cfb691" />
      </g>

      {/* ラグ */}
      <ellipse cx={w / 2 - 30} cy={h + 34} rx={92} ry={13} fill="#ddcdb6" />
      <ellipse cx={w / 2 - 30} cy={h + 34} rx={62} ry={8} fill="#e6d9c6" />
    </g>
  );
}

/** 迎えたばかりの子の足元に出る、ごく淡いリング。 */
function WelcomeRing({ x, r }: { x: number; r: number }) {
  return (
    <ellipse
      cx={x}
      cy={2}
      rx={r * 1.15}
      ry={r * 0.3}
      fill="none"
      stroke="#d8b98a"
      strokeWidth={2}
      opacity={0.55}
    >
      <animate attributeName="opacity" values="0.55;0.15;0.55" dur="1.6s" repeatCount="indefinite" />
    </ellipse>
  );
}

function Bubble({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.min(150, text.length * 12 + 20);
  return (
    <g transform={`translate(${Math.max(w / 2 + 4, Math.min(SHELF.width - w / 2 - 4, x))} ${y})`}>
      <rect x={-w / 2} y={-20} width={w} height={24} rx={12} fill="#fffaf3" opacity={0.96} />
      <path d="M -5 3 L 0 10 L 5 3 Z" fill="#fffaf3" opacity={0.96} />
      <text
        x={0}
        y={-3}
        textAnchor="middle"
        fontSize={12}
        fill="#6b5a4e"
        style={{ fontFamily: "inherit" }}
      >
        {text}
      </text>
    </g>
  );
}
