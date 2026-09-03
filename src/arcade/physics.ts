/**
 * クレーン盤面の物理。球体のみを扱う 1 ファイル完結のソルバ。
 *
 * DOM に依存しない純粋なデータ操作なので、テストから直接駆動できる。
 * 目的はリアルさではなく「ちゃんと取れるが、少し転がる」感触の制御である
 * （仕様 3.1）。剛体エンジンの拘束と戦う代わりに、必要な挙動だけを数値で持つ。
 */

/** 景品 1 個。x-z が水平面、y が高さ（上が正、床が 0）。 */
export type Body = {
  id: string;
  defId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 当たり判定の半径 */
  r: number;
  /** 見た目の回転 (deg)。物理には影響しない */
  spin: number;
  /** アームに掴まれている間は積分も衝突もしない */
  held: boolean;
};

export type Pit = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 出口穴。中心が半径内に入り、床に届いたら転落 */
  exit: { x: number; z: number; r: number };
};

export const STEP = 1 / 120;

const GRAVITY = 1400;
const RESTITUTION = 0.35;
const FLOOR_FRICTION = 0.86;
const PAIR_RESTITUTION = 0.4;
/** これ未満の速度は静止とみなす */
const REST_SPEED = 6;
/** これ未満の落下速度では跳ねずに着地する */
const BOUNCE_CUTOFF = 40;
/** 1 ステップで進める最大の dt。巨大な dt でもトンネリングさせない */
const MAX_DT = 1 / 50;

/**
 * 接地中の減衰係数 k。v(t) = v0 * e^(-kt) となる。
 * 床を距離 s だけ転がすのに必要な初速は v0 = s * k。
 *
 * 摩擦は接地中しか効かない。宙に浮いている物体に「転がる距離」から
 * 求めた初速を与えると、空中を飛んで何倍も遠くへ行ってしまう。
 * rollSpeedFor は必ず y=0 の物体にだけ使うこと。
 */
export const ROLL_DECAY_K = 60 * Math.log(1 / FLOOR_FRICTION);

/** 床の上で距離 s だけ転がすための初速。 */
export function rollSpeedFor(s: number): number {
  // 低速で切り捨てる分（|v| < 1 で停止）をわずかに補う
  return Math.max(0, s) * ROLL_DECAY_K * 1.06;
}

/**
 * 既定の盤面。手前左にシュート、奥に景品を並べる。
 *
 * 幅は画面 (320px) より狭くしてある。奥行きの投影で右へずれる分と
 * 景品の半径を足しても画面からはみ出さないようにするため。
 */
export const DEFAULT_PIT: Pit = {
  minX: 0,
  maxX: 236,
  minZ: 0,
  maxZ: 176,
  exit: { x: 34, z: 18, r: 34 },
};

export type StepResult = {
  /** このステップで出口へ落ちた景品の id */
  fallen: string[];
  /** 景品同士がぶつかった回数。効果音の強さに使う */
  impacts: number;
};

/** 出口の中心までの水平距離。 */
export function exitDistance(b: Body, pit: Pit): number {
  return Math.hypot(b.x - pit.exit.x, b.z - pit.exit.z);
}

/** すべての景品が床の上で止まっているか。 */
export function atRest(bodies: Body[]): boolean {
  for (const b of bodies) {
    if (b.held) continue;
    if (b.y > 0.5) return false;
    if (Math.abs(b.vx) >= REST_SPEED) return false;
    if (Math.abs(b.vy) >= REST_SPEED) return false;
    if (Math.abs(b.vz) >= REST_SPEED) return false;
  }
  return true;
}

/**
 * 1 ステップ進める。**bodies を破壊的に更新する。**
 * 出口へ落ちた景品は配列から取り除かれ、その id が fallen に入る。
 *
 * この関数はクレーンの状態機械を呼ばない。呼び出し側が同じループで
 * step と tickCrane の両方を回す（責務の分離。craneMachine.ts 参照）。
 */
export function step(bodies: Body[], pit: Pit, dt: number): StepResult {
  const h = Math.min(Math.max(dt, 0), MAX_DT);
  const fallen: string[] = [];
  let impacts = 0;

  // 積分
  for (const b of bodies) {
    if (b.held) continue;
    b.vy -= GRAVITY * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.z += b.vz * h;
    // 見た目の転がり
    b.spin += (b.vx + b.vz * 0.4) * h * 1.4;
  }

  // 床
  for (const b of bodies) {
    if (b.held) continue;
    if (b.y <= 0) {
      b.y = 0;
      if (b.vy < -BOUNCE_CUTOFF) {
        b.vy = -b.vy * RESTITUTION;
      } else if (b.vy < 0) {
        b.vy = 0;
      }
      // 接地中のみ摩擦がかかる
      const f = Math.pow(FLOOR_FRICTION, h * 60);
      b.vx *= f;
      b.vz *= f;
      if (Math.abs(b.vx) < 1) b.vx = 0;
      if (Math.abs(b.vz) < 1) b.vz = 0;
    }
  }

  // 景品同士。水平面のみで押し出す。
  // 1 ステップにつき 1 回だけ補正する（繰り返すと発散するため）。
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (a.held) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (b.held) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      const min = a.r + b.r;
      if (d >= min) continue;

      // 完全に同じ座標なら決定論的な向きを与えて 0 除算を避ける
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const overlap = (min - d) / 2;
      a.x -= nx * overlap;
      a.z -= nz * overlap;
      b.x += nx * overlap;
      b.z += nz * overlap;

      // 法線方向の速度だけを交換する
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const imp = -rel * (1 + PAIR_RESTITUTION) * 0.5;
        a.vx -= nx * imp;
        a.vz -= nz * imp;
        b.vx += nx * imp;
        b.vz += nz * imp;
        impacts++;
      }
    }
  }

  // 壁
  for (const b of bodies) {
    if (b.held) continue;
    if (b.x < pit.minX) {
      b.x = pit.minX;
      if (b.vx < 0) b.vx = -b.vx * RESTITUTION;
    } else if (b.x > pit.maxX) {
      b.x = pit.maxX;
      if (b.vx > 0) b.vx = -b.vx * RESTITUTION;
    }
    if (b.z < pit.minZ) {
      b.z = pit.minZ;
      if (b.vz < 0) b.vz = -b.vz * RESTITUTION;
    } else if (b.z > pit.maxZ) {
      b.z = pit.maxZ;
      if (b.vz > 0) b.vz = -b.vz * RESTITUTION;
    }
  }

  // 出口。床に届いた時点で判定する
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b.held) continue;
    if (b.y > 0.5) continue;
    if (exitDistance(b, pit) > pit.exit.r) continue;
    fallen.push(b.id);
    bodies.splice(i, 1);
  }

  return { fallen, impacts };
}
