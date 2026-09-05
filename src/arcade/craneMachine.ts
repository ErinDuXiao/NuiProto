import { getPlush, plushCoefficient } from "../data/plushies";
import type { PlushDef } from "../state/types";
import {
  atRest,
  exitDistance,
  rollSpeedFor,
  type Body,
  type FallenPrize,
  type Pit,
} from "./physics";

/**
 * クレーンの難易度と状態機械。
 *
 * 難易度は確率抽選をまったく使わない（依頼書7章）。
 * 「取れなかった」がプレイヤーの技量ではなく乱数のせいに見えると、
 * 「惜しい！次なら取れそう」ではなく「理不尽だ」になるからである。
 *
 * 代わりに 3 層で「2〜4回以内に取れる」を作る。
 *   1. 個体差を狭いレンジに閉じ込める（plushCoefficient）
 *   2. 試行ごとに掴み半径を広げ、保持減衰を弱める（7.6）
 *   3. 失敗のたびに景品が出口へ確実に近づく不変条件（7.7）
 *
 * 3 は確率にも物理の偶然にも依存しない幾何的な保証で、
 * 1 と 2 の仮定が外れても「4回以内に取れる」は崩れない。
 */

// ---------------------------------------------------------------- 難易度

/** 基準の掴み半径 (px) */
export const R0 = 44;
/** 基準の保持減衰。持ち上げ切るまでに hold がこれだけ減る */
export const DRAIN0 = 0.62;
/** 下降完了から出口上空に到達するまで (秒) */
export const T_LIFT = 1.1;
/** これを下回ると手が離れる */
export const RELEASE_THRESHOLD = 0.15;
/** 1 試行あたり必ず出口へ近づく距離 (px) */
export const MIN_ADVANCE = 30;
/** この距離まで来た景品は、触れられるだけで転落しうる */
export const AUTO_DROP_RANGE = 60;
/** 不変条件を転がりで満たそうと試みる回数の上限 */
export const MAX_ADVANCE_RETRIES = 3;

const RADIUS_ASSIST = [1.0, 1.25, 1.5, 1.75];
const DRAIN_ASSIST = [1.0, 0.72, 0.48, 0.29];

/** 試行番号 n (1始まり) をアシスト表の添字に落とす。5回目以降は頭打ち。 */
const idx = (n: number): number =>
  Math.min(Math.max(Number.isFinite(n) ? Math.round(n) : 1, 1), 4) - 1;

export const radiusAssist = (n: number): number => RADIUS_ASSIST[idx(n)];
export const drainAssist = (n: number): number => DRAIN_ASSIST[idx(n)];
export const grabRadius = (n: number): number => R0 * radiusAssist(n);
export const drain = (n: number): number => DRAIN0 * drainAssist(n);

/** 持ち上げ切るために必要な初期保持力。 */
export const requiredHold = (n: number): number => RELEASE_THRESHOLD + drain(n);

/**
 * アーム接地時の保持力。d はアームと景品の x-z 距離。
 *
 * (1 - d/R(n)) * k をそのまま返し、[0,1] にクランプする。
 */
export function initialHold(d: number, def: PlushDef, n: number): number {
  const R = grabRadius(n);
  if (!Number.isFinite(d) || d >= R) return 0;
  const raw = (1 - Math.max(0, d) / R) * plushCoefficient(def);
  return Math.min(1, Math.max(0, raw));
}

/** 持ち上げ切れるか。hold は上昇中に drain(n) だけ減る。 */
export function willHold(d: number, def: PlushDef, n: number): boolean {
  return initialHold(d, def, n) >= requiredHold(n);
}

/**
 * 掴める最大の照準誤差。取れないなら 0。
 *
 * initialHold は 1 でクランプされるが、requiredHold(n) <= 1 なので
 * クランプが効く領域（hold0 が 1 を超える領域）では必ず成功する。
 * したがってこの式はクランプの影響を受けず、willHold の境界と一致する。
 */
export function maxAimError(def: PlushDef, n: number): number {
  const k = plushCoefficient(def);
  const ratio = 1 - requiredHold(n) / k;
  return ratio <= 0 ? 0 : grabRadius(n) * ratio;
}

// ---------------------------------------------------------------- 不変条件

/** 試行後に満たすべき出口距離の上限。 */
export const advanceGoal = (before: number): number => Math.max(0, before - MIN_ADVANCE);

/** 不変条件（仕様 7.7）を満たしているか。 */
export function satisfiesAdvance(b: Body, pit: Pit, before: number): boolean {
  return exitDistance(b, pit) <= advanceGoal(before) + 1e-6;
}

/**
 * 出口方向へ転がす初速を与える。need は詰めたい距離。
 *
 * **床に接している物体にしか使ってはならない。**
 * 摩擦は接地中しか効かないため、宙に浮いた物体に与えると
 * 空中を飛んで何倍も遠くへ行き、掴み失敗が獲得に化ける。
 */
export function advanceImpulse(b: Body, pit: Pit, need: number): void {
  const dx = pit.exit.x - b.x;
  const dz = pit.exit.z - b.z;
  const len = Math.hypot(dx, dz);
  if (len <= 1e-6 || !Number.isFinite(need) || need <= 0) return;
  const speed = rollSpeedFor(need);
  b.vx = (dx / len) * speed;
  b.vz = (dz / len) * speed;
  b.vy = 0;
}

/**
 * 手が離れた瞬間の、ころんとした落ち方。
 *
 * ここで出口を狙わせない。空中の物体に狙いをつけると距離が制御できず、
 * 「取れなかったのに取れた」が起きて難易度設計が崩れる。
 * 出口へ寄せる仕事は、盤面が静止してから settle の不変条件ループが行う。
 */
function tumbleImpulse(b: Body, awayFromX: number, awayFromZ: number): void {
  const dx = b.x - awayFromX;
  const dz = b.z - awayFromZ;
  const len = Math.hypot(dx, dz) || 1;
  b.vx += (dx / len) * 45;
  b.vz += (dz / len) * 45;
}

/**
 * 対象を出口方向の直線上、exitDistance が goal ちょうどになる点へ直接置く。
 *
 * 転がりで不変条件を満たせなかったときの最後の手段（仕様 7.7 手順6）。
 * 重なりは対象ではなく「他の景品」を押しのけて解消する。
 * 対象を動かすと保証した位置が壊れるためである。
 *
 * 有限回で必ず終わり、必ず不変条件を満たす。
 */
export function placeTowardExit(
  target: Body,
  others: Body[],
  pit: Pit,
  goal: number
): "placed" | "acquired" {
  // 目標が出口領域の内側なら、置くのではなく獲得として扱う。
  // before < MIN_ADVANCE の景品はここで必ず取れる（距離は負にならない）。
  if (goal <= pit.exit.r) return "acquired";

  const dx = pit.exit.x - target.x;
  const dz = pit.exit.z - target.z;
  const len = Math.hypot(dx, dz);
  if (len <= 1e-6) return "acquired"; // すでに出口の真上

  target.x = pit.exit.x - (dx / len) * goal;
  target.z = pit.exit.z - (dz / len) * goal;
  target.y = 0;
  target.vx = 0;
  target.vy = 0;
  target.vz = 0;
  pushOthersAway(target, others, pit);
  return "placed";
}

/**
 * 対象は固定したまま、重なっている他の景品だけを押しのける。
 *
 * 押しのけた先が出口の中だと、**狙っていない景品が獲得されてしまう。**
 * 押し出しのたびに出口の外へ逃がすこと。
 */
function pushOthersAway(target: Body, others: Body[], pit: Pit): void {
  const movable = others.filter((o) => o.id !== target.id && !o.held);
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const o of movable) {
      const pairs: Body[] = [target, ...movable.filter((m) => m.id !== o.id)];
      for (const other of pairs) {
        let dx = o.x - other.x;
        let dz = o.z - other.z;
        let d = Math.hypot(dx, dz);
        const min = o.r + other.r;
        if (d >= min) continue;
        if (d < 1e-6) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        // 対象は動かさない。押しのけられる側だけを動かす。
        const push = other.id === target.id ? min - d : (min - d) / 2;
        o.x += (dx / d) * push;
        o.z += (dz / d) * push;
        o.x = Math.min(pit.maxX, Math.max(pit.minX, o.x));
        o.z = Math.min(pit.maxZ, Math.max(pit.minZ, o.z));
        keepOutOfExit(o, pit);
        o.vx = 0;
        o.vz = 0;
        moved = true;
      }
    }
    if (!moved) break;
  }

  // 最後にもう一度、押しのけた全員を出口の外へ逃がす。
  // 各回の押し出しで一度外へ出しても、後の回で押し戻されることがある。
  for (const o of movable) keepOutOfExit(o, pit);
}

/**
 * 出口の内側に入ってしまった景品を、縁の外へ押し戻す。
 *
 * 半径方向へ出しただけでは盤面の外に出てしまうことがあり、
 * 盤面内へ丸め直すと再び出口の中に戻ってしまう。
 * そこで出口のまわりの向きを順に試し、
 * 「盤面の内側」かつ「出口の外」を同時に満たす位置を選ぶ。
 */
function keepOutOfExit(b: Body, pit: Pit): void {
  const safe = pit.exit.r + b.r * 0.35;
  if (exitDistance(b, pit) >= safe) return;

  const inBounds = (x: number, z: number) =>
    x >= pit.minX && x <= pit.maxX && z >= pit.minZ && z <= pit.maxZ;

  const dx = b.x - pit.exit.x;
  const dz = b.z - pit.exit.z;
  const base = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dz, dx) : 0;

  // 元の向きを最優先し、そこから左右へ広げながら探す
  for (let i = 0; i < 24; i++) {
    const spread = Math.ceil(i / 2) * (Math.PI / 12);
    const a = base + (i % 2 === 0 ? spread : -spread);
    const x = pit.exit.x + Math.cos(a) * safe;
    const z = pit.exit.z + Math.sin(a) * safe;
    if (inBounds(x, z)) {
      b.x = x;
      b.z = z;
      return;
    }
  }

  // どの向きも盤面に収まらない極端な盤面。中央へ逃がす。
  b.x = (pit.minX + pit.maxX) / 2;
  b.z = (pit.minZ + pit.maxZ) / 2;
}

// ---------------------------------------------------------------- 状態機械

export type CraneState =
  | "idle"
  | "aimX"
  | "aimZ"
  | "descend"
  | "grab"
  | "lift"
  | "carry"
  | "release"
  | "settle";

export type CraneEventKind =
  | "drop"
  | "grabbed"
  | "released"
  | "won"
  | "nudged"
  | "settled";

/**
 * `defId` は "won" のときに必ず入る。獲得した景品の種類を
 * bodyId の文字列から復元させないため（physics.FallenPrize と同じ理由）。
 */
export type CraneEvent = { kind: CraneEventKind; bodyId?: string; defId?: string };

export type Crane = {
  state: CraneState;
  armX: number;
  armZ: number;
  /** アームの高さ。0 が床、ARM_TOP が上限 */
  armY: number;
  hold: number;
  hold0: number;
  heldId: string | null;
  /** 現在の盤面での DROP 回数。startDrop でのみ増える */
  attemptsOnBoard: number;
  liftElapsed: number;
  /** この試行で不変条件を保証する対象 */
  targetId: string | null;
  advanceBefore: number;
  advanceRetries: number;
  /** settle に居続けた時間 (秒)。盤面が静止しない異常時の逃げ道 */
  settleElapsed: number;
};

/** settle がこの秒数を超えたら、静止を待たずに決着させる。 */
export const SETTLE_TIMEOUT = 8;

/**
 * アームの最高高さ。投影後に画面の上端からはみ出さない値にすること。
 * 大きすぎるとアームのヘッドが画面外に消えて、何が起きているか分からなくなる。
 */
export const ARM_TOP = 168;
const ARM_SPEED_Y = 320;
const ARM_SPEED_X = 260;
const NUDGE_SPEED = 150;

export function createCrane(): Crane {
  return {
    state: "idle",
    armX: 160,
    armZ: 90,
    armY: ARM_TOP,
    hold: 0,
    hold0: 0,
    heldId: null,
    attemptsOnBoard: 0,
    liftElapsed: 0,
    targetId: null,
    advanceBefore: 0,
    advanceRetries: 0,
    settleElapsed: 0,
  };
}

function nearestBody(bodies: Body[], x: number, z: number): Body | undefined {
  let best: Body | undefined;
  let bestD = Infinity;
  for (const b of bodies) {
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * 試行を開始する。**attemptsOnBoard を増やす唯一の場所。**
 *
 * 掴めるかどうかに関わらず「対象」をここで決める。空振りでもこの子が動き、
 * 試行終了後に不変条件（7.7）の検査を受ける。
 *
 * 不変条件は「その試行の対象」に対して成立する。毎回まったく別の景品を
 * 狙えば、1匹あたりの前進はその分ゆっくりになる。「4回以内に取れる」は
 * 同じ子を狙い続けた場合の保証である。
 */
export function startDrop(c: Crane, bodies: Body[], pit: Pit): void {
  c.attemptsOnBoard++;
  c.liftElapsed = 0;
  c.advanceRetries = 0;
  c.settleElapsed = 0;
  c.hold = 0;
  c.hold0 = 0;
  c.heldId = null;

  const target = nearestBody(bodies, c.armX, c.armZ);
  c.targetId = target?.id ?? null;
  c.advanceBefore = target ? exitDistance(target, pit) : 0;
  c.state = "descend";
}

/**
 * 1 ステップ進める。**step() は呼ばない。**
 * 呼び出し側が同じループで step(bodies, pit, dt) と両方を回す。
 */
export function tickCrane(c: Crane, bodies: Body[], pit: Pit, dt: number): CraneEvent[] {
  const events: CraneEvent[] = [];
  const byId = (id: string | null) => (id ? bodies.find((b) => b.id === id) : undefined);

  switch (c.state) {
    case "idle":
    case "aimX":
    case "aimZ":
      break;

    case "descend": {
      c.armY -= ARM_SPEED_Y * dt;
      if (c.armY <= 0) {
        c.armY = 0;
        c.state = "grab";
        events.push({ kind: "drop" });
      }
      break;
    }

    case "grab": {
      const target = byId(c.targetId);
      if (!target) {
        c.state = "settle";
        break;
      }
      const d = Math.hypot(target.x - c.armX, target.z - c.armZ);
      c.hold0 = initialHold(d, getPlush(target.defId), c.attemptsOnBoard);
      c.hold = c.hold0;
      if (c.hold0 > 0) {
        target.held = true;
        c.heldId = target.id;
        c.liftElapsed = 0;
        c.state = "lift";
        events.push({ kind: "grabbed", bodyId: target.id });
      } else {
        // 掴めなくてもアームは必ず景品を小突く。
        // 「操作 → 何も起きない」を作らない（依頼書6章）。
        nudge(target, c);
        events.push({ kind: "nudged", bodyId: target.id });
        c.state = "release";
      }
      break;
    }

    case "lift": {
      const held = byId(c.heldId);
      if (!held) {
        // 掴んでいた景品が盤面から消えた（獲得された等）
        c.heldId = null;
        c.state = "release";
        break;
      }
      c.liftElapsed += dt;
      c.armY = Math.min(ARM_TOP, (c.liftElapsed / T_LIFT) * ARM_TOP);
      held.x = c.armX;
      held.z = c.armZ;
      held.y = c.armY;
      c.hold = c.hold0 - drain(c.attemptsOnBoard) * (c.liftElapsed / T_LIFT);

      if (c.hold < RELEASE_THRESHOLD) {
        held.held = false;
        c.heldId = null;
        events.push({ kind: "released", bodyId: held.id });
        tumbleImpulse(held, c.armX, c.armZ);
        c.state = "release";
      } else if (c.liftElapsed >= T_LIFT) {
        c.armY = ARM_TOP;
        c.state = "carry";
      }
      break;
    }

    case "carry": {
      const held = byId(c.heldId);
      if (!held) {
        c.heldId = null;
        c.state = "release";
        break;
      }
      const dx = pit.exit.x - c.armX;
      const dz = pit.exit.z - c.armZ;
      const dist = Math.hypot(dx, dz);
      const move = ARM_SPEED_X * dt;
      if (dist <= move) {
        c.armX = pit.exit.x;
        c.armZ = pit.exit.z;
        held.held = false;
        c.heldId = null;
        held.x = c.armX;
        held.z = c.armZ;
        held.vx = 0;
        held.vz = 0;
        c.state = "release";
      } else {
        c.armX += (dx / dist) * move;
        c.armZ += (dz / dist) * move;
        held.x = c.armX;
        held.z = c.armZ;
        held.y = c.armY;
      }
      break;
    }

    case "release": {
      c.armY = Math.min(ARM_TOP, c.armY + ARM_SPEED_Y * dt);
      if (c.armY >= ARM_TOP) c.state = "settle";
      break;
    }

    case "settle": {
      c.settleElapsed += dt;
      // 盤面が静止しない異常が起きても、プレイヤーを永久に待たせない
      const timedOut = c.settleElapsed >= SETTLE_TIMEOUT;
      if (!atRest(bodies) && !timedOut) break;
      if (timedOut) {
        for (const b of bodies) {
          b.vx = 0;
          b.vy = 0;
          b.vz = 0;
          b.y = 0;
        }
      }

      const target = byId(c.targetId);
      if (!target) {
        // 獲得されて盤面から消えた
        finish(c);
        break;
      }
      if (satisfiesAdvance(target, pit, c.advanceBefore)) {
        events.push({ kind: "settled", bodyId: target.id });
        finish(c);
        break;
      }
      if (exitDistance(target, pit) <= pit.exit.r) {
        // 出口の内側にいる。方向ベクトルが零になる前に獲得として扱う。
        acquire(target, bodies, events);
        finish(c);
        break;
      }
      if (!timedOut && c.advanceRetries < MAX_ADVANCE_RETRIES) {
        c.advanceRetries++;
        advanceImpulse(target, pit, exitDistance(target, pit) - advanceGoal(c.advanceBefore));
        break;
      }
      // 最後の手段。理不尽な行き詰まりを絶対に起こさない。
      const goal = advanceGoal(c.advanceBefore);
      if (placeTowardExit(target, bodies, pit, goal) === "acquired") {
        acquire(target, bodies, events);
      } else {
        events.push({ kind: "settled", bodyId: target.id });
      }
      finish(c);
      break;
    }
  }

  return events;
}

/**
 * 掴めなかったときにアームが景品を小突く。
 * 「操作 → 何も起きない」を作らない（依頼書6章）。
 * 出口へ寄せる仕事は settle の不変条件ループに任せる。
 */
function nudge(target: Body, c: Crane): void {
  const dx = target.x - c.armX;
  const dz = target.z - c.armZ;
  const len = Math.hypot(dx, dz) || 1;
  target.vx += (dx / len) * NUDGE_SPEED;
  target.vz += (dz / len) * NUDGE_SPEED;
}

function acquire(target: Body, bodies: Body[], events: CraneEvent[]): void {
  const i = bodies.indexOf(target);
  if (i >= 0) bodies.splice(i, 1);
  events.push({ kind: "won", bodyId: target.id, defId: target.defId });
}

/**
 * won イベントから、保存すべき来歴を決める。
 *
 * attemptsOnBoard は盤面が補充されると 0 に戻る。したがってこの関数は
 * **won を処理した直後、盤面を作り直す前に**呼ばなければならない。
 * 種類は ID 文字列から復元せず、落ちた景品そのものから受け取る。
 */
export function resolveWin(
  crane: Crane,
  won: FallenPrize,
  watcherInstanceId: string | null
): { plushTypeId: string; attemptsToAcquire: number | null; witnessedBy: string | null } {
  return {
    plushTypeId: won.defId,
    /*
     * 0 回は「1 回目で取れた」ではなく「分からない」。
     *
     * DROP を一度もしていないのに獲得が成立する経路が実在する。
     * 壊れた（あるいは細工された）保存から出口の中に景品が復元されると、
     * 最初の物理ステップで落ちて won になる。そこで 1 に丸めると
     * 「1回目で取れた子」という起きていない出来事を書き込むことになり、
     * プロフィールがその嘘をそのまま読み上げる。
     *
     * **分からない来歴は捏造せず null にする。** PlushInstance の
     * attemptsToAcquire は元から number | null で、v1 移行分や starter を
     * 「不明」として表せるようになっている。ここもその表現に合わせる。
     * 1 に戻してはいけない。
     */
    attemptsToAcquire: crane.attemptsOnBoard > 0 ? crane.attemptsOnBoard : null,
    witnessedBy: watcherInstanceId,
  };
}

function finish(c: Crane): void {
  c.state = "idle";
  c.settleElapsed = 0;
  c.targetId = null;
  c.heldId = null;
  c.hold = 0;
  c.hold0 = 0;
  c.armY = ARM_TOP;
}

export { ARM_SPEED_X, ARM_SPEED_Y };
