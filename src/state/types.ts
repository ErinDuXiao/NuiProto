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

/** 棚に飾られている 1 匹。同種でも uid と seed が違えば別の子として扱う。 */
export type OwnedPlush = {
  /** 個体 ID。獲得ごとに一意 */
  uid: string;
  defId: string;
  acquiredAt: number;
  /** 棚上の水平位置 (px) */
  x: number;
  /** 0-2。-1 は「箱の中」で棚に描画しない */
  shelfRow: number;
  /** 個体差シード（仕様 5.4） */
  seed: number;
};

/**
 * クレーン盤面の保存形。
 * 速度・アーム位置・状態機械の途中は保存しないため、
 * 書き込みはクレーンが idle かつ全景品が静止しているときのみ行う（仕様 5.3）。
 */
export type CraneBoardSave = {
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
  | "shelf_dwell";

export type LogEvent = {
  type: LogEventType;
  /** epoch ms */
  t: number;
  sessionId: string;
  plushId?: string;
  attempt?: number;
  meta?: Record<string, number | string | boolean>;
};

export type SaveV1 = {
  version: 1;
  sessionCount: number;
  owned: OwnedPlush[];
  craneBoard: CraneBoardSave | null;
  /** 通算プレイ回数。リセットされない */
  attempts: number;
  /** 出会い演出が未再生の uid */
  pendingWelcome: string | null;
  /** フル版の出会い演出を再生済みか */
  firstMeetingDone: boolean;
  log: LogEvent[];
};
