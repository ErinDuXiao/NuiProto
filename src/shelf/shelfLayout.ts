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

/**
 * 隣接リンクが「張られる」距離 / 「切れる」距離（仕様5.1）。
 *
 * **ここに置いてあるのは、棚の配置計算（`snapPlacement`）と関係の計算
 * （`neighbors.ts`）の両方が同じ数値を見なければならないため。**
 * `neighbors.ts` は `SHELF` を使うので、配置側が `neighbors.ts` から
 * 借りると循環参照になる。かといって両方に 110 と書くと、片方だけ
 * 直したときに「隣に置いたつもりが隣にならない」という、誰にも
 * 見えない形で壊れる（このリポジトリは過去に棚の定数を二重に持って
 * 事故を起こしている）。定義はこの1箇所だけ。
 *
 * 張る閾値より切る閾値を緩くしてヒステリシスを作る（点滅させない）。
 */
export const NEIGHBOR_LINK_DISTANCE = 110;
export const NEIGHBOR_BREAK_DISTANCE = 124;

/**
 * ドラッグ中、段を選ぶ基準を指の何 px 上に取るか（仕様6.1）。
 *
 * 最大の景品の直径は 72px（size 34 × 個体差 1.05 の半径 35.7）。その半径より
 * 大きく取る。段の間隔 102px の半分（51px）より小さくもしておく — ここを
 * 超えると、指をまったく動かしていないのに持ち上げただけで一段上へ
 * 吸着してしまう。
 *
 * **「指が顔まで届かない」を無条件に保証する値ではない。** 描く足元は
 * 常にどこかの段の上面ラインなので、指と足元の差は段の吸着ぶんずれる。
 * 段の内側（指が `rowY[0]` 以下）では足元が指より最大 5px しか下に来ない
 * （51 − 46）。しかし**最上段より上では `rowFromY` がクランプする**ため、
 * 指が `rowY[0]` を超えて上がった分だけ差は無制限に開く（指 y=150 で
 * 64px）。ここは持ち上げ量では閉じられない — 上に乗せる棚板が無いので、
 * どんな値にしても指だけが先に上がる。詳細は `useDragPlacement.poseOf`。
 */
export const DRAG_LIFT_PX = 46;

/** 指を離してから確定位置へ滑り込むまでの時間 (ms)。仕様6.3。 */
export const DROP_SETTLE_MS = 180;

/**
 * いま指がある高さ `y` に、半径 `r` の子を降ろせるか（仕様6.2）。
 *
 * 降ろせるなら段の番号、降ろせないなら `null`。ドラッグ中の「置ける場所が
 * 分かる」影は、この戻り値がそのまま影を出す段になる。
 *
 * `others` には**掴んでいる本人を含めない**こと。含めると、元の段へ戻す
 * だけの操作でその段が満杯に見え、影が消える。
 *
 * 段をまたいだ振り替え（満杯なら空いている段へ逃がす）は `snapPlacement` の
 * 仕事であって、ここではしない。影は「いま指がある段に置けるか」だけを
 * 答える — 指が段Aにあるのに段Bに影が出ては、置ける場所を示すどころか
 * 嘘をつくことになる。
 */
export function landingRowFor(y: number, r: number, others: Placed[]): number | null {
  const row = rowFromY(y);
  const inRow = others.filter((o) => o.shelfRow === row);
  if (inRow.length >= PER_ROW) return null;
  // 定員に空きがあっても、大きい子は既にいる子の隙間に入れないことがある。
  // 段の中央から左右へ探して、どこにも空きが無ければ置けない。
  const [lo, hi] = bounds(r);
  return pushOut((lo + hi) / 2, r, inRow) === null ? null : row;
}

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
    if (placed !== null) {
      return {
        x: preferNeighborly(placed, r, candidateRow, inRow, rest),
        shelfRow: candidateRow,
        reverted: false,
      };
    }
  }

  return { x: wantX, shelfRow: wantRow, reverted: true };
}

/**
 * 隣接の判定に使うのと同じ距離（`neighbors.ts` の候補生成と揃える）。
 * 同じ段なら x 差、上下の隣の段なら斜辺。2段以上離れた相手とは隣になれない。
 */
function neighborDistance(x: number, row: number, o: Placed): number {
  const dRow = Math.abs(o.shelfRow - row);
  if (dRow === 0) return Math.abs(o.x - x);
  if (dRow === 1) return Math.hypot(o.x - x, rowY(o.shelfRow) - rowY(row));
  return Number.POSITIVE_INFINITY;
}

/**
 * 「隣になれる位置」を優先して吸着させる（仕様6.4）。
 *
 * 並べ替えは、プレイヤーが**誰の隣に誰を置くかを決める**操作である。
 * 落とした位置が隣接距離 (110px) の外側に数 px 落ちただけでリンクが
 * 張られないと、プレイヤーの意図は何の手応えもなく空振りする。
 * そこで、置ける位置の中から「誰かの隣になれる位置」を選ぶ。
 *
 * **引き寄せは半径 `r` までしか許さない。** これは「プレイヤーが指した点を、
 * ぬいぐるみが依然として覆っている」範囲そのもの。これを超えると、
 * 狙った場所とは別の場所へ勝手に動いたようにしか見えない。
 * 押し出し (`pushOut`) 自体が動かす距離は最小でも `(o.r + r) * 0.94`
 * ＝ ほぼ `2r` なので、この引き寄せは押し出しが動かす量より必ず小さい。
 * 明らかに誰からも離れた場所を狙った Drop は、そのままそこに残る。
 */
function preferNeighborly(
  base: number,
  r: number,
  row: number,
  inRow: Placed[],
  all: Placed[]
): number {
  // すでに誰かの隣になれるなら 1px も動かさない。狙いがそのまま通る。
  if (all.some((o) => neighborDistance(base, row, o) < NEIGHBOR_LINK_DISTANCE)) return base;

  const [lo, hi] = bounds(r);
  const free = (v: number) =>
    v >= lo && v <= hi && inRow.every((o) => Math.abs(o.x - v) >= (o.r + r) * 0.94);

  // いちばん近い相手の側から先に試す。左右で同点のとき、遠い方へ
  // 寄せると「隣に置いたのに逆へ逃げた」ように見える。
  let dir = 1;
  let nearest = Number.POSITIVE_INFINITY;
  for (const o of all) {
    const d = neighborDistance(base, row, o);
    if (d < nearest) {
      nearest = d;
      dir = o.x >= base ? 1 : -1;
    }
  }

  for (let d = 4; d <= r; d += 4) {
    for (const v of [base + dir * d, base - dir * d]) {
      if (!free(v)) continue;
      if (all.some((o) => neighborDistance(v, row, o) < NEIGHBOR_LINK_DISTANCE)) return v;
    }
  }
  return base;
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
