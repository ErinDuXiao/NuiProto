import { describe, it, expect } from "vitest";
import { migrateV1 } from "./migrate";
import type { SaveV1Raw } from "./types";

// 移行の入力なので、v1 の型で受ける。SaveV1Raw が出てよいのは
// persist.ts / migrate.ts とそのテストまで（仕様 4.2.1）。
const v1: SaveV1Raw = {
  version: 1,
  sessionCount: 3,
  owned: [
    { uid: "a", defId: "bear_01", acquiredAt: 1000, x: 160, shelfRow: 1, seed: 0.3 },
    { uid: "b", defId: "rabbit_01", acquiredAt: 2000, x: 242, shelfRow: 1, seed: 0.7 },
  ],
  craneBoard: null,
  attempts: 5,
  pendingWelcome: null,
  firstMeetingDone: true,
  log: [{ type: "shelf_view", t: 1, sessionId: "s" }],
};

describe("migrateV1", () => {
  it("所持品を1匹も失わない", () => {
    expect(migrateV1(v1).instances).toHaveLength(2);
  });

  it("フィールドを対応づけて移す", () => {
    const [a] = migrateV1(v1).instances;
    expect(a.instanceId).toBe("a");
    expect(a.plushTypeId).toBe("bear_01");
    expect(a.personalitySeed).toBe(0.3);
    expect(a.acquiredAt).toBe(1000);
    expect(a.x).toBe(160);
    expect(a.shelfRow).toBe(1);
  });

  it("最古の1匹だけ starter、他は unknown（来歴を捏造しない）", () => {
    const [a, b] = migrateV1(v1).instances;
    expect(a.origin).toBe("starter");
    expect(b.origin).toBe("unknown");
  });

  it("分からない来歴は null のまま残す", () => {
    for (const i of migrateV1(v1).instances) {
      expect(i.attemptsToAcquire).toBeNull();
      expect(i.witnessedBy).toBeNull();
    }
  });

  it("version が 2 になり、neighborSince が空で始まる", () => {
    const out = migrateV1(v1);
    expect(out.version).toBe(2);
    expect(out.neighborSince).toEqual({});
  });

  it("プレイ回数・セッション数・ログ・演出フラグを保つ", () => {
    const out = migrateV1(v1);
    expect(out.attempts).toBe(5);
    expect(out.sessionCount).toBe(3);
    expect(out.firstMeetingDone).toBe(true);
    expect(out.log).toHaveLength(1);
  });

  it("pendingWelcome が所持品を指していれば保つ", () => {
    const out = migrateV1({ ...v1, pendingWelcome: "b" });
    expect(out.pendingWelcome).toBe("b");
  });

  it("所持品が空でも落ちない", () => {
    expect(() => migrateV1({ ...v1, owned: [] })).not.toThrow();
  });
});
