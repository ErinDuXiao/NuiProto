import { describe, it, expect } from "vitest";
import { step, atRest, exitDistance, DEFAULT_PIT, STEP, type Body } from "./physics";

const body = (over: Partial<Body> = {}): Body => ({
  id: "a",
  defId: "bear_01",
  x: 160,
  y: 0,
  z: 90,
  vx: 0,
  vy: 0,
  vz: 0,
  r: 30,
  spin: 0,
  held: false,
  ...over,
});

function settle(bodies: Body[], seconds = 5): string[] {
  const fallen: string[] = [];
  for (let i = 0; i < seconds * 120; i++) {
    fallen.push(...step(bodies, DEFAULT_PIT, STEP).fallen);
  }
  return fallen;
}

describe("重力と床", () => {
  it("落ちて床で止まる", () => {
    const b = [body({ y: 200 })];
    settle(b);
    expect(b[0].y).toBeCloseTo(0, 0);
    expect(atRest(b)).toBe(true);
  });

  it("held の物体は落ちない", () => {
    const b = [body({ y: 200, held: true })];
    settle(b, 1);
    expect(b[0].y).toBe(200);
    expect(b[0].vy).toBe(0);
  });

  it("跳ね返りは減衰し、無限に跳ね続けない", () => {
    const b = [body({ y: 300 })];
    settle(b, 10);
    expect(Math.abs(b[0].vy)).toBeLessThan(1);
  });

  it("床にめり込まない", () => {
    const b = [body({ y: 400, vy: -3000 })];
    for (let i = 0; i < 600; i++) {
      step(b, DEFAULT_PIT, STEP);
      expect(b[0].y).toBeGreaterThanOrEqual(-0.01);
    }
  });
});

describe("壁", () => {
  it("外へ出ない", () => {
    for (const v of [-9999, 9999]) {
      const b = [body({ vx: v })];
      settle(b, 3);
      expect(b[0].x).toBeGreaterThanOrEqual(DEFAULT_PIT.minX - 0.01);
      expect(b[0].x).toBeLessThanOrEqual(DEFAULT_PIT.maxX + 0.01);
    }
  });

  it("奥行き方向も外へ出ない", () => {
    const b = [body({ vz: 9999 })];
    settle(b, 3);
    expect(b[0].z).toBeLessThanOrEqual(DEFAULT_PIT.maxZ + 0.01);
  });
});

describe("衝突", () => {
  it("重なった2体は離れる", () => {
    const b = [body({ id: "a", x: 150 }), body({ id: "b", x: 160 })];
    settle(b, 2);
    expect(Math.hypot(b[0].x - b[1].x, b[0].z - b[1].z)).toBeGreaterThan(50);
  });

  it("衝突後も速度が増幅されない（爆発しない）", () => {
    const b = [body({ id: "a", x: 120, vx: 200 }), body({ id: "b", x: 180 })];
    settle(b, 3);
    for (const o of b) expect(Math.abs(o.vx)).toBeLessThanOrEqual(200);
  });

  it("多数の物体が完全に重なっても発散せず静止する", () => {
    const b = Array.from({ length: 8 }, (_, i) => body({ id: `p${i}`, x: 160 + i * 0.01 }));
    settle(b, 8);
    for (const o of b) {
      expect(Number.isFinite(o.x), o.id).toBe(true);
      expect(Number.isFinite(o.z), o.id).toBe(true);
      expect(o.x).toBeGreaterThanOrEqual(DEFAULT_PIT.minX - 1);
      expect(o.x).toBeLessThanOrEqual(DEFAULT_PIT.maxX + 1);
    }
    expect(atRest(b)).toBe(true);
  });

  it("完全に同じ座標でもNaNにならない（0除算）", () => {
    const b = [body({ id: "a" }), body({ id: "b" })];
    settle(b, 2);
    for (const o of b) {
      expect(Number.isNaN(o.x), o.id).toBe(false);
      expect(Number.isNaN(o.z), o.id).toBe(false);
    }
  });

  it("held の物体は他の物体に押されない", () => {
    const b = [body({ id: "held", held: true, y: 60 }), body({ id: "free", x: 165 })];
    settle(b, 2);
    expect(b[0].x).toBe(160);
    expect(b[0].y).toBe(60);
  });
});

describe("出口", () => {
  it("出口の上に来ると落ちて fallen に入る", () => {
    const b = [body({ x: DEFAULT_PIT.exit.x, z: DEFAULT_PIT.exit.z, y: 100 })];
    expect(settle(b, 4)).toContain("a");
  });

  it("出口から遠ければ落ちない", () => {
    const b = [body({ x: DEFAULT_PIT.exit.x + 200, z: DEFAULT_PIT.exit.z, y: 100 })];
    expect(settle(b, 4)).not.toContain("a");
  });

  it("落ちた物体は二度と fallen に入らず、盤面から取り除かれる", () => {
    const b = [body({ x: DEFAULT_PIT.exit.x, z: DEFAULT_PIT.exit.z, y: 100 })];
    const f = settle(b, 6);
    expect(f.filter((id) => id === "a")).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it("held のまま出口の上にあっても落ちない", () => {
    const b = [body({ x: DEFAULT_PIT.exit.x, z: DEFAULT_PIT.exit.z, y: 100, held: true })];
    expect(settle(b, 3)).toHaveLength(0);
    expect(b).toHaveLength(1);
  });
});

describe("exitDistance", () => {
  it("出口の真上なら0に近い", () => {
    expect(
      exitDistance(body({ x: DEFAULT_PIT.exit.x, z: DEFAULT_PIT.exit.z }), DEFAULT_PIT)
    ).toBeLessThan(1);
  });
  it("離れれば大きくなる", () => {
    const near = exitDistance(body({ x: DEFAULT_PIT.exit.x + 50 }), DEFAULT_PIT);
    const far = exitDistance(body({ x: DEFAULT_PIT.exit.x + 150 }), DEFAULT_PIT);
    expect(far).toBeGreaterThan(near);
  });
});

describe("atRest", () => {
  it("空の盤面は静止とみなす", () => {
    expect(atRest([])).toBe(true);
  });
  it("動いている物体があれば静止でない", () => {
    expect(atRest([body({ vx: 500 })])).toBe(false);
  });
  it("宙にある物体があれば静止でない", () => {
    expect(atRest([body({ y: 200 })])).toBe(false);
  });
});

describe("タイムステップ", () => {
  it("dt が巨大でも1ステップ分として扱い破綻しない", () => {
    const b = [body({ y: 100 })];
    step(b, DEFAULT_PIT, 10);
    expect(Number.isFinite(b[0].y)).toBe(true);
    expect(b[0].y).toBeGreaterThanOrEqual(0);
  });
});
