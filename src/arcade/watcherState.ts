import { NEUTRAL_POSE, type Pose } from "../render/pose";
import { AUTO_DROP_RANGE, type CraneEvent, type CraneState } from "./craneMachine";

/**
 * 見守りぬいぐるみの気持ち（仕様 7.9 / 依頼書 8 章）。
 *
 * この子が居ることで、プレイヤーは「景品を取る」のではなく
 * 「この子に友達を連れて帰る」体験になる。このMVPの重要機能である。
 *
 * 落としたときに悲しませすぎないこと。「あっ！」で止め、すぐ持ち直す。
 * プレイヤーに罪悪感を持たせるのが目的ではない。
 */
export type WatcherMood =
  | "idle"
  | "aiming"
  | "dropping"
  | "grabbed"
  | "missed"
  | "nearExit"
  | "success";

export const MOODS: readonly WatcherMood[] = [
  "idle",
  "aiming",
  "dropping",
  "grabbed",
  "missed",
  "nearExit",
  "success",
] as const;

/** のけぞりから立ち直るまで (ms)。長引かせない。 */
export const MISSED_DURATION = 800;

/**
 * クレーンの状態と直前のイベントから気持ちを決める。純粋関数。
 *
 * @param exitDist 対象の景品と出口の距離。近づいたことに気づかせるために使う
 */
export function moodFor(
  craneState: CraneState,
  lastEvent: CraneEvent | null,
  exitDist: number
): WatcherMood {
  // 喜びは何よりも優先する
  if (lastEvent?.kind === "won") return "success";

  switch (craneState) {
    case "aimX":
    case "aimZ":
      return "aiming";
    case "descend":
    case "grab":
      return "dropping";
    case "lift":
    case "carry":
      return lastEvent?.kind === "grabbed" ? "grabbed" : "dropping";
    case "release":
    case "settle":
      if (lastEvent?.kind === "released" || lastEvent?.kind === "nudged") return "missed";
      return "idle";
    default:
      break;
  }

  if (lastEvent?.kind === "settled" && exitDist <= AUTO_DROP_RANGE) return "nearExit";
  return "idle";
}

/** 気持ちに入ってからの経過時間 (ms) から姿勢を作る。純粋関数。 */
export function watcherPose(mood: WatcherMood, elapsed: number): Pose {
  const t = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const s = t / 1000;

  switch (mood) {
    case "aiming": {
      // 目を大きく、身を乗り出し、左右に小さく揺れる
      return {
        ...NEUTRAL_POSE,
        eyeOpen: 1.25,
        tilt: Math.sin(s * 4.2) * 5,
        squash: 0.97,
        hop: 1 + Math.sin(s * 4.2) * 1,
      };
    }

    case "dropping": {
      // 息を止めて見つめる。瞬きもしない。
      return { ...NEUTRAL_POSE, eyeOpen: 1.15 };
    }

    case "grabbed": {
      const hop = Math.abs(Math.sin(s * 7)) * 10;
      return { ...NEUTRAL_POSE, eyeOpen: 1.35, hop, squash: 1.04, armRaise: 0.35 };
    }

    case "missed": {
      // のけぞって、すぐ立ち直る
      const p = Math.min(1, t / MISSED_DURATION);
      const back = (1 - p) * (1 - p);
      return {
        ...NEUTRAL_POSE,
        // 目は開けたまま。閉じると泣いているように見える
        eyeOpen: 1 + back * 0.3,
        tilt: -back * 12,
        squash: 1 - back * 0.08,
        hop: 0,
      };
    }

    case "nearExit": {
      // 前のめり。もうちょっと、という顔
      return { ...NEUTRAL_POSE, eyeOpen: 1.15, tilt: 4, squash: 0.98 };
    }

    case "success": {
      const hop = Math.abs(Math.sin(s * 5.5)) * 14 * Math.max(0.35, 1 - s * 0.25);
      return {
        ...NEUTRAL_POSE,
        eyeOpen: 1.2,
        armRaise: 1,
        hop,
        squash: 1.06,
        tilt: Math.sin(s * 5.5) * 4,
      };
    }

    default: {
      // ゆるい呼吸
      return { ...NEUTRAL_POSE, squash: 1 + Math.sin(s * 2.2) * 0.012 };
    }
  }
}

/** 気持ちに対応するセリフのキー。無言なら null。 */
export function lineKeyFor(mood: WatcherMood): string | null {
  switch (mood) {
    case "idle":
      return "craneIdle";
    case "aiming":
      return "craneAiming";
    case "grabbed":
      return "craneGrabbed";
    case "missed":
      return "craneMissed";
    case "nearExit":
      return "craneNearExit";
    case "success":
      return "craneSuccess";
    default:
      // dropping は無言。息を呑んでいる方が緊張が出る。
      return null;
  }
}
