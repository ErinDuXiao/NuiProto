import { hasPlush } from "../data/plushies";
import type { CraneBoardSave, LogEvent, OwnedPlush, SaveV1 } from "./types";

export const STORAGE_KEY = "plushcrane.v1";

/** 棚に飾れる最大数。3段 × 4匹（仕様 9章）。 */
export const SHELF_CAPACITY = 12;
export const SHELF_ROWS = 3;

/** 最初の子。プレイヤーは起動した瞬間からひとりではない。 */
const STARTER_DEF_ID = "bear_01";

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
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

function sanitizeOwned(raw: unknown): OwnedPlush[] {
  if (!Array.isArray(raw)) return [];
  const out: OwnedPlush[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.defId !== "string" || !hasPlush(o.defId)) continue;
    const row = Math.round(num(o.shelfRow, 0));
    out.push({
      uid: typeof o.uid === "string" && o.uid ? o.uid : makeUid(),
      defId: o.defId,
      acquiredAt: num(o.acquiredAt, Date.now()),
      x: num(o.x, 160),
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
  for (const item of b.prizes) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.defId !== "string" || !hasPlush(p.defId)) continue;
    prizes.push({ defId: p.defId, x: num(p.x, 0), z: num(p.z, 0) });
  }
  if (prizes.length === 0) return null;
  return { prizes, attemptsOnBoard: Math.max(0, Math.round(num(b.attemptsOnBoard, 0))) };
}

function sanitizeLog(raw: unknown): LogEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is LogEvent =>
      typeof e === "object" && e !== null && typeof (e as LogEvent).type === "string"
  );
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
    sessionCount: Math.max(0, Math.round(num(s.sessionCount, 0))),
    owned,
    craneBoard: sanitizeBoard(s.craneBoard),
    attempts: Math.max(0, Math.round(num(s.attempts, 0))),
    pendingWelcome: pending,
    firstMeetingDone: s.firstMeetingDone === true,
    log: sanitizeLog(s.log),
  };
}

/** 保存する。容量超過や書き込み禁止でもアプリを落とさない。 */
export function writeSave(s: SaveV1): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 保存できないだけでプレイは続けられる。握りつぶす。
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
