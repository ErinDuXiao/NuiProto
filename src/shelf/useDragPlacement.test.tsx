import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { store, useGame } from "../state/store";
import type { LogEvent, LogEventType } from "../state/types";
import { useDragPlacement, type DragState } from "./useDragPlacement";
import { DRAG_LIFT_PX, DROP_SETTLE_MS, rowY, SHELF } from "./shelfLayout";

/**
 * 並べ替えの操作性のテスト（仕様6章 / 依頼書13章）。
 *
 * ここで見るのは見た目ではなく **指の動きが位置と記録に正しく届くか**。
 * `plush_drag_end` は指標 D（関係の演出を見て並べ替えたか）の片側なので、
 * 「完了したドラッグは必ず記録される・中断は記録されない」を機械で守る。
 *
 * rAF と performance.now を仮想の時計に乗せて手で進める。持ち上げの 120ms と
 * 着地の 180ms は時間の関数なので、時間を手で持たないと検証できない。
 */

const VIEW_H = SHELF.height + 53;

let clock = 0;
let frames: FrameRequestCallback[] = [];
let lastDrag: DragState = null;
let taps: string[] = [];

/** フレームを1つ進める。rAF の時刻と performance.now を同じ速さで動かす。 */
function tick(dt = 16): void {
  clock += dt;
  const queue = frames;
  frames = [];
  act(() => {
    for (const cb of queue) cb(clock);
  });
}

/** 時計だけ進める（フレームは走らせない）。 */
function advance(dt: number): void {
  clock += dt;
}

/**
 * jsdom には PointerEvent が無い。React は type だけで振り分けるので、
 * MouseEvent に pointerId を足したもので代用する。
 */
function pointerEvent(type: string, x: number, y: number, pointerId: number): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, "pointerId", { value: pointerId });
  return e;
}

function down(el: Element, x: number, y: number, id = 1): void {
  act(() => {
    el.dispatchEvent(pointerEvent("pointerdown", x, y, id));
  });
}

function move(x: number, y: number, id = 1): void {
  act(() => {
    window.dispatchEvent(pointerEvent("pointermove", x, y, id));
  });
}

function up(x: number, y: number, id = 1): void {
  act(() => {
    window.dispatchEvent(pointerEvent("pointerup", x, y, id));
  });
}

function cancel(id = 1): void {
  act(() => {
    window.dispatchEvent(pointerEvent("pointercancel", 0, 0, id));
  });
}

/**
 * 棚の最小の器。**onTap は毎レンダー新しい関数を渡す** — ShelfScreen が
 * 実際にそうしており、そこが壊れると1回動かしただけでドラッグが死ぬ。
 */
function Harness() {
  const game = useGame();
  const svgRef = useRef<SVGSVGElement>(null);
  const { onPointerDown, drag } = useDragPlacement({
    instances: game.instances,
    svgRef,
    enabled: true,
    onTap: (instanceId) => {
      taps.push(instanceId);
    },
  });
  lastDrag = drag;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${SHELF.width} ${VIEW_H}`}>
      {game.instances.map((o) => (
        <g
          key={o.instanceId}
          data-testid={o.instanceId}
          onPointerDown={(e) => onPointerDown(o.instanceId, e)}
        />
      ))}
    </svg>
  );
}

function grab(instanceId: string): Element {
  const el = document.querySelector(`[data-testid="${instanceId}"]`);
  if (!el) throw new Error(`no element for ${instanceId}`);
  return el;
}

function logsOf(type: LogEventType): LogEvent[] {
  return store.get().log.filter((e) => e.type === type);
}

function starter(): { id: string; x: number; row: number } {
  const o = store.get().instances[0];
  return { id: o.instanceId, x: o.x, row: o.shelfRow };
}

function posOf(instanceId: string): { x: number; shelfRow: number } {
  const o = store.get().instances.find((i) => i.instanceId === instanceId);
  if (!o) throw new Error(`no instance ${instanceId}`);
  return { x: o.x, shelfRow: o.shelfRow };
}

beforeEach(() => {
  localStorage.clear();
  store.resetAll();
  frames = [];
  clock = 1000;
  lastDrag = null;
  taps = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  // jsdom の getBoundingClientRect は 0 を返す。viewBox と 1:1 に合わせて、
  // 画面座標をそのまま棚の座標として読めるようにする。
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: SHELF.width,
    bottom: VIEW_H,
    width: SHELF.width,
    height: VIEW_H,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDragPlacement — 指の動きが届く", () => {
  it("親が毎レンダー新しい onTap を渡してもドラッグが続く", () => {
    // ShelfScreen は onTap にインラインの関数を渡している。購読を
    // その同一性に依存させると、1回目の移動で state が変わった瞬間に
    // 購読が張り直されて掴んでいる指を見失い、**2回目以降の移動が
    // まるごと無視され、指を離しても確定しない**（drag_end が消える）。
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 40, rowY(s.row));
    move(s.x + 80, rowY(s.row));

    expect(lastDrag?.moved, "1回目の移動でドラッグが始まっていない").toBe(true);
    expect(lastDrag?.x, "2回目の移動が無視されている").toBeCloseTo(s.x + 80, 0);

    up(s.x + 80, rowY(s.row));
    expect(posOf(s.id).x, "指を離しても位置が確定していない").toBeCloseTo(s.x + 80, 0);
  });

  it("2本目の指には乗っ取られない", () => {
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 40, rowY(s.row), 1);
    move(s.x + 200, rowY(s.row), 2);
    expect(lastDrag?.x, "別の指の移動を拾っている").toBeCloseTo(s.x + 40, 0);
    up(0, 0, 2);
    expect(lastDrag, "別の指の pointerup でドラッグが終わっている").not.toBeNull();
  });

  it("しきい値未満はタップとして扱い、ドラッグの記録を残さない", () => {
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 2, rowY(s.row));
    up(s.x + 2, rowY(s.row));

    expect(taps).toEqual([s.id]);
    expect(logsOf("plush_drag_start"), "タップで drag_start が残っている").toHaveLength(0);
    expect(logsOf("plush_drag_end"), "タップで drag_end が残っている").toHaveLength(0);
  });
});

describe("useDragPlacement — 記録（指標 D の片側）", () => {
  it("動かして離したら drag_start と drag_end が1件ずつ残る", () => {
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 40, rowY(s.row));
    move(s.x + 60, rowY(s.row));
    up(s.x + 60, rowY(s.row));

    expect(logsOf("plush_drag_start")).toHaveLength(1);
    const ends = logsOf("plush_drag_end");
    expect(ends, "完了したドラッグが記録されていない").toHaveLength(1);
    expect(ends[0].meta?.fromRow).toBe(s.row);
    expect(ends[0].meta?.toRow).toBe(s.row);
    expect(ends[0].meta?.reverted).toBe(false);
  });

  it("元の位置へ戻すだけのドラッグでも drag_end を残す", () => {
    // store.movePlush は位置が変わらないと何も書かない。記録をそこに
    // 相乗りさせると「動かしたが結局戻した」操作が指標 D から消える。
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 30, rowY(s.row));
    move(s.x, rowY(s.row));
    up(s.x, rowY(s.row));

    expect(posOf(s.id).x).toBe(s.x);
    expect(logsOf("plush_drag_end"), "位置が変わらないと記録が消えている").toHaveLength(1);
  });

  it("pointercancel は drag_end を残さず、位置も動かさない", () => {
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 60, rowY(s.row));
    cancel();

    expect(lastDrag, "中断してもドラッグが残っている").toBeNull();
    expect(posOf(s.id).x, "奪われたジェスチャで位置が動いた").toBe(s.x);
    expect(logsOf("plush_drag_end"), "中断が並べ替えとして数えられている").toHaveLength(0);
    expect(taps, "中断が撫でたことにされている").toHaveLength(0);
  });

  it("棚が満杯でも記録は残り、個体は棚の上に残る", () => {
    // 定員ちょうど（starter を含めて 12 匹）。掴んでいる本人を除けば
    // 必ず1枠空いているので snapPlacement は取り消さないが、
    // 「取り消したかどうか」は必ず記録に載っていなければならない。
    const s = starter();
    act(() => {
      for (let i = 0; i < 11; i++) store.grantPlush("bear_01");
    });
    render(<Harness />);
    const before = posOf(s.id);

    down(grab(s.id), before.x, rowY(before.shelfRow));
    move(before.x + 40, rowY(before.shelfRow));
    up(before.x + 40, rowY(before.shelfRow));

    const ends = logsOf("plush_drag_end");
    expect(ends, "満杯の棚でドラッグの記録が消えている").toHaveLength(1);
    expect(typeof ends[0].meta?.reverted, "取り消したかどうかが記録に無い").toBe("boolean");
    expect(posOf(s.id).shelfRow, "個体が箱の中へ消えた").toBeGreaterThanOrEqual(0);
  });
});

describe("useDragPlacement — 指で隠れない × 棚板から浮かない（仕様6.1）", () => {
  it("持ち上がったあと、足元は常に棚板の上面ラインにある", () => {
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 10, rowY(s.row));
    tick(200); // 持ち上げの 120ms を越える

    for (let y = 260; y <= 520; y += 7) {
      move(s.x + 10, y);
      tick();
      expect(lastDrag!.y, `y=${y} で棚板から浮いている`).toBeCloseTo(
        rowY(lastDrag!.shelfRow),
        4
      );
    }
  });

  it("持ち上がったあと、足元は指より上にある（顔が指で隠れない）", () => {
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 10, rowY(s.row));
    tick(200);

    // 段の吸着で最大 (段間隔/2 = 51px) だけ下へずれるが、持ち上げ量 46px を
    // 引いた **5px** しか指に近づかない。指が入るのは胴（72px）の最下部
    // 5px であって、顔には決して届かない。この 5px は仕様の数値
    // （46 < 51）が抱えている残差なので、境界値としてここに固定しておく。
    const slack = (SHELF.rowY[1] - SHELF.rowY[0]) / 2 - DRAG_LIFT_PX;
    for (let y = 260; y <= 520; y += 7) {
      move(s.x + 10, y);
      tick();
      expect(lastDrag!.y - y, `y=${y} で指がぬいぐるみに深く重なっている`).toBeLessThanOrEqual(
        slack + 0.001
      );
    }
  });

  it("頭を掴んでも、掴んだ瞬間に段が飛ばない（持ち上げは120msかけて付く）", () => {
    render(<Harness />);
    const s = starter();
    const feet = rowY(s.row);
    // 頭のあたり（足元から 60px 上）を掴む
    down(grab(s.id), s.x, feet - 60);
    move(s.x + 6, feet - 60);

    expect(lastDrag?.moved).toBe(true);
    expect(lastDrag!.shelfRow, "掴んだ瞬間に一段上へ飛んでいる").toBe(s.row);
    expect(Math.abs(lastDrag!.y - feet), "掴んだ瞬間に縦へ飛んでいる").toBeLessThan(20);

    // 120ms かけてオフセットが付き切る。指はそのままでも段が上がる。
    tick(200);
    expect(lastDrag!.shelfRow, "持ち上げが付いていない").toBe(s.row - 1);
    expect(lastDrag!.y).toBeCloseTo(rowY(s.row - 1), 4);
  });
});

describe("useDragPlacement — 置ける場所が分かる（仕様6.2）", () => {
  it("置ける段では、影を出す段が着地する段と一致する", () => {
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 10, rowY(s.row));
    tick(200);
    expect(lastDrag!.landingRow).toBe(lastDrag!.shelfRow);
  });

  it("満杯の段の上では影を出さない", () => {
    // 上の段（row 0）を 3 匹で埋める。掴んでいる starter は row 1 のまま。
    act(() => {
      for (let i = 0; i < 3; i++) store.grantPlush("bear_01");
      const ids = store.get().instances.slice(1, 4);
      ids.forEach((o, i) => store.movePlush(o.instanceId, 78 + i * 82, 0));
    });
    render(<Harness />);
    const s = starter();

    down(grab(s.id), s.x, rowY(s.row));
    move(s.x, rowY(s.row) - 4);
    tick(200);
    // 指を上の段まで運ぶ
    move(s.x, rowY(0) + DRAG_LIFT_PX);
    tick();
    expect(lastDrag!.shelfRow, "上の段に来ていない").toBe(0);
    expect(lastDrag!.landingRow, "満杯の段に影が出ている").toBeNull();
  });

  it("元の段へ戻すとき、自分を数えて満杯にしない", () => {
    // 自分を含めて 3 匹の段。自分を数え込むと影が消える。
    act(() => {
      for (let i = 0; i < 2; i++) store.grantPlush("bear_01");
      const all = store.get().instances;
      all.forEach((o, i) => store.movePlush(o.instanceId, 78 + i * 82, 1));
    });
    render(<Harness />);
    const s = starter();
    const p = posOf(s.id);

    down(grab(s.id), p.x, rowY(p.shelfRow));
    move(p.x + 6, rowY(p.shelfRow));
    tick(200);
    expect(lastDrag!.shelfRow).toBe(1);
    expect(lastDrag!.landingRow, "自分自身を数えて満杯にしている").toBe(1);
  });
});

describe("useDragPlacement — Drop でジャンプしない（仕様6.3）", () => {
  it("離した直後は離した位置のまま、DROP_SETTLE_MS かけて確定位置へ滑る", () => {
    // 右隣に1匹置いて、押し出しが起きる位置へ落とす。
    act(() => {
      store.grantPlush("bear_01");
      const other = store.get().instances[1].instanceId;
      store.movePlush(other, 250, 1);
    });
    render(<Harness />);
    const s = starter();
    const p = posOf(s.id);

    down(grab(s.id), p.x, rowY(p.shelfRow));
    move(240, rowY(p.shelfRow));
    tick(200);
    const releaseX = lastDrag!.x;
    up(240, rowY(p.shelfRow));

    const committed = posOf(s.id);
    expect(committed.x, "押し出しが起きていない前提が崩れている").not.toBeCloseTo(
      releaseX,
      0
    );
    expect(lastDrag, "離した瞬間にドラッグが消えている（＝瞬間移動）").not.toBeNull();
    expect(lastDrag!.settling, "滑走が始まっていない").toBeTruthy();
    expect(lastDrag!.x, "離した瞬間に確定位置へ飛んでいる").toBeCloseTo(releaseX, 1);

    // 途中は離した位置と確定位置の間にいる
    tick(DROP_SETTLE_MS / 2);
    const mid = lastDrag!.x;
    expect(Math.min(releaseX, committed.x)).toBeLessThanOrEqual(mid + 0.001);
    expect(mid).toBeLessThanOrEqual(Math.max(releaseX, committed.x) + 0.001);

    // 滑走が終わればドラッグは畳まれる
    tick(DROP_SETTLE_MS);
    expect(lastDrag, "滑走が終わってもドラッグが残っている").toBeNull();
  });

  it("滑走中にアンマウントしても壊れず、位置は確定済み", () => {
    render(<Harness />);
    const s = starter();
    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 60, rowY(s.row));
    up(s.x + 60, rowY(s.row));
    expect(lastDrag!.settling).toBeTruthy();

    expect(() => cleanup()).not.toThrow();
    expect(posOf(s.id).x, "滑走の途中で置き場所が失われた").toBeCloseTo(s.x + 60, 0);
    expect(() => tick(DROP_SETTLE_MS * 2)).not.toThrow();
  });

  it("rAF が一度も回らなくても、滑走は時間で必ず畳まれる", () => {
    // タブが隠れると rAF は止まる。終わり方が rAF の中だけにあると、
    // 棚は「ドラッグ中」のまま固まり、環境アニメーションも隣接の
    // 再計算も再開しない。保険のタイマーは**離した時点**で張らなければ
    // ならない — 掴んだ時点で張ると、少し長いドラッグで空振りして消える。
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const s = starter();
      down(grab(s.id), s.x, rowY(s.row));
      move(s.x + 40, rowY(s.row));
      // ゆっくり並べ替える人。掴んでから離すまで数秒かかる。
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      move(s.x + 60, rowY(s.row));
      up(s.x + 60, rowY(s.row));
      expect(lastDrag!.settling, "滑走が始まっていない").toBeTruthy();

      // rAF は 1 フレームも回さない
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(lastDrag, "滑走が終わらずドラッグが残り続けている").toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("滑走中でも次のドラッグを受け付ける", () => {
    act(() => {
      store.grantPlush("bear_01");
    });
    render(<Harness />);
    const s = starter();
    const other = store.get().instances[1];

    down(grab(s.id), s.x, rowY(s.row));
    move(s.x + 40, rowY(s.row));
    up(s.x + 40, rowY(s.row));
    expect(lastDrag!.settling).toBeTruthy();

    // 滑走の途中で別の子を掴む
    advance(40);
    down(grab(other.instanceId), other.x, rowY(other.shelfRow));
    move(other.x - 40, rowY(other.shelfRow));
    expect(lastDrag!.instanceId, "滑走中の子を掴んだままになっている").toBe(
      other.instanceId
    );
    up(other.x - 40, rowY(other.shelfRow));
    expect(logsOf("plush_drag_end"), "2回目のドラッグが記録されていない").toHaveLength(2);
  });
});
