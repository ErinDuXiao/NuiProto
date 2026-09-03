import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlush } from "../data/plushies";
import { pickLine } from "../data/lines";
import { PlushSVG } from "../render/PlushSVG";
import { NEUTRAL_POSE, type Pose } from "../render/pose";
import { useAmbientLife, type AmbientTarget } from "../render/useAmbientLife";
import { store, useGame } from "../state/store";
import { SHELF, rowY } from "./shelfLayout";
import { MeetingCeremony } from "./MeetingCeremony";

type Props = {
  onGoArcade: () => void;
  onShare: () => void;
};

type Bubble = { uid: string; text: string; until: number };

/**
 * 棚画面 = ぬいぐるみたちが暮らしている小さな部屋。
 *
 * 「インベントリ」や「コレクション一覧」に見せてはいけない（依頼書4章A）。
 * グリッド線・枠・通し番号・収集率（"2/10"）は一切出さない。
 */
export function ShelfScreen({ onGoArcade, onShare }: Props) {
  const game = useGame();
  const refs = useRef(new Map<string, SVGGElement | null>());
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [squashed, setSquashed] = useState<Record<string, number>>({});

  const ceremonyUid = game.pendingWelcome;
  const onShelf = useMemo(() => game.owned.filter((o) => o.shelfRow >= 0), [game.owned]);

  const targets: AmbientTarget[] = useMemo(
    () =>
      onShelf.map((o) => ({ uid: o.uid, seed: o.seed, x: o.x, shelfRow: o.shelfRow })),
    [onShelf]
  );

  // 演出中は環境アニメーションを止め、演出側にポーズの制御を渡す
  useAmbientLife(refs, targets, ceremonyUid === null);

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
    (uid: string, defId: string, seed: number) => {
      if (ceremonyUid) return;
      store.log("plush_touched", { plushId: defId });
      setBubbles((b) => [
        ...b.filter((x) => x.uid !== uid),
        { uid, text: pickLine("shelfTouch", seed, Math.floor(Date.now() / 1000)), until: Date.now() + 2200 },
      ]);
      setSquashed((s) => ({ ...s, [uid]: Date.now() }));
      window.setTimeout(() => {
        setSquashed((s) => {
          const next = { ...s };
          delete next[uid];
          return next;
        });
      }, 460);
    },
    [ceremonyUid]
  );

  return (
    <div className="screen shelf">
      <header className="shelf-header">
        <span className="shelf-title">ぬいぐるみのおうち</span>
        <span className="shelf-count">おともだち {game.owned.length}</span>
      </header>

      <svg
        className="room"
        viewBox={`0 0 ${SHELF.width} ${SHELF.height + 40}`}
        role="img"
        aria-label="ぬいぐるみの部屋"
      >
        <Room />

        {onShelf.map((o) => {
          const def = getPlush(o.defId);
          const y = rowY(o.shelfRow);
          const pose = poseFor(squashed[o.uid]);
          const bubble = bubbles.find((b) => b.uid === o.uid);
          return (
            <g key={o.uid} transform={`translate(0 ${y})`}>
              <g
                ref={(el) => {
                  refs.current.set(o.uid, el);
                }}
                transform={`translate(${o.x} 0)`}
                onPointerDown={() => touch(o.uid, o.defId, o.seed)}
                style={{ cursor: "pointer" }}
              >
                <PlushSVG def={def} pose={pose} seed={o.seed} />
              </g>
              {bubble && <Bubble x={o.x} y={-def.size * 2.1} text={bubble.text} />}
            </g>
          );
        })}
      </svg>

      <nav className="shelf-actions">
        <button className="btn primary" onClick={onGoArcade}>
          ゲームセンターへ
        </button>
        <button className="btn" onClick={onShare}>
          棚をシェア
        </button>
      </nav>

      {ceremonyUid && (
        <MeetingCeremony
          guestUid={ceremonyUid}
          isFirstMeeting={!game.firstMeetingDone}
          onDone={(skipped) => store.finishWelcome(skipped)}
        />
      )}
    </div>
  );
}

/** クリックされた直後だけ潰れて、オーバーシュートしながら戻る。 */
function poseFor(touchedAt: number | undefined): Pose {
  if (!touchedAt) return NEUTRAL_POSE;
  const t = (Date.now() - touchedAt) / 460;
  if (t >= 1) return NEUTRAL_POSE;
  const squash = 0.85 + 0.15 * t + Math.sin(t * Math.PI * 2) * 0.06;
  return { ...NEUTRAL_POSE, squash };
}

/** 部屋の背景。壁・窓・床・棚板。木は淡く、影は薄く。 */
function Room() {
  const w = SHELF.width;
  return (
    <g>
      <rect x={0} y={0} width={w} height={SHELF.height + 40} fill="#efe7dc" />
      {/* 窓 */}
      <rect x={w - 96} y={26} width={72} height={62} rx={8} fill="#dfe8ea" />
      <rect x={w - 96} y={26} width={72} height={62} rx={8} fill="none" stroke="#d8cbb8" strokeWidth={3} />
      <line x1={w - 60} y1={26} x2={w - 60} y2={88} stroke="#d8cbb8" strokeWidth={2} />
      {/* 棚板 */}
      {SHELF.rowY.map((y) => (
        <g key={y}>
          <rect x={8} y={y} width={w - 16} height={9} rx={3} fill="#d9c3a5" />
          <rect x={8} y={y + 9} width={w - 16} height={4} rx={2} fill="#c3a884" opacity={0.7} />
        </g>
      ))}
      {/* 床 */}
      <rect x={0} y={SHELF.height + 14} width={w} height={26} fill="#e3d5c0" />
    </g>
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
