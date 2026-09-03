import { useSyncExternalStore } from "react";
import { getPlush } from "../data/plushies";
import { pushLog } from "./log";
import {
  clearSave,
  initialSave,
  loadSave,
  makeUid,
  SHELF_CAPACITY,
  SHELF_ROWS,
  writeSave,
} from "./persist";
import type { CraneBoardSave, LogEventType, OwnedPlush, SaveV1 } from "./types";

type LogExtra = {
  plushId?: string;
  attempt?: number;
  meta?: Record<string, number | string | boolean>;
};

const SESSION_ID = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let state: SaveV1 = loadSave();
const listeners = new Set<() => void>();

/** 直近の永続化に成功したか。失敗し続けている場合は UI から知らせる。 */
let persistOk = true;

/**
 * 状態を差し替えて永続化し、購読者に通知する。
 *
 * updater は必ず新しいオブジェクトを返すこと。useSyncExternalStore は
 * 参照の同一性で変更を検出するため、既存の state を書き換えてはならない。
 *
 * 順序は「メモリ更新 → 永続化 → 通知」。永続化を通知より先に行うことで、
 * 画面に出た変化が保存されていないという状態を最小にする。保存に失敗しても
 * プレイは続けられるようにするが、成否は persistOk で観測できるようにする。
 *
 * 購読者の例外は握りつぶす。1人が落ちても他の購読者への通知を止めない。
 */
function set(updater: (s: SaveV1) => SaveV1): void {
  const next = updater(state);
  if (next === state) return;
  state = next;
  persistOk = writeSave(state);
  for (const l of listeners) {
    try {
      l();
    } catch {
      // 購読者の都合でストアを壊さない
    }
  }
}

function makeLog(
  s: SaveV1,
  type: LogEventType,
  extra: LogExtra = {}
): SaveV1["log"] {
  return pushLog(s.log, {
    type,
    t: Date.now(),
    sessionId: SESSION_ID,
    ...extra,
  });
}

const PER_ROW = SHELF_CAPACITY / SHELF_ROWS;
const SLOT_SPACING = 80;
const SLOT_X0 = 40;

/** 有効な段に置かれている個体だけを数える。 */
function displayed(owned: OwnedPlush[]): OwnedPlush[] {
  return owned.filter(
    (o) => Number.isInteger(o.shelfRow) && o.shelfRow >= 0 && o.shelfRow < SHELF_ROWS
  );
}

/**
 * 新しい子を置く場所を探す。1段4匹 × 3段。
 *
 * **既にいる子の隣を選ぶ。** これは見た目の都合ではなく、出会いの演出
 * （仕様8章）が「2匹が並ぶ」ことを前提にしているため。離れた段に置くと
 * 演出そのものが成立しない。同じ距離なら右側を選ぶ。
 *
 * 自由配置で格子から外れた子がいてもぶつからないよう、
 * 格子のキーではなく実際の距離で占有を判定する。
 * 空きが無ければ shelfRow: -1（箱の中）を返す。個体を捨てることはしない。
 */
function findSlot(owned: OwnedPlush[]): { x: number; shelfRow: number } {
  const onShelf = displayed(owned);
  if (onShelf.length >= SHELF_CAPACITY) return { x: 160, shelfRow: -1 };

  let best: { x: number; shelfRow: number; cost: number } | null = null;

  for (let row = 0; row < SHELF_ROWS; row++) {
    const inRow = onShelf.filter((o) => o.shelfRow === row);
    if (inRow.length >= PER_ROW) continue;
    for (let col = 0; col < PER_ROW; col++) {
      const x = SLOT_X0 + col * SLOT_SPACING;
      if (!inRow.every((o) => Math.abs(o.x - x) >= SLOT_SPACING * 0.8)) continue;

      // 既存の子との近さでコストを決める。段が違えば大きく不利にする。
      let cost = 0;
      if (onShelf.length > 0) {
        cost = Infinity;
        for (const o of onShelf) {
          const d = Math.abs(o.x - x) + (o.shelfRow === row ? 0 : 400);
          // 同距離なら右隣を選ぶ
          cost = Math.min(cost, d + (x < o.x ? 1 : 0));
        }
      } else {
        cost = col;
      }
      if (!best || cost < best.cost) best = { x, shelfRow: row, cost };
    }
  }

  return best ? { x: best.x, shelfRow: best.shelfRow } : { x: 160, shelfRow: -1 };
}

export const store = {
  get(): SaveV1 {
    return state;
  },

  /** 直近の永続化に成功したか。false なら「保存できていない」ことを画面で伝える。 */
  isPersisted(): boolean {
    return persistOk;
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },

  /**
   * クレーンで景品を獲得する。
   *
   * 所持品への追加・出会い演出フラグの設定・ログ記録を 1 回の更新でまとめて行う。
   * 途中の状態が外から見えないため、演出中にリロードしても
   * pendingWelcome が残り、演出は必ず 1 回だけ再生される（仕様 5.3）。
   *
   * @returns 追加された個体の uid
   */
  winPlush(defId: string): string {
    // 未知の defId ならここで落ちる。状態を触る前に検証する。
    getPlush(defId);
    const uid = makeUid();
    set((s) => {
      const slot = findSlot(s.owned);
      const plush: OwnedPlush = {
        uid,
        defId,
        acquiredAt: Date.now(),
        x: slot.x,
        shelfRow: slot.shelfRow,
        seed: Math.random(),
      };
      const owned = [...s.owned, plush];
      return {
        ...s,
        owned,
        pendingWelcome: uid,
        log: makeLog(s, "plush_won", { plushId: defId, attempt: s.attempts }),
      };
    });
    return uid;
  },

  /** 出会い演出の再生完了。pendingWelcome のクリアと初回完了の記録を同時に行う。 */
  finishWelcome(skipped: boolean): void {
    set((s) => {
      if (!s.pendingWelcome) return s;
      return {
        ...s,
        pendingWelcome: null,
        firstMeetingDone: true,
        log: makeLog(s, "welcome_played", {
          meta: { count: s.owned.length, skipped },
        }),
      };
    });
  },

  /**
   * 棚の中で個体を動かす。
   *
   * ストアが棚の不変条件を守る唯一の場所。呼び出し側が何を渡しても
   * 「段が範囲外」「定員13匹目」「x が NaN」といった状態にはならない。
   */
  movePlush(uid: string, x: number, shelfRow: number): void {
    set((s) => {
      const idx = s.owned.findIndex((o) => o.uid === uid);
      if (idx < 0) return s;
      const before = s.owned[idx];

      const row = Number.isFinite(shelfRow)
        ? Math.min(SHELF_ROWS - 1, Math.max(-1, Math.round(shelfRow)))
        : before.shelfRow;
      const nx = Number.isFinite(x) ? Math.min(2000, Math.max(-2000, x)) : before.x;

      // 箱の中から棚へ出すときだけ定員を確認する
      if (row >= 0 && before.shelfRow < 0 && displayed(s.owned).length >= SHELF_CAPACITY) {
        return s;
      }
      if (row === before.shelfRow && nx === before.x) return s;

      const owned = [...s.owned];
      owned[idx] = { ...before, x: nx, shelfRow: row };
      return {
        ...s,
        owned,
        log: makeLog(s, "plush_repositioned", {
          plushId: before.defId,
          meta: { fromRow: before.shelfRow, toRow: row },
        }),
      };
    });
  },

  saveBoard(board: CraneBoardSave | null): void {
    set((s) => ({ ...s, craneBoard: board }));
  },

  bumpAttempts(): void {
    set((s) => ({ ...s, attempts: s.attempts + 1 }));
  },

  log(type: LogEventType, extra: LogExtra = {}): void {
    set((s) => ({ ...s, log: makeLog(s, type, extra) }));
  },

  /** DevMenu 用。出会い演出を起こさずに追加する。 */
  grantPlush(defId: string): void {
    getPlush(defId);
    set((s) => {
      const slot = findSlot(s.owned);
      return {
        ...s,
        owned: [
          ...s.owned,
          {
            uid: makeUid(),
            defId,
            acquiredAt: Date.now(),
            x: slot.x,
            shelfRow: slot.shelfRow,
            seed: Math.random(),
          },
        ],
      };
    });
  },

  resetAll(): void {
    clearSave();
    set(() => initialSave());
  },

  startSession(): void {
    set((s) => ({
      ...s,
      sessionCount: s.sessionCount + 1,
      log: makeLog(s, "session_start", { meta: { session: s.sessionCount + 1 } }),
    }));
  },
};

export function useGame(): SaveV1 {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export { SESSION_ID };
