import { getPlush } from "../data/plushies";
import { PlushSVG } from "../render/PlushSVG";
import { NEUTRAL_POSE } from "../render/pose";
import { ARM_TOP, type Crane } from "./craneMachine";
import type { Body, Pit } from "./physics";

/** 盤面の描画サイズ。ArcadeScreen の viewBox と揃える。 */
export const VIEW = { width: 320, height: 384, floorY: 336 } as const;

/** 奥行きによる横ずれの基準。中央を基準にして左右対称にずらす。 */
const Z_MID = 88;
const OFFSET_X = 40;

/**
 * 擬似3D投影（仕様 7.1）。
 * y が高さ、z が奥行き。奥ほど上に、わずかに右に、わずかに小さく。
 *
 * 横ずれを z の中央基準にすることで、盤面全体が画面の中に収まる。
 */
export function project(x: number, y: number, z: number) {
  return {
    sx: OFFSET_X + x + (z - Z_MID) * 0.32,
    sy: VIEW.floorY - z * 0.52 - y,
    scale: 1 - z * 0.0011,
  };
}

type Props = {
  bodies: Body[];
  crane: Crane;
  pit: Pit;
  debug: boolean;
};

/**
 * クレーン筐体と景品の描画。
 *
 * 描画順は z の降順（奥から手前へ）。派手な装飾やロゴは入れない（依頼書18章）。
 */
export function CraneView({ bodies, crane, pit, debug }: Props) {
  const sorted = [...bodies].sort((a, b) => b.z - a.z);
  const arm = project(crane.armX, crane.armY, crane.armZ);
  const exit = project(pit.exit.x, 0, pit.exit.z);

  return (
    <g>
      <Cabinet />

      {/* 出口シュート */}
      <g>
        <ellipse cx={exit.sx} cy={exit.sy} rx={pit.exit.r * 1.15} ry={pit.exit.r * 0.62} fill="#c7b49a" />
        <ellipse cx={exit.sx} cy={exit.sy + 2} rx={pit.exit.r} ry={pit.exit.r * 0.52} fill="#6b5a4a" opacity={0.5} />
      </g>

      {/* 景品 */}
      {sorted.map((b) => {
        const p = project(b.x, b.y, b.z);
        const def = getPlush(b.defId);
        return (
          <g key={b.id} transform={`translate(${p.sx} ${p.sy}) scale(${p.scale})`}>
            <PlushSVG
              def={def}
              pose={{ ...NEUTRAL_POSE, tilt: b.spin % 360, squash: b.held ? 0.94 : 1 }}
              seed={0.5}
            />
          </g>
        );
      })}

      {/* アーム */}
      <Arm sx={arm.sx} sy={arm.sy} armY={crane.armY} open={crane.heldId === null} />

      {debug && <DebugLayer bodies={bodies} pit={pit} crane={crane} />}

      {/* ガラス面。景品より手前に薄くかける */}
      <rect x={4} y={20} width={VIEW.width - 8} height={VIEW.floorY - 8} rx={8} fill="#dfeaf0" opacity={0.14} />
    </g>
  );
}

/** 筐体。淡いウッドとオフホワイト。 */
function Cabinet() {
  return (
    <g>
      <rect x={0} y={0} width={VIEW.width} height={VIEW.height} fill="#efe7dc" />
      {/* 内壁 */}
      <path
        d={`M 4 20 L ${VIEW.width - 4} 20 L ${VIEW.width - 4} ${VIEW.floorY} L 4 ${VIEW.floorY} Z`}
        fill="#e7ded1"
      />
      {/* 床。奥ほど上にいくので台形に見せる */}
      <path
        d={`M 4 ${VIEW.floorY - 92} L ${VIEW.width - 4} ${VIEW.floorY - 92} L ${VIEW.width - 4} ${VIEW.floorY} L 4 ${VIEW.floorY} Z`}
        fill="#e2d5c2"
      />
      <line x1={4} y1={VIEW.floorY - 92} x2={VIEW.width - 4} y2={VIEW.floorY - 92} stroke="#d5c5ae" strokeWidth={2} />
      {/* 上の梁 */}
      <rect x={0} y={0} width={VIEW.width} height={22} rx={6} fill="#d9c3a5" />
      {/* 下の台 */}
      <rect x={0} y={VIEW.floorY} width={VIEW.width} height={VIEW.height - VIEW.floorY} fill="#d9c3a5" />
      <rect x={0} y={VIEW.floorY} width={VIEW.width} height={5} fill="#c3a884" opacity={0.6} />
    </g>
  );
}

/** アーム。2本爪を開閉するだけの簡素なもの。 */
function Arm({ sx, sy, armY, open }: { sx: number; sy: number; armY: number; open: boolean }) {
  const spread = open ? 13 : 6;
  const railY = 26;
  const headY = sy - 34;
  return (
    <g>
      {/* レール */}
      <rect x={4} y={railY - 4} width={VIEW.width - 8} height={6} rx={3} fill="#cbb79b" />
      {/* ワイヤー */}
      <line x1={sx} y1={railY} x2={sx} y2={headY} stroke="#b6a288" strokeWidth={2} />
      {/* ヘッド */}
      <rect x={sx - 13} y={headY - 7} width={26} height={13} rx={5} fill="#c2ab8d" />
      {/* 爪 */}
      <path
        d={`M ${sx - 4} ${headY + 6} L ${sx - spread} ${headY + 22} L ${sx - spread + 4} ${headY + 26}`}
        stroke="#b09877"
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={`M ${sx + 4} ${headY + 6} L ${sx + spread} ${headY + 22} L ${sx + spread - 4} ${headY + 26}`}
        stroke="#b09877"
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
      {/* 落下位置の目安。アームが上にあるときだけ薄く出す */}
      {armY > 20 && (
        <ellipse cx={sx} cy={sy} rx={17} ry={7} fill="none" stroke="#b09877" strokeWidth={1.4} opacity={0.45} />
      )}
    </g>
  );
}

/** 当たり判定・速度ベクトル・出口領域。Developer Menu から切り替える。 */
function DebugLayer({ bodies, pit, crane }: { bodies: Body[]; pit: Pit; crane: Crane }) {
  const exit = project(pit.exit.x, 0, pit.exit.z);
  return (
    <g opacity={0.85}>
      <ellipse
        cx={exit.sx}
        cy={exit.sy}
        rx={pit.exit.r}
        ry={pit.exit.r * 0.55}
        fill="none"
        stroke="#d06a6a"
        strokeWidth={1.5}
      />
      {bodies.map((b) => {
        const p = project(b.x, b.y, b.z);
        const v = project(b.x + b.vx * 0.15, b.y, b.z + b.vz * 0.15);
        return (
          <g key={b.id}>
            <ellipse
              cx={p.sx}
              cy={p.sy}
              rx={b.r}
              ry={b.r * 0.55}
              fill="none"
              stroke="#6a8fd0"
              strokeWidth={1.2}
            />
            <line x1={p.sx} y1={p.sy} x2={v.sx} y2={v.sy} stroke="#6ad08f" strokeWidth={1.5} />
          </g>
        );
      })}
      <line
        x1={project(crane.armX, 0, crane.armZ).sx}
        y1={project(crane.armX, 0, crane.armZ).sy - 6}
        x2={project(crane.armX, 0, crane.armZ).sx}
        y2={project(crane.armX, 0, crane.armZ).sy + 6}
        stroke="#d06a6a"
        strokeWidth={2}
      />
    </g>
  );
}

export { ARM_TOP };
