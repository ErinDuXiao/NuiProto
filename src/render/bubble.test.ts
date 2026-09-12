import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
  placeBubble,
  bubbleBoxes,
  plushFaceBox,
  UNKNOWN_FACE,
  type BubbleBox,
  type BubbleBounds,
  type BubbleNeighbor,
  type BubblePlacement,
} from "./bubble";
import { PlushSVG } from "./PlushSVG";
import { applyIndividuality, individuality, plushTopOf, NEUTRAL_POSE, type Pose } from "./pose";
import { getPlush, PLUSHIES } from "../data/plushies";
import { LINES } from "../data/lines";
import { MOODS, lineKeyFor, watcherPose } from "../arcade/watcherState";
import { Watcher, WATCHER_VIEW } from "../arcade/Watcher";
import { SHELF, rowY } from "../shelf/shelfLayout";
import { ceremonyAt, type CeremonyPhase } from "../shelf/ceremonyTimeline";
import { CeremonyActors, type Ceremony } from "../shelf/MeetingCeremony";
import { ShelfScreen } from "../shelf/ShelfScreen";
import { store } from "../state/store";
import { SLOT_SPACING, SLOT_X0 } from "../state/persist";
import type { PlushDef, PlushInstance } from "../state/types";

const bounds = { minX: 0, maxX: 320, minY: 0 };

describe("placeBubble", () => {
  it("通常は頭の上に出る", () => {
    const r = placeBubble({ anchorX: 160, headTopY: 200, textWidth: 100, bounds, others: [] });
    expect(r.below).toBe(false);
    expect(r.y).toBeLessThan(200);
  });

  it("上端に近ければ下側へ回す（画面外に出ない）", () => {
    const r = placeBubble({ anchorX: 160, headTopY: 10, textWidth: 100, bounds, others: [] });
    expect(r.below).toBe(true);
    expect(r.y).toBeGreaterThanOrEqual(bounds.minY);
  });

  it("左右の端をはみ出さない", () => {
    for (const x of [0, 5, 315, 320]) {
      const r = placeBubble({ anchorX: x, headTopY: 200, textWidth: 140, bounds, others: [] });
      expect(r.x - 70).toBeGreaterThanOrEqual(bounds.minX);
      expect(r.x + 70).toBeLessThanOrEqual(bounds.maxX);
    }
  });

  it("他の子の顔に被らないよう横へずらす", () => {
    const others = [{ x: 160, headTopY: 150 }];
    const clean = placeBubble({ anchorX: 160, headTopY: 250, textWidth: 100, bounds, others: [] });
    const avoid = placeBubble({ anchorX: 160, headTopY: 250, textWidth: 100, bounds, others });
    expect(avoid.x).not.toBeCloseTo(clean.x, 1);
  });

  it("どの入力でも有限の値を返す", () => {
    for (const anchorX of [-1000, 0, 160, 5000, Number.NaN]) {
      for (const headTopY of [-500, 0, 300, Number.NaN]) {
        const r = placeBubble({ anchorX, headTopY, textWidth: 100, bounds, others: [] });
        expect(Number.isFinite(r.x)).toBe(true);
        expect(Number.isFinite(r.y)).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 「顔に被らない」を本当に検証するための道具
 *
 * WHY: 上の5件は依頼書が指定した最小限で、**顔に被っても落ちない**。
 * 「8px ずらしただけで顔を完全に覆っている」実装も
 * 「吹き出しの箱が画面外へ出ている」実装も通ってしまう（`x` が動いたか、
 * アンカー点が範囲内か、しか見ていない）。実際そのせいで、上に出せる場面で
 * 下へ回して目の上に吹き出しを乗せる回帰がそのまま出荷された。
 * 以下は「吹き出しの箱（絵として描かれる矩形）が、顔の箱と交差しない」
 * ことを直接主張する。
 * ------------------------------------------------------------------ */

/** PlushSVG の SHAPE_RATIO の写し。下の「実際に描く目と一致する」テストが見張る。 */
const SHAPE_RATIO: Record<PlushDef["art"]["shape"], { x: number; y: number }> = {
  round: { x: 1.0, y: 1.0 },
  pear: { x: 0.92, y: 1.04 },
  long: { x: 0.8, y: 1.18 },
  blob: { x: 1.1, y: 0.88 },
};

/**
 * 個体差を反映した定義のメモ。総当たりで同じ (種類, seed) を何十万回も引くので、
 * 色計算まで含む `applyIndividuality` を毎回走らせない（値は同じ）。
 */
const INDIV = new Map<string, PlushDef>();
function indiv(def: PlushDef, seed: number): PlushDef {
  const key = `${def.id}:${seed}`;
  let d = INDIV.get(key);
  if (!d) {
    d = applyIndividuality(def, seed);
    INDIV.set(key, d);
  }
  return d;
}
const TOPS = new Map<string, number>();
function topOf(def: PlushDef, seed: number): number {
  const key = `${def.id}:${seed}`;
  let t = TOPS.get(key);
  if (t === undefined) {
    t = plushTopOf(def, seed);
    TOPS.set(key, t);
  }
  return t;
}

/**
 * 目の外接矩形（足元原点、上が負）。PlushSVG が実際に目を描く式と同じ。
 * `pose.hop` は PlushSVG が外側の `<g translate(0 -hop)>` で掛けるので、
 * ここでも引く。
 */
function eyeBox(def: PlushDef, pose: Pose, seed: number): BubbleBox {
  const d = indiv(def, seed);
  const r = d.size;
  const ratio = SHAPE_RATIO[d.art.shape];
  const rx = r * ratio.x * (2 - pose.squash);
  const ry = r * ratio.y * pose.squash;
  const cy = -ry;
  const eyeR = 3.4;
  // 目を閉じているときは高さ 1.6 の線（<rect y={eyeY-0.8} height={1.6}>）になる。
  const eyeRy = pose.eyeOpen > 0.08 ? eyeR * pose.eyeOpen : 0.8;
  const eyeY = cy - ry * 0.14;
  const eyeX = rx * 0.32;
  const eyeDx = pose.lookAt * rx * 0.12;
  return {
    left: -eyeX + eyeDx - eyeR,
    right: eyeX + eyeDx + eyeR,
    top: eyeY - eyeRy - pose.hop,
    bottom: eyeY + eyeRy - pose.hop,
  };
}

/**
 * `pose.tilt` は胴の中心を軸にした回転なので、目は主に左右へ振れる
 * （最大 12° ・軸から約 40px で 8px 強）。上端が持ち上がる量は 1px 未満。
 * 回転行列をテストに書き写す代わりに、その分を顔の箱に足して安全側へ倒す。
 */
const TILT_MARGIN_X = 9;
const TILT_MARGIN_Y = 2;

/** 呼び出し側の絶対座標での顔（目）の当たり判定。 */
function faceBox(def: PlushDef, pose: Pose, seed: number, ox: number, oy: number): BubbleBox {
  const e = eyeBox(def, pose, seed);
  return {
    left: ox + e.left - TILT_MARGIN_X,
    right: ox + e.right + TILT_MARGIN_X,
    top: oy + e.top - TILT_MARGIN_Y,
    bottom: oy + e.bottom + TILT_MARGIN_Y,
  };
}

function intersects(a: BubbleBox, b: BubbleBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 箱が `bounds` の内側に収まっているか（下端は `bounds` が持たないので見ない）。 */
function insideBounds(b: BubbleBox, bx: BubbleBounds): boolean {
  const eps = 1e-9;
  return b.left >= bx.minX - eps && b.right <= bx.maxX + eps && b.top >= bx.minY - eps;
}

/** 個体差の拡縮が最小 / 最大になる seed。±5% の両端を実際に踏むため。 */
function seedsAtScaleExtremes(): { minSeed: number; maxSeed: number; min: number; max: number } {
  let minSeed = 0;
  let maxSeed = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 3000; i++) {
    const seed = i / 3000;
    const s = individuality(seed).scale;
    if (s < min) {
      min = s;
      minSeed = seed;
    }
    if (s > max) {
      max = s;
      maxSeed = seed;
    }
  }
  return { minSeed, maxSeed, min, max };
}

const EXTREMES = seedsAtScaleExtremes();
/** 個体差の両端と真ん中。 */
const SEEDS = [EXTREMES.minSeed, 0.5, EXTREMES.maxSeed];
/** 個体差の両端だけ。頭の高さも目の位置もサイズに対して単調なので、両端が最悪になる。 */
const EXTREME_SEEDS = [EXTREMES.minSeed, EXTREMES.maxSeed];

/** 実際のセリフから、呼び出し側と同じ式で吹き出しの幅を出す（重複は畳む）。 */
function widthsOf(lines: readonly string[], cap: number, perChar: number, pad: number): number[] {
  return [...new Set(lines.map((t) => Math.min(cap, t.length * perChar + pad)))].sort(
    (a, b) => a - b
  );
}

/**
 * 1回の配置を検査して、破れた約束を `fail` に積む。
 *
 * 1. 本体が `faces` のどれとも交差しない（顔に掛からない）。
 * 2. しっぽ込みの外接矩形が `bounds` の内側にある。
 * 3. **回避しなくても誰の顔にも掛からないなら、1px も動いていない。**
 *    （Finding 3: 重なっていないのに押しのけるのは、顔を守ることにならず、
 *    吹き出しを喋っている子から引き離すだけ。）
 *
 * 何十万回も回すので `expect` は最後に1回だけ呼ぶ（戻り値は「動いたか」）。
 */
function audit(
  fail: string[],
  where: string,
  p: BubblePlacement,
  still: BubblePlacement,
  w: number,
  faces: BubbleBox[],
  bx: BubbleBounds
): boolean {
  const push = (msg: string) => {
    if (fail.length < 20) fail.push(msg);
  };
  const { body, outer } = bubbleBoxes(p, w);
  faces.forEach((f, i) => {
    if (intersects(body, f)) push(`顔[${i}]に被った: ${where}`);
  });
  if (!insideBounds(outer, bx)) push(`範囲外へ出た: ${where}`);
  if (p.below !== still.below) push(`上下が他の子に左右された: ${where}`);
  const moved = p.x !== still.x || p.y !== still.y;
  const stillBody = bubbleBoxes(still, w).body;
  if (moved && faces.every((f) => !intersects(stillBody, f))) {
    push(`被っていないのに動いた: ${where} (${still.x},${still.y})→(${p.x},${p.y})`);
  }
  return moved;
}

describe("顔の当たり判定（テストの土台）", () => {
  it("個体差の両端 ±5% を本当に踏んでいる", () => {
    expect(EXTREMES.min).toBeLessThan(0.951);
    expect(EXTREMES.max).toBeGreaterThan(1.049);
  });

  it("目の当たり判定は PlushSVG が実際に描く目と一致する", () => {
    const poses: Pose[] = [
      NEUTRAL_POSE,
      { ...NEUTRAL_POSE, squash: 1.06, eyeOpen: 1.35, hop: 13 },
      { ...NEUTRAL_POSE, squash: 0.72, eyeOpen: 0.5, lookAt: -1 },
      { ...NEUTRAL_POSE, eyeOpen: 0, lookAt: 1 },
    ];
    for (const def of PLUSHIES) {
      for (const seed of SEEDS) {
        for (const pose of poses) {
          const { container } = render(
            createElement("svg", null, createElement(PlushSVG, { def, pose, seed }))
          );
          const open = Array.from(container.querySelectorAll('[data-part="eye"]'));
          const shut = Array.from(container.querySelectorAll('[data-part="eyelid"]'));
          const num = (el: Element, a: string) => Number(el.getAttribute(a));
          let top: number;
          let bottom: number;
          let left: number;
          let right: number;
          if (open.length > 0) {
            expect(open.length).toBe(2);
            top = Math.min(...open.map((e) => num(e, "cy") - num(e, "ry")));
            bottom = Math.max(...open.map((e) => num(e, "cy") + num(e, "ry")));
            left = Math.min(...open.map((e) => num(e, "cx") - num(e, "rx")));
            right = Math.max(...open.map((e) => num(e, "cx") + num(e, "rx")));
          } else {
            expect(shut.length).toBe(2);
            top = Math.min(...shut.map((e) => num(e, "y")));
            bottom = Math.max(...shut.map((e) => num(e, "y") + num(e, "height")));
            left = Math.min(...shut.map((e) => num(e, "x")));
            right = Math.max(...shut.map((e) => num(e, "x") + num(e, "width")));
          }
          cleanup();
          const e = eyeBox(def, pose, seed);
          const where = `${def.id} seed=${seed} eyeOpen=${pose.eyeOpen}`;
          // hop は外側の <g> の transform なので属性には出ない。足して比べる。
          expect(e.top + pose.hop, `top ${where}`).toBeCloseTo(top, 6);
          expect(e.bottom + pose.hop, `bottom ${where}`).toBeCloseTo(bottom, 6);
          expect(e.left, `left ${where}`).toBeCloseTo(left, 6);
          expect(e.right, `right ${where}`).toBeCloseTo(right, 6);

          // 本番の回避が使う顔の箱（`plushFaceBox`）も、描かれた目から直接
          // 導いた箱と一致すること。回避側の写しがずれると、避けているつもりの
          // 顔と描かれている顔が静かに食い違う。
          const prod = plushFaceBox(def, seed, pose, 0, 0);
          expect(prod.top, `本番 top ${where}`).toBeCloseTo(top - pose.hop - TILT_MARGIN_Y, 6);
          expect(prod.bottom, `本番 bottom ${where}`).toBeCloseTo(
            bottom - pose.hop + TILT_MARGIN_Y,
            6
          );
          expect(prod.left, `本番 left ${where}`).toBeCloseTo(left - TILT_MARGIN_X, 6);
          expect(prod.right, `本番 right ${where}`).toBeCloseTo(right + TILT_MARGIN_X, 6);
        }
      }
    }
  });

  /**
   * `{ x, headTopY }` だけを渡された相手は、種類が分からないので
   * `UNKNOWN_FACE` で見る。その箱がどれかの顔からはみ出していれば、
   * 「分からない相手」の顔には吹き出しが乗りうる。実際に使われる姿勢を
   * 全部集めて、カタログの全種類で確かめる。
   */
  it("種類の分からない相手の箱（UNKNOWN_FACE）は、どの種類のどの姿勢の顔も覆う", () => {
    const poses: Pose[] = [NEUTRAL_POSE, { ...NEUTRAL_POSE, squash: 1.06, tilt: -4 }];
    // 棚のタップの潰れ（ShelfScreen.poseFor）。
    for (let t = 0; t < 1; t += 0.05) {
      poses.push({ ...NEUTRAL_POSE, squash: 0.85 + 0.15 * t + Math.sin(t * Math.PI * 2) * 0.06 });
    }
    for (const mood of MOODS) {
      for (let t = 0; t <= 3000; t += 25) poses.push(watcherPose(mood, t));
    }
    for (const first of [true, false]) {
      for (let t = 0; t <= 4200; t += 20) {
        for (const lookDir of [-1, 1]) {
          const { hostPose, guestPose } = ceremonyPoses(ceremonyAt(t, first), lookDir);
          poses.push(hostPose, guestPose);
        }
      }
    }
    const fail: string[] = [];
    for (const def of PLUSHIES) {
      for (const seed of SEEDS) {
        for (const pose of poses) {
          const head = topOf(def, seed) - pose.hop;
          const f = faceBox(def, pose, seed, 0, 0);
          if (
            f.top - head < UNKNOWN_FACE.top ||
            f.bottom - head > UNKNOWN_FACE.bottom ||
            -f.left > UNKNOWN_FACE.halfW ||
            f.right > UNKNOWN_FACE.halfW
          ) {
            if (fail.length < 10) {
              fail.push(
                `${def.id} seed=${seed} ${JSON.stringify(pose)}: top=${f.top - head} bottom=${f.bottom - head} halfW=${Math.max(-f.left, f.right)}`
              );
            }
          }
        }
      }
    }
    expect(fail).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 見守り（クレーン画面）
 * 天井が近い唯一の呼び出し元で、上下の切り替えが日常的に踏まれる。
 * ------------------------------------------------------------------ */

const WATCHER_BOUNDS: BubbleBounds = {
  minX: 0,
  maxX: WATCHER_VIEW.width,
  minY: -WATCHER_VIEW.baseY,
};
/** 跳ねのピークを含む時刻（grabbed は 224ms、success は 285ms あたりが頂点）。 */
const WATCHER_ELAPSED = [0, 100, 224, 285, 374, 600, 1000, 1800];
/** Watcher.tsx の `Math.min(170, text.length * 13 + 22)` が取りうる幅。 */
const WATCHER_WIDTHS = [48, 100, 170];

function watcherPlacement(def: PlushDef, seed: number, pose: Pose, textWidth: number) {
  const headTopY = plushTopOf(def, seed) - pose.hop;
  return placeBubble({
    anchorX: WATCHER_VIEW.x,
    headTopY,
    textWidth,
    bounds: WATCHER_BOUNDS,
    others: [],
  });
}

describe("見守りの吹き出し", () => {
  it("どの種類・どの個体差・どのムードでも、顔に掛からず画面内に収まる", () => {
    for (const def of PLUSHIES) {
      for (const seed of SEEDS) {
        for (const mood of MOODS) {
          for (const t of WATCHER_ELAPSED) {
            const pose = watcherPose(mood, t);
            for (const w of WATCHER_WIDTHS) {
              const p = watcherPlacement(def, seed, pose, w);
              const { body, outer } = bubbleBoxes(p, w);
              const face = faceBox(def, pose, seed, WATCHER_VIEW.x, 0);
              const where = `${def.id} seed=${seed} ${mood}@${t}ms w=${w} below=${p.below}`;
              expect(intersects(body, face), `顔に被った: ${where}`).toBe(false);
              expect(insideBounds(outer, WATCHER_BOUNDS), `画面外へ出た: ${where}`).toBe(true);
            }
          }
        }
      }
    }
  });

  /**
   * 回帰の直撃点。クマはスターター＝既定の見守り役で、`craneIdle` は
   * アーケードに入って最初に出るセリフ。ここが下側に回ると、初回プレイの
   * 一発目から吹き出しが目に乗る。あざらしとペンギンは目が完全に隠れていた。
   */
  it("クマ・あざらし・ペンギンは頭の上に出る（下側へ回さない）", () => {
    for (const id of ["bear_01", "seal_01", "penguin_01"]) {
      const def = getPlush(id);
      for (const seed of SEEDS) {
        for (const mood of MOODS) {
          for (const t of WATCHER_ELAPSED) {
            const pose = watcherPose(mood, t);
            const p = watcherPlacement(def, seed, pose, 170);
            expect(p.below, `${id} seed=${seed} ${mood}@${t}ms`).toBe(false);
          }
        }
      }
    }
  });

  /**
   * 呼び出し側の配線を押さえる。`placeBubble` にいくら正しい判断をさせても、
   * 渡す `headTopY` が素の `plushTop(def)`（個体差の拡縮を含まない値）だと、
   * 頭上の余白を最大 5% ぶん多く見積もる。クマで約4px、天井が近い見守りでは
   * それが上下の分岐を変えるので、実際に描かれた吹き出しの y で確かめる。
   */
  it("Watcher は個体差の拡縮を含めた頭のてっぺんを渡している", () => {
    for (const def of PLUSHIES) {
      for (const seed of [EXTREMES.minSeed, EXTREMES.maxSeed]) {
        const plush = {
          instanceId: "w1",
          plushTypeId: def.id,
          acquiredAt: null,
          attemptsToAcquire: null,
          witnessedBy: null,
          origin: "starter" as const,
          x: 0,
          shelfRow: 0,
          personalitySeed: seed,
        };
        const { container } = render(
          createElement(
            "svg",
            null,
            createElement(Watcher, { plush, mood: "idle" as const, elapsed: 0, moodCount: 0 })
          )
        );
        const text = container.querySelector("text");
        expect(text, `セリフが出ていない: ${def.id}`).not.toBeNull();
        const transform = text?.parentElement?.getAttribute("transform") ?? "";
        const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform);
        expect(m, `transform を読めない: ${transform}`).not.toBeNull();
        const drawnY = Number(m?.[2]);
        cleanup();

        const w = Math.min(170, (text?.textContent?.length ?? 0) * 13 + 22);
        const expected = watcherPlacement(def, seed, watcherPose("idle", 0), w);
        expect(drawnY, `${def.id} seed=${seed}`).toBeCloseTo(expected.y, 6);
      }
    }
  });

  it("耳の長い子は下側へ回るが、そのときも目より上に出る", () => {
    // ミルクラビットは耳のぶん頭のてっぺんが 105px まで届き、天井まで 7px しか
    // 残らない。下側へ回しても、耳の付け根あたり＝目よりずっと上に出る。
    const def = getPlush("rabbit_01");
    const pose = watcherPose("success", 285);
    const p = watcherPlacement(def, EXTREMES.maxSeed, pose, 170);
    expect(p.below).toBe(true);
    const { body } = bubbleBoxes(p, 170);
    const face = faceBox(def, pose, EXTREMES.maxSeed, WATCHER_VIEW.x, 0);
    expect(body.bottom).toBeLessThan(face.top);
  });
});

/* ------------------------------------------------------------------ *
 * 棚と出会いの演出
 * ------------------------------------------------------------------ */

const SHELF_BOUNDS: BubbleBounds = { minX: 0, maxX: SHELF.width, minY: 0 };
/** 実際のスロット（`persist.ts` が唯一の定義）。 */
const SLOTS = [0, 1, 2].map((i) => SLOT_X0 + i * SLOT_SPACING);
/** 棚の全スロット（最上段・両端の列を含む）。 */
const ALL_SLOTS = [0, 1, 2, 3].flatMap((row) => SLOTS.map((x) => ({ x, row })));

type Actor = { def: PlushDef; seed: number; x: number; row: number };

function shelfFace(a: Actor, pose: Pose): BubbleBox {
  return faceBox(a.def, pose, a.seed, a.x, rowY(a.row));
}

function shelfHeadTop(a: Actor, hop = 0): number {
  return rowY(a.row) + topOf(a.def, a.seed) - hop;
}

/** 本番の呼び出し側（ShelfScreen / MeetingCeremony）が `others` に渡すもの。 */
function neighborOf(a: Actor, pose: Pose): BubbleNeighbor {
  return { face: plushFaceBox(a.def, a.seed, pose, a.x, rowY(a.row)) };
}

/** タップのリアクションの幅（`ShelfScreen` の `Math.min(150, len*12+20)`）。 */
const SHELF_WIDTHS = [44, 92, 150];
/** 実際のタップのセリフが取る幅。 */
const SHELF_TOUCH_WIDTHS = widthsOf(LINES.shelfTouch, 150, 12, 20);
/** 出会いの演出のセリフが取る幅（`MeetingCeremony` の `Math.min(160, len*13+22)`）。 */
const HOST_WIDTHS = widthsOf(LINES.welcomeHost, 160, 13, 22);
const GUEST_WIDTHS = widthsOf(LINES.welcomeGuest, 160, 13, 22);

/** `CeremonyActors` と同じ姿勢の組み立て（テスト側の独立した写し）。 */
function ceremonyPoses(phase: CeremonyPhase, lookDir: number): { hostPose: Pose; guestPose: Pose } {
  return {
    hostPose: {
      ...NEUTRAL_POSE,
      lookAt: phase.hostLook * lookDir,
      tilt: phase.hostLook * lookDir * 5,
      hop: phase.hostHop,
    },
    guestPose: {
      ...NEUTRAL_POSE,
      squash: phase.guestSquash,
      hop: phase.guestDrop + phase.guestHop,
      lookAt: phase.guestHop > 0 ? -lookDir * 0.6 : 0,
    },
  };
}

describe("棚の吹き出し", () => {
  it("最上段でも顔に掛からず、部屋の中に収まる", () => {
    for (const def of PLUSHIES) {
      for (const seed of SEEDS) {
        for (const x of SLOTS) {
          const actor: Actor = { def, seed, x, row: 0 };
          for (const w of SHELF_WIDTHS) {
            const p = placeBubble({
              anchorX: x,
              headTopY: shelfHeadTop(actor),
              textWidth: w,
              bounds: SHELF_BOUNDS,
              others: [],
            });
            const { body, outer } = bubbleBoxes(p, w);
            const where = `${def.id} seed=${seed} x=${x} w=${w}`;
            expect(p.below, `最上段で下へ回った: ${where}`).toBe(false);
            expect(intersects(body, shelfFace(actor, NEUTRAL_POSE)), `顔に被った: ${where}`).toBe(
              false
            );
            expect(insideBounds(outer, SHELF_BOUNDS), `部屋の外へ出た: ${where}`).toBe(true);
          }
        }
      }
    }
  });

  it("段が満席（3匹）でも、誰の顔にも掛からず部屋の中に収まる", () => {
    for (const row of [0, 1, 2, 3]) {
      const actors: Actor[] = SLOTS.map((x, i) => ({
        def: PLUSHIES[i * 3],
        seed: SEEDS[i],
        x,
        row,
      }));
      for (const speaker of actors) {
        for (const w of SHELF_WIDTHS) {
          const p = placeBubble({
            anchorX: speaker.x,
            headTopY: shelfHeadTop(speaker),
            textWidth: w,
            bounds: SHELF_BOUNDS,
            others: actors
              .filter((a) => a !== speaker)
              .map((a) => ({ x: a.x, headTopY: shelfHeadTop(a) })),
          });
          const { body, outer } = bubbleBoxes(p, w);
          const where = `row=${row} x=${speaker.x} w=${w}`;
          for (const a of actors) {
            expect(intersects(body, shelfFace(a, NEUTRAL_POSE)), `${a.def.id} の顔に被った: ${where}`)
              .toBe(false);
          }
          expect(insideBounds(outer, SHELF_BOUNDS), `部屋の外へ出た: ${where}`).toBe(true);
        }
      }
    }
  });

  /**
   * 【2026-09-12 書き換え】以前の名前は「端の子は内側の子から離れる方（＝壁側）へ
   * 逃げる」で、端の子の吹き出しが動く（`pl.x < left.x` / `pr.x > right.x`）ことを
   * 要求していた。だが同じ段に並んだ子の目は、上に出した吹き出しの本体より
   * 必ず下にある（本体の下端は自分の頭のてっぺんの 9px 上、隣の目の上端は
   * 隣の頭のてっぺんの 14px 以上下で、同じ段なら頭の高さの差を足しても
   * 交差しない）。つまりこの配置に重なりは無く、あの主張は「代理指標が被って
   * いると誤判定して押しのける」挙動をそのまま正解として固定していた。
   * 本当に守りたいのは「誰の顔にも掛からない」と「掛からないなら動かない」
   * なので、それを全員・全幅で直接主張する（真ん中の子が動かないという
   * 元の主張はそのまま含まれる）。
   */
  it("同じ段に並んだだけの子は、端でも真ん中でも吹き出しが動かず、誰の顔にも掛からない", () => {
    const actors: Actor[] = SLOTS.map((x, i) => ({ def: PLUSHIES[i], seed: SEEDS[i], x, row: 1 }));
    for (const self of actors) {
      for (const w of [...SHELF_WIDTHS, ...SHELF_TOUCH_WIDTHS]) {
        const opts = {
          anchorX: self.x,
          headTopY: shelfHeadTop(self),
          textWidth: w,
          bounds: SHELF_BOUNDS,
        };
        const still = placeBubble({ ...opts, others: [] });
        const p = placeBubble({
          ...opts,
          others: actors.filter((a) => a !== self).map((a) => neighborOf(a, NEUTRAL_POSE)),
        });
        const where = `${self.def.id} x=${self.x} w=${w}`;
        expect(p, `重なっていないのに動いた: ${where}`).toEqual(still);
        expect(p.x, where).toBeCloseTo(self.x, 6);
        const { body } = bubbleBoxes(p, w);
        for (const a of actors) {
          expect(intersects(body, shelfFace(a, NEUTRAL_POSE)), `${a.def.id} の顔に被った: ${where}`)
            .toBe(false);
        }
      }
    }
  });

  /**
   * この機能が存在する理由そのもの。実際に最初に起きる配置
   * （スターターのクマ = スロット0、新入り = スロット1、同じ段）で、
   * 演出の全フレームにわたって吹き出しが二匹のどちらの顔にも掛からないこと。
   *
   * 【2026-09-12 書き換え】以前はここで「相手から離れる方へ寄っていること」
   * （先輩は x < 78、新入りは x > 160）を要求していた。だがこの配置では
   * 上に出した本体は相手の目より上にあり、そもそも重なっていない。
   * あの主張は、代理指標（先端 y と相手の頭の距離 < 90px）が「被っている」と
   * 誤判定して何にも被っていない吹き出しを 78→63、160→192 と押しのけて
   * いた挙動を、正しいものとして固定していた。
   * 顔に掛からないことの主張はそのまま残し、代わりに「回避しなくても
   * 掛からないのだから、1px も動かない（78 と 160 のまま）」を主張する。
   */
  it("出会いの演出（実際の配置）: 全フレームでどちらの顔にも掛からず、要らない回避をしない", () => {
    const host: Actor = { def: getPlush("bear_01"), seed: SEEDS[0], x: SLOTS[0], row: 0 };
    const guest: Actor = { def: getPlush("penguin_01"), seed: SEEDS[2], x: SLOTS[1], row: 0 };
    const lookDir = Math.sign(guest.x - host.x) || 1;
    let sawHostLine = false;
    let sawGuestLine = false;

    for (const first of [true, false]) {
      for (let t = 0; t <= 4200; t += 20) {
        const phase = ceremonyAt(t, first);
        const { hostPose, guestPose } = ceremonyPoses(phase, lookDir);
        const hostTopY = shelfHeadTop(host, phase.hostHop);
        const guestTopY = shelfHeadTop(guest, phase.guestHop);

        const speak = phase.hostLine
          ? { text: phase.hostLine, self: host, selfTop: hostTopY, other: guest, otherPose: guestPose }
          : phase.guestLine
            ? { text: phase.guestLine, self: guest, selfTop: guestTopY, other: host, otherPose: hostPose }
            : null;
        if (!speak) continue;
        if (phase.hostLine) sawHostLine = true;
        else sawGuestLine = true;

        const w = Math.min(160, speak.text.length * 13 + 22);
        const opts = {
          anchorX: speak.self.x,
          headTopY: speak.selfTop,
          textWidth: w,
          bounds: SHELF_BOUNDS,
        };
        const p = placeBubble({ ...opts, others: [neighborOf(speak.other, speak.otherPose)] });
        const { body, outer } = bubbleBoxes(p, w);
        const where = `first=${first} t=${t} speaker=${speak.self.def.id}`;
        expect(intersects(body, shelfFace(host, hostPose)), `先輩の顔に被った: ${where}`).toBe(false);
        expect(intersects(body, shelfFace(guest, guestPose)), `新入りの顔に被った: ${where}`).toBe(
          false
        );
        expect(insideBounds(outer, SHELF_BOUNDS), `部屋の外へ出た: ${where}`).toBe(true);
        expect(p.below, `下へ回った: ${where}`).toBe(false);

        // 回避しなくても顔に掛からない（この配置の前提）。だから動いてはいけない。
        const still = placeBubble({ ...opts, others: [] });
        const stillBody = bubbleBoxes(still, w).body;
        expect(
          intersects(stillBody, shelfFace(speak.other, speak.otherPose)),
          `前提が崩れた（回避しないと相手の顔に掛かる）: ${where}`
        ).toBe(false);
        expect(p, `被っていないのに動いた: ${where}`).toEqual(still);
        expect(p.x, `喋っている子の真上から動いた: ${where}`).toBe(speak.self.x);
      }
    }

    // 両方のセリフを本当に踏んだことを確かめる（窓がずれたら空振りになる）。
    expect(sawHostLine).toBe(true);
    expect(sawGuestLine).toBe(true);
    expect([SLOTS[0], SLOTS[1]]).toEqual([78, 160]);
  });
});

/* ------------------------------------------------------------------ *
 * 回避が「本当に要るとき」に働くこと（Finding 3）
 *
 * 重なっていないときに動かないだけなら、回避を丸ごと消した実装も通る。
 * 実際に起きる配置で、回避しないと顔に乗ることを前提として確かめた上で、
 * 回避が働いて顔から外れることを主張する。
 * ------------------------------------------------------------------ */

/**
 * スターターから始めて、実際の獲得（`store.grantPlush` → `findSlot`）で
 * 並べたときの位置。seed は位置に関係しないので、位置だけを借りる。
 */
function layoutFromStore(typeIds: string[]): { id: string; x: number; row: number }[] {
  localStorage.clear();
  store.resetAll();
  for (const id of typeIds) store.grantPlush(id);
  return store
    .get()
    .instances.map((o) => ({ id: o.plushTypeId, x: o.x, row: o.shelfRow }));
}

describe("回避は本物の重なりがあるときに働く", () => {
  /**
   * 耳の長いミルクラビットは頭のてっぺんが足元から 95〜105px 上にあり、
   * 上に出した吹き出しの本体はさらに 9〜35px 上 — ちょうど真上の段
   * （102px 上）の子の目の高さに届く。スターターの下の段が埋まったあとの
   * 4匹目は、必ず真上の段の左端に置かれる（`findSlot`）ので、よく起きる配置。
   */
  it("背の高い子の真上の段に子が1匹いるとき: 横へずらして顔から外す", () => {
    const layout = layoutFromStore(["fox_01", "rabbit_01", "jellyfish_01"]);
    const rabbitAt = layout.find((o) => o.id === "rabbit_01");
    const jellyAt = layout.find((o) => o.id === "jellyfish_01");
    expect(rabbitAt, "前提: ミルクラビットが棚にいる").toBeDefined();
    expect(jellyAt, "前提: くらげが棚にいる").toBeDefined();
    expect(jellyAt?.row, "前提: くらげはミルクラビットの真上の段").toBe((rabbitAt?.row ?? 0) - 1);
    expect(jellyAt?.x, "前提: くらげはミルクラビットの真上").toBe(rabbitAt?.x);

    let fired = 0;
    for (const rs of EXTREME_SEEDS) {
      for (const js of EXTREME_SEEDS) {
        const actors: Actor[] = layout.map((o, i) => ({
          def: getPlush(o.id),
          seed: o.id === "rabbit_01" ? rs : o.id === "jellyfish_01" ? js : SEEDS[i % 3],
          x: o.x,
          row: o.row,
        }));
        const rabbit = actors.find((a) => a.def.id === "rabbit_01") as Actor;
        const jelly = actors.find((a) => a.def.id === "jellyfish_01") as Actor;
        for (const w of SHELF_TOUCH_WIDTHS) {
          const opts = {
            anchorX: rabbit.x,
            headTopY: shelfHeadTop(rabbit),
            textWidth: w,
            bounds: SHELF_BOUNDS,
          };
          const still = placeBubble({ ...opts, others: [] });
          const where = `rabbit seed=${rs} jelly seed=${js} w=${w}`;
          expect(
            intersects(bubbleBoxes(still, w).body, shelfFace(jelly, NEUTRAL_POSE)),
            `前提: 回避しなければくらげの目に乗る: ${where}`
          ).toBe(true);

          const p = placeBubble({
            ...opts,
            others: actors.filter((a) => a !== rabbit).map((a) => neighborOf(a, NEUTRAL_POSE)),
          });
          const { body, outer } = bubbleBoxes(p, w);
          for (const a of actors) {
            expect(intersects(body, shelfFace(a, NEUTRAL_POSE)), `${a.def.id} の顔に被った: ${where}`)
              .toBe(false);
          }
          expect(insideBounds(outer, SHELF_BOUNDS), `部屋の外へ出た: ${where}`).toBe(true);
          // 上の段にはくらげ1匹だけなので、横に逃げ場がある。高さは変えない。
          expect(p.y, `横で逃げられるのに下げた: ${where}`).toBe(still.y);
          expect(p.x, `動かなかった: ${where}`).not.toBe(still.x);
          fired++;
        }
      }
    }
    expect(fired).toBeGreaterThan(0);
  });

  it("真上の段が埋まっていて横に逃げ場が無いとき: 自分の頭の方へ下げて顔から外す", () => {
    const layout = layoutFromStore(["fox_01", "rabbit_01", "frog_01", "duck_01", "jellyfish_01"]);
    const rabbitAt = layout.find((o) => o.id === "rabbit_01");
    expect(rabbitAt, "前提: ミルクラビットが棚にいる").toBeDefined();
    const above = layout.filter((o) => o.row === (rabbitAt?.row ?? 0) - 1);
    expect(above.length, "前提: 真上の段が満席").toBe(3);

    for (const rs of EXTREME_SEEDS) {
      for (const os of EXTREME_SEEDS) {
        const actors: Actor[] = layout.map((o) => ({
          def: getPlush(o.id),
          seed: o.id === "rabbit_01" ? rs : os,
          x: o.x,
          row: o.row,
        }));
        const rabbit = actors.find((a) => a.def.id === "rabbit_01") as Actor;
        const w = Math.max(...SHELF_TOUCH_WIDTHS);
        const opts = {
          anchorX: rabbit.x,
          headTopY: shelfHeadTop(rabbit),
          textWidth: w,
          bounds: SHELF_BOUNDS,
        };
        const where = `rabbit seed=${rs} others seed=${os} w=${w}`;
        const still = placeBubble({ ...opts, others: [] });
        const stillBody = bubbleBoxes(still, w).body;
        expect(
          actors.some((a) => a !== rabbit && intersects(stillBody, shelfFace(a, NEUTRAL_POSE))),
          `前提: 回避しなければ上の段の目に乗る: ${where}`
        ).toBe(true);

        const p = placeBubble({
          ...opts,
          others: actors.filter((a) => a !== rabbit).map((a) => neighborOf(a, NEUTRAL_POSE)),
        });
        const { body, outer } = bubbleBoxes(p, w);
        for (const a of actors) {
          expect(intersects(body, shelfFace(a, NEUTRAL_POSE)), `${a.def.id} の顔に被った: ${where}`)
            .toBe(false);
        }
        // 下げた分だけ自分の顔に近づくので、タップで潰れた瞬間
        // （ShelfScreen.poseFor の t=0、潰れるのは触られた本人だけ）の顔でも確かめる。
        expect(
          intersects(body, shelfFace(rabbit, { ...NEUTRAL_POSE, squash: 0.85 })),
          `潰れた自分の顔に被った: ${where}`
        ).toBe(false);
        expect(insideBounds(outer, SHELF_BOUNDS), `部屋の外へ出た: ${where}`).toBe(true);
        expect(p.y, `下げなかった: ${where}`).toBeGreaterThan(still.y);
        // 下げてよいのは、本体の下端が頭のてっぺんから 10px（HEAD_ROOM）食い込むまで。
        expect(body.bottom, `頭に食い込みすぎた: ${where}`).toBeLessThanOrEqual(
          shelfHeadTop(rabbit) + 10 + 1e-9
        );
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 棚のタップと出会いの演出を、全10種で総当たりする（Finding 2a）
 * ------------------------------------------------------------------ */

describe("全種類の総当たり（棚のタップ・出会いの演出）", () => {
  it("棚のタップ: 全10種 × 個体差の両端 × 全段・全列、隣が誰でも顔に掛からず、要らないときは動かない", () => {
    const fail: string[] = [];
    let fired = 0;
    let cases = 0;
    for (const sDef of PLUSHIES) {
      for (const sSeed of EXTREME_SEEDS) {
        for (const sPos of ALL_SLOTS) {
          const speaker: Actor = { def: sDef, seed: sSeed, x: sPos.x, row: sPos.row };
          const head = shelfHeadTop(speaker);
          const selfFace = shelfFace(speaker, NEUTRAL_POSE);
          const stills = SHELF_TOUCH_WIDTHS.map((w) =>
            placeBubble({ anchorX: speaker.x, headTopY: head, textWidth: w, bounds: SHELF_BOUNDS, others: [] })
          );
          for (const nDef of PLUSHIES) {
            for (const nSeed of EXTREME_SEEDS) {
              for (const nPos of ALL_SLOTS) {
                if (nPos.row === sPos.row && nPos.x === sPos.x) continue;
                const nb: Actor = { def: nDef, seed: nSeed, x: nPos.x, row: nPos.row };
                const faces = [selfFace, shelfFace(nb, NEUTRAL_POSE)];
                const others = [neighborOf(nb, NEUTRAL_POSE)];
                SHELF_TOUCH_WIDTHS.forEach((w, wi) => {
                  const p = placeBubble({
                    anchorX: speaker.x,
                    headTopY: head,
                    textWidth: w,
                    bounds: SHELF_BOUNDS,
                    others,
                  });
                  const where = `${sDef.id}(seed=${sSeed}) @row${sPos.row},x${sPos.x} / ${nDef.id}(seed=${nSeed}) @row${nPos.row},x${nPos.x} w=${w}`;
                  if (audit(fail, where, p, stills[wi], w, faces, SHELF_BOUNDS)) fired++;
                  cases++;
                });
              }
            }
          }
        }
      }
    }
    expect(fail).toEqual([]);
    // 回避が一度も働かない総当たりは、「動かない」側しか見ていないことになる。
    expect(fired, `回避が働いた件数 / ${cases}`).toBeGreaterThan(0);
  });

  it("棚のタップ: 棚が満席（全種類を順にずらして並べる）でも、誰の顔にも掛からず、要らないときは動かない", () => {
    const fail: string[] = [];
    let fired = 0;
    for (let offset = 0; offset < PLUSHIES.length; offset++) {
      for (const parity of [0, 1]) {
        const actors: Actor[] = ALL_SLOTS.map((s, k) => ({
          def: PLUSHIES[(k + offset) % PLUSHIES.length],
          seed: EXTREME_SEEDS[(k + parity) % 2],
          x: s.x,
          row: s.row,
        }));
        const faces = actors.map((a) => shelfFace(a, NEUTRAL_POSE));
        const neighbors = actors.map((a) => neighborOf(a, NEUTRAL_POSE));
        actors.forEach((speaker, i) => {
          for (const w of SHELF_TOUCH_WIDTHS) {
            const opts = {
              anchorX: speaker.x,
              headTopY: shelfHeadTop(speaker),
              textWidth: w,
              bounds: SHELF_BOUNDS,
            };
            const still = placeBubble({ ...opts, others: [] });
            const p = placeBubble({ ...opts, others: neighbors.filter((_, j) => j !== i) });
            const where = `offset=${offset} parity=${parity} ${speaker.def.id} @row${speaker.row},x${speaker.x} w=${w}`;
            if (audit(fail, where, p, still, w, faces, SHELF_BOUNDS)) fired++;
          }
        });
      }
    }
    expect(fail).toEqual([]);
    expect(fired).toBeGreaterThan(0);
  });

  /**
   * 迎える側（先輩）は新入りの最近傍（`pickHost`）。同じ段の隣だけでなく、
   * 段の最初の子として置かれた新入りの真上の子が先輩になる（コスト 400 の
   * 段違いでも、同じ段に誰もいなければ最近傍になる）ので、縦に重なる配置も
   * 実際に起きる。
   */
  it("出会いの演出: 全10種 × 全10種 × 個体差の両端 × 並び方、全フレームで顔に掛からず、要らないときは動かない", () => {
    const placements: { name: string; host: [number, number]; guest: [number, number] }[] = [
      { name: "同じ段・先輩が左端", host: [0, 0], guest: [0, 1] },
      { name: "同じ段・先輩が右端", host: [0, 2], guest: [0, 1] },
      { name: "同じ段・新入りが右端", host: [0, 1], guest: [0, 2] },
      { name: "同じ段・新入りが左端", host: [0, 1], guest: [0, 0] },
      { name: "新入りが先輩の真下（左端の列）", host: [0, 0], guest: [1, 0] },
      { name: "新入りが先輩の真下（右端の列）", host: [0, 2], guest: [1, 2] },
      { name: "新入りが先輩の真上（最上段）", host: [1, 1], guest: [0, 1] },
      { name: "最下段", host: [3, 1], guest: [3, 2] },
    ];
    // セリフが出ているフレームだけを集める。跳ねの頂点は刻みに乗らないことがあるので足す。
    const frames: { first: boolean; t: number; phase: CeremonyPhase }[] = [];
    for (const first of [true, false]) {
      const ts = new Set<number>([1210, 2000, 2400, 830, 1162.5, 1387.5]);
      for (let t = 0; t <= 4200; t += 40) ts.add(t);
      for (const t of ts) {
        const phase = ceremonyAt(t, first);
        if (phase.hostLine || phase.guestLine) frames.push({ first, t, phase });
      }
    }
    expect(frames.some((f) => f.phase.hostLine), "先輩のセリフを踏んでいない").toBe(true);
    expect(frames.some((f) => f.phase.guestLine && !f.phase.hostLine), "新入りのセリフを踏んでいない").toBe(
      true
    );

    const fail: string[] = [];
    let fired = 0;
    for (const pl of placements) {
      for (const hDef of PLUSHIES) {
        for (const gDef of PLUSHIES) {
          for (const hSeed of EXTREME_SEEDS) {
            for (const gSeed of EXTREME_SEEDS) {
              const host: Actor = { def: hDef, seed: hSeed, x: SLOTS[pl.host[1]], row: pl.host[0] };
              const guest: Actor = { def: gDef, seed: gSeed, x: SLOTS[pl.guest[1]], row: pl.guest[0] };
              const lookDir = Math.sign(guest.x - host.x) || 1;
              for (const { first, t, phase } of frames) {
                const { hostPose, guestPose } = ceremonyPoses(phase, lookDir);
                const hostSpeaks = Boolean(phase.hostLine);
                const self = hostSpeaks ? host : guest;
                const other = hostSpeaks ? guest : host;
                const selfTop = shelfHeadTop(self, hostSpeaks ? phase.hostHop : phase.guestHop);
                const others = [neighborOf(other, hostSpeaks ? guestPose : hostPose)];
                const faces = [shelfFace(host, hostPose), shelfFace(guest, guestPose)];
                for (const w of hostSpeaks ? HOST_WIDTHS : GUEST_WIDTHS) {
                  const opts = { anchorX: self.x, headTopY: selfTop, textWidth: w, bounds: SHELF_BOUNDS };
                  const still = placeBubble({ ...opts, others: [] });
                  const p = placeBubble({ ...opts, others });
                  const where = `${pl.name} host=${hDef.id}(${hSeed}) guest=${gDef.id}(${gSeed}) first=${first} t=${t} ${hostSpeaks ? "host" : "guest"} w=${w}`;
                  if (audit(fail, where, p, still, w, faces, SHELF_BOUNDS)) fired++;
                }
              }
            }
          }
        }
      }
    }
    expect(fail).toEqual([]);
    expect(fired).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * 実際に描かれた吹き出し（Finding 2b）
 *
 * 上の総当たりは「吹き出しの箱」を `bubbleBoxes()` で計算している。
 * 描画側の JSX が `bubbleShape()` から離れても、`bubbleBoxes` と描画側が
 * 揃って間違った方へ変わっても、計算上の箱は正しいままなので何も落ちない。
 * そこで3箇所を実際にレンダリングし、DOM の `<rect>` と しっぽの `<path>` を
 * 読んで、(1) テストが仮定している箱と一致すること、(2) 描かれた本体そのものが
 * 顔（テスト側の独立した写しの顔の箱）に掛からず範囲内にあること、を直接見る。
 * ------------------------------------------------------------------ */

type Drawn = { text: string; body: BubbleBox; outer: BubbleBox };

/** `<text>` を含む吹き出しの `<g>` を読んで、絶対座標の本体・外接矩形にする。 */
function readBubbles(root: ParentNode): Drawn[] {
  return Array.from(root.querySelectorAll("text")).map((t) => {
    const g = t.parentElement;
    const transform = g?.getAttribute("transform") ?? "";
    const m = /translate\(\s*([^\s,)]+)[\s,]+([^\s,)]+)\s*\)/.exec(transform);
    const rect = g?.querySelector("rect");
    const path = g?.querySelector("path");
    if (!g || !m || !rect || !path) {
      throw new Error(`吹き出しの形を読めない: transform="${transform}" rect=${!!rect} path=${!!path}`);
    }
    const tx = Number(m[1]);
    const ty = Number(m[2]);
    const attr = (el: Element, a: string) => Number(el.getAttribute(a));
    const body: BubbleBox = {
      left: tx + attr(rect, "x"),
      right: tx + attr(rect, "x") + attr(rect, "width"),
      top: ty + attr(rect, "y"),
      bottom: ty + attr(rect, "y") + attr(rect, "height"),
    };
    const nums = (path.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)?.map(Number) ?? [];
    const xs = nums.filter((_, i) => i % 2 === 0).map((v) => tx + v);
    const ys = nums.filter((_, i) => i % 2 === 1).map((v) => ty + v);
    const values = [...xs, ...ys, ...Object.values(body)];
    if (xs.length < 3 || values.some((v) => !Number.isFinite(v))) {
      throw new Error(`吹き出しの寸法が数値でない: ${transform} d="${path.getAttribute("d")}"`);
    }
    return {
      text: t.textContent ?? "",
      body,
      outer: {
        left: Math.min(body.left, ...xs),
        right: Math.max(body.right, ...xs),
        top: Math.min(body.top, ...ys),
        bottom: Math.max(body.bottom, ...ys),
      },
    };
  });
}

function boxesClose(a: BubbleBox, b: BubbleBox): boolean {
  const eps = 1e-6;
  return (
    Math.abs(a.left - b.left) < eps &&
    Math.abs(a.right - b.right) < eps &&
    Math.abs(a.top - b.top) < eps &&
    Math.abs(a.bottom - b.bottom) < eps
  );
}

/** 描かれた吹き出しを、テストの仮定・顔・範囲と突き合わせる。 */
function auditDrawn(
  fail: string[],
  where: string,
  drawn: Drawn,
  p: BubblePlacement,
  w: number,
  faces: BubbleBox[],
  bx: BubbleBounds
): void {
  const push = (msg: string) => {
    if (fail.length < 20) fail.push(msg);
  };
  const expected = bubbleBoxes(p, w);
  if (!boxesClose(drawn.body, expected.body)) {
    push(`本体が仮定とずれた: ${where} drawn=${JSON.stringify(drawn.body)} expected=${JSON.stringify(expected.body)}`);
  }
  if (!boxesClose(drawn.outer, expected.outer)) {
    push(`しっぽ込みの外形が仮定とずれた: ${where} drawn=${JSON.stringify(drawn.outer)} expected=${JSON.stringify(expected.outer)}`);
  }
  faces.forEach((f, i) => {
    if (intersects(drawn.body, f)) push(`描かれた本体が顔[${i}]に被った: ${where}`);
  });
  if (!insideBounds(drawn.outer, bx)) push(`描かれた吹き出しが範囲外へ出た: ${where}`);
}

function instanceOf(id: string, def: PlushDef, seed: number, x: number, row: number): PlushInstance {
  return {
    instanceId: id,
    plushTypeId: def.id,
    acquiredAt: null,
    attemptsToAcquire: null,
    witnessedBy: null,
    origin: "starter",
    x,
    shelfRow: row,
    personalitySeed: seed,
  };
}

describe("実際に描かれた吹き出し（DOM）", () => {
  it("見守り: 描かれた本体・しっぽが仮定どおりで、顔に掛からず画面内にある", () => {
    const fail: string[] = [];
    let seen = 0;
    for (const def of PLUSHIES) {
      for (const seed of EXTREME_SEEDS) {
        for (const mood of MOODS) {
          if (lineKeyFor(mood) === null) continue;
          for (const t of [0, 224, 285, 1000]) {
            const plush = instanceOf("w1", def, seed, 0, 0);
            const { container } = render(
              createElement("svg", null, createElement(Watcher, { plush, mood, elapsed: t, moodCount: 0 }))
            );
            const drawn = readBubbles(container);
            cleanup();
            const where = `${def.id} seed=${seed} ${mood}@${t}ms`;
            if (drawn.length !== 1) {
              fail.push(`吹き出しが1つでない (${drawn.length}): ${where}`);
              continue;
            }
            const pose = watcherPose(mood, t);
            const w = Math.min(170, drawn[0].text.length * 13 + 22);
            const p = watcherPlacement(def, seed, pose, w);
            const faces = [faceBox(def, pose, seed, WATCHER_VIEW.x, 0)];
            auditDrawn(fail, where, drawn[0], p, w, faces, WATCHER_BOUNDS);
            seen++;
          }
        }
      }
    }
    expect(fail).toEqual([]);
    expect(seen).toBeGreaterThan(0);
  });

  it("出会いの演出: 描かれた本体・しっぽが仮定どおりで、どちらの顔にも掛からず、回避の配線が効いている", () => {
    const configs = [
      // 実際に最初に起きる配置。回避は要らない。
      {
        name: "スターターのクマ + 隣のペンギン",
        host: instanceOf("h", getPlush("bear_01"), SEEDS[0], SLOTS[0], 0),
        guest: instanceOf("g", getPlush("penguin_01"), SEEDS[2], SLOTS[1], 0),
        mustFire: false,
      },
      // 新入り（ミルクラビット）が先輩（カエル）の真下。新入りのセリフで回避が要る。
      {
        name: "カエルの真下に来たミルクラビット",
        host: instanceOf("h", getPlush("frog_01"), EXTREMES.minSeed, SLOTS[0], 0),
        guest: instanceOf("g", getPlush("rabbit_01"), EXTREMES.maxSeed, SLOTS[0], 1),
        mustFire: true,
      },
      // 先輩（ミルクラビット）の真上に新入り（あひる）。先輩のセリフで回避が要る。
      {
        name: "ミルクラビットの真上に来たあひる",
        host: instanceOf("h", getPlush("rabbit_01"), EXTREMES.maxSeed, SLOTS[1], 1),
        guest: instanceOf("g", getPlush("duck_01"), EXTREMES.minSeed, SLOTS[1], 0),
        mustFire: true,
      },
    ];
    const fail: string[] = [];
    for (const c of configs) {
      const hostDef = getPlush(c.host.plushTypeId);
      const guestDef = getPlush(c.guest.plushTypeId);
      const host: Actor = { def: hostDef, seed: c.host.personalitySeed, x: c.host.x, row: c.host.shelfRow };
      const guest: Actor = { def: guestDef, seed: c.guest.personalitySeed, x: c.guest.x, row: c.guest.shelfRow };
      const lookDir = Math.sign(guest.x - host.x) || 1;
      let moved = 0;
      let frames = 0;
      let i = 0;
      for (const first of [true, false]) {
        for (let t = 0; t <= 4200; t += 100) {
          // セリフを順に替えて、実際に出る幅を全部踏む。
          const lines = {
            host: LINES.welcomeHost[i % LINES.welcomeHost.length],
            guest: LINES.welcomeGuest[i % LINES.welcomeGuest.length],
          };
          const phase = ceremonyAt(t, first, lines);
          if (!phase.hostLine && !phase.guestLine) continue;
          i++;
          const ceremony: Ceremony = {
            active: true,
            phase,
            host: c.host,
            guest: c.guest,
            stagedIds: new Set([c.host.instanceId, c.guest.instanceId]),
            skip: () => {},
          };
          const { container } = render(
            createElement("svg", null, createElement(CeremonyActors, { ceremony }))
          );
          const drawn = readBubbles(container);
          cleanup();
          const where = `${c.name} first=${first} t=${t}`;
          if (drawn.length !== 1) {
            fail.push(`吹き出しが1つでない (${drawn.length}): ${where}`);
            continue;
          }
          const { hostPose, guestPose } = ceremonyPoses(phase, lookDir);
          const hostSpeaks = Boolean(phase.hostLine);
          const self = hostSpeaks ? host : guest;
          const other = hostSpeaks ? guest : host;
          const w = Math.min(160, drawn[0].text.length * 13 + 22);
          const opts = {
            anchorX: self.x,
            headTopY: shelfHeadTop(self, hostSpeaks ? phase.hostHop : phase.guestHop),
            textWidth: w,
            bounds: SHELF_BOUNDS,
          };
          const p = placeBubble({ ...opts, others: [neighborOf(other, hostSpeaks ? guestPose : hostPose)] });
          const faces = [shelfFace(host, hostPose), shelfFace(guest, guestPose)];
          auditDrawn(fail, where, drawn[0], p, w, faces, SHELF_BOUNDS);
          const still = bubbleBoxes(placeBubble({ ...opts, others: [] }), w).body;
          if (!boxesClose(drawn[0].body, still)) moved++;
          frames++;
        }
      }
      if (frames === 0) fail.push(`セリフのフレームを踏んでいない: ${c.name}`);
      if (c.mustFire && moved === 0) fail.push(`回避が要る配置で、描かれた吹き出しが一度も動かなかった: ${c.name}`);
      if (!c.mustFire && moved > 0) fail.push(`回避が要らない配置で、描かれた吹き出しが動いた (${moved}): ${c.name}`);
    }
    expect(fail).toEqual([]);
  });

  describe("棚のタップ", () => {
    const VIEW_H = SHELF.height + 53;

    beforeEach(() => {
      localStorage.clear();
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
      });
      vi.setSystemTime(1_800_000_000_000);
      // 環境アニメーションの rAF は走らせない。走ると呼吸や視線で顔が動き、
      // 描かれた位置とテストの仮定（中立の姿勢）がずれる。
      vi.stubGlobal("requestAnimationFrame", () => 1);
      vi.stubGlobal("cancelAnimationFrame", () => {});
      // jsdom の getBoundingClientRect は 0 を返す。viewBox と 1:1 に合わせる。
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
      // 個体の seed を実行ごとに変えない（落ちたときに再現できるように）。
      let n = 0;
      vi.spyOn(Math, "random").mockImplementation(() => {
        n += 1;
        return (n * 0.6180339887498949) % 1;
      });
    });

    afterEach(() => {
      cleanup();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    /** jsdom には PointerEvent が無い。MouseEvent に pointerId を足して代用する。 */
    function pointer(type: string, x: number, y: number): Event {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(e, "pointerId", { value: 1 });
      return e;
    }

    it("描かれた本体・しっぽが仮定どおりで、誰の顔にも掛からず、上の段の顔を避ける配線が効いている", () => {
      store.resetAll();
      for (const id of ["fox_01", "rabbit_01", "frog_01", "duck_01", "jellyfish_01"]) {
        store.grantPlush(id);
      }
      const onShelf = store.get().instances.filter((o) => o.shelfRow >= 0);
      const rabbitInst = onShelf.find((o) => o.plushTypeId === "rabbit_01");
      expect(rabbitInst, "前提: ミルクラビットが棚にいる").toBeDefined();
      expect(
        onShelf.some((o) => o.shelfRow === (rabbitInst?.shelfRow ?? 0) - 1 && o.x === rabbitInst?.x),
        "前提: ミルクラビットの真上の段に子がいる"
      ).toBe(true);

      const actors = onShelf.map((o) => ({
        inst: o,
        actor: { def: getPlush(o.plushTypeId), seed: o.personalitySeed, x: o.x, row: o.shelfRow },
      }));
      const fail: string[] = [];
      let rabbitMoved = false;

      actors.forEach(({ inst, actor }, index) => {
        const { container } = render(
          createElement(ShelfScreen, { onGoArcade: () => {}, onShare: () => {}, onSecretTap: () => {} })
        );
        const room = container.querySelector("svg.room");
        const handles = room ? Array.from(room.querySelectorAll("g[style]")) : [];
        const handle = handles[index];
        if (!room || handles.length !== actors.length || !handle) {
          fail.push(`棚の子を掴めない: ${inst.plushTypeId} handles=${handles.length}`);
          cleanup();
          return;
        }
        const cy = rowY(inst.shelfRow) - 20;
        act(() => {
          handle.dispatchEvent(pointer("pointerdown", inst.x, cy));
        });
        act(() => {
          window.dispatchEvent(pointer("pointermove", inst.x + 2, cy));
        });
        act(() => {
          window.dispatchEvent(pointer("pointerup", inst.x + 2, cy));
        });
        const drawn = readBubbles(room);
        cleanup();

        const where = `${inst.plushTypeId} seed=${inst.personalitySeed} @row${inst.shelfRow},x${inst.x}`;
        if (drawn.length !== 1) {
          fail.push(`タップで吹き出しが1つ出ていない (${drawn.length}): ${where}`);
          return;
        }
        const w = Math.min(150, drawn[0].text.length * 12 + 20);
        const opts = {
          anchorX: inst.x,
          headTopY: shelfHeadTop(actor),
          textWidth: w,
          bounds: SHELF_BOUNDS,
        };
        const p = placeBubble({
          ...opts,
          others: actors.filter((a) => a.inst !== inst).map((a) => neighborOf(a.actor, NEUTRAL_POSE)),
        });
        const faces = [
          ...actors.map((a) => shelfFace(a.actor, NEUTRAL_POSE)),
          // タップした本人はその瞬間に潰れている（ShelfScreen.poseFor の t=0）。
          shelfFace(actor, { ...NEUTRAL_POSE, squash: 0.85 }),
        ];
        auditDrawn(fail, where, drawn[0], p, w, faces, SHELF_BOUNDS);

        if (inst === rabbitInst) {
          const still = bubbleBoxes(placeBubble({ ...opts, others: [] }), w).body;
          const upper = actors.filter((a) => a.inst.shelfRow === inst.shelfRow - 1);
          if (!upper.some((a) => intersects(still, shelfFace(a.actor, NEUTRAL_POSE)))) {
            fail.push(`前提: 回避しなければ上の段の目に乗るはず: ${where}`);
          }
          rabbitMoved = !boxesClose(drawn[0].body, still);
        }
      });

      expect(fail).toEqual([]);
      expect(rabbitMoved, "上の段の目に乗る配置なのに、描かれた吹き出しが動いていない").toBe(true);
    });
  });
});
