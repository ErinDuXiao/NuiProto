import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSave, writeSave, initialSave, STORAGE_KEY, SHELF_ROWS } from "./persist";
import { provenanceLines } from "../shelf/provenance";
import type { LogEventType } from "./types";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

/**
 * v1 時代の保存データ。移行の入力としてそのまま使う。
 *
 * acquiredAt はこのゲームが実在し得る範囲（2026年以降）の値にする。
 * `sanitizeAcquiredAt` はそれより前を「壊れた値」として null に落とすので、
 * 1000 や 2000 のような小さな数値のままだと移行後に origin が
 * 決まらなくなる（"最古の1匹" が見つからない）。
 */
const v1Fixture = {
  version: 1,
  sessionCount: 3,
  owned: [
    { uid: "a", defId: "bear_01", acquiredAt: new Date("2026-01-10T00:00:00Z").getTime(), x: 160, shelfRow: 1, seed: 0.3 },
    { uid: "b", defId: "rabbit_01", acquiredAt: new Date("2026-01-20T00:00:00Z").getTime(), x: 242, shelfRow: 1, seed: 0.7 },
  ],
  craneBoard: null,
  attempts: 5,
  pendingWelcome: null,
  firstMeetingDone: true,
  log: [{ type: "shelf_view", t: 1, sessionId: "s" }],
};

describe("persist", () => {
  it("初期状態はBearを1匹持つ", () => {
    const s = initialSave();
    expect(s.instances).toHaveLength(1);
    expect(s.instances[0].plushTypeId).toBe("bear_01");
    expect(s.firstMeetingDone).toBe(false);
    expect(s.pendingWelcome).toBeNull();
  });

  it("保存→読込で一致する", () => {
    const s = initialSave();
    s.attempts = 7;
    s.instances[0].x = 123;
    s.firstMeetingDone = true;
    writeSave(s);
    const back = loadSave();
    expect(back.attempts).toBe(7);
    expect(back.instances[0].x).toBe(123);
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
    expect(loadSave().instances[0].plushTypeId).toBe("bear_01");
  });

  it("versionが違えば初期状態に戻す", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, instances: [] }));
    expect(loadSave().instances).toHaveLength(1);
  });

  it("instancesが配列でなければ初期状態に戻す", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, instances: "nope" }));
    expect(loadSave().instances).toHaveLength(1);
  });

  it("未知のplushTypeIdを持つ所持品は捨てる", () => {
    const s = initialSave();
    s.instances.push({
      instanceId: "x",
      plushTypeId: "dragon_99",
      acquiredAt: 0,
      attemptsToAcquire: null,
      witnessedBy: null,
      origin: "crane",
      x: 0,
      shelfRow: 0,
      personalitySeed: 0.5,
    });
    writeSave(s);
    const back = loadSave();
    expect(back.instances.every((o) => o.plushTypeId !== "dragon_99")).toBe(true);
    expect(back.instances).toHaveLength(1);
  });

  it("所持品が全滅したら初期状態に戻す（空の部屋にしない）", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, instances: [{ plushTypeId: "dragon_99" }], log: [] })
    );
    expect(loadSave().instances).toHaveLength(1);
    expect(loadSave().instances[0].plushTypeId).toBe("bear_01");
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
    // 同上: instances が空だと parseV2 が null になり sanitizeLog を通らない。
    // 有効な個体を1匹入れて実際に sanitizeLog が動く経路にする。
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [
          { instanceId: "a", plushTypeId: "bear_01", acquiredAt: 1, x: 120, shelfRow: 1,
            personalitySeed: 0.5, attemptsToAcquire: null, witnessedBy: null, origin: "starter" },
        ],
        log: "oops",
      })
    );
    expect(loadSave().log).toEqual([]);
  });

  it("数値フィールドがNaNや文字列でも壊れない", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        attempts: "many",
        instances: [
          {
            instanceId: "a",
            plushTypeId: "bear_01",
            acquiredAt: null,
            x: "left",
            shelfRow: 9,
            personalitySeed: 2,
            attemptsToAcquire: "three",
            witnessedBy: 7,
            origin: "crane",
          },
        ],
        log: [],
      })
    );
    const back = loadSave();
    expect(Number.isFinite(back.attempts)).toBe(true);
    expect(Number.isFinite(back.instances[0].x)).toBe(true);
    expect(back.instances[0].shelfRow).toBeLessThan(SHELF_ROWS);
    // 分からない来歴は捏造せず null にする
    expect(back.instances[0].attemptsToAcquire).toBeNull();
    expect(back.instances[0].witnessedBy).toBeNull();
  });

  it("未知のイベント種別を持つログは捨てる", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [
          {
            instanceId: "a",
            plushTypeId: "bear_01",
            acquiredAt: 1,
            x: 120,
            shelfRow: 1,
            personalitySeed: 0.5,
            attemptsToAcquire: null,
            witnessedBy: null,
            origin: "crane",
          },
        ],
        log: [
          { type: "shelf_view", t: 1, sessionId: "s" },
          { type: "garbage", t: 2, sessionId: "s" },
          { type: "plush_won", t: 3, sessionId: "s", meta: null },
        ],
      })
    );
    const log = loadSave().log;
    expect(log).toHaveLength(2);
    expect(log.every((e) => e.type !== ("garbage" as never))).toBe(true);
  });

  it("巨大なログは上限で切り詰める", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      type: "shelf_view",
      t: i,
      sessionId: "s",
    }));
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [
          {
            instanceId: "a",
            plushTypeId: "bear_01",
            acquiredAt: 1,
            x: 120,
            shelfRow: 1,
            personalitySeed: 0.5,
            attemptsToAcquire: null,
            witnessedBy: null,
            origin: "crane",
          },
        ],
        log: many,
      })
    );
    expect(loadSave().log.length).toBeLessThanOrEqual(2000);
  });

  it("instanceIdが重複していたら振り直す", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [
          {
            instanceId: "same",
            plushTypeId: "bear_01",
            acquiredAt: 1,
            x: 120,
            shelfRow: 1,
            personalitySeed: 0.5,
            attemptsToAcquire: null,
            witnessedBy: null,
            origin: "starter",
          },
          {
            instanceId: "same",
            plushTypeId: "fox_01",
            acquiredAt: 2,
            x: 200,
            shelfRow: 1,
            personalitySeed: 0.5,
            attemptsToAcquire: null,
            witnessedBy: null,
            origin: "crane",
          },
        ],
        log: [],
      })
    );
    const instances = loadSave().instances;
    expect(new Set(instances.map((o) => o.instanceId)).size).toBe(2);
  });

  it("writeSaveは成否を返す", () => {
    expect(writeSave(initialSave())).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeSave(initialSave())).toBe(false);
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
    expect(loadSave().instances).toHaveLength(1);
  });

  it("LogEventType の全種別が保存で生き残る（許可リストとずれない）", () => {
    const all: LogEventType[] = [
      "session_start", "shelf_view", "arcade_enter", "crane_start", "crane_drop",
      "plush_grabbed", "plush_dropped", "plush_moved", "plush_won", "shelf_return",
      "plush_placed", "plush_repositioned", "share_clicked", "share_result",
      "welcome_played", "plush_touched", "shelf_dwell",
      "plush_profile_opened", "plush_drag_start", "plush_drag_end",
      "neighbor_created", "neighbor_removed", "relationship_reaction",
      "shelf_idle_10s", "shelf_idle_30s", "shelf_return_after_win",
    ];
    const s = initialSave();
    s.log = all.map((type, i) => ({ type, t: i, sessionId: "s" }));
    writeSave(s);
    expect(loadSave().log.map((e) => e.type)).toEqual(all);
  });
});

describe("persist / v1 からの移行", () => {
  it("v1 の保存データを読み込んで移行する", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Fixture));
    const s = loadSave();
    expect(s.version).toBe(2);
    expect(s.instances).toHaveLength(2);
    expect(s.instances[0].origin).toBe("starter");
  });

  it("移行結果を即座に v2 として保存し直す", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Fixture));
    loadSave();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(2);
  });

  it("保存キーは変えない（旧データを見失わない）", () => {
    expect(STORAGE_KEY).toBe("plushcrane.v1");
  });

  it("version が 1 でも 2 でもなければ初期状態", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(loadSave().instances[0].origin).toBe("starter");
  });

  it("v1 の owned が配列でなければ初期状態", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, owned: "nope" }));
    expect(loadSave().instances).toHaveLength(1);
  });

  it("v1 の未知の defId を持つ所持品は移行前に捨てる", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...v1Fixture,
        owned: [
          ...v1Fixture.owned,
          { uid: "c", defId: "dragon_99", acquiredAt: 3, x: 0, shelfRow: 0, seed: 0.1 },
        ],
      })
    );
    expect(loadSave().instances).toHaveLength(2);
  });

  it("v2 の instances に不正な origin があれば unknown に落とす", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [{ instanceId: "a", plushTypeId: "bear_01", acquiredAt: 1, x: 160,
                      shelfRow: 1, personalitySeed: 0.5, attemptsToAcquire: null,
                      witnessedBy: null, origin: "nonsense" }],
        log: [], neighborSince: {},
      })
    );
    expect(loadSave().instances[0].origin).toBe("unknown");
  });

  it("neighborSince が壊れていても落ちない", () => {
    // instances を空にすると parseV2 が null を返して initialSave にすり替わり、
    // sanitizeNeighborSince が一度も呼ばれないまま素通りしてしまう。
    // 有効な個体を1匹入れて parseV2 を実際に通し、サニタイズを働かせる。
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [
          { instanceId: "a", plushTypeId: "bear_01", acquiredAt: 1, x: 120, shelfRow: 1,
            personalitySeed: 0.5, attemptsToAcquire: null, witnessedBy: null, origin: "starter" },
        ],
        neighborSince: "nope",
        log: [],
      })
    );
    expect(loadSave().neighborSince).toEqual({});
  });

  it("acquiredAt が壊れていても他の個体は読める", () => {
    const validAcquiredAt = new Date("2026-02-01T00:00:00Z").getTime();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [
          { instanceId: "a", plushTypeId: "bear_01", acquiredAt: validAcquiredAt, x: 160, shelfRow: 1,
            personalitySeed: 0.5, attemptsToAcquire: null, witnessedBy: null, origin: "starter" },
          { instanceId: "b", plushTypeId: "fox_01", acquiredAt: "むかし", x: 242, shelfRow: 1,
            personalitySeed: 0.5, attemptsToAcquire: null, witnessedBy: null, origin: "crane" },
        ],
        log: [],
      })
    );
    const instances = loadSave().instances;
    expect(instances).toHaveLength(2);
    expect(instances[0].acquiredAt).toBe(validAcquiredAt);
    expect(instances[1].acquiredAt).toBeNull();
  });

  it("実在しない個体を指す neighborSince は捨てる", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [
          { instanceId: "a", plushTypeId: "bear_01", acquiredAt: 1, x: 160, shelfRow: 1,
            personalitySeed: 0.5, attemptsToAcquire: null, witnessedBy: null, origin: "starter" },
          { instanceId: "b", plushTypeId: "fox_01", acquiredAt: 2, x: 242, shelfRow: 1,
            personalitySeed: 0.5, attemptsToAcquire: null, witnessedBy: null, origin: "crane" },
        ],
        neighborSince: { "a|b": 1000, "a|ghost": 2000 },
        log: [],
      })
    );
    expect(loadSave().neighborSince).toEqual({ "a|b": 1000 });
  });
});

/**
 * 壊れた保存データが「断定文」に化けないことを、保存の往復と
 * プロフィール文面の両方で確かめる。
 *
 * ここが崩れると、ゲームは知らないはずの来歴を自信たっぷりに語り出す。
 * 「値を丸めたほうが分岐が減る」という理由でサニタイズを
 * 元に戻さないこと（Global Constraint「分からない来歴を捏造しない」）。
 */
describe("persist / 壊れた来歴を捏造しない", () => {
  /** 2026年9月10日。日付の断定が出たかどうかを見るための基準時刻。 */
  const NOW = new Date("2026-09-10T10:00:00").getTime();

  /** crane 由来の個体を1匹だけ持つ保存データを書いて読み直す。 */
  function roundTrip(overrides: Record<string, unknown>) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instances: [
          {
            instanceId: "a",
            plushTypeId: "rabbit_01",
            acquiredAt: new Date("2026-09-04T10:00:00").getTime(),
            attemptsToAcquire: 3,
            witnessedBy: null,
            origin: "crane",
            x: 160,
            shelfRow: 1,
            personalitySeed: 0.5,
            ...overrides,
          },
        ],
        log: [],
        neighborSince: {},
      })
    );
    const inst = loadSave().instances[0];
    return { inst, lines: provenanceLines(inst, [inst], NOW) };
  }

  // 0回や負の回数で景品は取れない。これは「0回で取れた」ではなく壊れた値。
  it.each([[0], [-1], [-9999], [0.4]])(
    "試行回数 %s は 0 に丸めず null にし、回数の行を出さない",
    (attempts) => {
      const { inst, lines } = roundTrip({ attemptsToAcquire: attempts });
      expect(inst.attemptsToAcquire).toBeNull();
      expect(lines.some((l) => l.includes("回目"))).toBe(false);
      expect(lines.some((l) => l.includes("すぐにおうちに来た"))).toBe(false);
    }
  );

  it("正しい試行回数はそのまま残る（サニタイズが行き過ぎていない）", () => {
    const { inst, lines } = roundTrip({ attemptsToAcquire: 1 });
    expect(inst.attemptsToAcquire).toBe(1);
    expect(lines).toContain("すぐにおうちに来た");
    expect(roundTrip({ attemptsToAcquire: 12 }).lines).toContain("12回目でおうちに来た");
  });

  // 現在時刻で埋めると、読み込むたびに「きょう来た」という嘘が生まれる。
  it.each([[null], ["きのう"], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "acquiredAt が %s なら現在時刻で埋めず null にし、日付を断定しない",
    (acquiredAt) => {
      const { inst, lines } = roundTrip({ acquiredAt });
      expect(inst.acquiredAt).toBeNull();
      expect(lines).toContain("いつからか、ここにいる");
      expect(lines.some((l) => l.includes("きょう"))).toBe(false);
      expect(lines.some((l) => /\d+月\d+日/.test(l))).toBe(false);
    }
  );

  // 0 や 1 は数値としては有効でも、このゲームが存在しない1970年近辺を指す。
  // 「0回で取れた」を弾く sanitizeAttempts と同じ理由で、
  // 「1970年に来た」という断定文も事実ではなく破損として扱う。
  it.each([[0], [1], [-1], [new Date("2025-12-31T23:59:59Z").getTime()]])(
    "acquiredAt が %s（ゲームが存在しない過去）なら null にし、1970年近辺を断定しない",
    (acquiredAt) => {
      const { inst, lines } = roundTrip({ acquiredAt });
      expect(inst.acquiredAt).toBeNull();
      expect(lines).toContain("いつからか、ここにいる");
      expect(lines.some((l) => /\d+月\d+日/.test(l))).toBe(false);
    }
  );

  // 遠すぎる未来も同じ理屈で捏造になる（桁が壊れた値以外に生まれ得ない）。
  it("acquiredAt が遠い未来なら null にし、未来の日付を断定しない", () => {
    const farFuture = new Date("2200-01-01T00:00:00Z").getTime();
    const { inst, lines } = roundTrip({ acquiredAt: farFuture });
    expect(inst.acquiredAt).toBeNull();
    expect(lines).toContain("いつからか、ここにいる");
  });

  // 境界そのもの（2026年の開始・2100年の開始の直前）はサニタイズが
  // 行き過ぎていないことの確認。
  it("ゲーム開始日時ちょうど、遠い未来の直前は事実として残す", () => {
    const epoch = new Date("2026-01-01T00:00:00Z").getTime();
    expect(roundTrip({ acquiredAt: epoch }).inst.acquiredAt).toBe(epoch);
    const justBeforeFarFuture = new Date("2099-12-31T23:59:59Z").getTime();
    expect(roundTrip({ acquiredAt: justBeforeFarFuture }).inst.acquiredAt).toBe(
      justBeforeFarFuture
    );
  });

  it("日付が分からなくても、分かっている回数は語る（知っている事実を捨てない）", () => {
    const { lines } = roundTrip({ acquiredAt: null, attemptsToAcquire: 5 });
    expect(lines).toContain("いつからか、ここにいる");
    expect(lines).toContain("5回目でおうちに来た");
  });

  it("正しい acquiredAt はそのまま残る（サニタイズが行き過ぎていない）", () => {
    const { inst, lines } = roundTrip({});
    expect(inst.acquiredAt).toBe(new Date("2026-09-04T10:00:00").getTime());
    expect(lines).toContain("9月4日にやってきた");
  });

  it("v1 の壊れた acquiredAt も現在時刻で埋めない", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...v1Fixture,
        owned: [
          { uid: "a", defId: "bear_01", acquiredAt: new Date("2026-01-10T00:00:00Z").getTime(), x: 160, shelfRow: 1, seed: 0.3 },
          { uid: "b", defId: "rabbit_01", acquiredAt: "?", x: 242, shelfRow: 1, seed: 0.7 },
        ],
      })
    );
    const instances = loadSave().instances;
    expect(instances[1].acquiredAt).toBeNull();
    // 日時が分からない子を「最古＝はじめからここにいた」にはしない
    expect(instances[0].origin).toBe("starter");
    expect(instances[1].origin).toBe("unknown");
  });
});
