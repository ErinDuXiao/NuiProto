import { useCallback, useEffect, useRef, useState } from "react";
import { getPlush } from "../data/plushies";
import { store } from "../state/store";
import type { PlushInstance } from "../state/types";
import { rowFromY, snapPlacement, SHELF, type Placed } from "./shelfLayout";

/** ここを超えて動いたらドラッグ。それ未満はタップ（リアクション）。 */
const DRAG_THRESHOLD = 4;

export type DragState = {
  instanceId: string;
  x: number;
  shelfRow: number;
  /** 元の位置。置けなかったときに戻す先 */
  fromX: number;
  fromRow: number;
  moved: boolean;
} | null;

type Options = {
  instances: PlushInstance[];
  /** SVG 要素。画面座標を viewBox 座標に変換するのに使う */
  svgRef: React.RefObject<SVGSVGElement>;
  enabled: boolean;
  /** ドラッグにならなかった場合（タップ）に呼ばれる */
  onTap: (instanceId: string) => void;
};

/**
 * 棚のドラッグ配置（仕様 9 章）。
 *
 * マウスとタッチをポインタイベントで共通に扱う。指が要素の外に出ても
 * 追従するよう setPointerCapture を使い、ドラッグ中はページのスクロールを止める。
 *
 * 4px 動くまではタップとして扱う。ぬいぐるみを撫でる操作と
 * 動かす操作を取り違えないため。
 */
export function useDragPlacement({ instances, svgRef, enabled, onTap }: Options) {
  const [drag, setDrag] = useState<DragState>(null);
  const startRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  /** 掴んでいる指の識別子。2本目の指に乗っ取られないようにする */
  const pointerIdRef = useRef<number | null>(null);
  const dragRef = useRef<DragState>(null);
  dragRef.current = drag;

  /** 画面座標を SVG の viewBox 座標へ移す。 */
  const toLocal = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const vw = SHELF.width;
      const vh = SHELF.height + 53;
      // viewBox は preserveAspectRatio の既定 (xMidYMid meet) で収まっている
      const scale = Math.min(rect.width / vw, rect.height / vh);
      const offX = (rect.width - vw * scale) / 2;
      const offY = (rect.height - vh * scale) / 2;
      return {
        x: (clientX - rect.left - offX) / scale,
        y: (clientY - rect.top - offY) / scale,
      };
    },
    [svgRef]
  );

  const onPointerDown = useCallback(
    (instanceId: string, e: React.PointerEvent) => {
      if (!enabled) return;
      // 既に別の指で掴んでいる。2本目は無視する。
      if (pointerIdRef.current !== null) return;
      const target = instances.find((o) => o.instanceId === instanceId);
      if (!target || target.shelfRow < 0) return;
      const local = toLocal(e.clientX, e.clientY);
      if (!local) return;

      // 実ポインタでない場合など、捕捉できないことがある。
      // 捕捉できなくてもドラッグ自体は window のイベントで成立する。
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // noop
      }
      pointerIdRef.current = e.pointerId;
      startRef.current = { px: local.x, py: local.y, ox: target.x, oy: target.shelfRow };
      setDrag({
        instanceId,
        x: target.x,
        shelfRow: target.shelfRow,
        fromX: target.x,
        fromRow: target.shelfRow,
        moved: false,
      });
    },
    [enabled, instances, toLocal]
  );

  useEffect(() => {
    if (!drag) return;

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerIdRef.current) return;
      const start = startRef.current;
      const cur = dragRef.current;
      if (!start || !cur) return;
      const local = toLocal(e.clientX, e.clientY);
      if (!local) return;

      const dx = local.x - start.px;
      const dy = local.y - start.py;
      const moved = cur.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
      if (!moved) return;

      e.preventDefault();
      setDrag({
        ...cur,
        moved: true,
        x: start.ox + dx,
        shelfRow: rowFromY(SHELF.rowY[start.oy] + dy),
      });
    };

    /**
     * 指が離れた。掴んでいた指のものだけを見る。
     * @param commit 配置を確定するか。pointercancel では確定しない。
     */
    const end = (e: PointerEvent, commit: boolean) => {
      if (e.pointerId !== pointerIdRef.current) return;
      const cur = dragRef.current;
      pointerIdRef.current = null;
      startRef.current = null;
      setDrag(null);
      if (!cur) return;

      // ブラウザにジェスチャを奪われた場合。撫でたことにも、
      // 動かしたことにもせず、何もなかったことにする。
      if (!commit) return;

      if (!cur.moved) {
        onTap(cur.instanceId);
        return;
      }

      // Placed.uid は棚の配置計算だけが使う識別子。個体の instanceId をそのまま渡す。
      const def = getPlush(
        instances.find((o) => o.instanceId === cur.instanceId)?.plushTypeId ?? "bear_01"
      );
      const others: Placed[] = instances
        .filter((o) => o.shelfRow >= 0 && o.instanceId !== cur.instanceId)
        .map((o) => ({
          uid: o.instanceId,
          x: o.x,
          shelfRow: o.shelfRow,
          r: getPlush(o.plushTypeId).size,
        }));

      const placed = snapPlacement(cur.instanceId, cur.x, cur.shelfRow, def.size, others);
      if (placed.reverted) {
        // どこにも置けない。元の位置へ戻す。無言で消したり重ねたりしない。
        store.movePlush(cur.instanceId, cur.fromX, cur.fromRow);
      } else {
        store.movePlush(cur.instanceId, placed.x, placed.shelfRow);
      }
    };

    const onUp = (e: PointerEvent) => end(e, true);
    const onCancel = (e: PointerEvent) => end(e, false);

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      // ドラッグ中にアンマウントされた場合、掴んだ指を解放しておく
      pointerIdRef.current = null;
    };
  }, [drag !== null, instances, toLocal, onTap]);

  return { onPointerDown, drag };
}
