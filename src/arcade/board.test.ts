import { describe, it, expect } from "vitest";
import { makeBoard, restoreBoard, boardToSave, LEAD_PRIZE, LEAD_MAX_DIST } from "./board";
import { DEFAULT_PIT, exitDistance } from "./physics";
import { getPlush } from "../data/plushies";

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

describe("makeBoard", () => {
  it("主景品は Rabbit で、必ず先頭にある", () => {
    for (let s = 1; s <= 40; s++) {
      const b = makeBoard(DEFAULT_PIT, mulberry32(s));
      expect(b[0].defId, `seed ${s}`).toBe(LEAD_PRIZE);
    }
  });

  it("主景品の出口距離が必ず LEAD_MAX_DIST 以内（4回以内獲得の前提）", () => {
    for (let s = 1; s <= 200; s++) {
      const b = makeBoard(DEFAULT_PIT, mulberry32(s));
      expect(exitDistance(b[0], DEFAULT_PIT), `seed ${s}`).toBeLessThanOrEqual(LEAD_MAX_DIST);
    }
  });

  it("初期配置で景品同士が重ならない", () => {
    for (let s = 1; s <= 60; s++) {
      const b = makeBoard(DEFAULT_PIT, mulberry32(s));
      for (let i = 0; i < b.length; i++) {
        for (let j = i + 1; j < b.length; j++) {
          const d = Math.hypot(b[i].x - b[j].x, b[i].z - b[j].z);
          expect(d, `seed ${s}: ${b[i].id}-${b[j].id}`).toBeGreaterThanOrEqual(b[i].r + b[j].r);
        }
      }
    }
  });

  it("初期配置の景品が盤面の内側に収まる", () => {
    for (let s = 1; s <= 60; s++) {
      for (const o of makeBoard(DEFAULT_PIT, mulberry32(s))) {
        expect(o.x).toBeGreaterThanOrEqual(DEFAULT_PIT.minX);
        expect(o.x).toBeLessThanOrEqual(DEFAULT_PIT.maxX);
        expect(o.z).toBeGreaterThanOrEqual(DEFAULT_PIT.minZ);
        expect(o.z).toBeLessThanOrEqual(DEFAULT_PIT.maxZ);
      }
    }
  });

  it("最初から出口の中に入っている景品はない（置いた瞬間に落ちない）", () => {
    for (let s = 1; s <= 60; s++) {
      for (const o of makeBoard(DEFAULT_PIT, mulberry32(s))) {
        expect(exitDistance(o, DEFAULT_PIT), `seed ${s} ${o.id}`).toBeGreaterThan(
          DEFAULT_PIT.exit.r
        );
      }
    }
  });

  it("idが重複しない", () => {
    for (let s = 1; s <= 40; s++) {
      const ids = makeBoard(DEFAULT_PIT, mulberry32(s)).map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("全景品が床の上で静止した状態で始まる", () => {
    for (const o of makeBoard(DEFAULT_PIT, mulberry32(7))) {
      expect(o.y).toBe(0);
      expect(o.vx).toBe(0);
      expect(o.vy).toBe(0);
      expect(o.vz).toBe(0);
      expect(o.held).toBe(false);
    }
  });
});

describe("boardToSave / restoreBoard", () => {
  it("往復して位置と種類が保たれる", () => {
    const b = makeBoard(DEFAULT_PIT, mulberry32(3));
    const back = restoreBoard(boardToSave(b, 2));
    expect(back).toHaveLength(b.length);
    for (let i = 0; i < b.length; i++) {
      expect(back[i].defId).toBe(b[i].defId);
      expect(back[i].x).toBeCloseTo(b[i].x, 6);
      expect(back[i].z).toBeCloseTo(b[i].z, 6);
    }
  });

  it("復元した景品は速度ゼロ・床の上・掴まれていない状態に正規化される", () => {
    const save = { prizes: [{ defId: "rabbit_01", x: 120, z: 90 }], attemptsOnBoard: 3 };
    const [b] = restoreBoard(save);
    expect(b.y).toBe(0);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
    expect(b.vz).toBe(0);
    expect(b.held).toBe(false);
    expect(b.r).toBe(getPlush("rabbit_01").size);
  });

  it("試行回数が保たれる", () => {
    expect(boardToSave(makeBoard(DEFAULT_PIT, mulberry32(1)), 3).attemptsOnBoard).toBe(3);
  });
});
