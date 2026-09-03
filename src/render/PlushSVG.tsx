import type { PlushDef, PlushEars, PlushExtra } from "../state/types";
import { applyIndividuality, lerp, type Pose } from "./pose";

type Props = {
  def: PlushDef;
  pose: Pose;
  seed: number;
};

/** shape ごとの胴の縦横比。丸く柔らかく、少し転がりそうなシルエットにする。 */
const SHAPE_RATIO: Record<PlushDef["art"]["shape"], { x: number; y: number }> = {
  round: { x: 1.0, y: 1.0 },
  pear: { x: 0.92, y: 1.04 },
  long: { x: 0.8, y: 1.18 },
  blob: { x: 1.1, y: 0.88 },
};

/**
 * ぬいぐるみを描く唯一のレンダラ。
 *
 * 棚・見守り・クレーン盤面のすべてがこれを使う。原点は足元中央 (0, 0) で上が負。
 * 親の <svg> の中に置き、transform で配置する。
 *
 * 仕様10章の直列化制約を守ること。棚のシェア画像はこの出力を
 * スタンドアロン SVG として canvas に流し込むため、以下を使ってはならない:
 *   <use> / <image> / <text> / Webフォント / url(...) を含む外部参照 / filter
 * 影は feGaussianBlur ではなく半透明の楕円で表現する。
 * 色は CSS クラスではなく必ずインラインの属性で持つ。
 */
export function PlushSVG({ def, pose, seed }: Props) {
  const d = applyIndividuality(def, seed);
  const r = d.size;
  const { body, accent, face, shape, ears, extras = [] } = d.art;

  const ratio = SHAPE_RATIO[shape];
  // squash < 1 で縦に潰れ、横に広がる。体積感を保つための逆方向の変形。
  const rx = r * ratio.x * (2 - pose.squash);
  const ry = r * ratio.y * pose.squash;
  const cy = -ry;

  const eyeR = 3.4;
  const eyeRy = eyeR * pose.eyeOpen;
  const eyeY = cy - ry * 0.14;
  const eyeX = rx * 0.32;
  const eyeDx = pose.lookAt * rx * 0.12;

  // 手は胴の楕円からわずかにはみ出す位置に置く。内側に入れると万歳が見えない。
  const armY = lerp(cy + ry * 0.34, cy - ry * 0.62, pose.armRaise);
  const armX = lerp(rx * 0.98, rx * 1.02, pose.armRaise);

  return (
    <g transform={`translate(0 ${-pose.hop}) rotate(${pose.tilt} 0 ${cy})`}>
      {/* 影。ぬいぐるみが浮くほど小さく薄くなる */}
      <ellipse
        data-part="shadow"
        cx={0}
        cy={pose.hop * 0.25 + 2}
        rx={rx * 0.82}
        ry={r * 0.15}
        fill="#4a3a2c"
        opacity={0.1}
      />

      {/* 胴より後ろの部位 */}
      <Ears kind={ears} rx={rx} ry={ry} cy={cy} body={body} accent={accent} layer="back" />
      <Extras kinds={extras} rx={rx} ry={ry} cy={cy} body={body} accent={accent} layer="back" />

      {/* 手足。胴の後ろに置いて、はみ出す部分だけ見せる */}
      <ellipse data-part="arm" cx={-armX} cy={armY} rx={r * 0.24} ry={r * 0.2} fill={body} />
      <ellipse data-part="arm" cx={armX} cy={armY} rx={r * 0.24} ry={r * 0.2} fill={body} />

      {/* 胴 */}
      <ellipse cx={0} cy={cy} rx={rx} ry={ry} fill={body} />

      {/* お腹 */}
      <ellipse
        cx={0}
        cy={cy + ry * 0.3}
        rx={rx * 0.54}
        ry={ry * 0.46}
        fill={accent}
        opacity={0.9}
      />

      {/* 胴より手前の部位 */}
      <Ears kind={ears} rx={rx} ry={ry} cy={cy} body={body} accent={accent} layer="front" />
      <Extras kinds={extras} rx={rx} ry={ry} cy={cy} body={body} accent={accent} layer="front" />

      {/* ほお */}
      <ellipse cx={-rx * 0.56} cy={eyeY + 6} rx={r * 0.16} ry={r * 0.1} fill="#e8a8a8" opacity={0.4} />
      <ellipse cx={rx * 0.56} cy={eyeY + 6} rx={r * 0.16} ry={r * 0.1} fill="#e8a8a8" opacity={0.4} />

      {/* 目。閉じているときは線に置き換える */}
      {pose.eyeOpen > 0.08 ? (
        <>
          <ellipse
            data-part="eye"
            cx={-eyeX + eyeDx}
            cy={eyeY}
            rx={eyeR}
            ry={eyeRy}
            fill={face}
          />
          <ellipse
            data-part="eye"
            cx={eyeX + eyeDx}
            cy={eyeY}
            rx={eyeR}
            ry={eyeRy}
            fill={face}
          />
          {/* ハイライト */}
          <ellipse
            cx={-eyeX + eyeDx + 1.2}
            cy={eyeY - eyeRy * 0.4}
            rx={1.1}
            ry={1.1 * pose.eyeOpen}
            fill="#ffffff"
            opacity={0.85}
          />
          <ellipse
            cx={eyeX + eyeDx + 1.2}
            cy={eyeY - eyeRy * 0.4}
            rx={1.1}
            ry={1.1 * pose.eyeOpen}
            fill="#ffffff"
            opacity={0.85}
          />
        </>
      ) : (
        <>
          <rect
            data-part="eyelid"
            x={-eyeX + eyeDx - eyeR}
            y={eyeY - 0.8}
            width={eyeR * 2}
            height={1.6}
            rx={0.8}
            fill={face}
          />
          <rect
            data-part="eyelid"
            x={eyeX + eyeDx - eyeR}
            y={eyeY - 0.8}
            width={eyeR * 2}
            height={1.6}
            rx={0.8}
            fill={face}
          />
        </>
      )}

      {/* 鼻と口。くちばしを持つ子には描かない */}
      {!extras.includes("beak") && (
        <>
          <ellipse cx={eyeDx * 0.5} cy={eyeY + 8} rx={2.6} ry={2} fill={face} />
          <path
            d={`M ${eyeDx * 0.5 - 4} ${eyeY + 11.4} Q ${eyeDx * 0.5} ${eyeY + 14} ${
              eyeDx * 0.5 + 4
            } ${eyeY + 11.4}`}
            stroke={face}
            strokeWidth={1.3}
            strokeLinecap="round"
            fill="none"
          />
        </>
      )}
    </g>
  );
}

type PartProps = {
  rx: number;
  ry: number;
  cy: number;
  body: string;
  accent: string;
  layer: "back" | "front";
};

function Ears({ kind, rx, ry, cy, body, accent, layer }: PartProps & { kind: PlushEars }) {
  if (kind === "none") return null;
  const r = Math.max(rx, ry);

  if (kind === "round") {
    if (layer === "back") {
      return (
        <>
          <circle cx={-rx * 0.66} cy={cy - ry * 0.68} r={r * 0.29} fill={body} />
          <circle cx={rx * 0.66} cy={cy - ry * 0.68} r={r * 0.29} fill={body} />
        </>
      );
    }
    return (
      <>
        <circle cx={-rx * 0.66} cy={cy - ry * 0.68} r={r * 0.15} fill={accent} />
        <circle cx={rx * 0.66} cy={cy - ry * 0.68} r={r * 0.15} fill={accent} />
      </>
    );
  }

  if (kind === "long") {
    if (layer === "back") {
      return (
        <>
          <ellipse
            cx={-rx * 0.32}
            cy={cy - ry * 1.02}
            rx={r * 0.16}
            ry={r * 0.46}
            fill={body}
            transform={`rotate(-9 ${-rx * 0.32} ${cy - ry * 1.02})`}
          />
          <ellipse
            cx={rx * 0.32}
            cy={cy - ry * 1.02}
            rx={r * 0.16}
            ry={r * 0.46}
            fill={body}
            transform={`rotate(9 ${rx * 0.32} ${cy - ry * 1.02})`}
          />
        </>
      );
    }
    return (
      <>
        <ellipse
          cx={-rx * 0.32}
          cy={cy - ry * 1.04}
          rx={r * 0.07}
          ry={r * 0.31}
          fill={accent}
          transform={`rotate(-9 ${-rx * 0.32} ${cy - ry * 1.04})`}
        />
        <ellipse
          cx={rx * 0.32}
          cy={cy - ry * 1.04}
          rx={r * 0.07}
          ry={r * 0.31}
          fill={accent}
          transform={`rotate(9 ${rx * 0.32} ${cy - ry * 1.04})`}
        />
      </>
    );
  }

  // pointed。頭のシルエットから明確に飛び出させないと、耳ではなく模様に見える。
  if (layer === "back") {
    const top = cy - ry * 1.5;
    const yBase = cy - ry * 0.68;
    return (
      <>
        <path
          d={`M ${-rx * 0.84} ${yBase} L ${-rx * 0.62} ${top} L ${-rx * 0.3} ${yBase} Z`}
          fill={body}
        />
        <path
          d={`M ${rx * 0.84} ${yBase} L ${rx * 0.62} ${top} L ${rx * 0.3} ${yBase} Z`}
          fill={body}
        />
      </>
    );
  }
  const top = cy - ry * 1.26;
  const yBase = cy - ry * 0.74;
  return (
    <>
      <path
        d={`M ${-rx * 0.73} ${yBase} L ${-rx * 0.6} ${top} L ${-rx * 0.42} ${yBase} Z`}
        fill={accent}
      />
      <path
        d={`M ${rx * 0.73} ${yBase} L ${rx * 0.6} ${top} L ${rx * 0.42} ${yBase} Z`}
        fill={accent}
      />
    </>
  );
}

function Extras({
  kinds,
  rx,
  ry,
  cy,
  body,
  accent,
  layer,
}: PartProps & { kinds: PlushExtra[] }) {
  const r = Math.max(rx, ry);
  const out: JSX.Element[] = [];

  // しっぽ・ひれは胴の楕円より外に出さないと埋もれて見えない。
  if (kinds.includes("tail") && layer === "back") {
    out.push(
      <ellipse
        key="tail"
        cx={rx * 1.16}
        cy={cy + ry * 0.36}
        rx={r * 0.32}
        ry={r * 0.26}
        fill={accent}
        transform={`rotate(-16 ${rx * 1.16} ${cy + ry * 0.36})`}
      />
    );
  }

  if (kinds.includes("flipper") && layer === "back") {
    const fy = cy + ry * 0.22;
    out.push(
      <ellipse
        key="fl"
        cx={-rx * 1.08}
        cy={fy}
        rx={r * 0.18}
        ry={r * 0.32}
        fill={body}
        transform={`rotate(-22 ${-rx * 1.08} ${fy})`}
      />,
      <ellipse
        key="fr"
        cx={rx * 1.08}
        cy={fy}
        rx={r * 0.18}
        ry={r * 0.32}
        fill={body}
        transform={`rotate(22 ${rx * 1.08} ${fy})`}
      />
    );
  }

  if (kinds.includes("tentacles") && layer === "front") {
    for (let i = 0; i < 5; i++) {
      const t = (i / 4) * 2 - 1;
      out.push(
        <ellipse
          key={`t${i}`}
          cx={t * rx * 0.66}
          cy={cy + ry * 0.86}
          rx={r * 0.15}
          ry={r * 0.22}
          fill={body}
        />
      );
    }
  }

  if (kinds.includes("beak") && layer === "front") {
    const beakY = cy - ry * 0.02;
    out.push(
      <path
        key="beak"
        d={`M ${-r * 0.16} ${beakY} L 0 ${beakY + r * 0.16} L ${r * 0.16} ${beakY} Z`}
        fill="#e8a55c"
      />
    );
  }

  return <>{out}</>;
}
