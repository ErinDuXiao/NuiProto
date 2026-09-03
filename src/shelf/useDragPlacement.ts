import { useCallback, useEffect, useRef, useState } from "react";
import { getPlush } from "../data/plushies";
import { store } from "../state/store";
import type { OwnedPlush } from "../state/types";
import { rowFromY, snapPlacement, SHELF, type Placed } from "./shelfLayout";

/** ここを超えて動いたらドラッグ。それ未満はタップ（リアクション）。 */
const DRAG_THRESHOLD = 4;

export type DragState = {
  uid: string;
  x: number;
  shelfRow: number;
  /** 元の位置。置けなかったときに戻す先 */
  fromX: number;
  fromRow: number;
  moved: boolean;
} | null;

type Options = {
  owned: OwnedPlush[];
  /** SVG 要素。画面座標を viewBox 座標に変換するのに使う */
  svgRef: React.RefObject<SVGSVGElement>;
  enabled: boolean;
  /** ドラッグにならなかった場合（タップ）に呼ばれる */
  onTap: (uid: string) => void;
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
export function useDragPlacement({ owned, svgRef, enabled, onTap }: Options) {
  const [drag, setDrag] = useState<DragState>(null);
  const startRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
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
    (uid: string, e: React.PointerEvent) => {
      if (!enabled) return;
      const target = owned.find((o) => o.uid === uid);
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
      startRef.current = { px: local.x, py: local.y, ox: target.x, oy: target.shelfRow };
      setDrag({
        uid,
        x: target.x,
        shelfRow: target.shelfRow,
        fromX: target.x,
        fromRow: target.shelfRow,
        moved: false,
      });
    },
    [enabled, owned, toLocal]
  );

  useEffect(() => {
    if (!drag) return;

    const move = (e: PointerEvent) => {
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

    const finish = () => {
      const cur = dragRef.current;
      startRef.current = null;
      setDrag(null);
      if (!cur) return;

      if (!cur.moved) {
        onTap(cur.uid);
        return;
      }

      const def = getPlush(owned.find((o) => o.uid === cur.uid)?.defId ?? "bear_01");
      const others: Placed[] = owned
        .filter((o) => o.shelfRow >= 0 && o.uid !== cur.uid)
        .map((o) => ({ uid: o.uid, x: o.x, shelfRow: o.shelfRow, r: getPlush(o.defId).size }));

      const placed = snapPlacement(cur.uid, cur.x, cur.shelfRow, def.size, others);
      if (placed.reverted) {
        // どこにも置けない。元の位置へ戻す。無言で消したり重ねたりしない。
        store.movePlush(cur.uid, cur.fromX, cur.fromRow);
      } else {
        store.movePlush(cur.uid, placed.x, placed.shelfRow);
      }
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [drag !== null, owned, toLocal, onTap]);

  return { onPointerDown, drag };
}
