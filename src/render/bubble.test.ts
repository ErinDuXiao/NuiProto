import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { placeBubble, bubbleBoxes, type BubbleBox, type BubbleBounds } from "./bubble";
import { PlushSVG } from "./PlushSVG";
import { applyIndividuality, individuality, plushTopOf, NEUTRAL_POSE, type Pose } from "./pose";
import { getPlush, PLUSHIES } from "../data/plushies";
import { MOODS, watcherPose } from "../arcade/watcherState";
import { Watcher, WATCHER_VIEW } from "../arcade/Watcher";
import { SHELF, rowY } from "../shelf/shelfLayout";
import { ceremonyAt } from "../shelf/ceremonyTimeline";
import { SLOT_SPACING, SLOT_X0 } from "../state/persist";
import type { PlushDef } from "../state/types";

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
 * 目の外接矩形（足元原点、上が負）。PlushSVG が実際に目を描く式と同じ。
 * `pose.hop` は PlushSVG が外側の `<g translate(0 -hop)>` で掛けるので、
 * ここでも引く。
 */
function eyeBox(def: PlushDef, pose: Pose, seed: number): BubbleBox {
  const d = applyIndividuality(def, seed);
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
        }
      }
    }
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

type Actor = { def: PlushDef; seed: number; x: number; row: number };

function shelfFace(a: Actor, pose: Pose): BubbleBox {
  return faceBox(a.def, pose, a.seed, a.x, rowY(a.row));
}

function shelfHeadTop(a: Actor, hop = 0): number {
  return rowY(a.row) + plushTopOf(a.def, a.seed) - hop;
}

/** タップのリアクションの幅（`ShelfScreen` の `Math.min(150, len*12+20)`）。 */
const SHELF_WIDTHS = [44, 92, 150];

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

  it("端の子は内側の子から離れる方（＝壁側）へ逃げる", () => {
    const actors: Actor[] = SLOTS.map((x, i) => ({ def: PLUSHIES[i], seed: SEEDS[i], x, row: 1 }));
    const others = (self: Actor) =>
      actors.filter((a) => a !== self).map((a) => ({ x: a.x, headTopY: shelfHeadTop(a) }));

    const left = actors[0];
    const pl = placeBubble({
      anchorX: left.x,
      headTopY: shelfHeadTop(left),
      textWidth: 150,
      bounds: SHELF_BOUNDS,
      others: others(left),
    });
    expect(pl.x).toBeLessThan(left.x);

    const right = actors[2];
    const pr = placeBubble({
      anchorX: right.x,
      headTopY: shelfHeadTop(right),
      textWidth: 150,
      bounds: SHELF_BOUNDS,
      others: others(right),
    });
    expect(pr.x).toBeGreaterThan(right.x);

    // 真ん中の子は左右対称に挟まれているので、どちらへ動いても片方へ近づく。
    // 動かないのが正解。
    const mid = actors[1];
    const pm = placeBubble({
      anchorX: mid.x,
      headTopY: shelfHeadTop(mid),
      textWidth: 150,
      bounds: SHELF_BOUNDS,
      others: others(mid),
    });
    expect(pm.x).toBeCloseTo(mid.x, 6);
  });

  /**
   * この機能が存在する理由そのもの。実際に最初に起きる配置
   * （スターターのクマ = スロット0、新入り = スロット1、同じ段）で、
   * 演出の全フレームにわたって吹き出しが二匹のどちらの顔にも掛からないこと。
   */
  it("出会いの演出（実際の配置）: 全フレームでどちらの顔にも掛からない", () => {
    const host: Actor = { def: getPlush("bear_01"), seed: SEEDS[0], x: SLOTS[0], row: 0 };
    const guest: Actor = { def: getPlush("penguin_01"), seed: SEEDS[2], x: SLOTS[1], row: 0 };
    const lookDir = Math.sign(guest.x - host.x) || 1;
    let sawHostLine = false;
    let sawGuestLine = false;

    for (const first of [true, false]) {
      for (let t = 0; t <= 4200; t += 20) {
        const phase = ceremonyAt(t, first);
        const hostPose: Pose = {
          ...NEUTRAL_POSE,
          lookAt: phase.hostLook * lookDir,
          tilt: phase.hostLook * lookDir * 5,
          hop: phase.hostHop,
        };
        const guestPose: Pose = {
          ...NEUTRAL_POSE,
          squash: phase.guestSquash,
          hop: phase.guestDrop + phase.guestHop,
          lookAt: phase.guestHop > 0 ? -lookDir * 0.6 : 0,
        };
        const hostTopY = shelfHeadTop(host, phase.hostHop);
        const guestTopY = shelfHeadTop(guest, phase.guestHop);

        const speak = phase.hostLine
          ? { text: phase.hostLine, self: host, selfTop: hostTopY, otherTop: guestTopY, other: guest }
          : phase.guestLine
            ? { text: phase.guestLine, self: guest, selfTop: guestTopY, otherTop: hostTopY, other: host }
            : null;
        if (!speak) continue;
        if (phase.hostLine) sawHostLine = true;
        else sawGuestLine = true;

        const w = Math.min(160, speak.text.length * 13 + 22);
        const p = placeBubble({
          anchorX: speak.self.x,
          headTopY: speak.selfTop,
          textWidth: w,
          bounds: SHELF_BOUNDS,
          others: [{ x: speak.other.x, headTopY: speak.otherTop }],
        });
        const { body, outer } = bubbleBoxes(p, w);
        const where = `first=${first} t=${t} speaker=${speak.self.def.id}`;
        expect(intersects(body, shelfFace(host, hostPose)), `先輩の顔に被った: ${where}`).toBe(false);
        expect(intersects(body, shelfFace(guest, guestPose)), `新入りの顔に被った: ${where}`).toBe(
          false
        );
        expect(insideBounds(outer, SHELF_BOUNDS), `部屋の外へ出た: ${where}`).toBe(true);
        expect(p.below, `下へ回った: ${where}`).toBe(false);

        // 相手から離れる方へ寄っていること。隣のスロットは 82px しか離れて
        // いないので完全には避けられないが、「避けようとして何もしない」の
        // ままにはしない（Task 8 初版はここが恒久的に空振りしていた）。
        if (speak.self === host) expect(p.x, `寄らなかった: ${where}`).toBeLessThan(host.x);
        else expect(p.x, `寄らなかった: ${where}`).toBeGreaterThan(guest.x);
      }
    }

    // 両方のセリフを本当に踏んだことを確かめる（窓がずれたら空振りになる）。
    expect(sawHostLine).toBe(true);
    expect(sawGuestLine).toBe(true);
  });
});
