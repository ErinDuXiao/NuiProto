import { describe, it, expect } from "vitest";
import {
  computeNeighbors, pairKey, shelfPointOf,
  NEIGHBOR_LINK_DISTANCE, NEIGHBOR_BREAK_DISTANCE,
} from "./neighbors";
import { SHELF } from "./shelfLayout";
import { SLOT_SPACING } from "../state/persist";
import type { PlushInstance } from "../state/types";

const inst = (id: string, x: number, row: number, type = "bear_01"): PlushInstance => ({
  instanceId: id, plushTypeId: type, acquiredAt: 0,
  attemptsToAcquire: null, witnessedBy: null, origin: "crane",
  x, shelfRow: row, personalitySeed: 0.5,
});

const fresh = (instances: PlushInstance[], now = 1000) =>
  computeNeighbors(instances, [], {}, now);

describe("隣接の距離条件（仕様5.1）", () => {
  it("同じ段の隣は隣接する", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 78 + SLOT_SPACING, 1)]);
    expect(r.links).toHaveLength(1);
  });

  it("真上・真下は隣接する", () => {
    const r = fresh([inst("a", 160, 1), inst("b", 160, 2)]);
    expect(r.links).toHaveLength(1);
  });

  it("斜めは隣接しない（配置が読み取れるようにするため）", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 78 + SLOT_SPACING, 2)]);
    expect(r.links).toHaveLength(0);
  });

  it("段の間隔とスロット間隔が前提どおり", () => {
    expect(SLOT_SPACING).toBeLessThanOrEqual(NEIGHBOR_LINK_DISTANCE);
    const rowGap = SHELF.rowY[1] - SHELF.rowY[0];
    expect(rowGap).toBeLessThanOrEqual(NEIGHBOR_LINK_DISTANCE);
    expect(Math.hypot(SLOT_SPACING, rowGap)).toBeGreaterThan(NEIGHBOR_BREAK_DISTANCE);
  });

  it("箱の中（shelfRow < 0）は隣接判定に入らない", () => {
    const r = fresh([inst("a", 160, 1), inst("b", 160, -1)]);
    expect(r.links).toHaveLength(0);
  });
});

describe("ヒステリシス（点滅させない）", () => {
  it("一度隣になったら、少し離れただけでは切れない", () => {
    const a = inst("a", 100, 1);
    const b = inst("b", 100 + NEIGHBOR_LINK_DISTANCE - 2, 1);
    const first = computeNeighbors([a, b], [], {}, 0);
    expect(first.links).toHaveLength(1);

    const bFar = { ...b, x: 100 + NEIGHBOR_LINK_DISTANCE + 8 }; // 118 < 124
    const second = computeNeighbors([a, bFar], first.links, first.neighborSince, 100);
    expect(second.links, "解消閾値の内側なのに切れた").toHaveLength(1);
  });

  it("解消閾値を超えれば切れる", () => {
    const a = inst("a", 100, 1);
    const b = inst("b", 100 + NEIGHBOR_LINK_DISTANCE - 2, 1);
    const first = computeNeighbors([a, b], [], {}, 0);
    const bFar = { ...b, x: 100 + NEIGHBOR_BREAK_DISTANCE + 6 };
    const second = computeNeighbors([a, bFar], first.links, first.neighborSince, 100);
    expect(second.links).toHaveLength(0);
    expect(second.removed).toContain(pairKey("a", "b"));
  });
});

describe("リンクの生成と消滅", () => {
  it("新しいリンクを created で報告する", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 160, 1)]);
    expect(r.created).toEqual([pairKey("a", "b")]);
  });

  it("既存のリンクは created に入らない", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = fresh(list);
    const second = computeNeighbors(list, first.links, first.neighborSince, 2000);
    expect(second.created).toEqual([]);
  });

  it("切れたリンクの neighborSince を削除する", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = fresh(list);
    expect(Object.keys(first.neighborSince)).toHaveLength(1);
    const apart = [list[0], { ...list[1], x: 300 }];
    const second = computeNeighbors(apart, first.links, first.neighborSince, 2000);
    expect(second.neighborSince).toEqual({});
  });

  it("pairKey は順序に依存しない", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});

describe("togetherMs は連続して隣にいる時間", () => {
  it("時間とともに増える", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 1000);
    expect(first.links[0].togetherMs).toBe(0);
    const later = computeNeighbors(list, first.links, first.neighborSince, 6000);
    expect(later.links[0].togetherMs).toBe(5000);
  });

  it("一度離すと 0 に戻る", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 0);
    const apart = [list[0], { ...list[1], x: 300 }];
    const gone = computeNeighbors(apart, first.links, first.neighborSince, 60_000);
    const again = computeNeighbors(list, gone.links, gone.neighborSince, 61_000);
    expect(again.links[0].togetherMs).toBe(0);
  });
});

describe("親密度", () => {
  it("近いほど高い", () => {
    const near = fresh([inst("a", 100, 1), inst("b", 160, 1)]).links[0];
    const far = fresh([inst("a", 100, 1), inst("b", 205, 1)]).links[0];
    expect(near.affinity).toBeGreaterThan(far.affinity);
  });

  it("同じ種類のほうが高い", () => {
    const same = fresh([inst("a", 78, 1, "bear_01"), inst("b", 160, 1, "bear_01")]).links[0];
    const diff = fresh([inst("a", 78, 1, "bear_01"), inst("b", 160, 1, "fox_01")]).links[0];
    expect(same.affinity).toBeGreaterThan(diff.affinity);
    expect(same.sameType).toBe(true);
  });

  it("一緒に迎えた関係のほうが高い", () => {
    const a = inst("a", 78, 1);
    const b = { ...inst("b", 160, 1), witnessedBy: "a" };
    const together = fresh([a, b]).links[0];
    const apart = fresh([a, inst("b", 160, 1)]).links[0];
    expect(together.cameHomeTogether).toBe(true);
    expect(together.affinity).toBeGreaterThan(apart.affinity);
  });

  it("長く隣にいるほど高い", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 0);
    const later = computeNeighbors(list, first.links, first.neighborSince, 200_000);
    expect(later.links[0].affinity).toBeGreaterThan(first.links[0].affinity);
  });
});

describe("隣接は各方向でいちばん近い1匹だけ（仕様5.1）", () => {
  it("同じ段に3匹並ぶと、端どうしは隣接しない", () => {
    const r = fresh([
      inst("l", 78, 1),
      inst("m", 78 + SLOT_SPACING, 1),
      inst("rr", 78 + SLOT_SPACING * 2, 1),
    ]);
    const keys = r.links.map((k) => pairKey(k.a, k.b));
    expect(keys).toContain(pairKey("l", "m"));
    expect(keys).toContain(pairKey("m", "rr"));
    // 端どうしは間に m がいるので隣ではない
    expect(keys).not.toContain(pairKey("l", "rr"));
  });

  it("重なって置かれても、隣は左右上下でそれぞれ1匹まで", () => {
    // 距離だけで判定すると 3 匹が総当たりで 3 本張ってしまう
    const r = fresh([inst("a", 160, 1), inst("b", 168, 1), inst("c", 176, 1)]);
    for (const id of ["a", "b", "c"]) {
      const degree = r.links.filter((k) => k.a === id || k.b === id).length;
      expect(degree, `${id} の隣が多すぎる`).toBeLessThanOrEqual(4);
    }
    expect(r.links.map((k) => pairKey(k.a, k.b))).not.toContain(pairKey("a", "c"));
  });

  it("リンクは対称。片方から見て隣なら、もう片方から見ても隣", () => {
    const r = fresh([inst("a", 100, 1), inst("b", 170, 1), inst("c", 240, 1)]);
    for (const k of r.links) {
      expect(k.a < k.b, "リンクの端点は辞書順に正規化されている").toBe(true);
    }
    expect(new Set(r.links.map((k) => pairKey(k.a, k.b))).size).toBe(r.links.length);
  });
});

describe("規模", () => {
  it("棚が満杯でもリンクは幾何的な上界を超えない", () => {
    const all: PlushInstance[] = [];
    for (let row = 0; row < SHELF.rows; row++) {
      for (let col = 0; col < 3; col++) {
        all.push(inst(`p${row}-${col}`, 78 + col * SLOT_SPACING, row));
      }
    }
    const r = fresh(all);
    // 各個体の隣は左右上下の最大4つ。12 * 4 / 2 = 24
    expect(r.links.length).toBeLessThanOrEqual(24);
    expect(r.links.length).toBeGreaterThan(0);
  });

  it("全員が同座標でも、リンクが総当たりにならない", () => {
    // 距離だけで判定すると C(12,2) = 66 本になる。それは「隣にいる」ではない。
    const all = Array.from({ length: 12 }, (_, i) => inst(`p${i}`, 160, 1));
    const r = fresh(all);
    expect(r.links.length, "総当たりになっている").toBeLessThanOrEqual(24);
    expect(Object.keys(r.neighborSince).length).toBeLessThanOrEqual(24);
  });

  it("0匹・1匹でも落ちない", () => {
    expect(fresh([]).links).toEqual([]);
    expect(fresh([inst("a", 160, 1)]).links).toEqual([]);
  });
});

const degreeOf = (links: { a: string; b: string }[], id: string) =>
  links.filter((k) => k.a === id || k.b === id).length;

const maxDegree = (links: { a: string; b: string }[], ids: string[]) =>
  ids.reduce((m, id) => Math.max(m, degreeOf(links, id)), 0);

describe("次数の上界（隣が多すぎれば、それはもう「隣」ではない）", () => {
  it("同じ x にほぼ全員が積み上がっても、次数は 4 を超えない", () => {
    // レビューが見つけた実例。旧実装では 101 の 10 匹が全員 100 の子を
    // 「左の最近傍」に指名し、その子の次数が 10 になっていた。
    const xs = [100, ...Array<number>(10).fill(101), 102];
    const all = xs.map((x, i) => inst(`q${i}`, x, 1));
    const r = fresh(all);
    const ids = all.map((p) => p.instanceId);

    // (x, instanceId) の全順序で一列に並ぶので、鎖のリンクはちょうど 11 本。
    expect(r.links).toHaveLength(11);
    expect(maxDegree(r.links, ids), "同じ相手を全員が指名して次数が膨らんでいる").toBeLessThanOrEqual(4);
  });

  it("上下の段を巻き込んで密集しても、次数は 4 を超えない", () => {
    // レビューが見つけたもうひとつの実例（旧実装で 33 本・最大次数 10）。
    const xs = [150, 151, 152, 153, 150, 151, 152, 153, 150, 151];
    const all = [
      ...xs.map((x, i) => inst(`m${i}`, x, 2)),
      inst("up", 150, 1),
      inst("down", 153, 3),
    ];
    const r = fresh(all);
    const ids = all.map((p) => p.instanceId);

    expect(maxDegree(r.links, ids), "次数の上界が効いていない").toBeLessThanOrEqual(4);
    // 段内の鎖 9 本 + 上下の相互指名 2 本。
    expect(r.links).toHaveLength(11);
  });

  it("棚が満杯でも 1 匹あたりの隣は 4 匹まで", () => {
    const all: PlushInstance[] = [];
    for (let row = 0; row < SHELF.rows; row++) {
      for (let col = 0; col < 3; col++) {
        all.push(inst(`p${row}-${col}`, 78 + col * SLOT_SPACING, row));
      }
    }
    const r = fresh(all);
    expect(maxDegree(r.links, all.map((p) => p.instanceId))).toBeLessThanOrEqual(4);
  });
});

describe("完全に同じ座標でも隣関係が成立する", () => {
  it("同座標のままでも、リンクが 0 本にはならない", () => {
    // 旧実装は「x が小さい側／大きい側」を厳密比較で探していたため、
    // 同座標の子は誰の左でも右でもなく、リンクが 1 本も張られなかった。
    // 「全員が同座標でも総当たりにならない」テストは 0 本でも通ってしまう。
    const all = Array.from({ length: 12 }, (_, i) => inst(`p${i}`, 160, 1));
    const r = fresh(all);
    expect(r.links.length, "同座標だと誰の隣でもなくなっている").toBe(11);
    expect(maxDegree(r.links, all.map((p) => p.instanceId))).toBeLessThanOrEqual(4);
  });

  it("1px ずらしただけで関係の数が激変しない", () => {
    const stacked = Array.from({ length: 12 }, (_, i) => inst(`p${i}`, 160, 1));
    const nudged = stacked.map((p, i) => (i === 0 ? { ...p, x: 161 } : p));
    expect(fresh(nudged).links.length).toBe(fresh(stacked).links.length);
  });

  it("同座標の並び順は入力配列の順序に依存しない", () => {
    // 保存データの並び順は保証されない。並べ替えただけで関係が変わると、
    // 読み込むたびに違う「隣」が生まれる。
    const all = Array.from({ length: 6 }, (_, i) => inst(`p${i}`, 160, 1));
    const forward = fresh(all).links.map((k) => pairKey(k.a, k.b)).sort();
    const backward = fresh([...all].reverse()).links.map((k) => pairKey(k.a, k.b)).sort();
    expect(backward).toEqual(forward);
  });
});

describe("ヒステリシス: 張る閾値と切る閾値は別物", () => {
  it("初対面のペアは、張る閾値の外なら隣にならない", () => {
    // 距離 115 は「切る閾値(124)の内側だが張る閾値(110)の外」。
    // 両方に解消閾値を使う実装（＝ヒステリシスなし）はここだけで落ちる。
    const a = inst("a", 100, 1);
    const b = inst("b", 100 + 115, 1);
    const r = computeNeighbors([a, b], [], {}, 1000);
    expect(r.links, "張る側にも解消閾値を使っている").toHaveLength(0);
    expect(r.created).toEqual([]);
    expect(r.neighborSince).toEqual({});
  });
});

describe("保存された隣接は再読み込みをまたいで続く", () => {
  const pair = () => [inst("a", 78, 1), inst("b", 160, 1)];

  it("再読み込み後も togetherMs が積み上がる", () => {
    const list = pair();
    const first = computeNeighbors(list, [], {}, 1000);
    // 再読み込み直後は prev が必ず空。保存されているのは neighborSince だけ。
    const afterReload = computeNeighbors(list, [], first.neighborSince, 500_000);
    expect(afterReload.links[0].togetherMs, "起動のたびに 0 に戻っている").toBe(499_000);
  });

  it("再読み込みでは created を報告しない", () => {
    // ここが漏れると、アプリを開くたびに既存のペア全部で
    // 「隣になった」挿話が一斉に鳴る。
    const list = pair();
    const first = computeNeighbors(list, [], {}, 1000);
    const afterReload = computeNeighbors(list, [], first.neighborSince, 500_000);
    expect(afterReload.created, "既存の関係を毎回「新しい関係」にしている").toEqual([]);
  });

  it("ヒステリシスの内側にいるペアは再読み込みでも切れない", () => {
    const a = inst("a", 100, 1);
    const near = inst("b", 100 + NEIGHBOR_LINK_DISTANCE - 2, 1);
    const first = computeNeighbors([a, near], [], {}, 0);
    const drifted = { ...near, x: 100 + 118 }; // 110 <= 118 < 124
    const moved = computeNeighbors([a, drifted], first.links, first.neighborSince, 100);
    expect(moved.links).toHaveLength(1);

    // 何も動かしていないのに読み込み直しただけで関係が消えるのは、
    // ヒステリシスを入れた目的（点滅させない）に真っ向から反する。
    // 保存された neighborSince を「このペアは繋がっていた」という
    // 事実として扱い、解消閾値で判定する。
    const afterReload = computeNeighbors([a, drifted], [], moved.neighborSince, 200);
    expect(afterReload.links, "読み込み直しただけで関係が切れた").toHaveLength(1);
    expect(afterReload.created).toEqual([]);
  });

  it("保存されていても解消閾値を超えていれば切れて removed に出る", () => {
    const list = pair();
    const first = computeNeighbors(list, [], {}, 1000);
    const apart = [list[0], { ...list[1], x: 300 }];
    const afterReload = computeNeighbors(apart, [], first.neighborSince, 2000);
    expect(afterReload.links).toEqual([]);
    expect(afterReload.removed).toContain(pairKey("a", "b"));
    expect(afterReload.neighborSince).toEqual({});
  });

  it("壊れた neighborSince の値は since に採用しない", () => {
    // NaN を since にすると togetherMs が NaN になり、親密度がまるごと壊れる。
    const list = pair();
    const broken: Record<string, number> = { [pairKey("a", "b")]: Number.NaN };
    const r = computeNeighbors(list, [], broken, 5000);
    expect(r.links).toHaveLength(1);
    expect(Number.isFinite(r.links[0].togetherMs)).toBe(true);
    expect(r.links[0].togetherMs).toBe(0);
    expect(Number.isFinite(r.links[0].affinity)).toBe(true);
  });
});

describe("computeNeighbors は純粋関数", () => {
  it("instances / prev / neighborSince のどれも書き換えない", () => {
    // 入力の配列を並べ替える実装に変わっても、返り値だけを見るテストでは
    // 気づけない。凍結して呼び、値の同一性も併せて確かめる。
    const list = [inst("b", 160, 1), inst("a", 78, 1), inst("c", 242, 1)];
    const first = computeNeighbors(list, [], {}, 1000);

    const instancesBefore = structuredClone(list);
    const prevBefore = structuredClone(first.links);
    const sinceBefore = structuredClone(first.neighborSince);

    Object.freeze(list);
    for (const p of list) Object.freeze(p);
    Object.freeze(first.links);
    for (const l of first.links) Object.freeze(l);
    Object.freeze(first.neighborSince);

    // ESM は strict mode なので、書き換えようとすればここで TypeError になる。
    const second = computeNeighbors(list, first.links, first.neighborSince, 9000);

    expect(list).toEqual(instancesBefore);
    expect(first.links).toEqual(prevBefore);
    expect(first.neighborSince).toEqual(sinceBefore);
    // 返り値が入力を使い回していないこと（呼び出し側の変更が遡って効かない）
    expect(second.neighborSince).not.toBe(first.neighborSince);
    expect(second.links).not.toBe(first.links);
  });
});

describe("shelfPointOf", () => {
  it("段のY座標を返す", () => {
    expect(shelfPointOf(inst("a", 160, 2))).toEqual({ x: 160, y: SHELF.rowY[2] });
  });
});
