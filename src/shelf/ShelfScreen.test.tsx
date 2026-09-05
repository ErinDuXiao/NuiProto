import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ShelfScreen } from "./ShelfScreen";
import { store } from "../state/store";
import type { LogEvent, LogEventType } from "../state/types";

/**
 * 棚画面の配線のテスト。
 *
 * ここで見るのは見た目ではなく **「獲得 → 演出 → 挨拶 → ログ」がつながっているか**。
 * フック単体のテスト（useAmbientLife.test.tsx）はリンクや挿話を手で与えるので、
 * 「そもそも棚がリンクを渡していない」という壊れ方は捕まえられない。
 * 実際、演出中は隣接の計算を止めているせいで、**クレーンで取ってきた子の挨拶が
 * 一度も鳴らない**という不具合がここを見ていなかった間に入り込んでいた。
 *
 * rAF と壁時計を同じ仮想の時計に乗せて手で進める。挿話の間隔（6〜14秒）や
 * 記録の間引き（12秒）は時間の関数なので、時間を手で持たないと検証できない。
 */

/** 壁時計の起点。rAF の時刻 t に対して常に EPOCH + t になるよう揃える。 */
const EPOCH = 1_800_000_000_000;

let frames: FrameRequestCallback[] = [];
let clock = 0;

/** 1フレーム進める。rAF の時刻と Date.now を同じ速さで動かす。 */
function tick(t: number): void {
  clock = t;
  vi.setSystemTime(EPOCH + t);
  const queue = frames;
  frames = [];
  act(() => {
    for (const cb of queue) cb(t);
    // ShelfScreen の onTransition は relationship_reaction の store.log を
    // rAF コールバックの外（setTimeout(0)）へ追い出している（Task 6 のレビュー
    // 指摘）。setTimeout は toFake に含めてあるので、ここで即座に進めておかないと
    // この tick() の直後に来る `logsOf(...)` の同期チェックが軒並み空振りする。
    vi.advanceTimersByTime(0);
  });
}

function logsOf(type: LogEventType): LogEvent[] {
  return store.get().log.filter((e) => e.type === type);
}

/**
 * tick() は setTimeout(0) まで進めてしまうので、rAF コールバックが呼び出し元へ
 * 戻った**直後**（＝ setTimeout(0) がまだ発火していない状態）を見たい
 * Task 6 の証明用テストだけはこちらを使う。
 */
function rawTick(t: number): void {
  clock = t;
  vi.setSystemTime(EPOCH + t);
  const queue = frames;
  frames = [];
  act(() => {
    for (const cb of queue) cb(t);
  });
}

function renderShelf() {
  return render(
    <ShelfScreen onGoArcade={() => {}} onShare={() => {}} onSecretTap={() => {}} />
  );
}

/**
 * 出会いの演出を最後まで再生する。演出中は隣接を計算しない（仕様5.7）ので、
 * 「迎えた子の関係」が生まれるのは必ずこのあと。
 */
function playCeremony(): void {
  const from = clock;
  // 初回の演出は 4 秒。余裕を見て 4.5 秒ぶん回す。
  for (let i = 1; i <= 45; i++) tick(from + i * 100);
  // 最終状態を見せてから配置を解放する 500ms の待ち
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

beforeEach(() => {
  localStorage.clear();
  store.resetAll();
  frames = [];
  clock = 10_000;
  vi.useFakeTimers({
    // rAF は自前で持つ（フレームを1つずつ手で走らせたい）ので偽装しない。
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(EPOCH + clock);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ShelfScreen — 迎えたばかりの子の関係", () => {
  it("演出が終わったあとに挨拶が鳴り、neighbor_created が記録される", () => {
    // クレーンで取ってきた子は必ず既存の子の隣に置かれる（store.findSlot）。
    const guest = store.winPlush({
      plushTypeId: "bear_01",
      attemptsToAcquire: 3,
      witnessedBy: null,
    });
    const host = store.get().instances[0].instanceId;

    renderShelf();
    expect(logsOf("neighbor_created"), "演出中に隣接を計算してはいけない").toHaveLength(0);

    playCeremony();

    // 演出のあとの1回目の再計算は「起動直後の復元」ではない。
    // いま生まれた関係として報告されなければならない。
    const created = logsOf("neighbor_created");
    expect(created, "迎えた子のリンクが復元として捨てられている").toHaveLength(1);
    expect(created[0].meta?.sameType, "指標 E が読む meta が無い").toBe(true);

    // 受け皿に積まれた created を rAF ループが1フレームで消費し、挨拶が始まる。
    tick(clock + 100);

    const reactions = logsOf("relationship_reaction");
    expect(reactions, "挨拶が一度も起きていない").toHaveLength(1);
    expect(reactions[0].meta?.reactionType).toBe("greeting");
    expect(
      [reactions[0].meta?.source, reactions[0].meta?.target].sort(),
      "誰と誰の反応か分からない"
    ).toEqual([host, guest].sort());
  });

  it("保存データを復元しただけの起動では created を報告しない（仕様5.4）", () => {
    // 隣り合った2匹がいるのに neighborSince が空 = 移行直後・機能追加直後の姿。
    // ここで挨拶を鳴らすと、アプリを開くたびに古い関係が演じ直される。
    store.grantPlush("rabbit_01");
    expect(store.get().pendingWelcome, "この経路に演出は無い").toBeNull();

    renderShelf();
    const t0 = clock;
    for (let i = 1; i <= 60; i++) tick(t0 + i * 100);

    expect(logsOf("neighbor_created")).toHaveLength(0);
    expect(
      logsOf("relationship_reaction").filter((e) => e.meta?.reactionType === "greeting"),
      "復元しただけの関係で挨拶が鳴っている"
    ).toHaveLength(0);
  });

  it("隣が離れると neighbor_removed が sameType 付きで記録される", () => {
    const guest = store.winPlush({
      plushTypeId: "rabbit_01",
      attemptsToAcquire: 1,
      witnessedBy: null,
    });
    renderShelf();
    playCeremony();

    const created = logsOf("neighbor_created");
    expect(created).toHaveLength(1);
    expect(created[0].meta?.sameType, "種類が違うのに同種として記録している").toBe(false);

    // 棚の反対側へ動かす。距離が切断の閾値を大きく超えるのでリンクは切れる。
    act(() => {
      store.movePlush(guest, 700, 1);
    });

    const removed = logsOf("neighbor_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].meta?.sameType).toBe(false);
  });
});

describe("ShelfScreen — relationship_reaction の記録間隔 (依頼書22章 指標 D)", () => {
  it("演出が続いている間、記録の空白が 30 秒を超えない", () => {
    // 指標 D は「relationship_reaction から 30 秒以内の plush_drag_end」。
    // 記録の空白が 30 秒を超えると、その空白の中で起きた演出に反応した
    // 並べ替えは D から丸ごと消える（粗くなるのではなく過小に出る）。
    store.grantPlush("rabbit_01");
    renderShelf();

    const t0 = clock;
    // 120 秒ぶん。挿話は 6〜14 秒ごとなので、この間に何本も始まって終わる。
    for (let i = 1; i <= 1200; i++) tick(t0 + i * 100);

    const ts = logsOf("relationship_reaction").map((e) => e.t);
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i] - ts[i - 1], "記録の空白が指標 D の窓より長い").toBeLessThan(30_000);
    }
    // 記録が 1 件も無ければ上の空白は空回りするので、本数も見る。
    expect(ts.length, "演出がほとんど記録されていない").toBeGreaterThan(3);
  });
});

describe("ShelfScreen — relationship_reaction の store.log は rAF の外で走る (Task 6)", () => {
  /**
   * useAmbientLife の rAF コールバック（frame）は毎フレーム DOM 属性を
   * 直接書き換えるだけで React に触れてはいけない（Global Constraint）。
   * ところが挿話が始まった瞬間だけ ShelfScreen.onTransition が呼ばれ、
   * そこから store.log（JSON.stringify 全体 + localStorage.setItem +
   * 購読者通知＝再レンダー）が走っていた。しかも呼ばれるのは挿話が
   * "始まった" まさにそのフレームで、記録の間引きを 60s→12s に縮めた分
   * 5倍の頻度で起きるようになっていた。
   *
   * ここでは rAF コールバックが呼び出し元へ戻った直後の状態を直接見て、
   * store.log がまだ走っていないこと（＝ rAF を塞いでいないこと）を確認する。
   */
  it("エピソード開始のフレーム内では store.log が同期的に走らない", () => {
    store.winPlush({ plushTypeId: "bear_01", attemptsToAcquire: 3, witnessedBy: null });
    renderShelf();
    playCeremony();
    expect(logsOf("neighbor_created"), "前提が崩れている").toHaveLength(1);

    // rAF コールバックそのものを1回だけ手で呼ぶ。setTimeout はまだ進めない。
    rawTick(clock + 100);

    expect(
      logsOf("relationship_reaction"),
      "store.log が rAF コールバックの中で同期的に走っている"
    ).toHaveLength(0);

    // 次のマクロタスクまで進めると、追い出しておいた書き込みが届く。
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(
      logsOf("relationship_reaction"),
      "遅延させた書き込みが結局どこにも届いていない"
    ).toHaveLength(1);
  });

  it("setTimeout(0) が発火する前にアンマウントすると relationship_reaction は記録されない", () => {
    // 追い出した書き込みがアンマウント後に発火して、古いクロージャの ref や
    // 既に片付いたコンポーネントに触れないことを確認する（squashTimers と
    // 同じ後始末の約束）。
    store.winPlush({ plushTypeId: "bear_01", attemptsToAcquire: 3, witnessedBy: null });
    renderShelf();
    playCeremony();
    expect(logsOf("neighbor_created"), "前提が崩れている").toHaveLength(1);

    rawTick(clock + 100);
    // まだ発火していないはず。ここでアンマウントして片付けを走らせる。
    cleanup();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(
      logsOf("relationship_reaction"),
      "アンマウント後に発火した書き込みが残っている"
    ).toHaveLength(0);
  });
});
