import type { PlushInstance, SaveV1Raw, SaveV2 } from "./types";

/**
 * v1 の保存データを v2 へ移す（仕様 4.2）。
 *
 * **既存の保存データを破棄しない。** 棚が黙って消えるのは、
 * このゲームの主旨に真っ向から反する。
 *
 * ここは**変換だけ**を行う。値の検証は `parseV1` の仕事であり、
 * 混ぜると「どちらが不正入力を弾いたのか」が追えなくなる。
 */
export function migrateV1(raw: SaveV1Raw): SaveV2 {
  const owned = raw.owned;

  // 最古の1匹だけを starter とみなす。v1 には来歴が記録されていないので、
  // 残りは「分からない」と書く。クレーンで取ったのか Developer Menu で
  // 足したのか区別できないものを "crane" にすると来歴の捏造になる。
  //
  // 日時が不明（null）の子はこの比較から外す。いつ来たか分からない子を
  // 「最古」とは言えないし、starter は「はじめからここにいた」と断定する
  // 来歴なので、根拠がないまま与えてはいけない。全員の日時が不明なら
  // starter は決めず、全員 "unknown" のままにする。
  let oldest = -1;
  for (let i = 0; i < owned.length; i++) {
    const at = owned[i].acquiredAt;
    if (at === null) continue;
    const best = oldest < 0 ? null : owned[oldest].acquiredAt;
    if (best === null || at < best) oldest = i;
  }

  const instances: PlushInstance[] = owned.map((o, i) => ({
    instanceId: o.uid,
    plushTypeId: o.defId,
    acquiredAt: o.acquiredAt,
    attemptsToAcquire: null,
    witnessedBy: null,
    origin: i === oldest ? "starter" : "unknown",
    x: o.x,
    shelfRow: o.shelfRow,
    personalitySeed: o.seed,
  }));

  return {
    version: 2,
    sessionCount: raw.sessionCount,
    instances,
    craneBoard: raw.craneBoard,
    attempts: raw.attempts,
    pendingWelcome: raw.pendingWelcome,
    firstMeetingDone: raw.firstMeetingDone,
    // 関係はこの瞬間から数え始める。v1 には隣接の履歴が無いので、
    // 「昔から隣にいた」ことにはしない。
    neighborSince: {},
    log: raw.log,
  };
}
