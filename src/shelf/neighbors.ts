import { SHELF } from "./shelfLayout";
import type { PlushInstance } from "../state/types";

/**
 * 隣接リンクの計算（仕様5.1）。
 *
 * 「距離が近い」だけで隣接を決めない。棚は詰め合わせで重なりが起きうる場所であり、
 * 距離だけで判定すると 12 匹が重なって置かれたときに総当たり（C(12,2)=66本）の
 * リンクが張られてしまう。それは「隣にいる」という言葉の意味を壊す。
 *
 * 代わりに、各個体について「左・右・上・下」それぞれの方向で最も近い1匹だけを
 * 候補にし、その候補が距離条件を満たすときだけリンクを張る（トポロジカルな隣接）。
 * これにより1個体の次数は最大4、盤面全体のリンク数は幾何的な上界
 * （個体数 * 4 / 2）を超えない。
 */

/** これ未満でリンクが「張られる」。 */
export const NEIGHBOR_LINK_DISTANCE = 110;
/** これを超えるとリンクが「切れる」。張る閾値より緩くしてヒステリシスを作る。 */
export const NEIGHBOR_BREAK_DISTANCE = 124;

/** togetherMs の親密度への寄与が頭打ちになるまでの時間 (ms)。 */
const TOGETHERNESS_SATURATION_MS = 120_000;

export type NeighborLink = {
  /** 辞書順で小さい方の instanceId */
  a: string;
  /** 辞書順で大きい方の instanceId */
  b: string;
  distance: number;
  /** 0-1。距離が近いほど高い */
  closeness: number;
  sameType: boolean;
  /** 一緒に迎えた関係か（片方がもう片方の witnessedBy） */
  cameHomeTogether: boolean;
  /** 連続して隣であり続けている時間 (ms)。切れると 0 に戻る */
  togetherMs: number;
  affinity: number;
};

/** 棚上の座標。段番号を y 座標に変換するだけの薄い関数。 */
export function shelfPointOf(p: PlushInstance): { x: number; y: number } {
  return { x: p.x, y: SHELF.rowY[Math.min(SHELF.rows - 1, Math.max(0, p.shelfRow))] };
}

/** 2つの instanceId から、順序に依存しないキーを作る。 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

type Candidate = { other: PlushInstance; distance: number };

/** 候補のうち距離が最小のものを選ぶ。同距離なら先に見つかった方を保つ（安定）。 */
function nearest(candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (best === null || c.distance < best.distance) best = c;
  }
  return best;
}

/**
 * 各個体について、左・右・上・下それぞれで最も近い1匹を候補として集める。
 * 戻り値はまだ距離条件（閾値）を適用していない「隣接候補」のペア集合。
 */
function topologicalCandidatePairs(onShelf: PlushInstance[]): Map<string, Candidate> {
  // pairKey -> 候補（同じペアが両側から選ばれても1エントリにまとめる）
  const pairs = new Map<string, Candidate>();

  const byRow = new Map<number, PlushInstance[]>();
  for (const p of onShelf) {
    const row = byRow.get(p.shelfRow) ?? [];
    row.push(p);
    byRow.set(p.shelfRow, row);
  }

  const addPair = (a: PlushInstance, b: PlushInstance, distance: number) => {
    pairs.set(pairKey(a.instanceId, b.instanceId), { other: b, distance });
  };

  for (const p of onShelf) {
    const sameRow = byRow.get(p.shelfRow) ?? [];

    // 左: 同じ段で x が小さい側のうち最も近い1匹
    const left = nearest(
      sameRow
        .filter((o) => o.instanceId !== p.instanceId && o.x < p.x)
        .map((o) => ({ other: o, distance: p.x - o.x }))
    );
    if (left) addPair(p, left.other, left.distance);

    // 右: 同じ段で x が大きい側のうち最も近い1匹
    const right = nearest(
      sameRow
        .filter((o) => o.instanceId !== p.instanceId && o.x > p.x)
        .map((o) => ({ other: o, distance: o.x - p.x }))
    );
    if (right) addPair(p, right.other, right.distance);

    // 上: 1段上で、x の差が最も小さい1匹
    const above = nearest(
      (byRow.get(p.shelfRow - 1) ?? []).map((o) => ({
        other: o,
        distance: Math.hypot(o.x - p.x, SHELF.rowY[p.shelfRow - 1] - SHELF.rowY[p.shelfRow]),
      }))
    );
    if (above) addPair(p, above.other, above.distance);

    // 下: 1段下で、x の差が最も小さい1匹
    const below = nearest(
      (byRow.get(p.shelfRow + 1) ?? []).map((o) => ({
        other: o,
        distance: Math.hypot(o.x - p.x, SHELF.rowY[p.shelfRow + 1] - SHELF.rowY[p.shelfRow]),
      }))
    );
    if (below) addPair(p, below.other, below.distance);
  }

  return pairs;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * a と b が「一緒に迎えた」関係かどうか。
 *
 * witnessedBy は「そのとき見守っていた個体」なので、どちらかが相手を
 * witnessedBy に持っていれば一緒に迎えたと言える。acquiredAt の一致では
 * 判定しない — acquiredAt は null（不明）でありうるし、null 同士を
 * 「同時刻」とみなすと分からない来歴を捏造することになる。
 */
function cameHomeTogetherOf(a: PlushInstance, b: PlushInstance): boolean {
  return a.witnessedBy === b.instanceId || b.witnessedBy === a.instanceId;
}

export function computeNeighbors(
  instances: PlushInstance[],
  prev: NeighborLink[],
  neighborSince: Record<string, number>,
  now: number
): { links: NeighborLink[]; neighborSince: Record<string, number>; created: string[]; removed: string[] } {
  const onShelf = instances.filter((p) => p.shelfRow >= 0);
  const byId = new Map(onShelf.map((p) => [p.instanceId, p]));

  const prevByKey = new Map(prev.map((l) => [pairKey(l.a, l.b), l]));
  const candidatePairs = topologicalCandidatePairs(onShelf);

  const nextLinks: NeighborLink[] = [];
  const nextSince: Record<string, number> = {};
  const created: string[] = [];

  for (const [key, cand] of candidatePairs) {
    const wasLinked = prevByKey.has(key);
    const threshold = wasLinked ? NEIGHBOR_BREAK_DISTANCE : NEIGHBOR_LINK_DISTANCE;
    if (cand.distance >= threshold) continue;

    const [aId, bId] = key.split("|");
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue; // 候補生成後に消えることはないはずだが、念のため

    const since = wasLinked ? (neighborSince[key] ?? now) : now;
    nextSince[key] = since;
    if (!wasLinked) created.push(key);

    const closeness = clamp01(1 - cand.distance / NEIGHBOR_BREAK_DISTANCE);
    const sameType = a.plushTypeId === b.plushTypeId;
    const cameHomeTogether = cameHomeTogetherOf(a, b);
    const togetherMs = Math.max(0, now - since);
    const affinity =
      closeness * 1.0 +
      (sameType ? 0.5 : 0) +
      (cameHomeTogether ? 0.8 : 0) +
      Math.min(togetherMs / TOGETHERNESS_SATURATION_MS, 1) * 0.4;

    nextLinks.push({
      a: aId,
      b: bId,
      distance: cand.distance,
      closeness,
      sameType,
      cameHomeTogether,
      togetherMs,
      affinity,
    });
  }

  const removed: string[] = [];
  for (const key of prevByKey.keys()) {
    if (!(key in nextSince)) removed.push(key);
  }

  nextLinks.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));

  return { links: nextLinks, neighborSince: nextSince, created, removed };
}
