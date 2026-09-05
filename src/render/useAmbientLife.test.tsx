import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import {
  ambientRelationTargets,
  easeLean,
  stepRelations,
  useAmbientLife,
  MAX_LEAN_DEG,
  type AmbientTarget,
  type ShelfRelations,
} from "./useAmbientLife";
import type { NeighborLink } from "../shelf/neighbors";
import {
  createDirector,
  tickDirector,
  type Episode,
  type DirectorState,
} from "../shelf/shelfDirector";

function link(a: string, b: string, over: Partial<NeighborLink> = {}): NeighborLink {
  return {
    a,
    b,
    distance: 82,
    closeness: 0.34,
    sameType: false,
    cameHomeTogether: false,
    togetherMs: 0,
    affinity: 1,
    ...over,
  };
}

function relations(over: Partial<ShelfRelations> = {}): ShelfRelations {
  return {
    links: [],
    revision: 0,
    personalities: {},
    created: [],
    director: createDirector(0),
    onTransition: () => {},
    ...over,
  };
}

/** 決定論的な乱数。挿話の間隔・長さが毎回同じになる。 */
function fixedRnd(v = 0.5): () => number {
  return () => v;
}

describe("stepRelations — created の消費 (Task 4/5 レビューの申し送り)", () => {
  it("created を渡した最初のフレームで挨拶が始まる", () => {
    const started: Episode[] = [];
    const rel = relations({
      links: [link("a", "b")],
      created: ["a|b"],
      onTransition: (s) => {
        if (s) started.push(s);
      },
    });
    stepRelations(rel, 100, fixedRnd());
    expect(started).toHaveLength(1);
    expect(started[0].kind).toBe("greeting");
  });

  it("created は結果によらず1フレームで空になる", () => {
    // リンクがまだ届いていないので挨拶は起きない。それでも溜めておかない。
    const rel = relations({ links: [], created: ["a|b"] });
    stepRelations(rel, 100, fixedRnd());
    expect(rel.created).toEqual([]);
  });

  it("同じ created を持ち続けても挨拶は2度と始まらない", () => {
    const started: Episode[] = [];
    const rel = relations({
      links: [link("a", "b")],
      created: ["a|b"],
      onTransition: (s) => {
        if (s) started.push(s);
      },
    });
    // 60 秒間まわす。挨拶は 2〜3 秒で終わるので、created が残っていれば
    // 終わった直後のフレームで何度でも再開してしまう。
    for (let t = 0; t <= 60_000; t += 50) stepRelations(rel, t, fixedRnd());

    const greetings = started.filter((e) => e.kind === "greeting");
    expect(greetings, "挨拶が連発している").toHaveLength(1);
  });

  it("created を消費しないと同じペアが挨拶し続ける（防いでいる不具合の再現）", () => {
    // stepRelations を使わず、created を持ちっぱなしにした素朴な実装。
    // これが「同じペアが 2〜3 秒ごとに永久に挨拶する」経路。
    let state: DirectorState = createDirector(0);
    const stale = ["a|b"];
    let greetings = 0;
    for (let t = 0; t <= 60_000; t += 50) {
      const res = tickDirector(state, [link("a", "b")], stale, {}, t, fixedRnd());
      state = res.state;
      if (res.started?.kind === "greeting") greetings++;
    }
    expect(greetings, "この経路が壊れていないなら消費を守る意味がない").toBeGreaterThan(5);
  });

  it("onTransition は毎フレームではなく遷移の瞬間だけ呼ばれる", () => {
    let calls = 0;
    const rel = relations({
      links: [link("a", "b")],
      onTransition: () => {
        calls++;
      },
    });
    // 40 秒 = 2400 フレーム。挿話は 6〜14 秒ごとなので開始・終了あわせて 10 回前後。
    for (let t = 0; t <= 40_000; t += 1000 / 60) stepRelations(rel, t, Math.random);
    expect(calls).toBeGreaterThan(0);
    expect(calls, "毎フレーム React に触れている").toBeLessThan(30);
  });

  it("挿話は常に高々1つしか走らない", () => {
    const rel = relations({ links: [link("a", "b"), link("b", "c"), link("c", "d")] });
    for (let t = 0; t <= 120_000; t += 50) {
      stepRelations(rel, t, Math.random);
      // DirectorState は episode を1つしか持てないので、型として1つ以下。
      // 走っている挿話と消えかけの挿話が同じペアで二重にならないことを見る。
      const ep = rel.director.episode;
      const fading = rel.director.fading;
      if (ep && fading) expect(fading.until).toBeGreaterThan(ep.startedAt);
    }
  });
});

describe("ambientRelationTargets — 常時層", () => {
  const pos = new Map([
    ["a", 100],
    ["b", 182],
  ]);
  const strength = new Map([
    ["a", 1],
    ["b", 1],
  ]);

  it("互いに相手の方へ傾く", () => {
    const t = ambientRelationTargets(pos, [link("a", "b")], strength);
    expect(t.get("a")!.lean).toBeGreaterThan(0);
    expect(t.get("b")!.lean).toBeLessThan(0);
  });

  it("傾きは 3.5 度を超えない", () => {
    const t = ambientRelationTargets(
      pos,
      [link("a", "b", { affinity: 99 })],
      new Map([
        ["a", 1.3 * 1.15],
        ["b", 1.3 * 1.15],
      ])
    );
    expect(Math.abs(t.get("a")!.lean)).toBeLessThanOrEqual(MAX_LEAN_DEG);
  });

  it("両隣に挟まれた子は傾きが打ち消されても見る向きを持つ", () => {
    const p = new Map([
      ["a", 100],
      ["b", 182],
      ["c", 264],
    ]);
    const s = new Map([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);
    const t = ambientRelationTargets(p, [link("a", "b"), link("b", "c")], s);
    expect(t.get("b")!.lean).toBeCloseTo(0, 6);
    expect(t.get("b")!.dir).not.toBe(0);
  });

  it("真上・真下の隣（x が同じ）には左右どちらへも傾かない", () => {
    const p = new Map([
      ["a", 100],
      ["b", 100],
    ]);
    const t = ambientRelationTargets(p, [link("a", "b")], strength);
    expect(t.get("a")!.lean).toBe(0);
    expect(Object.is(t.get("b")!.lean, 0), "-0 が漏れている").toBe(true);
  });

  it("棚にいない個体のリンクは無視する", () => {
    const t = ambientRelationTargets(pos, [link("a", "ghost")], strength);
    expect(t.size).toBe(0);
  });

  it("affinity が壊れていても NaN を返さない", () => {
    const t = ambientRelationTargets(
      pos,
      [link("a", "b", { affinity: Number.NaN, closeness: Number.NaN })],
      strength
    );
    expect(Number.isFinite(t.get("a")!.lean)).toBe(true);
    expect(Number.isFinite(t.get("a")!.near)).toBe(true);
  });
});

describe("easeLean — 傾きがゆっくり戻る (仕様5.7)", () => {
  it("1フレームでは戻りきらない", () => {
    const next = easeLean(3.5, 0, 16);
    expect(next).toBeLessThan(3.5);
    expect(next).toBeGreaterThan(3.0);
  });

  it("3秒あればほぼ戻る", () => {
    let v = 3.5;
    for (let i = 0; i < 190; i++) v = easeLean(v, 0, 16);
    expect(Math.abs(v)).toBeLessThan(0.05);
  });

  it("フレームレートが違っても同じ時間で戻る", () => {
    let a = 3.5;
    for (let i = 0; i < 60; i++) a = easeLean(a, 0, 1000 / 60);
    let b = 3.5;
    for (let i = 0; i < 120; i++) b = easeLean(b, 0, 1000 / 120);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it("目標へ十分近づいたら畳む", () => {
    expect(easeLean(0.0001, 0, 16)).toBe(0);
  });

  it("壊れた値でも NaN を作らない", () => {
    expect(easeLean(Number.NaN, 2, 16)).toBe(2);
    expect(easeLean(1, Number.NaN, 16)).toBe(1);
    expect(easeLean(1, 0, Number.NaN)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DOM を伴うテスト。rAF を手で回して、書き込まれた属性を直接見る。
// ---------------------------------------------------------------------------

let frames: FrameRequestCallback[] = [];
let renders = 0;
/** rAF と performance.now を同じ時計に乗せる。dt が実機と同じ意味になる。 */
let clock = 0;

function tick(t: number): void {
  clock = t;
  const q = frames;
  frames = [];
  for (const cb of q) cb(t);
}

beforeEach(() => {
  frames = [];
  renders = 0;
  clock = 10_000;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness({
  targets,
  enabled = true,
  rel,
}: {
  targets: AmbientTarget[];
  enabled?: boolean;
  rel: ShelfRelations;
}) {
  renders++;
  const refs = useRef(new Map<string, SVGGElement | null>());
  const relRef = useRef(rel);
  relRef.current = rel;
  useAmbientLife(refs, targets, enabled, relRef);
  return (
    <svg>
      {targets.map((t) => (
        <g
          key={t.instanceId}
          ref={(el) => {
            if (el) refs.current.set(t.instanceId, el);
            else refs.current.delete(t.instanceId);
          }}
          transform={`translate(${t.x} 0)`}
        >
          <g data-part="face">
            <ellipse data-part="eye" ry="3.4" />
          </g>
        </g>
      ))}
    </svg>
  );
}

function target(instanceId: string, x: number, seed = 0.5): AmbientTarget {
  return { instanceId, personalitySeed: seed, x, shelfRow: 0 };
}

function rotationOf(container: HTMLElement, i: number): number {
  const g = container.querySelectorAll("svg > g")[i];
  const m = /rotate\((-?[\d.]+)\)/.exec(g.getAttribute("transform") ?? "");
  return m ? Number.parseFloat(m[1]) : Number.NaN;
}

/** rAF のタイムスタンプは performance.now と同じ時間軸。 */
function startTime(): number {
  return clock + 16;
}

describe("useAmbientLife — 棚への組み込み", () => {
  it("隣接リンクから寄りかかりが生まれる", () => {
    const rel = relations({ links: [link("a", "b")] });
    const { container } = render(
      <Harness targets={[target("a", 100), target("b", 182)]} rel={rel} />
    );
    const t0 = startTime();
    tick(t0);
    expect(rotationOf(container, 0)).toBeGreaterThan(0);
    expect(rotationOf(container, 1)).toBeLessThan(0);
  });

  it("リンクが消えても傾きは瞬時に戻らず、ゆっくり戻る (仕様5.7)", () => {
    const rel = relations({ links: [link("a", "b", { affinity: 2 })] });
    const { container, rerender } = render(
      <Harness targets={[target("a", 100), target("b", 182)]} rel={rel} />
    );
    const t0 = startTime();
    tick(t0);
    const leaning = rotationOf(container, 0);
    expect(leaning).toBeGreaterThan(0.5);

    // 離す。位置が変わるので targets のキーも変わり、エフェクトが張り直される。
    // 傾きの現在値がその張り直しを跨いで残っていなければ、ここで 0 に飛ぶ。
    const next = relations({ links: [], revision: 1 });
    rerender(<Harness targets={[target("a", 100), target("b", 500)]} rel={next} />);
    tick(t0 + 16);
    const oneFrameLater = rotationOf(container, 0);
    expect(oneFrameLater, "離した瞬間に傾きが飛んでいる").toBeGreaterThan(leaning * 0.8);

    for (let i = 1; i <= 200; i++) tick(t0 + 16 + i * 16);
    expect(Math.abs(rotationOf(container, 0)), "いつまでも戻らない").toBeLessThan(0.05);
  });

  it("打ち切られて消えかけている挿話も姿勢に出る（directorPose を使っている）", () => {
    const t0 = startTime();
    const ep: Episode = { kind: "look", a: "a", b: "b", startedAt: t0 - 1000, durationMs: 2000 };
    // 走っている挿話は無い。episodePose だけを呼ぶ実装ではここが 0 になる。
    const rel = relations({
      links: [],
      director: { episode: null, fading: { episode: ep, until: t0 + 200 }, nextAt: t0 + 1e9 },
    });
    const { container } = render(<Harness targets={[target("a", 100)]} rel={rel} />);
    tick(t0);
    expect(Math.abs(rotationOf(container, 0))).toBeGreaterThan(0.2);
  });

  it("消えかけの挿話は 300ms で中立へ戻る", () => {
    const t0 = startTime();
    const ep: Episode = { kind: "look", a: "a", b: "b", startedAt: t0 - 1000, durationMs: 2000 };
    const rel = relations({
      links: [],
      director: { episode: null, fading: { episode: ep, until: t0 + 300 }, nextAt: t0 + 1e9 },
    });
    const { container } = render(<Harness targets={[target("a", 100)]} rel={rel} />);
    tick(t0);
    const during = Math.abs(rotationOf(container, 0));
    tick(t0 + 150);
    const half = Math.abs(rotationOf(container, 0));
    expect(half).toBeLessThan(during);
    tick(t0 + 400);
    expect(Math.abs(rotationOf(container, 0))).toBeLessThan(0.01);
  });

  it("挿話の hop が縦方向の平行移動として出る", () => {
    const t0 = startTime();
    const ep: Episode = {
      kind: "greeting",
      a: "a",
      b: "b",
      startedAt: t0,
      durationMs: 2000,
    };
    const rel = relations({
      links: [link("a", "b")],
      director: { episode: ep, fading: null, nextAt: t0 + 1e9 },
    });
    const { container } = render(<Harness targets={[target("a", 100)]} rel={rel} />);
    let lifted = false;
    for (let i = 1; i <= 60; i++) {
      tick(t0 + i * 16);
      const tr = container.querySelector("svg > g")!.getAttribute("transform") ?? "";
      const m = /translate\(100 (-?[\d.]+)\)/.exec(tr);
      if (m && Number.parseFloat(m[1]) < -0.5) lifted = true;
    }
    expect(lifted).toBe(true);
  });

  it("深く寄りかかっている子は挿話でそれ以上倒れない", () => {
    const t0 = startTime();
    // sleepTogether は挿話の中で最も傾く（4度）。常時層の最大 3.5 度と
    // 単純に足すと 7.5 度になり「倒れかけ」に見える。
    const ep: Episode = {
      kind: "sleepTogether",
      a: "a",
      b: "b",
      startedAt: t0,
      durationMs: 2000,
    };
    const rel = relations({
      links: [link("a", "b", { affinity: 9 })],
      director: { episode: ep, fading: null, nextAt: t0 + 1e9 },
    });
    const { container } = render(
      <Harness targets={[target("a", 100), target("b", 182)]} rel={rel} />
    );
    let peak = 0;
    for (let i = 1; i <= 120; i++) {
      tick(t0 + i * 16);
      peak = Math.max(peak, Math.abs(rotationOf(container, 0)), Math.abs(rotationOf(container, 1)));
    }
    expect(peak, "常時層の上限は超える（挿話が効いている）").toBeGreaterThan(MAX_LEAN_DEG);
    expect(peak, "倒れかけて見える角度まで行っている").toBeLessThan(6);
  });

  it("誰の隣でもない子の挿話は振れ幅が削られない", () => {
    const t0 = startTime();
    const ep: Episode = { kind: "look", a: "a", b: "b", startedAt: t0, durationMs: 2000 };
    // 真上・真下の隣なので常時層の傾きは 0。挿話の 3 度がそのまま出る。
    // （links を空にすると指揮が「相手が隣にいない」と見て挿話を打ち切る）
    const rel = relations({
      links: [link("a", "b")],
      director: { episode: ep, fading: null, nextAt: t0 + 1e9 },
    });
    const { container } = render(
      <Harness
        targets={[target("a", 100), { instanceId: "b", personalitySeed: 0.5, x: 100, shelfRow: 1 }]}
        rel={rel}
      />
    );
    let peak = 0;
    for (let i = 1; i <= 120; i++) {
      tick(t0 + i * 16);
      peak = Math.max(peak, Math.abs(rotationOf(container, 0)));
    }
    expect(peak).toBeGreaterThan(2.8);
  });

  it("挿話の眠さが目の高さに出る", () => {
    const t0 = startTime();
    const ep: Episode = {
      kind: "sleepTogether",
      a: "a",
      b: "b",
      startedAt: t0,
      durationMs: 2000,
    };
    const rel = relations({
      links: [link("a", "b")],
      director: { episode: ep, fading: null, nextAt: t0 + 1e9 },
    });
    const { container } = render(<Harness targets={[target("a", 100)]} rel={rel} />);
    tick(t0 + 1000);
    const ry = Number.parseFloat(
      container.querySelector('[data-part="eye"]')!.getAttribute("ry") ?? "3.4"
    );
    expect(ry).toBeLessThan(1.5);
  });

  it("毎フレームの動きが React の再レンダーを起こさない", () => {
    const rel = relations({ links: [link("a", "b"), link("b", "c")] });
    render(
      <Harness targets={[target("a", 100), target("b", 182), target("c", 264)]} rel={rel} />
    );
    const before = renders;
    const t0 = startTime();
    // 40 秒ぶん。この間に挿話は何度も始まって終わる。
    for (let i = 1; i <= 2400; i++) tick(t0 + i * 16);
    expect(rel.director.nextAt, "指揮が動いていない").not.toBe(0);
    expect(renders, "毎フレーム再レンダーしている").toBe(before);
  });

  it("止めるときに書き換えた属性をすべて戻す", () => {
    const t0 = startTime();
    const ep: Episode = {
      kind: "sleepTogether",
      a: "a",
      b: "b",
      startedAt: t0,
      durationMs: 2000,
    };
    const rel = relations({
      links: [link("a", "b")],
      director: { episode: ep, fading: null, nextAt: t0 + 1e9 },
    });
    const { container, rerender } = render(
      <Harness targets={[target("a", 100), target("b", 182)]} rel={rel} />
    );
    tick(t0 + 1000);
    const g = container.querySelector("svg > g")!;
    expect(g.getAttribute("transform")).not.toBe("translate(100 0)");

    // ドラッグ開始や演出の開始で止まる経路。要素は残ったまま。
    rerender(
      <Harness targets={[target("a", 100), target("b", 182)]} enabled={false} rel={rel} />
    );
    expect(g.getAttribute("transform")).toBe("translate(100 0)");
    expect(g.querySelector('[data-part="eye"]')!.getAttribute("ry")).toBe("3.4");
    expect(g.querySelector('[data-part="face"]')!.getAttribute("transform")).toBe(
      "translate(0 0)"
    );
  });

  it("enabled=false では何も書かない", () => {
    const rel = relations({ links: [link("a", "b")] });
    const { container } = render(
      <Harness targets={[target("a", 100), target("b", 182)]} enabled={false} rel={rel} />
    );
    tick(startTime());
    expect(container.querySelector("svg > g")!.getAttribute("transform")).toBe(
      "translate(100 0)"
    );
  });

  it("箱の中の個体（shelfRow < 0）には触れない", () => {
    const rel = relations({ links: [] });
    const { container } = render(
      <Harness
        targets={[{ instanceId: "a", personalitySeed: 0.5, x: 160, shelfRow: -1 }]}
        rel={rel}
      />
    );
    tick(startTime());
    expect(container.querySelector("svg > g")!.getAttribute("transform")).toBe(
      "translate(160 0)"
    );
  });
});
