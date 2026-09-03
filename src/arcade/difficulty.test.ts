import { describe, it, expect } from "vitest";
import {
  grabRadius,
  drain,
  requiredHold,
  initialHold,
  willHold,
  maxAimError,
  R0,
  DRAIN0,
} from "./craneMachine";
import { PLUSHIES, getPlush, plushCoefficient } from "../data/plushies";

/** レイリー分布に従う照準誤差 d を生成する（仕様 7.6）。 */
function aimError(sigma: number, rnd: () => number): number {
  return Math.hypot(gauss(rnd) * sigma, gauss(rnd) * sigma);
}

function gauss(rnd: () => number): number {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("アシスト表 (仕様7.6)", () => {
  const rows = [
    { n: 1, R: 44, req: 0.77 },
    { n: 2, R: 55, req: 0.6 },
    { n: 3, R: 66, req: 0.45 },
    { n: 4, R: 77, req: 0.33 },
  ];
  for (const { n, R, req } of rows) {
    it(`n=${n} の掴み半径が ${R}px`, () => {
      expect(grabRadius(n)).toBeCloseTo(R, 0);
    });
    it(`n=${n} の必要hold0が ${req}`, () => {
      expect(requiredHold(n)).toBeCloseTo(req, 2);
    });
  }

  it("5回目以降は4回目と同じ（上限で頭打ち）", () => {
    expect(grabRadius(9)).toBe(grabRadius(4));
    expect(drain(9)).toBe(drain(4));
  });

  it("0回目や負の試行番号でも1回目として扱う", () => {
    expect(grabRadius(0)).toBe(grabRadius(1));
    expect(grabRadius(-5)).toBe(grabRadius(1));
  });

  it("R0とDRAIN0が仕様値", () => {
    expect(R0).toBe(44);
    expect(DRAIN0).toBeCloseTo(0.62, 6);
  });
});

describe("initialHold", () => {
  it("全個体・全試行・全距離で 0 以上 1 以下にクランプされる", () => {
    for (const p of PLUSHIES) {
      for (let n = 1; n <= 5; n++) {
        for (const d of [0, 5, 10, 50, 200, 1e9]) {
          const h = initialHold(d, p, n);
          expect(h, `${p.id} n=${n} d=${d}`).toBeGreaterThanOrEqual(0);
          expect(h, `${p.id} n=${n} d=${d}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("掴み半径の外なら0", () => {
    expect(initialHold(999, getPlush("rabbit_01"), 1)).toBe(0);
  });

  it("dが小さいほど大きい", () => {
    const r = getPlush("rabbit_01");
    expect(initialHold(0, r, 2)).toBeGreaterThan(initialHold(20, r, 2));
  });

  it("試行が進むほど同じdで大きくなる", () => {
    const r = getPlush("rabbit_01");
    expect(initialHold(20, r, 3)).toBeGreaterThan(initialHold(20, r, 1));
  });

  it("NaN の距離でも 0-1 に収まる", () => {
    expect(initialHold(Number.NaN, getPlush("rabbit_01"), 1)).toBe(0);
  });
});

describe("maxAimError (仕様7.6の表)", () => {
  it("Rabbit の許容誤差が仕様表と一致する", () => {
    const r = getPlush("rabbit_01");
    expect(maxAimError(r, 1)).toBeCloseTo(13.2, 0);
    expect(maxAimError(r, 2)).toBeCloseTo(25.0, 0);
    expect(maxAimError(r, 3)).toBeCloseTo(38.9, 0);
    expect(maxAimError(r, 4)).toBeCloseTo(54.0, 0);
  });

  it("全10種が n=4 で 35px 以上の許容誤差を持つ", () => {
    for (const p of PLUSHIES) {
      expect(
        maxAimError(p, 4),
        `${p.id} k=${plushCoefficient(p).toFixed(3)}`
      ).toBeGreaterThanOrEqual(35);
    }
  });

  it("許容誤差は試行とともに単調増加する", () => {
    for (const p of PLUSHIES) {
      for (let n = 1; n < 4; n++) {
        expect(maxAimError(p, n + 1), p.id).toBeGreaterThanOrEqual(maxAimError(p, n));
      }
    }
  });

  // maxAimError は willHold の境界そのものでなければ意味がない。
  // 式の写経ではなく、境界の内外で willHold が反転することを確かめる。
  it("境界の内側では掴め、外側では掴めない", () => {
    const EPS = 0.5;
    for (const p of PLUSHIES) {
      for (let n = 1; n <= 4; n++) {
        const m = maxAimError(p, n);
        if (m <= EPS) continue; // n=1 で取れない個体は対象外
        expect(willHold(m - EPS, p, n), `${p.id} n=${n} 内側`).toBe(true);
        expect(willHold(m + EPS, p, n), `${p.id} n=${n} 外側`).toBe(false);
      }
    }
  });
});

// これは「解析的キャリブレーション」であって獲得シミュレーションではない。
// willHold の閾値と照準分布の組み合わせが狙った当たり率になるかだけを見る。
// 実際に won が出るかは craneMachine.test.ts の端から端までのシミュレーションで検証する。
describe("照準分布キャリブレーション (仕様7.6の表の裏取り)", () => {
  function simulate(sigma: number, trials: number) {
    const rnd = mulberry32(20260903);
    const rabbit = getPlush("rabbit_01");
    let firstTry = 0;
    let within4 = 0;
    for (let i = 0; i < trials; i++) {
      for (let n = 1; n <= 4; n++) {
        if (willHold(aimError(sigma, rnd), rabbit, n)) {
          if (n === 1) firstTry++;
          within4++;
          break;
        }
      }
    }
    return { firstTry: firstTry / trials, within4: within4 / trials };
  }

  it("初見(σ=18px): 1回目 0.15〜0.45、4回以内 >= 0.95", () => {
    const r = simulate(18, 1000);
    expect(r.firstTry).toBeGreaterThanOrEqual(0.15);
    expect(r.firstTry).toBeLessThanOrEqual(0.45);
    expect(r.within4).toBeGreaterThanOrEqual(0.95);
  });

  it("上手いプレイヤー(σ=9px): 1回目 >= 0.50", () => {
    expect(simulate(9, 1000).firstTry).toBeGreaterThanOrEqual(0.5);
  });
});
