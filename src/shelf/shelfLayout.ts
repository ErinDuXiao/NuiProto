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

/** 1 段あたりの定員。 */
export function rowCapacity(_row: number): number {
  return PER_ROW;
}

/**
 * 画面上の y から段を求める。段の上面ラインに最も近い段を選ぶ。
 * 範囲外や NaN は端の段にクランプする。
 */
export function rowFromY(y: number): number {
  if (!Number.isFinite(y)) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let r = 0; r < SHELF.rows; r++) {
    const d = Math.abs(SHELF.rowY[r] - y);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export type Placed = { uid: string; x: number; shelfRow: number; r: number };
export type PlacedOut = { uid: string; x: number; shelfRow: number };

/** 棚の内側に収まる x の範囲。 */
function bounds(r: number): [number, number] {
  const lo = SHELF.frameLeft + r * 0.1;
  const hi = SHELF.frameRight - r * 0.1;
  return lo <= hi ? [lo, hi] : [SHELF.width / 2, SHELF.width / 2];
}

function clampIn(x: number, r: number): number {
  const [lo, hi] = bounds(r);
  const v = Number.isFinite(x) ? x : (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 重なりを解消する。純粋関数で、入力の配列も要素も書き換えない。
 *
 * 同じ段の中で x 昇順に並べ、隣と近すぎれば右へずらす。右端で溢れた個体は
 * 空きのある段へ移す。全段が埋まっていても**個体を捨てない**。
 * 表示の破綻より、ぬいぐるみが無言で消えないことを優先する。
 *
 * 反復回数に上限があるため、どんな入力でも必ず終了する。
 */
export function resolveOverlaps(items: Placed[]): PlacedOut[] {
  const work = items.map((i) => ({ ...i }));
  const MAX_PASSES = 12;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    for (let row = 0; row < SHELF.rows; row++) {
      const inRow = work
        .filter((w) => w.shelfRow === row)
        .sort((a, b) => a.x - b.x || a.uid.localeCompare(b.uid));

      // 左から順に、最低間隔を空けながら詰める。
      // 間隔は「隣り合う2匹の半径の和」で決める。片方の半径だけで
      // 決めると、大きい子と小さい子が隣り合ったときに重なる。
      let prev: Placed | null = null;
      for (const w of inRow) {
        const [lo, hi] = bounds(w.r);
        const minX = prev ? prev.x + (prev.r + w.r) * 0.94 : lo;
        const next = Math.min(hi, Math.max(lo, Math.max(w.x, minX)));
        if (Math.abs(next - w.x) > 0.01) {
          w.x = next;
          changed = true;
        }
        prev = w;
      }

      // 右端に収まりきらなかった個体を、空きのある段へ逃がす
      const overflow = inRow.filter(
        (w, i) => i > 0 && w.x - inRow[i - 1].x < (inRow[i - 1].r + w.r) * 0.9
      );
      for (const w of overflow) {
        const target = freestRow(work, row);
        if (target === row) break; // どこにも空きがない。重なったままでも消さない
        w.shelfRow = target;
        w.x = clampIn(w.x, w.r);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return work.map(({ uid, x, shelfRow }) => ({ uid, x, shelfRow }));
}

/** 最も空いている段。どこも満杯なら except をそのまま返す。 */
function freestRow(work: Placed[], except: number): number {
  let best = except;
  let bestCount = Infinity;
  for (let r = 0; r < SHELF.rows; r++) {
    if (r === except) continue;
    const count = work.filter((w) => w.shelfRow === r).length;
    if (count < PER_ROW && count < bestCount) {
      bestCount = count;
      best = r;
    }
  }
  return best;
}

/**
 * ドラッグで離した位置を、置ける位置に丸める。
 *
 * 重なるなら押し出し、その段が満杯なら空いている段へ移す。
 * どこにも置けなければ reverted を返し、呼び出し側が元の位置へ戻す。
 * ぬいぐるみが重なったまま放置されたり、無言で消えたりしないこと。
 */
export function snapPlacement(
  uid: string,
  x: number,
  row: number,
  r: number,
  others: Placed[]
): { x: number; shelfRow: number; reverted: boolean } {
  const rest = others.filter((o) => o.uid !== uid);
  const wantRow = Number.isFinite(row)
    ? Math.min(SHELF.rows - 1, Math.max(0, Math.round(row)))
    : 0;
  const wantX = clampIn(x, r);

  // 希望の段 → 空いている他の段 の順に試す
  const order = [wantRow, ...Array.from({ length: SHELF.rows }, (_, i) => i).filter((i) => i !== wantRow)];

  for (const candidateRow of order) {
    const inRow = rest.filter((o) => o.shelfRow === candidateRow);
    if (inRow.length >= PER_ROW) continue;
    const placed = pushOut(wantX, r, inRow);
    if (placed !== null) return { x: placed, shelfRow: candidateRow, reverted: false };
  }

  return { x: wantX, shelfRow: wantRow, reverted: true };
}

/** 既存の個体と重ならない最寄りの x を探す。見つからなければ null。 */
function pushOut(x: number, r: number, inRow: Placed[]): number | null {
  const [lo, hi] = bounds(r);
  const free = (v: number) => inRow.every((o) => Math.abs(o.x - v) >= (o.r + r) * 0.94);
  if (free(x)) return x;

  // 左右へ交互に探す
  for (let d = 4; d <= SHELF.width; d += 4) {
    const right = x + d;
    if (right <= hi && free(right)) return right;
    const left = x - d;
    if (left >= lo && free(left)) return left;
  }
  return null;
}
