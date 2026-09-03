import { hasPlush } from "../data/plushies";
import { LOG_LIMIT } from "./log";
import type { CraneBoardSave, LogEvent, LogEventType, OwnedPlush, SaveV1 } from "./types";

export const STORAGE_KEY = "plushcrane.v1";

/**
 * 棚の収容。4段 × 3匹（仕様 9章）。
 *
 * スロットの座標はここに集約する。棚の描画（shelfLayout）と
 * 新しい子の配置（store.findSlot）が別々の定数を持つと必ずずれる。
 */
export const SHELF_ROWS = 4;
export const PER_ROW = 3;
export const SHELF_CAPACITY = SHELF_ROWS * PER_ROW;
/** 左端のスロットの中心 x */
export const SLOT_X0 = 78;
/** スロット間隔。ぬいぐるみの最大直径 (約72px) より広く取る */
export const SLOT_SPACING = 82;

/** 最初の子。プレイヤーは起動した瞬間からひとりではない。 */
const STARTER_DEF_ID = "bear_01";

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 加算し続けても安全な範囲にカウンタを収める。 */
function clampCount(v: number): number {
  return Math.max(0, Math.min(1e9, Math.round(v)));
}

function makeUid(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function initialSave(): SaveV1 {
  return {
    version: 1,
    sessionCount: 0,
    owned: [
      {
        uid: makeUid(),
        defId: STARTER_DEF_ID,
        acquiredAt: Date.now(),
        // 格子スロット上、真ん中の段の中央に置く
        x: 160,
        shelfRow: 1,
        seed: Math.random(),
      },
    ],
    craneBoard: null,
    attempts: 0,
    pendingWelcome: null,
    firstMeetingDone: false,
    log: [],
  };
}

/** 所持品の上限。これを超える保存データは壊れているか作為的なもの。 */
const MAX_OWNED = 200;
/** 盤面の景品数の上限。 */
const MAX_PRIZES = 40;

function sanitizeOwned(raw: unknown): OwnedPlush[] {
  if (!Array.isArray(raw)) return [];
  const out: OwnedPlush[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_OWNED)) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.defId !== "string" || !hasPlush(o.defId)) continue;
    const row = Math.round(num(o.shelfRow, 0));
    // uid が重複すると pendingWelcome やドラッグの対象が曖昧になるので振り直す
    let uid = typeof o.uid === "string" && o.uid ? o.uid.slice(0, 64) : makeUid();
    if (seen.has(uid)) uid = makeUid();
    seen.add(uid);
    out.push({
      uid,
      defId: o.defId,
      acquiredAt: num(o.acquiredAt, Date.now()),
      x: Math.min(2000, Math.max(-2000, num(o.x, 160))),
      shelfRow: row < 0 ? -1 : Math.min(row, SHELF_ROWS - 1),
      seed: Math.min(1, Math.max(0, num(o.seed, Math.random()))),
    });
  }
  return out;
}

function sanitizeBoard(raw: unknown): CraneBoardSave | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b.prizes)) return null;
  const prizes: CraneBoardSave["prizes"] = [];
  for (const item of b.prizes.slice(0, MAX_PRIZES)) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.defId !== "string" || !hasPlush(p.defId)) continue;
    prizes.push({
      defId: p.defId,
      x: Math.min(4000, Math.max(-4000, num(p.x, 0))),
      z: Math.min(4000, Math.max(-4000, num(p.z, 0))),
    });
  }
  if (prizes.length === 0) return null;
  return { prizes, attemptsOnBoard: Math.min(9999, clampCount(num(b.attemptsOnBoard, 0))) };
}

const LOG_TYPES = new Set<LogEventType>([
  "session_start",
  "shelf_view",
  "arcade_enter",
  "crane_start",
  "crane_drop",
  "plush_grabbed",
  "plush_dropped",
  "plush_moved",
  "plush_won",
  "shelf_return",
  "plush_placed",
  "plush_repositioned",
  "share_clicked",
  "share_result",
  "welcome_played",
  "plush_touched",
  "shelf_dwell",
]);

function sanitizeMeta(raw: unknown): LogEvent["meta"] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * ログを検証する。型だけ合わせて中身を素通しすると、
 * 後で JSON を分析するときに未知のイベント名が混ざって解釈できなくなる。
 * 既知のイベント種別だけを残し、件数も上限で切る。
 */
function sanitizeLog(raw: unknown): LogEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: LogEvent[] = [];
  const src = raw.length > LOG_LIMIT ? raw.slice(raw.length - LOG_LIMIT) : raw;
  for (const item of src) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.type !== "string" || !LOG_TYPES.has(e.type as LogEventType)) continue;
    const ev: LogEvent = {
      type: e.type as LogEventType,
      t: num(e.t, 0),
      sessionId: typeof e.sessionId === "string" ? e.sessionId.slice(0, 64) : "",
    };
    if (typeof e.plushId === "string") ev.plushId = e.plushId.slice(0, 64);
    if (typeof e.attempt === "number" && Number.isFinite(e.attempt)) ev.attempt = e.attempt;
    const meta = sanitizeMeta(e.meta);
    if (meta) ev.meta = meta;
    out.push(ev);
  }
  return out;
}

/**
 * 保存データを読む。壊れていたら黙って壊れた状態で起動せず、初期状態に戻す。
 * localStorage 自体が使えない環境（プライベートモード等）でも例外を投げない。
 */
export function loadSave(): SaveV1 {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return initialSave();
  }
  if (!raw) return initialSave();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return initialSave();
  }
  if (typeof parsed !== "object" || parsed === null) return initialSave();

  const s = parsed as Record<string, unknown>;
  if (s.version !== 1) return initialSave();

  const owned = sanitizeOwned(s.owned);
  // 所持品が1匹も残らなかったら空の部屋を見せずに最初からやり直す
  if (owned.length === 0) return initialSave();

  const ownedUids = new Set(owned.map((o) => o.uid));
  const pending =
    typeof s.pendingWelcome === "string" && ownedUids.has(s.pendingWelcome)
      ? s.pendingWelcome
      : null;

  return {
    version: 1,
    sessionCount: clampCount(num(s.sessionCount, 0)),
    owned,
    craneBoard: sanitizeBoard(s.craneBoard),
    attempts: clampCount(num(s.attempts, 0)),
    pendingWelcome: pending,
    firstMeetingDone: s.firstMeetingDone === true,
    log: sanitizeLog(s.log),
  };
}

/**
 * 保存する。容量超過や書き込み禁止でもアプリを落とさない。
 * @returns 保存できたか。呼び出し側はこれを見て「保存されていない」ことを検知できる。
 */
export function writeSave(s: SaveV1): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    // 保存できないだけでプレイは続けられる
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

export { makeUid };
