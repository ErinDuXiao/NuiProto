import { getPlush } from "../data/plushies";
import type { CraneBoardSave } from "../state/types";
import { DEFAULT_PIT, exitDistance, type Body, type Pit } from "./physics";

/**
 * 保存形（CraneBoardSave）と実行時の Body[] の橋渡し。
 *
 * 保存には速度・高さ・掴み状態を含めないため（仕様 5.3）、
 * 変換をこのファイルに閉じ込める。他の場所で Body を手組みしない。
 */

/** 初回盤面の主景品。最も掴みやすい個体（仕様 5.2）。 */
export const LEAD_PRIZE = "rabbit_01";

/** 主景品の出口距離。ここに収めることで4回以内の獲得が幾何的に保証される（仕様 7.7）。 */
export const LEAD_MIN_DIST = 90;
export const LEAD_MAX_DIST = 140;

const FILLERS = ["frog_01", "duck_01", "seal_01", "fox_01", "octopus_01", "penguin_01"];

function makeBody(defId: string, x: number, z: number, index: number): Body {
  return {
    id: `${defId}#${index}`,
    defId,
    x,
    y: 0,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    r: getPlush(defId).size,
    spin: 0,
    held: false,
  };
}

export function restoreBoard(save: CraneBoardSave): Body[] {
  return save.prizes.map((p, i) => makeBody(p.defId, p.x, p.z, i));
}

/** 静止しているときだけ呼ぶこと（仕様 5.3）。 */
export function boardToSave(bodies: Body[], attemptsOnBoard: number): CraneBoardSave {
  return {
    prizes: bodies.map((b) => ({ defId: b.defId, x: b.x, z: b.z })),
    attemptsOnBoard,
  };
}

/**
 * 新しい盤面を作る。
 *
 * 主景品は出口から 90〜140px。この上限を守ることで、
 * 毎試行 30px 以上縮む不変条件と合わせて「4回目は必ず取れる」が成立する。
 */
export function makeBoard(pit: Pit = DEFAULT_PIT, rnd: () => number = Math.random): Body[] {
  const bodies: Body[] = [];

  // 主景品。出口からの距離と方向をランダムに選ぶ
  const dist = LEAD_MIN_DIST + rnd() * (LEAD_MAX_DIST - LEAD_MIN_DIST);
  const angle = 0.15 + rnd() * 0.9; // 奥・右方向へ
  const lead = makeBody(
    LEAD_PRIZE,
    clamp(pit.exit.x + Math.cos(angle) * dist, pit.minX + 36, pit.maxX - 36),
    clamp(pit.exit.z + Math.sin(angle) * dist, pit.minZ + 30, pit.maxZ - 30),
    0
  );
  bodies.push(lead);

  // 賑やかしの景品。主景品や出口に重ならない位置にだけ置く
  const count = 3;
  for (let i = 0; i < count; i++) {
    const defId = FILLERS[Math.floor(rnd() * FILLERS.length) % FILLERS.length];
    for (let tries = 0; tries < 40; tries++) {
      const x = pit.minX + 40 + rnd() * (pit.maxX - pit.minX - 80);
      const z = pit.minZ + 34 + rnd() * (pit.maxZ - pit.minZ - 68);
      const cand = makeBody(defId, x, z, i + 1);
      if (exitDistance(cand, pit) < pit.exit.r + cand.r + 24) continue;
      if (bodies.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + cand.r + 6)) continue;
      bodies.push(cand);
      break;
    }
  }

  return bodies;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
