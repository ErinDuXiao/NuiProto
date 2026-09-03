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

/**
 * 状態を差し替えて永続化し、購読者に通知する。
 *
 * updater は必ず新しいオブジェクトを返すこと。useSyncExternalStore は
 * 参照の同一性で変更を検出するため、既存の state を書き換えてはならない。
 */
function set(updater: (s: SaveV1) => SaveV1): void {
  state = updater(state);
  writeSave(state);
  for (const l of listeners) l();
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

/**
 * 棚の空きスロットを探す。1段4匹 × 3段。
 * 空きが無ければ shelfRow: -1（箱の中）を返す。個体を捨てることはしない。
 */
function findSlot(owned: OwnedPlush[]): { x: number; shelfRow: number } {
  const onShelf = owned.filter((o) => o.shelfRow >= 0);
  if (onShelf.length >= SHELF_CAPACITY) return { x: 160, shelfRow: -1 };

  const perRow = SHELF_CAPACITY / SHELF_ROWS;
  const used = new Set(onShelf.map((o) => `${o.shelfRow}:${Math.round((o.x - 40) / 80)}`));
  // 既存の子の隣に来るよう、若い段・若い列から詰める
  for (let row = 0; row < SHELF_ROWS; row++) {
    for (let col = 0; col < perRow; col++) {
      if (!used.has(`${row}:${col}`)) return { x: 40 + col * 80, shelfRow: row };
    }
  }
  return { x: 160, shelfRow: -1 };
}

export const store = {
  get(): SaveV1 {
    return state;
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

  movePlush(uid: string, x: number, shelfRow: number): void {
    set((s) => {
      const idx = s.owned.findIndex((o) => o.uid === uid);
      if (idx < 0) return s;
      const before = s.owned[idx];
      const owned = [...s.owned];
      owned[idx] = { ...before, x, shelfRow };
      return {
        ...s,
        owned,
        log: makeLog(s, "plush_repositioned", {
          plushId: before.defId,
          meta: { fromRow: before.shelfRow, toRow: shelfRow },
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
