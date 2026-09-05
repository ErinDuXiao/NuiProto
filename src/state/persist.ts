import { hasPlush } from "../data/plushies";
import { LOG_LIMIT } from "./log";
import { migrateV1 } from "./migrate";
import type {
  CraneBoardSave,
  LogEvent,
  LogEventType,
  PlushInstance,
  PlushOrigin,
  SaveV1Raw,
  SaveV2,
} from "./types";

/**
 * 保存キー。**変えない。**
 *
 * 名前に v1 が入っているのは前フェーズの名残であり、スキーマの
 * バージョンとは無関係。キーを変えると既存プレイヤーの棚を
 * 見失う。バージョンは中の `version` フィールドで判定する（仕様 4.2.1）。
 */
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
const STARTER_TYPE_ID = "bear_01";

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 加算し続けても安全な範囲にカウンタを収める。 */
function clampCount(v: number): number {
  return Math.max(0, Math.min(1e9, Math.round(v)));
}

function makeInstanceId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function initialSave(): SaveV2 {
  return {
    version: 2,
    sessionCount: 0,
    instances: [
      {
        instanceId: makeInstanceId(),
        plushTypeId: STARTER_TYPE_ID,
        acquiredAt: Date.now(),
        // 最初からここにいた子。試行回数も見守り役も存在しない。
        attemptsToAcquire: null,
        witnessedBy: null,
        origin: "starter",
        // 格子スロット上、真ん中の段の中央に置く
        x: 160,
        shelfRow: 1,
        personalitySeed: Math.random(),
      },
    ],
    craneBoard: null,
    attempts: 0,
    pendingWelcome: null,
    firstMeetingDone: false,
    neighborSince: {},
    log: [],
  };
}

/** 所持品の上限。これを超える保存データは壊れているか作為的なもの。 */
const MAX_INSTANCES = 200;
/** 盤面の景品数の上限。 */
const MAX_PRIZES = 40;
/**
 * 隣接リンクの上限。棚に出せるのは 12 匹で、各個体は最寄りの
 * 1 匹としかリンクしないので実際の上界は 24 本（仕様 4.1.1）。
 * 壊れた保存データで無制限に育たないよう、余裕を見て切る。
 */
const MAX_NEIGHBOR_LINKS = 64;

const ORIGINS = new Set<PlushOrigin>(["starter", "crane", "granted", "unknown"]);

/** 段を有効な範囲へ収める。負はすべて -1（箱の中）。 */
function clampRow(raw: unknown): number {
  const row = Math.round(num(raw, 0));
  return row < 0 ? -1 : Math.min(row, SHELF_ROWS - 1);
}

/**
 * 試行回数。分からない場合は捏造せず null のまま残す。
 *
 * **壊れた値を 0 に丸めない。** 0 回や負の回数で景品は取れないので、
 * それは「0 回で取れた」という事実ではなく「値が壊れている」だけ。
 * ところが provenance は 1 以下を「すぐにおうちに来た」と読むため、
 * 0 に丸めた瞬間、壊れたデータが断定文に化ける。
 * 有効な回数（1 以上）でなければ null＝分からない、に落とす
 * （Global Constraint「分からない来歴を捏造しない」）。
 */
function sanitizeAttempts(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  if (n < 1) return null;
  return Math.min(9999, n);
}

/**
 * 家に来た日時。読めなければ現在時刻で埋めず null にする。
 *
 * `num(raw, Date.now())` で埋めていた頃は、壊れた保存データが
 * そのままプロフィールの「きょう、やってきた」になっていた。
 * ゲームが知らない日付を、読み込みのたびに新しく作っていたことになる。
 * 分からないものは分からないまま運ぶ（`PlushInstance.acquiredAt` の注記）。
 */
function sanitizeAcquiredAt(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * v2 の所持品を検証する。
 *
 * 知らない `origin` は捨てずに `"unknown"` へ落とす。個体を消すより、
 * 来歴が分からない状態で残すほうがこのゲームでは正しい。
 */
function sanitizeInstances(raw: unknown): PlushInstance[] {
  if (!Array.isArray(raw)) return [];
  const out: PlushInstance[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_INSTANCES)) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.plushTypeId !== "string" || !hasPlush(o.plushTypeId)) continue;
    // instanceId が重複すると pendingWelcome やドラッグの対象が曖昧になるので振り直す
    let id =
      typeof o.instanceId === "string" && o.instanceId
        ? o.instanceId.slice(0, 64)
        : makeInstanceId();
    if (seen.has(id)) id = makeInstanceId();
    seen.add(id);
    out.push({
      instanceId: id,
      plushTypeId: o.plushTypeId,
      acquiredAt: sanitizeAcquiredAt(o.acquiredAt),
      attemptsToAcquire: sanitizeAttempts(o.attemptsToAcquire),
      witnessedBy: typeof o.witnessedBy === "string" ? o.witnessedBy.slice(0, 64) : null,
      origin: ORIGINS.has(o.origin as PlushOrigin) ? (o.origin as PlushOrigin) : "unknown",
      x: Math.min(2000, Math.max(-2000, num(o.x, 160))),
      shelfRow: clampRow(o.shelfRow),
      personalitySeed: Math.min(1, Math.max(0, num(o.personalitySeed, Math.random()))),
    });
  }
  return out;
}

/** v1 の所持品を検証する。移行のためだけに存在する。 */
function sanitizeOwnedV1(raw: unknown): SaveV1Raw["owned"] {
  if (!Array.isArray(raw)) return [];
  const out: SaveV1Raw["owned"] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_INSTANCES)) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.defId !== "string" || !hasPlush(o.defId)) continue;
    let uid = typeof o.uid === "string" && o.uid ? o.uid.slice(0, 64) : makeInstanceId();
    if (seen.has(uid)) uid = makeInstanceId();
    seen.add(uid);
    out.push({
      uid,
      defId: o.defId,
      // v1 でも同じ。壊れた日時を現在時刻に置き換えると、移行の瞬間に
      // 「きょう来た」という嘘が保存データへ焼き付く。
      acquiredAt: sanitizeAcquiredAt(o.acquiredAt),
      x: Math.min(2000, Math.max(-2000, num(o.x, 160))),
      shelfRow: clampRow(o.shelfRow),
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
    // 盤面の景品は個体ではなく種類なので defId のまま。改名しない。
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

/**
 * 隣接の記録を検証する。
 *
 * 実在しない個体を指すキーは捨てる。棚から居なくなった子との
 * 「隣にいた時間」が残り続けると、関係の演出が幽霊を相手にする。
 */
function sanitizeNeighborSince(
  raw: unknown,
  ids: Set<string>
): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  let n = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_NEIGHBOR_LINKS) break;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const pair = key.split("|");
    if (pair.length !== 2) continue;
    if (!ids.has(pair[0]) || !ids.has(pair[1])) continue;
    out[key] = value;
    n++;
  }
  return out;
}

/**
 * 保存で受け付けるイベント種別。
 * **`LogEventType` に足したら必ずここにも足す。**
 * 片方だけだと型検査は通るのにリロードで消える。
 */
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
  "plush_profile_opened",
  "plush_drag_start",
  "plush_drag_end",
  "neighbor_created",
  "neighbor_removed",
  "relationship_reaction",
  "shelf_idle_10s",
  "shelf_idle_30s",
  "shelf_return_after_win",
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
 * v2 として読む。読めなければ null。
 *
 * 所持品が1匹も残らなかったら null を返す。空の部屋を見せるより、
 * 最初の1匹がいる状態からやり直すほうがこのゲームでは正しい。
 */
export function parseV2(raw: unknown): SaveV2 | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== 2) return null;

  const instances = sanitizeInstances(s.instances);
  if (instances.length === 0) return null;

  const ids = new Set(instances.map((i) => i.instanceId));
  const pending =
    typeof s.pendingWelcome === "string" && ids.has(s.pendingWelcome)
      ? s.pendingWelcome
      : null;

  return {
    version: 2,
    sessionCount: clampCount(num(s.sessionCount, 0)),
    instances,
    craneBoard: sanitizeBoard(s.craneBoard),
    attempts: clampCount(num(s.attempts, 0)),
    pendingWelcome: pending,
    firstMeetingDone: s.firstMeetingDone === true,
    neighborSince: sanitizeNeighborSince(s.neighborSince, ids),
    log: sanitizeLog(s.log),
  };
}

/** v1 として読む。読めなければ null。移行のためだけに使う。 */
export function parseV1(raw: unknown): SaveV1Raw | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== 1) return null;

  const owned = sanitizeOwnedV1(s.owned);
  if (owned.length === 0) return null;

  const uids = new Set(owned.map((o) => o.uid));
  const pending =
    typeof s.pendingWelcome === "string" && uids.has(s.pendingWelcome)
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
 * 保存データを読む。壊れていたら黙って壊れた状態で起動せず、初期状態に戻す。
 * localStorage 自体が使えない環境（プライベートモード等）でも例外を投げない。
 *
 * 順序は仕様 4.2.1 のとおり。v1 を読んだら移行して**即座に書き戻す**。
 * 書き戻さないと、次回の起動でも毎回移行が走り、移行後に足した情報
 * （来歴・隣接の記録）が保存のたびに古い形と競合する。
 *
 * @param onMigrationWrite 移行の書き戻しが成功したかを受け取る。
 *   この結果を捨てると、書けなかった（容量超過・プライベートモード）ときでも
 *   アプリは「保存できている」と表示し、毎回黙って移行をやり直す。
 *   呼び出し側が `store.isPersisted()` へ届けるための唯一の経路。
 *   モジュール内に成否を隠し持たないのは、読み込みの結果を
 *   受け取り忘れたことがコード上で見えるようにするため。
 */
export function loadSave(onMigrationWrite?: (ok: boolean) => void): SaveV2 {
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

  const version = (parsed as Record<string, unknown>).version;

  if (version === 2) return parseV2(parsed) ?? initialSave();

  if (version === 1) {
    const v1 = parseV1(parsed);
    if (!v1) return initialSave();
    const v2 = migrateV1(v1);
    // 書き戻しは必ず行う。`onMigrationWrite?.(writeSave(v2))` と書くと
    // コールバック未指定のとき引数ごと評価されず、移行が保存されない。
    const written = writeSave(v2);
    onMigrationWrite?.(written);
    return v2;
  }

  return initialSave();
}

/**
 * 保存する。容量超過や書き込み禁止でもアプリを落とさない。
 * @returns 保存できたか。呼び出し側はこれを見て「保存されていない」ことを検知できる。
 */
export function writeSave(s: SaveV2): boolean {
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

export { makeInstanceId };
