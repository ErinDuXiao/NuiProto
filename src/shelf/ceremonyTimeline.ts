/**
 * 出会いの演出のタイムライン（仕様 8 章 / Priority 1）。
 *
 * このMVPで最も重要な数秒間。「景品を獲得した」ではなく
 * 「この子に新しい友達を連れて帰ってあげた」と感じさせるための演出である。
 *
 * 時刻 → 状態の純粋関数として書く。DOM から独立しているので、
 * タイムラインだけをテストでき、感触の調整を数値だけで行える。
 */

export type CeremonyPhase = {
  /** 先輩の視線。-1(左) .. 1(右)。新入りの方向へ向く */
  hostLook: number;
  /** 先輩の跳ね (px) */
  hostHop: number;
  /** 新入りの落下オフセット (px)。正で上にいる */
  guestDrop: number;
  /** 新入りの跳ね (px) */
  guestHop: number;
  /** 新入りの潰れ。着地の「ころん」を表す */
  guestSquash: number;
  hostLine?: string;
  guestLine?: string;
  caption?: string;
  sparkle: boolean;
};

const FULL_MS = 4000;
const SHORT_MS = 2400;

export function ceremonyDuration(isFirstMeeting: boolean): number {
  return isFirstMeeting ? FULL_MS : SHORT_MS;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0→1 をなめらかに。 */
function ease(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * 各キーの時刻（ms）。初回はゆっくり、2匹目以降は詰める。
 * 繰り返すと4秒は待ち時間に変わるため、短縮版を用意している（仕様8章）。
 */
type Marks = {
  land: number;
  turn: number;
  greet: number;
  bounce: number;
  settle: number;
  caption: number;
  end: number;
};

const FULL: Marks = {
  land: 450,
  turn: 600,
  greet: 1000,
  bounce: 1800,
  settle: 2600,
  caption: 3200,
  end: FULL_MS,
};

const SHORT: Marks = {
  land: 260,
  turn: 340,
  greet: 620,
  bounce: 1050,
  settle: 1500,
  caption: 1850,
  end: SHORT_MS,
};

export type CeremonyLines = { host: string; guest: string };

const DEFAULT_LINES: CeremonyLines = { host: "はじめまして！", guest: "……よろしくね。" };

export function ceremonyAt(
  ms: number,
  isFirstMeeting: boolean,
  lines: CeremonyLines = DEFAULT_LINES
): CeremonyPhase {
  const m = isFirstMeeting ? FULL : SHORT;
  // 範囲外は端の状態で安定させる。演出は必ず落ち着いた形で終わる。
  const t = Math.min(Math.max(ms, 0), m.end);

  // 新入りが上から落ちてくる → 着地で潰れて戻る
  const dropT = clamp01(t / m.land);
  const guestDrop = (1 - dropT * dropT) * 90;
  let guestSquash = 1;
  if (t >= m.land && t < m.land + 320) {
    const p = (t - m.land) / 320;
    // 0.72 まで潰れてから、少しだけ伸びて戻る
    guestSquash = 0.72 + 0.28 * ease(p) + Math.sin(p * Math.PI) * 0.1 * (1 - p);
  } else if (t >= m.land) {
    guestSquash = 1;
  } else {
    guestSquash = 1.06;
  }

  // 先輩が新入りの方を向く
  const hostLook = t >= m.turn ? ease((t - m.turn) / 420) : 0;

  // 新入りが2回跳ねる。sin の負の山を折り返して2つの山にする
  let guestHop = 0;
  if (t >= m.bounce && t < m.settle) {
    const p = (t - m.bounce) / (m.settle - m.bounce);
    guestHop = Math.abs(Math.sin(p * Math.PI * 2)) * 12 * (1 - p * 0.45);
  }

  // 先輩もつられて小さく跳ねる
  let hostHop = 0;
  if (t >= m.greet && t < m.greet + 420) {
    const p = (t - m.greet) / 420;
    hostHop = Math.max(0, Math.sin(p * Math.PI) * 7);
  }

  const greetWindow = t >= m.greet && t < m.settle;
  const guestWindow = t >= m.bounce && t < m.settle + 300;

  return {
    hostLook,
    hostHop,
    guestDrop,
    guestHop,
    guestSquash,
    hostLine: greetWindow ? lines.host : undefined,
    guestLine: guestWindow ? lines.guest : undefined,
    caption: t >= m.caption ? "Welcome home." : undefined,
    sparkle: t >= m.bounce && t < m.bounce + 700,
  };
}

/**
 * 出会いの演出で「迎える側」になる子を選ぶ。新入りの最近傍1匹。
 *
 * ShelfScreen と MeetingCeremony の両方がこれを使う。
 * 演出中は棚側がこの2匹の描画を止め、演出側が描く。
 * 両方が描くと同じぬいぐるみが二重に見えるため、選定は必ず1箇所に置く。
 */
export function pickHost<T extends { instanceId: string; x: number; shelfRow: number }>(
  instances: T[],
  guestId: string
): T | undefined {
  const guest = instances.find((o) => o.instanceId === guestId);
  if (!guest) return undefined;
  const others = instances.filter((o) => o.instanceId !== guestId && o.shelfRow >= 0);
  if (others.length === 0) return undefined;
  const cost = (o: T) => Math.abs(o.x - guest.x) + Math.abs(o.shelfRow - guest.shelfRow) * 400;
  return others.reduce((best, o) => (cost(o) < cost(best) ? o : best));
}
