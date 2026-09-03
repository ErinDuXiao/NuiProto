import { useEffect, type RefObject } from "react";
import { individuality } from "./pose";

export type AmbientTarget = {
  uid: string;
  seed: number;
  /** 棚上の水平位置。隣を見る演出の向き判定に使う */
  x: number;
  shelfRow: number;
};

type Registry = RefObject<Map<string, SVGGElement | null>>;

type Life = {
  seed: number;
  breathPeriod: number;
  breathPhase: number;
  blinkBase: number;
  nextBlink: number;
  blinkUntil: number;
  nextGlance: number;
  glanceUntil: number;
  glanceDir: number;
};

const BLINK_MS = 90;
const GLANCE_MS = 1500;

function makeLife(seed: number, now: number): Life {
  const iv = individuality(seed);
  return {
    seed,
    breathPeriod: iv.breathPeriod * 1000,
    breathPhase: iv.chatty * Math.PI * 2,
    blinkBase: iv.blinkBase * 1000,
    nextBlink: now + iv.blinkBase * 1000 * (0.4 + iv.linePick * 0.6),
    blinkUntil: 0,
    nextGlance: now + 12000 + iv.linePick * 8000,
    glanceUntil: 0,
    glanceDir: 0,
  };
}

/**
 * 棚のぬいぐるみに生活感を与える（仕様 6.1 / 依頼書 13 章）。
 *
 * 呼吸・瞬き・隣を見る動きを、単一の rAF ループから DOM 属性の直接書き換えで行う。
 * **React の再レンダーを一切発生させない。** 12匹が同時に呼吸していても
 * コンポーネントツリーは静止したままになる。
 *
 * ceremony 再生中やアーケード画面では enabled=false にして完全に止める。
 * ポーズを props で制御したい場面と、このフックは同時に使わない。
 */
export function useAmbientLife(
  registry: Registry,
  targets: AmbientTarget[],
  enabled: boolean
): void {
  // targets は毎レンダー新しい配列になるので、比較用のキーで依存を安定させる
  const key = targets.map((t) => `${t.uid}:${t.seed.toFixed(4)}:${t.x}:${t.shelfRow}`).join("|");

  useEffect(() => {
    if (!enabled) return;
    if (typeof requestAnimationFrame !== "function") return;

    const list = targets.filter((t) => t.shelfRow >= 0);
    if (list.length === 0) return;

    const now = performance.now();
    const lives = new Map<string, Life>(list.map((t) => [t.uid, makeLife(t.seed, now)]));

    // 隣にいる子。いなければ null
    const neighborDir = new Map<string, number>();
    for (const t of list) {
      const sameRow = list.filter((o) => o.uid !== t.uid && o.shelfRow === t.shelfRow);
      if (sameRow.length === 0) continue;
      let best = sameRow[0];
      for (const o of sameRow) {
        if (Math.abs(o.x - t.x) < Math.abs(best.x - t.x)) best = o;
      }
      neighborDir.set(t.uid, Math.sign(best.x - t.x));
    }

    let raf = 0;
    let running = true;

    const frame = (t: number) => {
      if (!running) return;
      const map = registry.current;
      if (map) {
        for (const target of list) {
          const el = map.get(target.uid);
          const life = lives.get(target.uid);
          if (!el || !life) continue;

          // 呼吸: 個体ごとに位相をずらしたごく小さな上下
          const breath = Math.sin((t / life.breathPeriod) * Math.PI * 2 + life.breathPhase);
          const sy = 1 + breath * 0.014;
          const sx = 1 - breath * 0.009;
          el.setAttribute(
            "transform",
            `translate(${target.x} 0) scale(${sx.toFixed(4)} ${sy.toFixed(4)})`
          );

          // 瞬き
          if (t >= life.nextBlink) {
            life.blinkUntil = t + BLINK_MS;
            life.nextBlink = t + life.blinkBase * (0.7 + Math.random() * 0.9);
          }
          const blinking = t < life.blinkUntil;
          for (const eye of el.querySelectorAll<SVGEllipseElement>('[data-part="eye"]')) {
            const base = eye.dataset.baseRy ?? eye.getAttribute("ry") ?? "3.4";
            eye.dataset.baseRy = base;
            eye.setAttribute("ry", blinking ? "0.7" : base);
          }

          // 隣を見る
          const dir = neighborDir.get(target.uid) ?? 0;
          if (dir !== 0 && t >= life.nextGlance) {
            life.glanceUntil = t + GLANCE_MS;
            life.glanceDir = dir;
            life.nextGlance = t + 12000 + Math.random() * 8000;
          }
          const face = el.querySelector<SVGGElement>('[data-part="face"]');
          if (face) {
            let look = 0;
            if (t < life.glanceUntil) {
              // 出入りをなめらかにする台形カーブ
              const p = 1 - (life.glanceUntil - t) / GLANCE_MS;
              const ease = Math.min(1, Math.min(p, 1 - p) * 5);
              look = life.glanceDir * ease * 3.2;
            }
            face.setAttribute("transform", `translate(${look.toFixed(2)} 0)`);
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // targets は key で同一性を判定する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, registry]);
}
