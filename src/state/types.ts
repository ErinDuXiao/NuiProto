export type Rarity = "common" | "rare" | "special";

export type PlushShape = "round" | "pear" | "long" | "blob";
export type PlushEars = "round" | "long" | "pointed" | "none";
export type PlushExtra = "beak" | "tentacles" | "flipper" | "tail";

export type PlushArt = {
  /** 本体色 */
  body: string;
  /** 耳の内側・お腹などの色 */
  accent: string;
  /** 目・鼻・口の色 */
  face: string;
  shape: PlushShape;
  ears: PlushEars;
  extras?: PlushExtra[];
};

export type PlushDef = {
  id: string;
  name: string;
  series: string;
  rarity: Rarity;
  /** 描画・当たり判定の基準半径 26-34 (px) */
  size: number;
  /** 掴み保持のしにくさ 0.8-1.2。レンジ厳守（仕様 7.5） */
  weight: number;
  /** 変形量・掴まれやすさ 0-1 */
  softness: number;
  art: PlushArt;
};

/**
 * どうやって家に来たか（仕様 4.1）。
 *
 * `attemptsToAcquire === null` から推測しない。starter と v1 移行分が
 * 区別できず、プロフィールの文面を間違える。
 *
 * `"unknown"` があるのは、v1 から移行してきた子がクレーンで取ったのか
 * Developer Menu で足したのか区別できないため。分からないものを
 * `"crane"` と書くのは、その子の来歴を捏造することになる。
 */
export type PlushOrigin = "starter" | "crane" | "granted" | "unknown";

/**
 * 棚に飾られている 1 匹。
 *
 * 「種類」ではなく「個体」。同じ Bear でも、最初から家にいた子と
 * 3回目で取れた子は別の存在として保存する。スタックしない。
 */
export type PlushInstance = {
  /** 個体 ID。獲得ごとに一意 */
  instanceId: string;
  /** どの種類か。`PlushDef.id` を指す */
  plushTypeId: string;
  acquiredAt: number;

  /** 何回目の試行で取れたか。null = 不明（v1 からの移行分、および starter） */
  attemptsToAcquire: number | null;
  /** そのとき見守っていた個体の instanceId。null = 不明 */
  witnessedBy: string | null;
  origin: PlushOrigin;

  /** 棚上の水平位置 (px) */
  x: number;
  /** 0-2。-1 は「箱の中」で棚に描画しない */
  shelfRow: number;
  /** 個体差シード（仕様 5.4） */
  personalitySeed: number;
};

/**
 * クレーン盤面の保存形。
 * 速度・アーム位置・状態機械の途中は保存しないため、
 * 書き込みはクレーンが idle かつ全景品が静止しているときのみ行う（仕様 5.3）。
 */
export type CraneBoardSave = {
  /**
   * 盤面の景品。**ここの `defId` は改名しない。**
   * これは個体ではなく「まだ誰のものでもない景品の種類」であり、
   * `PlushInstance.plushTypeId` とは別の概念。物理（`Body.defId`）と
   * 対になっているので、片方だけ改名すると盤面の復元が壊れる。
   */
  prizes: { defId: string; x: number; z: number }[];
  attemptsOnBoard: number;
};

export type LogEventType =
  // 依頼書 24 章の一覧
  | "session_start"
  | "shelf_view"
  | "arcade_enter"
  | "crane_start"
  | "crane_drop"
  | "plush_grabbed"
  | "plush_dropped"
  | "plush_moved"
  | "plush_won"
  | "shelf_return"
  | "plush_placed"
  | "plush_repositioned"
  | "share_clicked"
  // 「愛着が生まれるか」の検証に必要な追加イベント（仕様 17.2）
  | "share_result"
  | "welcome_played"
  | "plush_touched"
  | "shelf_dwell"
  // 同居フェーズ（個体・来歴・関係）の検証に必要なイベント。
  // 後続タスクが使う前にここへ全部並べておく。追加するときは
  // persist.ts の LOG_TYPES にも必ず同じものを足すこと。
  // 型だけ足すと、型検査は通るのにリロードで消える。
  | "plush_profile_opened"
  | "plush_drag_start"
  | "plush_drag_end"
  | "neighbor_created"
  | "neighbor_removed"
  | "relationship_reaction"
  | "shelf_idle_10s"
  | "shelf_idle_30s"
  | "shelf_return_after_win";

export type LogEvent = {
  type: LogEventType;
  /** epoch ms */
  t: number;
  sessionId: string;
  plushId?: string;
  attempt?: number;
  meta?: Record<string, number | string | boolean>;
};

/**
 * v1 の保存形。**移行専用**。
 *
 * この型を `persist.ts` / `migrate.ts` の外へ出さない。
 * 外へ漏れると、どちらのバージョンを扱っているのかコード上で
 * 見分けられなくなる。アプリ本体は `SaveV2` だけを知る。
 */
export type SaveV1Raw = {
  version: 1;
  sessionCount: number;
  owned: {
    uid: string;
    defId: string;
    acquiredAt: number;
    x: number;
    shelfRow: number;
    seed: number;
  }[];
  craneBoard: CraneBoardSave | null;
  attempts: number;
  pendingWelcome: string | null;
  firstMeetingDone: boolean;
  log: LogEvent[];
};

export type SaveV2 = {
  version: 2;
  sessionCount: number;
  instances: PlushInstance[];
  craneBoard: CraneBoardSave | null;
  /** 通算プレイ回数。リセットされない */
  attempts: number;
  /** 出会い演出が未再生の instanceId */
  pendingWelcome: string | null;
  /** フル版の出会い演出を再生済みか */
  firstMeetingDone: boolean;
  /**
   * 隣接ペアが隣同士になった時刻。キーは instanceId 2つの辞書順 "a|b"。
   * リンクが切れたら削除する。
   */
  neighborSince: Record<string, number>;
  log: LogEvent[];
};
