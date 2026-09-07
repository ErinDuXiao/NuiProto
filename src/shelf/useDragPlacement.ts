import { useCallback, useEffect, useRef, useState } from "react";
import { getPlush } from "../data/plushies";
import { store } from "../state/store";
import type { PlushInstance } from "../state/types";
import {
  landingRowFor,
  rowFromY,
  rowY,
  snapPlacement,
  DRAG_LIFT_PX,
  DROP_SETTLE_MS,
  SHELF,
  type Placed,
} from "./shelfLayout";

/** ここを超えて動いたらドラッグ。それ未満はタップ（リアクション）。 */
const DRAG_THRESHOLD = 4;

/**
 * 持ち上げのオフセットが付き切るまでの時間 (ms)。仕様6.1。
 *
 * 掴んだ瞬間に全部を適用すると、頭のあたりを掴んだときに
 * ぬいぐるみが一段上へ飛び上がる。
 */
const LIFT_RAMP_MS = 120;

/** 掴んだ点の高さとして受け付ける上限 (px)。異常な値で段が飛ぶのを防ぐ。 */
const MAX_GRAB_HEIGHT = 120;

export type DragState = {
  instanceId: string;
  /** 描画する x。滑走中は確定位置へ向けて補間される */
  x: number;
  /** 描画する足元の y。持ち上がったあとは必ず棚板の上面ライン */
  y: number;
  /** いま乗っている段 */
  shelfRow: number;
  /** 元の位置。置けなかったときに戻す先 */
  fromX: number;
  fromRow: number;
  moved: boolean;
  /**
   * 淡い影を出す段（仕様6.2）。置けない段と、指を離したあとは null。
   * 影を出す段は必ず `shelfRow` と一致する — 指がある段と違う段に
   * 影を出すのは、置ける場所を示すどころか嘘をつくことになる。
   */
  landingRow: number | null;
  /** 指を離して確定位置へ滑っている最中（仕様6.3） */
  settling?: { fromX: number; fromRow: number; startedAt: number };
} | null;

type Options = {
  instances: PlushInstance[];
  /** SVG 要素。画面座標を viewBox 座標に変換するのに使う */
  svgRef: React.RefObject<SVGSVGElement>;
  enabled: boolean;
  /** ドラッグにならなかった場合（タップ）に呼ばれる */
  onTap: (instanceId: string) => void;
};

/** ドラッグの生の状態。**React の state ではない**（毎フレーム書き換わる） */
type Live = {
  instanceId: string;
  plushTypeId: string;
  /** 掴んでいる指の識別子。2本目の指に乗っ取られないようにする */
  pointerId: number;
  /** 半径 */
  r: number;
  /** 掴んだ瞬間のローカル座標 */
  px: number;
  py: number;
  /** いまの指のローカル座標 */
  cx: number;
  cy: number;
  /** 掴んだ瞬間の位置 */
  originX: number;
  originRow: number;
  /** 掴んだ点が足元より何 px 上か。持ち上げと一緒に解消する */
  grabY: number;
  moved: boolean;
  /** 持ち上げの起点。moved になった瞬間の時刻 */
  liftFrom: number;
  /** 指はもう離れていて、確定位置へ滑っている */
  settle: { fromX: number; fromY: number; toX: number; toY: number; startedAt: number } | null;
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 出だしが速く、終わりが緩やかな曲線。持ち上げにも着地にも使う。 */
function easeOut(p: number): number {
  const c = clamp01(p);
  return 1 - (1 - c) * (1 - c);
}

/**
 * 単調な時計。**rAF のタイムスタンプと同じ物差しでなければならない。**
 * Date.now を混ぜると持ち上げも滑走も一瞬で終わったことにされる。
 */
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function hasRaf(): boolean {
  return typeof requestAnimationFrame === "function";
}

/**
 * ドラッグ中の描画位置。**純粋関数**で、`live` と時刻だけから決まる。
 *
 * 仕様6.1 の2条件を同時に満たすのがここ。
 *
 * - 段は「指の `DRAG_LIFT_PX` 上」を基準に選ぶ。掴んだ点の高さ（`grabY`）も
 *   一緒に解消するので、頭を掴んでも足元を掴んでも同じ持ち方になり、
 *   結果として**指は必ずぬいぐるみの足元より下**に来る（顔が隠れない）。
 * - 描く足元の y は選んだ段の**上面ラインそのもの**。指の高さは使わない。
 *   だから移動中も常にどこかの棚板に立っており、浮かない。
 *
 * この2つが矛盾しないのは、持ち上げを「描画のオフセット」ではなく
 * **「どの段を選ぶかの基準」** に入れているため。唯一の例外が掴んだ直後の
 * 120ms で、ここだけは掴んだ位置から段の上面ラインへ連続に寄せる
 * （いきなり吸着させると、掴んだ瞬間に飛び上がる）。
 */
function poseOf(live: Live, t: number): { x: number; y: number; row: number } {
  if (live.settle) {
    const s = live.settle;
    const p = easeOut((t - s.startedAt) / DROP_SETTLE_MS);
    return {
      x: s.fromX + (s.toX - s.fromX) * p,
      y: s.fromY + (s.toY - s.fromY) * p,
      row: rowFromY(s.toY),
    };
  }

  const e = live.moved ? easeOut((t - live.liftFrom) / LIFT_RAMP_MS) : 0;
  const dx = live.cx - live.px;
  const dy = live.cy - live.py;
  // 掴んだ段の上面ラインを基準に、指の移動量だけずらす。指の絶対 y を
  // そのまま使うと、頭を掴んだ瞬間に一段上へ飛ぶ。
  const anchor = rowY(live.originRow) + (Number.isFinite(dy) ? dy : 0);
  const row = rowFromY(anchor - e * (live.grabY + DRAG_LIFT_PX));
  const x = Number.isFinite(dx) ? live.originX + dx : live.originX;
  return { x, y: anchor + (rowY(row) - anchor) * e, row };
}

/**
 * 棚のドラッグ配置（仕様6章 / 9章）。
 *
 * マウスとタッチをポインタイベントで共通に扱う。指が要素の外に出ても
 * 追従するよう setPointerCapture を使い、ドラッグ中はページのスクロールを止める。
 *
 * 4px 動くまではタップとして扱う。ぬいぐるみを撫でる操作と
 * 動かす操作を取り違えないため。
 *
 * **window の購読は useEffect ではなく pointerdown で直接張る。** 依存配列に
 * 頼ると、親が毎レンダー新しい `onTap` を渡している（ShelfScreen が実際に
 * そうしている）だけで購読が張り直され、掴んでいる指を見失う。そうなると
 * 1回動かした時点でドラッグが凍り、指を離しても確定せず、
 * `plush_drag_end`（指標 D の片側）が丸ごと消える。
 */
export function useDragPlacement({ instances, svgRef, enabled, onTap }: Options) {
  const [drag, setDrag] = useState<DragState>(null);
  const liveRef = useRef<Live | null>(null);
  /** いま張っている購読と rAF を畳む手続き。生きている間だけ入っている */
  const stopRef = useRef<(() => void) | null>(null);
  /** 直前に React へ渡した値。同じなら setState しない（無駄な再レンダーを避ける） */
  const lastRef = useRef<DragState>(null);

  // レンダーのたびに差し替える。依存配列には決して載せない。
  const instancesRef = useRef(instances);
  instancesRef.current = instances;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

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

  /**
   * 掴んでいる子を**除いた**棚の全員。
   * ここに本人を混ぜると、元の段へ戻すだけで「満杯」になる。
   */
  const othersOf = useCallback(
    (instanceId: string): Placed[] =>
      instancesRef.current
        .filter((o) => o.shelfRow >= 0 && o.instanceId !== instanceId)
        .map((o) => ({
          // Placed.uid は棚の配置計算だけが使う識別子。個体の instanceId をそのまま渡す。
          uid: o.instanceId,
          x: o.x,
          shelfRow: o.shelfRow,
          r: getPlush(o.plushTypeId).size,
        })),
    []
  );

  /** 購読・rAF・状態を全部畳む。何度呼んでも安全。 */
  const finish = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    liveRef.current = null;
    lastRef.current = null;
    setDrag(null);
  }, []);

  /** いまの `live` から描画用の値を作って React へ渡す。 */
  const apply = useCallback(
    (t: number) => {
      const live = liveRef.current;
      if (!live) return;
      const pose = poseOf(live, t);
      // 影は「段に置けるか」だけを見る。段の上面ラインで問い合わせることで、
      // 持ち上げの途中（段の間にいる瞬間）でも段の判定がぶれない。
      const landingRow = live.settle
        ? null
        : landingRowFor(rowY(pose.row), live.r, othersOf(live.instanceId));

      const next: DragState = {
        instanceId: live.instanceId,
        x: pose.x,
        y: pose.y,
        shelfRow: pose.row,
        fromX: live.originX,
        fromRow: live.originRow,
        moved: live.moved,
        landingRow,
        ...(live.settle
          ? {
              settling: {
                fromX: live.settle.fromX,
                fromRow: rowFromY(live.settle.fromY),
                startedAt: live.settle.startedAt,
              },
            }
          : {}),
      };

      // 指が止まっている間、毎フレーム同じ値で再レンダーさせない。
      const prev = lastRef.current;
      if (
        prev &&
        prev.instanceId === next.instanceId &&
        prev.moved === next.moved &&
        prev.shelfRow === next.shelfRow &&
        prev.landingRow === next.landingRow &&
        (prev.settling === undefined) === (next.settling === undefined) &&
        Math.abs(prev.x - next.x) < 0.02 &&
        Math.abs(prev.y - next.y) < 0.02
      ) {
        return;
      }
      lastRef.current = next;
      setDrag(next);
    },
    [othersOf]
  );

  /**
   * 指を離した。掴んでいた指のものだけを見る。
   * @param commit 配置を確定するか。pointercancel では確定しない。
   */
  const end = useCallback(
    (pointerId: number, commit: boolean) => {
      const live = liveRef.current;
      if (!live || live.settle) return;
      if (pointerId !== live.pointerId) return;

      // ブラウザにジェスチャを奪われた場合。撫でたことにも、動かしたことにも
      // せず、何もなかったことにする。**`plush_drag_end` も残さない** —
      // 中断を数えると「並べ替えた」件数（指標 D）が水増しされる。
      if (!commit) {
        finish();
        return;
      }

      if (!live.moved) {
        const id = live.instanceId;
        finish();
        onTapRef.current(id);
        return;
      }

      const t = nowMs();
      const pose = poseOf(live, t);
      const placed = snapPlacement(
        live.instanceId,
        pose.x,
        pose.row,
        live.r,
        othersOf(live.instanceId)
      );
      // どこにも置けない。元の位置へ戻す。無言で消したり重ねたりしない。
      const toX = placed.reverted ? live.originX : placed.x;
      const toRow = placed.reverted ? live.originRow : placed.shelfRow;

      // 位置は**先に**確定させる。滑走は見た目だけなので、途中で
      // アンマウントされても画面を閉じられても置き場所は失われない。
      store.movePlush(live.instanceId, toX, toRow);
      /**
       * 記録は `store.movePlush` に相乗りさせない。movePlush は位置が
       * 変わらないと何も書かないので、「動かしたが結局同じ場所に戻した」
       * 操作が指標 D（`relationship_reaction` から 30 秒以内の
       * `plush_drag_end`）から丸ごと消えてしまう。
       */
      store.log("plush_drag_end", {
        plushId: live.plushTypeId,
        meta: { fromRow: live.originRow, toRow, reverted: placed.reverted },
      });

      live.settle = {
        fromX: pose.x,
        fromY: pose.y,
        toX,
        toY: rowY(toRow),
        startedAt: t,
      };
      apply(t);
      // rAF が無い環境では滑らせようがない。確定位置に居るので即座に畳む。
      if (!hasRaf()) finish();
    },
    [apply, finish, othersOf]
  );

  /** window の購読と rAF を張る。畳み方は stopRef に入れておく。 */
  const subscribe = useCallback(() => {
    if (stopRef.current) return;

    const onMove = (ev: PointerEvent) => {
      const live = liveRef.current;
      if (!live || live.settle) return;
      if (ev.pointerId !== live.pointerId) return;
      const local = toLocal(ev.clientX, ev.clientY);
      if (!local) return;
      live.cx = local.x;
      live.cy = local.y;

      const t = nowMs();
      if (!live.moved) {
        if (Math.hypot(local.x - live.px, local.y - live.py) <= DRAG_THRESHOLD) return;
        live.moved = true;
        // 持ち上げはここから始まる。掴んだ瞬間から数えると、しきい値を
        // 超える頃には既に持ち上がっていて「飛び上がった」ように見える。
        live.liftFrom = t;
        // 撫でる操作と区別が付いた瞬間にだけ記録する。pointerdown で
        // 記録すると、タップのたびに片割れの drag_start が残る。
        store.log("plush_drag_start", {
          plushId: live.plushTypeId,
          meta: { fromRow: live.originRow },
        });
      }
      ev.preventDefault();
      apply(t);
    };

    const onUp = (ev: PointerEvent) => end(ev.pointerId, true);
    const onCancel = (ev: PointerEvent) => end(ev.pointerId, false);

    let raf = 0;
    const frame = (t: number) => {
      const live = liveRef.current;
      if (!live) return;
      if (live.settle && t - live.settle.startedAt >= DROP_SETTLE_MS) {
        finish();
        return;
      }
      apply(t);
      raf = requestAnimationFrame(frame);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    if (hasRaf()) raf = requestAnimationFrame(frame);

    /**
     * 滑走が rAF 頼みのままだと、タブが隠れて rAF が止まった瞬間に
     * ドラッグが**永久に終わらない**。棚は「ドラッグ中」を見て環境
     * アニメーションと隣接の再計算を止めているので、そこで固まると
     * 関係が二度と更新されない。確定位置は既に保存済みなので、
     * 時間で畳んでしまって構わない。
     */
    const guard =
      typeof window.setTimeout === "function"
        ? window.setTimeout(() => {
            if (liveRef.current?.settle) finish();
          }, DROP_SETTLE_MS * 6)
        : 0;

    stopRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      window.clearTimeout(guard);
    };
  }, [apply, end, finish, toLocal]);

  const onPointerDown = useCallback(
    (instanceId: string, e: React.PointerEvent) => {
      if (!enabled) return;

      const live = liveRef.current;
      if (live) {
        // 指がまだ乗っている = 2本目の指。乗っ取らせない。
        if (!live.settle) return;
        // 滑走中なら打ち切って新しい操作を受ける。位置は Drop の時点で
        // 確定済みなので、打ち切っても迷子にならない。
        finish();
      }

      const target = instancesRef.current.find((o) => o.instanceId === instanceId);
      // shelfRow -1 は箱の中。棚に居ない子は掴めない。
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

      const t = nowMs();
      liveRef.current = {
        instanceId,
        plushTypeId: target.plushTypeId,
        pointerId: e.pointerId,
        r: getPlush(target.plushTypeId).size,
        px: local.x,
        py: local.y,
        cx: local.x,
        cy: local.y,
        originX: target.x,
        originRow: target.shelfRow,
        grabY: Math.min(MAX_GRAB_HEIGHT, Math.max(0, rowY(target.shelfRow) - local.y)),
        moved: false,
        liftFrom: t,
        settle: null,
      };
      subscribe();
      apply(t);
    },
    [apply, enabled, finish, subscribe, toLocal]
  );

  /**
   * アンマウント。掴んだままの指も、滑走中の rAF も残さない。
   *
   * `finish` を丸ごと使う（＝ state も畳む）。React 18 ではアンマウント後の
   * setState は何もしないので無害だが、**エフェクトだけが作り直される**
   * 経路（開発中の Fast Refresh、StrictMode の二重実行）でドラッグ中の
   * state だけが取り残されるのを防げる。取り残されると棚は「ドラッグ中」の
   * ままになり、環境アニメーションも隣接の再計算も二度と再開しない。
   */
  useEffect(() => () => finish(), [finish]);

  return { onPointerDown, drag };
}
