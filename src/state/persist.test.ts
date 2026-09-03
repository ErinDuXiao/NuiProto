import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSave, writeSave, initialSave, STORAGE_KEY } from "./persist";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("persist", () => {
  it("初期状態はBearを1匹持つ", () => {
    const s = initialSave();
    expect(s.owned).toHaveLength(1);
    expect(s.owned[0].defId).toBe("bear_01");
    expect(s.firstMeetingDone).toBe(false);
    expect(s.pendingWelcome).toBeNull();
  });

  it("保存→読込で一致する", () => {
    const s = initialSave();
    s.attempts = 7;
    s.owned[0].x = 123;
    s.firstMeetingDone = true;
    writeSave(s);
    const back = loadSave();
    expect(back.attempts).toBe(7);
    expect(back.owned[0].x).toBe(123);
    expect(back.firstMeetingDone).toBe(true);
  });

  it("craneBoardも往復する", () => {
    const s = initialSave();
    s.craneBoard = { prizes: [{ defId: "rabbit_01", x: 100, z: 50 }], attemptsOnBoard: 2 };
    writeSave(s);
    expect(loadSave().craneBoard).toEqual(s.craneBoard);
  });

  it("壊れたJSONなら初期状態に戻す", () => {
    localStorage.setItem(STORAGE_KEY, "{{{ not json");
    expect(loadSave().owned[0].defId).toBe("bear_01");
  });

  it("versionが違えば初期状態に戻す", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, owned: [] }));
    expect(loadSave().owned).toHaveLength(1);
  });

  it("ownedが配列でなければ初期状態に戻す", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, owned: "nope" }));
    expect(loadSave().owned).toHaveLength(1);
  });

  it("未知のdefIdを持つ所持品は捨てる", () => {
    const s = initialSave();
    s.owned.push({
      uid: "x",
      defId: "dragon_99",
      acquiredAt: 0,
      x: 0,
      shelfRow: 0,
      seed: 0.5,
    });
    writeSave(s);
    const back = loadSave();
    expect(back.owned.every((o) => o.defId !== "dragon_99")).toBe(true);
    expect(back.owned).toHaveLength(1);
  });

  it("所持品が全滅したら初期状態に戻す（空の部屋にしない）", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, owned: [{ defId: "dragon_99" }], log: [] })
    );
    expect(loadSave().owned).toHaveLength(1);
    expect(loadSave().owned[0].defId).toBe("bear_01");
  });

  it("未知のdefIdを持つ盤面は捨てる", () => {
    const s = initialSave();
    s.craneBoard = {
      prizes: [
        { defId: "rabbit_01", x: 1, z: 2 },
        { defId: "dragon_99", x: 3, z: 4 },
      ],
      attemptsOnBoard: 0,
    };
    writeSave(s);
    expect(loadSave().craneBoard!.prizes).toHaveLength(1);
  });

  it("logが配列でなければ空にする", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, owned: [], log: "oops" })
    );
    expect(loadSave().log).toEqual([]);
  });

  it("数値フィールドがNaNや文字列でも壊れない", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        attempts: "many",
        owned: [{ uid: "a", defId: "bear_01", acquiredAt: null, x: "left", shelfRow: 9, seed: 2 }],
        log: [],
      })
    );
    const back = loadSave();
    expect(Number.isFinite(back.attempts)).toBe(true);
    expect(Number.isFinite(back.owned[0].x)).toBe(true);
    expect(back.owned[0].shelfRow).toBeLessThan(3);
  });

  it("localStorageが書けなくても例外を投げない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeSave(initialSave())).not.toThrow();
  });

  it("localStorageが読めなくても初期状態を返す", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadSave().owned).toHaveLength(1);
  });
});
