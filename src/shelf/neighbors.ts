import { SHELF } from "./shelfLayout";
import type { PlushInstance } from "../state/types";

/**
 * 隣接リンクの計算（仕様5.1）。
 *
 * 「距離が近い」だけで隣接を決めない。棚は詰め合わせで重なりが起きうる場所であり、
 * 距離だけで判定すると 12 匹が重なって置かれたときに総当たり（C(12,2)=66本）の
 * リンクが張られてしまう。それは「隣にいる」という言葉の意味を壊す。
 *
 * 代わりに隣接は**トポロジカル**に決める。ただし「各個体が自分から見た最近傍を
 * 選び、その和集合を取る」だけでは次数が抑えられない。最近傍の指名は一方向なので、
 * N 匹が同じ 1 匹を指名すればその 1 匹の次数は N-1 になる（x=101 に 10 匹、
 * 100 と 102 に 1 匹ずつ、で次数 10 の個体が実際に生まれていた）。
 * 次数 10 の「隣」は人間の読みでは隣ではない。
 *
 * そこで、リンクの生成規則を**相互性が構造的に保証される形**に変えた:
 *
 * - 同じ段: (x, instanceId) の全順序で一列に並べ、**隣り合う 2 匹だけ**を結ぶ。
 *   鎖なので、ある個体の前者から見た後者は必ず自分自身になる。段内の次数は
 *   必ず 2 以下。x が完全に同値でも instanceId が順序を決めるので、
 *   「同座標だから誰の隣でもない」という不連続（旧実装は `o.x < p.x` の
 *   厳密比較でリンク 0 本になっていた）が起きない。
 * - 上下: 隣接する段の間で「p から見て x 差最小」かつ「相手から見ても x 差最小」
 *   という**相互指名**が成立した組だけを結ぶ。上リンク・下リンクはそれぞれ
 *   1 本以下になる。
 *
 * 結果、1 個体の次数は 左1 + 右1 + 上1 + 下1 = **最大 4** で確定する
 * （配置に依存しない上界）。盤面全体では 個体数 * 4 / 2 本を超えない。
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

/**
 * 段内の並び順。x が同値でも instanceId で決着させ、**全順序**にする。
 *
 * ここで同値を許すと「左でも右でもない」個体が生まれ、完全に重ねて置いた
 * ぬいぐるみが誰の隣でもなくなる。1px ずらしただけで関係が生まれ、
 * 重ねると消えるという不連続は、プレイヤーには理不尽にしか見えない。
 */
function compareInRow(a: PlushInstance, b: PlushInstance): number {
  if (a.x !== b.x) return a.x - b.x;
  return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
}

/**
 * others の中で p と x 差が最小の 1 匹。同値なら instanceId の小さい方。
 *
 * 「先に見つかった方を残す」ではなく instanceId で決めるのは、入力配列の
 * 順序で結果が変わらないようにするため（保存データの並び順は保証されない）。
 */
function nearestByDx(p: PlushInstance, others: PlushInstance[]): PlushInstance | null {
  let best: PlushInstance | null = null;
  let bestDx = Number.POSITIVE_INFINITY;
  for (const o of others) {
    const dx = Math.abs(o.x - p.x);
    if (dx < bestDx || (dx === bestDx && best !== null && o.instanceId < best.instanceId)) {
      best = o;
      bestDx = dx;
    }
  }
  return best;
}

/**
 * 隣接**候補**のペア集合（閾値はまだ適用しない）。
 * 返り値は pairKey -> 2匹の距離。
 */
function topologicalCandidatePairs(onShelf: PlushInstance[]): Map<string, number> {
  const pairs = new Map<string, number>();

  const byRow = new Map<number, PlushInstance[]>();
  for (const p of onShelf) {
    const row = byRow.get(p.shelfRow) ?? [];
    row.push(p);
    byRow.set(p.shelfRow, row);
  }
  for (const row of byRow.values()) row.sort(compareInRow);

  // 段内: 全順序で隣り合う 2 匹だけを結ぶ（鎖）。相互性は構造的に成立する。
  for (const row of byRow.values()) {
    for (let i = 1; i < row.length; i++) {
      const l = row[i - 1];
      const r = row[i];
      pairs.set(pairKey(l.instanceId, r.instanceId), Math.abs(r.x - l.x));
    }
  }

  // 上下: 相互に「x 差最小」と指名し合った組だけを結ぶ。
  // 片側からの指名だけで結ぶと、下段の N 匹が上段の同じ 1 匹を指名して
  // その 1 匹の次数が N になる。
  for (const [row, upper] of byRow) {
    const lower = byRow.get(row + 1);
    if (!lower) continue;
    const yUpper = SHELF.rowY[row];
    const yLower = SHELF.rowY[row + 1];
    if (yUpper === undefined || yLower === undefined) continue;
    const rowGap = yLower - yUpper;

    for (const p of upper) {
      const down = nearestByDx(p, lower);
      if (!down) continue;
      const back = nearestByDx(down, upper);
      if (back?.instanceId !== p.instanceId) continue; // 相互でなければ隣ではない
      pairs.set(pairKey(p.instanceId, down.instanceId), Math.hypot(down.x - p.x, rowGap));
    }
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

/**
 * 保存された「隣になった時刻」。読めない値は「無い」として扱う。
 *
 * 壊れた保存データの文字列や NaN を since に採用すると togetherMs が
 * NaN になり、親密度がそのまま壊れる。
 */
function storedSince(neighborSince: Record<string, number>, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(neighborSince, key)) return null;
  const v = neighborSince[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 隣接リンクを計算する。**純粋関数** — instances / prev / neighborSince の
 * どれも書き換えない（並べ替えも入力配列のコピーに対して行う）。
 */
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

  for (const [key, distance] of candidatePairs) {
    /**
     * 「すでに隣だった」の判定に neighborSince も見るのが要点。
     *
     * 再読み込み直後の呼び出しは prev が必ず空になる。prev だけを見ていると、
     * 保存しておいた neighborSince が毎回捨てられ、togetherMs はセッションを
     * またいで積み上がらない（「ずっと隣にいる」が永久に成立しない）。
     * さらに、起動のたびに既存のペア全部が created として報告され、
     * 「隣になった」挿話がアプリを開くたびに一斉に鳴る。
     *
     * neighborSince にキーがあるということは、前回終了時点でこのペアが
     * リンクしていたという保存済みの事実そのものなので、それを
     * 「リンク済み」の証拠として扱う。結果として、ヒステリシスの内側
     * （110 以上 124 未満）で生き延びていたペアも再読み込みを跨いで生き残る。
     * 何も動かしていないのに読み込み直しただけで関係が切れる方が、
     * ヒステリシスを入れた目的（点滅させない）に反する。
     */
    const restored = storedSince(neighborSince, key);
    const established = prevByKey.has(key) || restored !== null;
    const threshold = established ? NEIGHBOR_BREAK_DISTANCE : NEIGHBOR_LINK_DISTANCE;
    if (distance >= threshold) continue;

    const [aId, bId] = key.split("|");
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue; // 候補生成後に消えることはないはずだが、念のため

    const since = established ? (restored ?? now) : now;
    nextSince[key] = since;
    // 復元されたリンクは「今できた」ではなく「前から続いている」。created に入れない。
    if (!established) created.push(key);

    const closeness = clamp01(1 - distance / NEIGHBOR_BREAK_DISTANCE);
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
      distance,
      closeness,
      sameType,
      cameHomeTogether,
      togetherMs,
      affinity,
    });
  }

  // 消えたリンクは prev だけでなく、保存されていた neighborSince からも探す。
  // 再読み込み後に閾値を割ったペアは prev に無いので、prev だけ見ると
  // 「切れた」ことを誰にも報告できない。
  const removed: string[] = [];
  const previouslyLinked = new Set<string>([
    ...prevByKey.keys(),
    ...Object.keys(neighborSince).filter((k) => storedSince(neighborSince, k) !== null),
  ]);
  for (const key of previouslyLinked) {
    if (!(key in nextSince)) removed.push(key);
  }
  removed.sort();

  nextLinks.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));

  return { links: nextLinks, neighborSince: nextSince, created, removed };
}
