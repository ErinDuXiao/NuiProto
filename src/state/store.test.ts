import { describe, it, expect, beforeEach } from "vitest";
import { store } from "./store";
import { STORAGE_KEY, PER_ROW, SHELF_CAPACITY, SHELF_ROWS, SLOT_SPACING } from "./persist";

beforeEach(() => {
  localStorage.clear();
  store.resetAll();
});

describe("store", () => {
  it("初期はBear1匹", () => {
    expect(store.get().owned).toHaveLength(1);
    expect(store.get().owned[0].defId).toBe("bear_01");
  });

  it("winPlushは1回の更新で所持追加とpendingWelcome設定を行う", () => {
    const uid = store.winPlush("rabbit_01");
    const s = store.get();
    expect(s.owned).toHaveLength(2);
    expect(s.owned[1].uid).toBe(uid);
    expect(s.owned[1].defId).toBe("rabbit_01");
    expect(s.pendingWelcome).toBe(uid);
    expect(s.log.some((e) => e.type === "plush_won")).toBe(true);
  });

  it("winPlushはuidを毎回変える", () => {
    expect(store.winPlush("rabbit_01")).not.toBe(store.winPlush("rabbit_01"));
  });

  it("winPlushはseedを個体ごとに変える", () => {
    store.winPlush("rabbit_01");
    store.winPlush("rabbit_01");
    const [a, b] = store.get().owned.slice(1);
    expect(a.seed).not.toBe(b.seed);
  });

  it("未知のdefIdでwinPlushしても状態を壊さない", () => {
    expect(() => store.winPlush("dragon_99")).toThrow();
    expect(store.get().owned).toHaveLength(1);
    expect(store.get().pendingWelcome).toBeNull();
  });

  it("finishWelcomeで演出フラグが消え、初回完了が記録される", () => {
    store.winPlush("rabbit_01");
    expect(store.get().firstMeetingDone).toBe(false);
    store.finishWelcome(false);
    expect(store.get().pendingWelcome).toBeNull();
    expect(store.get().firstMeetingDone).toBe(true);
    expect(store.get().log.some((e) => e.type === "welcome_played")).toBe(true);
  });

  it("firstMeetingDoneは一度立ったら戻らない", () => {
    store.winPlush("rabbit_01");
    store.finishWelcome(false);
    store.winPlush("fox_01");
    store.finishWelcome(true);
    expect(store.get().firstMeetingDone).toBe(true);
  });

  it("pendingWelcomeが無い状態でfinishWelcomeを呼んでも壊れない", () => {
    expect(() => store.finishWelcome(false)).not.toThrow();
    expect(store.get().pendingWelcome).toBeNull();
  });

  it("winPlushはlocalStorageへ即座に永続化する", () => {
    store.winPlush("rabbit_01");
    expect(localStorage.getItem(STORAGE_KEY)).toContain("rabbit_01");
  });

  it("subscribeが変更時に呼ばれ、解除できる", () => {
    let n = 0;
    const un = store.subscribe(() => n++);
    store.winPlush("rabbit_01");
    expect(n).toBeGreaterThan(0);
    un();
    const before = n;
    store.winPlush("fox_01");
    expect(n).toBe(before);
  });

  it("getは変更のたびに新しい参照を返す（useSyncExternalStoreの前提）", () => {
    const a = store.get();
    store.winPlush("rabbit_01");
    expect(store.get()).not.toBe(a);
  });

  it("棚の上限を超えた分はshelfRow=-1（箱の中）になるが所持数には入る", () => {
    for (let i = 0; i < 14; i++) store.winPlush("duck_01");
    const s = store.get();
    expect(s.owned).toHaveLength(15);
    expect(s.owned.filter((o) => o.shelfRow >= 0).length).toBe(SHELF_CAPACITY);
    expect(s.owned.filter((o) => o.shelfRow === -1).length).toBe(3);
  });

  it("2匹目は1匹目と同じ段の隣に来る（出会いの演出の前提）", () => {
    const bear = store.get().owned[0];
    store.winPlush("rabbit_01");
    const rabbit = store.get().owned[1];
    expect(rabbit.shelfRow).toBe(bear.shelfRow);
    expect(Math.abs(rabbit.x - bear.x)).toBeLessThanOrEqual(SLOT_SPACING);
  });

  it("同じ段を埋めきってから次の段へ移る（ばらけて置かれない）", () => {
    store.winPlush("rabbit_01");
    store.winPlush("fox_01");
    const firstRow = store.get().owned[0].shelfRow;
    expect(
      store.get().owned.filter((o) => o.shelfRow === firstRow),
      "先に始めた段を埋めきっていない"
    ).toHaveLength(PER_ROW);

    store.winPlush("frog_01");
    const rows = store.get().owned.filter((o) => o.shelfRow >= 0).map((o) => o.shelfRow);
    expect(new Set(rows).size).toBe(2);
  });

  it("箱の中の子を棚へ出そうとしても定員13匹目にはならない", () => {
    for (let i = 0; i < 12; i++) store.winPlush("duck_01");
    const boxed = store.get().owned.find((o) => o.shelfRow === -1);
    expect(boxed).toBeDefined();
    store.movePlush(boxed!.uid, 160, 0);
    expect(store.get().owned.filter((o) => o.shelfRow >= 0)).toHaveLength(SHELF_CAPACITY);
  });

  it("movePlushにNaNや範囲外の段を渡しても状態が壊れない", () => {
    const uid = store.get().owned[0].uid;
    store.movePlush(uid, Number.NaN, 99);
    const o = store.get().owned[0];
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
    expect(() => store.winPlush("rabbit_01")).not.toThrow();
    expect(reached).toBe(true);
    un1();
    un2();
  });

  it("movePlushで配置が変わり永続化される", () => {
    const uid = store.get().owned[0].uid;
    store.movePlush(uid, 250, 2);
    expect(store.get().owned[0].x).toBe(250);
    expect(store.get().owned[0].shelfRow).toBe(2);
    expect(store.get().log.some((e) => e.type === "plush_repositioned")).toBe(true);
  });

  it("存在しないuidのmovePlushは無視される", () => {
    expect(() => store.movePlush("nope", 100, 0)).not.toThrow();
    expect(store.get().owned).toHaveLength(1);
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
    store.winPlush("rabbit_01");
    store.resetAll();
    expect(store.get().owned).toHaveLength(1);
    expect(store.get().pendingWelcome).toBeNull();
  });

  it("grantPlushは演出を起こさずに追加する（DevMenu用）", () => {
    store.grantPlush("fox_01");
    expect(store.get().owned).toHaveLength(2);
    expect(store.get().pendingWelcome).toBeNull();
  });
});
