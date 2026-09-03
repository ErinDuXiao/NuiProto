import { PER_ROW, SHELF_CAPACITY, SHELF_ROWS, SLOT_SPACING, SLOT_X0 } from "../state/persist";

/**
 * 棚の寸法。スマホ縦画面の内寸 320px を基準にする。
 * rowY は各段の「上面ライン」の y 座標。ぬいぐるみの足元がここに乗る。
 */
export const SHELF = {
  width: 320,
  height: 520,
  rows: SHELF_ROWS,
  /** 各段の上面ライン。ぬいぐるみの足元がここに乗る */
  rowY: [214, 316, 418, 520] as const,
  padding: 12,
  /** 棚の枠（キャビネット）の左右の内側。左右に部屋の余白を残す */
  frameLeft: 36,
  frameRight: 284,
  frameTop: 110,
} as const;

export { PER_ROW };

/** 棚の内側に収まる x に丸める。 */
export function clampToShelf(x: number, r: number): number {
  const min = Math.min(r, SHELF.width / 2);
  const max = Math.max(SHELF.width - r, SHELF.width / 2);
  return Math.min(max, Math.max(min, x));
}

/**
 * 獲得順に応じた初期配置。
 *
 * 2匹目が1匹目の隣に来ることが、出会いの演出（仕様8章）の前提になっている。
 * 上の段から左詰めで並べる。定員を超えたら shelfRow: -1（箱の中）。
 */
export function defaultSlot(index: number): { x: number; shelfRow: number } {
  if (index < 0 || index >= SHELF_CAPACITY) return { x: SHELF.width / 2, shelfRow: -1 };
  return {
    x: SLOT_X0 + (index % PER_ROW) * SLOT_SPACING,
    shelfRow: Math.floor(index / PER_ROW),
  };
}

/** 段の上面ライン y を返す。範囲外は端の段にクランプする。 */
export function rowY(row: number): number {
  const r = Math.min(SHELF.rows - 1, Math.max(0, Math.round(row)));
  return SHELF.rowY[r];
}
