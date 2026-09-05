import { describe, it, expect } from "vitest";
import {
  createDirector, tickDirector, directorPose,
  EPISODE_MIN_GAP_MS, EPISODE_MAX_GAP_MS, EPISODE_MAX_MS, FADE_MS,
  type DirectorState, type Episode, type Personality,
} from "./shelfDirector";
import { pairKey, type NeighborLink } from "./neighbors";

const link = (a: string, b: string, affinity = 1): NeighborLink => ({
  a, b, distance: 82, closeness: 0.7,
  sameType: false, cameHomeTogether: false, togetherMs: 0, affinity,
});

/** 等間隔に 0..1 を返す決定論的な乱数。呼ぶたびに次へ進む。 */
function evenRnd(step = 0.137, start = 0.05) {
  let v = start;
  return () => {
    const out = v;
    v = (v + step) % 1;
    return out;
  };
}

const NO_PERSONALITY: Record<string, Personality> = {};

/**
 * 指揮を回して、始まった挿話を集める。
 * 乱数はループの外で1つ作り、順に消費させる。
 */
function run(
  links: NeighborLink[],
  ms: number,
  opts: { rnd?: () => number; personalities?: Record<string, Personality> } = {}
) {
  const rnd = opts.rnd ?? evenRnd();
  const personalities = opts.personalities ?? NO_PERSONALITY;
  let s = createDirector(0);
  const started: Array<Episode & { at: number }> = [];
  const ended: Array<Episode & { at: number }> = [];
  /** いま走っているとテストが考えている挿話 */
  let active: Episode | null = null;
  const violations: string[] = [];

  for (let t = 0; t <= ms; t += 50) {
    const r = tickDirector(s, links, [], personalities, t, rnd);
    s = r.state;

    if (r.ended) {
      ended.push({ ...r.ended, at: t });
      if (active && r.ended.startedAt === active.startedAt) active = null;
    }
    if (r.started) {
      // 走っている最中に別の挿話が始まってはいけない
      if (active) violations.push(`t=${t}: 前の挿話が終わる前に次が始まった`);
      started.push({ ...r.started, at: t });
      active = r.started;
    }
    // 走っているはずの挿話が state から消えていないこと
    if (active && !s.episode) violations.push(`t=${t}: 挿話が黙って消えた`);
  }
  return { started, ended, violations, state: s };
}

describe("挿話は同時に高々1つ（仕様3章の原則）", () => {
  it("走っている最中に次の挿話が始まらない", () => {
    const r = run([link("a", "b"), link("c", "d")], 120_000);
    expect(r.violations).toEqual([]);
    expect(r.started.length, "そもそも一度も始まっていない").toBeGreaterThan(3);
  });

  it("始まった挿話は必ず終わる（数が釣り合う）", () => {
    const r = run([link("a", "b")], 120_000);
    expect(r.ended.length).toBeGreaterThanOrEqual(r.started.length - 1);
  });

  it("挿話の再生時間が 2〜3 秒に収まる", () => {
    const r = run([link("a", "b")], 120_000);
    expect(r.ended.length, "一度も終わっていない").toBeGreaterThan(0);
    for (const e of r.ended) {
      const dur = e.at - e.startedAt;
      expect(dur).toBeGreaterThanOrEqual(2000);
      expect(dur).toBeLessThanOrEqual(EPISODE_MAX_MS + 50);
    }
  });

  it("挿話の間隔が 6〜14 秒に収まる", () => {
    const r = run([link("a", "b")], 180_000);
    expect(r.started.length).toBeGreaterThan(3);
    for (let i = 1; i < r.started.length; i++) {
      const prevEnd = r.ended.find((e) => e.startedAt === r.started[i - 1].startedAt);
      expect(prevEnd, "前の挿話の終わりが見つからない").toBeDefined();
      const gap = r.started[i].at - prevEnd!.at;
      expect(gap).toBeGreaterThanOrEqual(EPISODE_MIN_GAP_MS - 50);
      expect(gap).toBeLessThanOrEqual(EPISODE_MAX_GAP_MS + 50);
    }
  });

  it("リンクが無ければ何も起きない", () => {
    const r = run([], 120_000);
    expect(r.started).toEqual([]);
  });
});

describe("greeting の割り込み（仕様5.4）", () => {
  it("新しいリンクができたら即座に挨拶する", () => {
    const s = createDirector(0);
    const r = tickDirector(s, [link("a", "b")], [pairKey("a", "b")],
                           NO_PERSONALITY, 100, evenRnd());
    expect(r.started?.kind).toBe("greeting");
  });

  it("走っている挿話を打ち切り、打ち切ったことを報告する", () => {
    const rnd = evenRnd();
    const links = [link("a", "b"), link("c", "d")];
    let s = createDirector(0);
    for (let t = 0; t <= 120_000; t += 50) {
      const r = tickDirector(s, links, [], NO_PERSONALITY, t, rnd);
      s = r.state;
      if (r.started && r.started.kind !== "greeting") {
        const cut = tickDirector(s, links, [pairKey("c", "d")],
                                 NO_PERSONALITY, t + 50, rnd);
        expect(cut.ended, "打ち切られた挿話が報告されない").not.toBeNull();
        expect(cut.ended!.startedAt).toBe(r.started.startedAt);
        expect(cut.started?.kind).toBe("greeting");
        expect(cut.state.fading, "消えかけの挿話が保持されていない").not.toBeNull();
        return;
      }
    }
    throw new Error("挿話が一度も始まらなかった");
  });

  it("打ち切られた側の姿勢が 300ms かけて中立へ戻る（飛ばない）", () => {
    const cut: Episode = { kind: "look", a: "a", b: "b", startedAt: 0, durationMs: 2400 };
    const state: DirectorState = {
      episode: { kind: "greeting", a: "c", b: "d", startedAt: 1000, durationMs: 2000 },
      fading: { episode: cut, until: 1000 + FADE_MS },
      nextAt: 99_999,
    };
    const at0 = directorPose(state, "a", 1000);
    const mid = directorPose(state, "a", 1000 + FADE_MS / 2);
    const done = directorPose(state, "a", 1000 + FADE_MS);
    // 中立へ単調に近づく
    expect(Math.abs(mid.lookAt)).toBeLessThanOrEqual(Math.abs(at0.lookAt));
    expect(Math.abs(done.lookAt)).toBeLessThanOrEqual(Math.abs(mid.lookAt));
    expect(done.lookAt).toBeCloseTo(0, 3);
    expect(done.tilt).toBeCloseTo(0, 3);
  });

  it("1回の配置確定で複数リンクができても挨拶は1本だけ", () => {
    const s = createDirector(0);
    const links = [link("a", "b", 1), link("a", "c", 2), link("b", "c", 0.5)];
    const created = [pairKey("a", "b"), pairKey("a", "c"), pairKey("b", "c")];
    const r = tickDirector(s, links, created, NO_PERSONALITY, 100, evenRnd());
    expect(r.started?.kind).toBe("greeting");
    // 最も affinity の高いリンクが選ばれる
    expect([r.started!.a, r.started!.b].sort()).toEqual(["a", "c"]);
    expect(r.state.episode?.kind).toBe("greeting");
  });
});

/**
 * ブリーフのテスト表に無い挙動。指揮は `removed` を受け取らないので、
 * 「相手が隣でなくなった」ことに気づく唯一の入口が links の消失になる。
 * ここを試さないと、箱へ戻された相手に向かって傾き続ける子が残る。
 */
describe("相手が隣でなくなったとき", () => {
  it("走っている挿話を打ち切り、姿勢はフェードで中立へ戻る", () => {
    const links = [link("a", "b")];
    const rnd = evenRnd();
    let s = createDirector(0);
    for (let t = 0; t <= 120_000; t += 50) {
      const r = tickDirector(s, links, [], NO_PERSONALITY, t, rnd);
      s = r.state;
      if (!r.started) continue;

      // 挿話の途中で相手が棚から消える（箱へ戻す・大きく動かす）
      const cutAt = t + 1000;
      const gone = tickDirector(s, [], [], NO_PERSONALITY, cutAt, rnd);
      expect(gone.ended, "打ち切りが報告されない").not.toBeNull();
      expect(gone.ended!.startedAt).toBe(r.started.startedAt);
      expect(gone.state.episode, "相手がいないのに演じ続けている").toBeNull();
      expect(gone.state.fading, "消えかけとして保持されていない").not.toBeNull();

      const mid = directorPose(gone.state, "a", cutAt + FADE_MS / 2);
      const done = directorPose(gone.state, "a", cutAt + FADE_MS);
      expect(Math.abs(mid.lookAt), "打ち切った瞬間に姿勢が飛んでいる").toBeGreaterThan(0.1);
      expect(Math.abs(done.lookAt)).toBeLessThanOrEqual(Math.abs(mid.lookAt));
      expect(done.lookAt).toBeCloseTo(0, 3);
      expect(done.tilt).toBeCloseTo(0, 3);
      return;
    }
    throw new Error("挿話が一度も始まらなかった");
  });
});

describe("純粋であること", () => {
  it("入力を書き換えない", () => {
    const links = [link("a", "b", 1), link("c", "d", 3)];
    const created = [pairKey("a", "b")];
    const personalities: Record<string, Personality> = { a: { sleepiness: 0.5 } };
    const snapshot = JSON.stringify({ links, created, personalities });
    const s = createDirector(0);
    const before = { ...s };

    tickDirector(s, links, created, personalities, 100, evenRnd());

    expect(JSON.stringify({ links, created, personalities })).toBe(snapshot);
    expect(s).toEqual(before);
  });

  it("何も起きないフレームでは state の参照が変わらない", () => {
    const s = createDirector(0);
    // nextAt は 6000。100ms では何も始まらない
    const r = tickDirector(s, [link("a", "b")], [], NO_PERSONALITY, 100, evenRnd());
    expect(r.state).toBe(s);
    expect(r.started).toBeNull();
    expect(r.ended).toBeNull();
  });
});

describe("対象の選ばれ方は重み付き（最大値固定ではない）", () => {
  it("両方のリンクが選ばれ、親密度の高いほうが多く選ばれる", () => {
    const counts: Record<string, number> = {};
    // 乱数の位相を変えて何度も回す
    for (let phase = 0; phase < 120; phase++) {
      const rnd = evenRnd(0.0731, phase / 120);
      const r = run([link("a", "b", 1), link("c", "d", 3)], 40_000, { rnd });
      for (const e of r.started) {
        const k = pairKey(e.a, e.b);
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    const low = counts[pairKey("a", "b")] ?? 0;
    const high = counts[pairKey("c", "d")] ?? 0;
    expect(high, "高い方が選ばれていない").toBeGreaterThan(low);
    // 常に最大値を選ぶ実装だと low が 0 になる。それはルーレットではない。
    expect(low, "低い方が一度も選ばれていない（最大値固定になっている）").toBeGreaterThan(0);
  });

  it("配列の順序を変えても結果の傾向が変わらない", () => {
    const tally = (links: NeighborLink[]) => {
      const c: Record<string, number> = {};
      for (let phase = 0; phase < 60; phase++) {
        const r = run(links, 40_000, { rnd: evenRnd(0.0731, phase / 60) });
        for (const e of r.started) {
          const k = pairKey(e.a, e.b);
          c[k] = (c[k] ?? 0) + 1;
        }
      }
      return c;
    };
    const forward = tally([link("a", "b", 1), link("c", "d", 3)]);
    const reversed = tally([link("c", "d", 3), link("a", "b", 1)]);
    for (const k of [pairKey("a", "b"), pairKey("c", "d")]) {
      const f = forward[k] ?? 0;
      const rv = reversed[k] ?? 0;
      const ratio = Math.max(f, rv) / Math.max(1, Math.min(f, rv));
      expect(ratio, `${k} が配列の順序に依存している`).toBeLessThan(2);
    }
  });
});

describe("性格が挿話の種類に効く（affinity には混ぜない）", () => {
  it("眠い子のリンクでは sleepTogether が起きやすい", () => {
    const links = [link("a", "b", 1)];
    const countKind = (sleepiness: number) => {
      let n = 0;
      for (let phase = 0; phase < 60; phase++) {
        const r = run(links, 60_000, {
          rnd: evenRnd(0.0731, phase / 60),
          personalities: { a: { sleepiness }, b: { sleepiness } },
        });
        n += r.started.filter((e) => e.kind === "sleepTogether").length;
      }
      return n;
    };
    expect(countKind(1)).toBeGreaterThan(countKind(0));
  });

  it("眠さはリンクの選ばれやすさを変えない", () => {
    const links = [link("a", "b", 1), link("c", "d", 1)];
    const share = (sleepiness: number) => {
      let ab = 0;
      let total = 0;
      for (let phase = 0; phase < 60; phase++) {
        const r = run(links, 40_000, {
          rnd: evenRnd(0.0731, phase / 60),
          personalities: { a: { sleepiness }, b: { sleepiness } },
        });
        for (const e of r.started) {
          total++;
          if (pairKey(e.a, e.b) === pairKey("a", "b")) ab++;
        }
      }
      return total === 0 ? 0 : ab / total;
    };
    // 眠さを変えても a-b が選ばれる割合はほぼ変わらないこと
    expect(Math.abs(share(1) - share(0))).toBeLessThan(0.15);
  });
});

describe("directorPose", () => {
  const ep = (kind: Episode["kind"]): DirectorState => ({
    episode: { kind, a: "a", b: "b", startedAt: 0, durationMs: 2400 },
    fading: null,
    nextAt: 99_999,
  });

  it("関与していない個体は中立のまま", () => {
    expect(directorPose(ep("look"), "z", 1000)).toEqual({
      lookAt: 0, hop: 0, eyeOpen: 1, tilt: 0,
    });
  });

  it("look では片方が先に、もう片方が遅れて見る", () => {
    const early = 300;
    expect(Math.abs(directorPose(ep("look"), "a", early).lookAt)).toBeGreaterThan(
      Math.abs(directorPose(ep("look"), "b", early).lookAt)
    );
  });

  it("sameDirection では2匹が同じ向きを見る", () => {
    const t = 1200;
    const a = directorPose(ep("sameDirection"), "a", t).lookAt;
    const b = directorPose(ep("sameDirection"), "b", t).lookAt;
    expect(Math.sign(a)).toBe(Math.sign(b));
    expect(Math.abs(a)).toBeGreaterThan(0.1);
  });

  it("sleepTogether では目が細くなる", () => {
    expect(directorPose(ep("sleepTogether"), "a", 1400).eyeOpen).toBeLessThan(1);
  });

  it("終了時刻には中立に戻っている", () => {
    for (const kind of ["look", "sameDirection", "sleepTogether", "greeting"] as const) {
      const p = directorPose(ep(kind), "a", 2400);
      expect(p.lookAt).toBeCloseTo(0, 2);
      expect(p.hop).toBeCloseTo(0, 2);
      expect(p.tilt).toBeCloseTo(0, 2);
      expect(p.eyeOpen).toBeCloseTo(1, 2);
    }
  });

  it("どの時刻でも有限の値を返す", () => {
    for (const kind of ["look", "sameDirection", "sleepTogether", "greeting"] as const) {
      for (const t of [-100, 0, 500, 2400, 100_000]) {
        for (const who of ["a", "b"]) {
          const p = directorPose(ep(kind), who, t);
          for (const [k, v] of Object.entries(p)) {
            expect(Number.isFinite(v), `${kind} ${who}@${t} ${k}`).toBe(true);
          }
        }
      }
    }
  });
});
