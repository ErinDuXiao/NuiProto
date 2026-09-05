import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { store } from "./store";
import { STORAGE_KEY, PER_ROW, SHELF_CAPACITY, SHELF_ROWS, SLOT_SPACING } from "./persist";

beforeEach(() => {
  localStorage.clear();
  store.resetAll();
});

/** 来歴を問わないテストのための短縮形。 */
function win(plushTypeId: string): string {
  return store.winPlush({ plushTypeId, attemptsToAcquire: 1, witnessedBy: null });
}

describe("store", () => {
  it("初期はBear1匹", () => {
    expect(store.get().instances).toHaveLength(1);
    expect(store.get().instances[0].plushTypeId).toBe("bear_01");
  });

  it("winPlushは1回の更新で所持追加とpendingWelcome設定を行う", () => {
    const id = win("rabbit_01");
    const s = store.get();
    expect(s.instances).toHaveLength(2);
    expect(s.instances[1].instanceId).toBe(id);
    expect(s.instances[1].plushTypeId).toBe("rabbit_01");
    expect(s.pendingWelcome).toBe(id);
    expect(s.log.some((e) => e.type === "plush_won")).toBe(true);
  });

  it("winPlushはinstanceIdを毎回変える", () => {
    expect(win("rabbit_01")).not.toBe(win("rabbit_01"));
  });

  it("winPlushはpersonalitySeedを個体ごとに変える", () => {
    win("rabbit_01");
    win("rabbit_01");
    const [a, b] = store.get().instances.slice(1);
    expect(a.personalitySeed).not.toBe(b.personalitySeed);
  });

  it("未知のplushTypeIdでwinPlushしても状態を壊さない", () => {
    expect(() => win("dragon_99")).toThrow();
    expect(store.get().instances).toHaveLength(1);
    expect(store.get().pendingWelcome).toBeNull();
  });

  it("finishWelcomeで演出フラグが消え、初回完了が記録される", () => {
    win("rabbit_01");
    expect(store.get().firstMeetingDone).toBe(false);
    store.finishWelcome(false);
    expect(store.get().pendingWelcome).toBeNull();
    expect(store.get().firstMeetingDone).toBe(true);
    expect(store.get().log.some((e) => e.type === "welcome_played")).toBe(true);
  });

  it("firstMeetingDoneは一度立ったら戻らない", () => {
    win("rabbit_01");
    store.finishWelcome(false);
    win("fox_01");
    store.finishWelcome(true);
    expect(store.get().firstMeetingDone).toBe(true);
  });

  it("pendingWelcomeが無い状態でfinishWelcomeを呼んでも壊れない", () => {
    expect(() => store.finishWelcome(false)).not.toThrow();
    expect(store.get().pendingWelcome).toBeNull();
  });

  it("winPlushはlocalStorageへ即座に永続化する", () => {
    win("rabbit_01");
    expect(localStorage.getItem(STORAGE_KEY)).toContain("rabbit_01");
  });

  it("subscribeが変更時に呼ばれ、解除できる", () => {
    let n = 0;
    const un = store.subscribe(() => n++);
    win("rabbit_01");
    expect(n).toBeGreaterThan(0);
    un();
    const before = n;
    win("fox_01");
    expect(n).toBe(before);
  });

  it("getは変更のたびに新しい参照を返す（useSyncExternalStoreの前提）", () => {
    const a = store.get();
    win("rabbit_01");
    expect(store.get()).not.toBe(a);
  });

  it("棚の上限を超えた分はshelfRow=-1（箱の中）になるが所持数には入る", () => {
    for (let i = 0; i < 14; i++) win("duck_01");
    const s = store.get();
    expect(s.instances).toHaveLength(15);
    expect(s.instances.filter((o) => o.shelfRow >= 0).length).toBe(SHELF_CAPACITY);
    expect(s.instances.filter((o) => o.shelfRow === -1).length).toBe(3);
  });

  it("2匹目は1匹目と同じ段の隣に来る（出会いの演出の前提）", () => {
    const bear = store.get().instances[0];
    win("rabbit_01");
    const rabbit = store.get().instances[1];
    expect(rabbit.shelfRow).toBe(bear.shelfRow);
    expect(Math.abs(rabbit.x - bear.x)).toBeLessThanOrEqual(SLOT_SPACING);
  });

  it("同じ段を埋めきってから次の段へ移る（ばらけて置かれない）", () => {
    win("rabbit_01");
    win("fox_01");
    const firstRow = store.get().instances[0].shelfRow;
    expect(
      store.get().instances.filter((o) => o.shelfRow === firstRow),
      "先に始めた段を埋めきっていない"
    ).toHaveLength(PER_ROW);

    win("frog_01");
    const rows = store.get().instances.filter((o) => o.shelfRow >= 0).map((o) => o.shelfRow);
    expect(new Set(rows).size).toBe(2);
  });

  it("箱の中の子を棚へ出そうとしても定員13匹目にはならない", () => {
    for (let i = 0; i < 12; i++) win("duck_01");
    const boxed = store.get().instances.find((o) => o.shelfRow === -1);
    expect(boxed).toBeDefined();
    store.movePlush(boxed!.instanceId, 160, 0);
    expect(store.get().instances.filter((o) => o.shelfRow >= 0)).toHaveLength(SHELF_CAPACITY);
  });

  it("movePlushにNaNや範囲外の段を渡しても状態が壊れない", () => {
    const id = store.get().instances[0].instanceId;
    store.movePlush(id, Number.NaN, 99);
    const o = store.get().instances[0];
    expect(Number.isFinite(o.x)).toBe(true);
    expect(o.shelfRow).toBeLessThan(SHELF_ROWS);
    expect(o.shelfRow).toBeGreaterThanOrEqual(-1);
  });

  it("購読者が例外を投げても他の購読者に通知が届く", () => {
    let reached = false;
    const un1 = store.subscribe(() => {
      throw new Error("boom");
    });
    const un2 = store.subscribe(() => {
      reached = true;
    });
    expect(() => win("rabbit_01")).not.toThrow();
    expect(reached).toBe(true);
    un1();
    un2();
  });

  it("movePlushで配置が変わり永続化される", () => {
    const id = store.get().instances[0].instanceId;
    store.movePlush(id, 250, 2);
    expect(store.get().instances[0].x).toBe(250);
    expect(store.get().instances[0].shelfRow).toBe(2);
    expect(store.get().log.some((e) => e.type === "plush_repositioned")).toBe(true);
  });

  it("存在しないinstanceIdのmovePlushは無視される", () => {
    expect(() => store.movePlush("nope", 100, 0)).not.toThrow();
    expect(store.get().instances).toHaveLength(1);
  });

  it("saveBoardとbumpAttemptsが動く", () => {
    store.saveBoard({ prizes: [{ defId: "rabbit_01", x: 10, z: 20 }], attemptsOnBoard: 1 });
    expect(store.get().craneBoard!.attemptsOnBoard).toBe(1);
    store.bumpAttempts();
    expect(store.get().attempts).toBe(1);
  });

  it("logは上限を超えても増え続けない", () => {
    for (let i = 0; i < 2200; i++) store.log("shelf_view");
    expect(store.get().log.length).toBeLessThanOrEqual(2000);
  });

  it("resetAllで初期状態に戻る", () => {
    win("rabbit_01");
    store.resetAll();
    expect(store.get().instances).toHaveLength(1);
    expect(store.get().pendingWelcome).toBeNull();
  });

  it("grantPlushは演出を起こさずに追加する（DevMenu用）", () => {
    store.grantPlush("fox_01");
    expect(store.get().instances).toHaveLength(2);
    expect(store.get().pendingWelcome).toBeNull();
  });
});

describe("store / 来歴", () => {
  it("winPlush が来歴を保存する", () => {
    const uid = store.winPlush({
      plushTypeId: "rabbit_01", attemptsToAcquire: 3, witnessedBy: "bear-1",
    });
    const i = store.get().instances.find((x) => x.instanceId === uid)!;
    expect(i.attemptsToAcquire).toBe(3);
    expect(i.witnessedBy).toBe("bear-1");
    expect(i.origin).toBe("crane");
  });

  it("grantPlush は来歴を残さず granted になる", () => {
    store.grantPlush("fox_01");
    const i = store.get().instances[1];
    expect(i.origin).toBe("granted");
    expect(i.attemptsToAcquire).toBeNull();
  });

  it("初期の1匹は starter", () => {
    expect(store.get().instances[0].origin).toBe("starter");
  });

  it("同じ種類を2匹取っても別個体として保存される（スタックしない）", () => {
    store.winPlush({ plushTypeId: "duck_01", attemptsToAcquire: 1, witnessedBy: null });
    store.winPlush({ plushTypeId: "duck_01", attemptsToAcquire: 4, witnessedBy: null });
    const ducks = store.get().instances.filter((i) => i.plushTypeId === "duck_01");
    expect(ducks).toHaveLength(2);
    expect(ducks[0].instanceId).not.toBe(ducks[1].instanceId);
    expect(ducks[0].attemptsToAcquire).not.toBe(ducks[1].attemptsToAcquire);
  });

  it("来歴は保存を往復しても残る", () => {
    store.winPlush({ plushTypeId: "rabbit_01", attemptsToAcquire: 7, witnessedBy: "bear-1" });
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.version).toBe(2);
    expect(raw.instances[1].attemptsToAcquire).toBe(7);
    expect(raw.instances[1].witnessedBy).toBe("bear-1");
    expect(raw.instances[1].origin).toBe("crane");
  });
});

/**
 * 起動時の v1→v2 移行の書き戻しが失敗したときに、
 * ストアが「保存できている」と嘘をつかないことを確かめる。
 *
 * ここが true 固定に戻ると、書けない環境で警告が出ないまま
 * 毎回の起動で移行がやり直され、プレイヤーは棚が保存されて
 * いないことに気づけない（DevMenu / ShelfScreen の
 * 「保存できていません」表示がこの値だけを見ている）。
 */
describe("store / 起動時の移行と保存の成否", () => {
  /** v1 時代の保存データ。移行を必ず走らせるための入力。 */
  const v1Fixture = {
    version: 1,
    sessionCount: 1,
    owned: [
      { uid: "a", defId: "bear_01", acquiredAt: 1000, x: 160, shelfRow: 1, seed: 0.3 },
    ],
    craneBoard: null,
    attempts: 0,
    pendingWelcome: null,
    firstMeetingDone: true,
    log: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** localStorage を用意し直してからストアを読み込み直す。 */
  async function freshStore(): Promise<typeof store> {
    vi.resetModules();
    const mod = await import("./store");
    return mod.store;
  }

  it("移行の書き戻しに失敗したら isPersisted は false", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Fixture));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const fresh = await freshStore();
    // 移行自体は成功して棚は見える。保存だけができていない。
    expect(fresh.get().instances).toHaveLength(1);
    expect(fresh.isPersisted()).toBe(false);
  });

  it("移行の書き戻しに成功すれば isPersisted は true", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Fixture));
    const fresh = await freshStore();
    expect(fresh.get().version).toBe(2);
    expect(fresh.isPersisted()).toBe(true);
  });
});
