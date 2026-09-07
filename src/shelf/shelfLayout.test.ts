import { describe, it, expect } from "vitest";
import {
  clampToShelf,
  defaultSlot,
  landingRowFor,
  resolveOverlaps,
  rowCapacity,
  rowFromY,
  snapPlacement,
  DRAG_LIFT_PX,
  DROP_SETTLE_MS,
  NEIGHBOR_LINK_DISTANCE,
  SHELF,
} from "./shelfLayout";
import { SHELF_CAPACITY, SHELF_ROWS, SLOT_SPACING } from "../state/persist";

describe("clampToShelf", () => {
  it("左端をはみ出さない", () => {
    expect(clampToShelf(-100, 32)).toBeGreaterThanOrEqual(32);
  });
  it("右端をはみ出さない", () => {
    expect(clampToShelf(9999, 32)).toBeLessThanOrEqual(SHELF.width - 32);
  });
  it("内側の値はそのまま", () => {
    expect(clampToShelf(160, 32)).toBe(160);
  });
  it("棚より大きい個体でも有限の値を返す", () => {
    expect(Number.isFinite(clampToShelf(100, 9999))).toBe(true);
  });
});

describe("defaultSlot", () => {
  it("定員分のスロットは同じ段で互いに重ならない", () => {
    const slots = Array.from({ length: SHELF_CAPACITY }, (_, i) => defaultSlot(i));
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[i].shelfRow !== slots[j].shelfRow) continue;
        expect(Math.abs(slots[i].x - slots[j].x), `${i}-${j}`).toBeGreaterThanOrEqual(72);
      }
    }
  });

  it("全スロットがキャビネットの内側にある（側板からはみ出さない）", () => {
    const MAX_R = 36; // 最大サイズ34 × 個体差1.05
    for (let i = 0; i < SHELF_CAPACITY; i++) {
      const s = defaultSlot(i);
      expect(s.x - MAX_R, `slot ${i} 左`).toBeGreaterThanOrEqual(SHELF.frameLeft);
      expect(s.x + MAX_R, `slot ${i} 右`).toBeLessThanOrEqual(SHELF.frameRight);
      expect(s.shelfRow).toBeGreaterThanOrEqual(0);
      expect(s.shelfRow).toBeLessThan(SHELF.rows);
    }
  });

  it("2匹目は1匹目の隣に来る（出会いの演出で並んで見えること）", () => {
    const a = defaultSlot(0);
    const b = defaultSlot(1);
    expect(b.shelfRow).toBe(a.shelfRow);
    expect(Math.abs(b.x - a.x)).toBeLessThan(120);
  });

  it("定員を超えたら箱の中を表す -1 を返す", () => {
    expect(defaultSlot(SHELF_CAPACITY).shelfRow).toBe(-1);
    expect(defaultSlot(99).shelfRow).toBe(-1);
  });
});

describe("SHELF", () => {
  it("段数が定数と一致し、段のY座標が上から下に並ぶ", () => {
    expect(SHELF.rows).toBe(SHELF_ROWS);
    expect(SHELF.rowY).toHaveLength(SHELF_ROWS);
    for (let i = 1; i < SHELF.rowY.length; i++) {
      expect(SHELF.rowY[i - 1]).toBeLessThan(SHELF.rowY[i]);
    }
  });

  it("スロット間隔がぬいぐるみの直径より広い", () => {
    expect(SLOT_SPACING).toBeGreaterThan(72);
  });
});

const item = (uid: string, x: number, shelfRow = 0, r = 32) => ({ uid, x, shelfRow, r });

describe("rowFromY", () => {
  it("各段のY座標が対応する段に落ちる", () => {
    for (let row = 0; row < SHELF.rows; row++) {
      expect(rowFromY(SHELF.rowY[row]), `row ${row}`).toBe(row);
    }
  });
  it("範囲外のYは端の段にクランプされる", () => {
    expect(rowFromY(-9999)).toBe(0);
    expect(rowFromY(9999)).toBe(SHELF.rows - 1);
  });
  it("NaNでも有効な段を返す", () => {
    expect(rowFromY(Number.NaN)).toBeGreaterThanOrEqual(0);
  });
});

describe("rowCapacity", () => {
  it("1段あたり3匹以上入る", () => {
    expect(rowCapacity(0)).toBeGreaterThanOrEqual(3);
  });
});

describe("resolveOverlaps", () => {
  it("重なった2匹を離す", () => {
    const [a, b] = resolveOverlaps([item("a", 100), item("b", 110)]);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(64 * 0.9);
  });

  it("解消後も全員が棚の内側にいる", () => {
    const out = resolveOverlaps([item("a", 100), item("b", 102), item("c", 104)]);
    for (const o of out) {
      expect(o.x).toBeGreaterThanOrEqual(SHELF.frameLeft);
      expect(o.x).toBeLessThanOrEqual(SHELF.frameRight);
    }
  });

  it("1段に入りきらない分は別の段へ移す", () => {
    const many = Array.from({ length: 6 }, (_, i) => item(`p${i}`, 160, 0, 32));
    expect(new Set(resolveOverlaps(many).map((o) => o.shelfRow)).size).toBeGreaterThan(1);
  });

  it("重ならない配置はそのまま保つ", () => {
    const input = [item("a", 78), item("b", 160), item("c", 242)];
    expect(resolveOverlaps(input).map((o) => o.x)).toEqual([78, 160, 242]);
  });

  it("個体を失わない", () => {
    const input = [item("a", 100), item("b", 105), item("c", 110)];
    expect(new Set(resolveOverlaps(input).map((o) => o.uid))).toEqual(new Set(["a", "b", "c"]));
  });

  it("全段が満杯でも終了し、個体を失わない（無限ループしない）", () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`p${i}`, 160, 1, 34));
    expect(resolveOverlaps(many)).toHaveLength(20);
  });

  it("完全に同座標が多数あっても終了する", () => {
    const same = Array.from({ length: 8 }, (_, i) => item(`s${i}`, 160, 0, 32));
    expect(() => resolveOverlaps(same)).not.toThrow();
    expect(resolveOverlaps(same)).toHaveLength(8);
  });

  it("大きさの違う個体が隣り合っても重ならない", () => {
    // 片方の半径だけで間隔を決めると、大きい子と小さい子で重なる
    const mixed = [item("small", 100, 0, 26), item("big", 120, 0, 34)];
    const out = resolveOverlaps(mixed);
    const gap = Math.abs(out[0].x - out[1].x);
    expect(gap).toBeGreaterThanOrEqual((26 + 34) * 0.9);
  });

  it("入力を書き換えない", () => {
    const input = [item("a", 100), item("b", 105)];
    resolveOverlaps(input);
    expect(input[1].x).toBe(105);
  });
});

describe("snapPlacement", () => {
  const others = [item("a", 160, 1, 32)];

  it("空いている場所にはそのまま置ける", () => {
    expect(snapPlacement("b", 240, 1, 32, others).x).toBeCloseTo(240, 0);
    expect(snapPlacement("b", 240, 1, 32, others).reverted).toBe(false);
  });

  it("重なる位置に置くと押し出される", () => {
    const p = snapPlacement("b", 168, 1, 32, others);
    expect(Math.abs(p.x - 160)).toBeGreaterThanOrEqual(60);
  });

  it("棚の外には置けない", () => {
    expect(snapPlacement("b", -500, 1, 32, others).x).toBeGreaterThanOrEqual(SHELF.frameLeft);
    expect(snapPlacement("b", 9999, 1, 32, others).x).toBeLessThanOrEqual(SHELF.frameRight);
  });

  it("自分自身とは衝突しない", () => {
    const p = snapPlacement("a", 160, 1, 32, others);
    expect(p.x).toBeCloseTo(160, 0);
    expect(p.reverted).toBe(false);
  });

  it("段がいっぱいなら空いている隣の段へ移す", () => {
    const full = [item("x", 78, 1, 34), item("y", 160, 1, 34), item("z", 242, 1, 34)];
    const p = snapPlacement("n", 160, 1, 34, full);
    expect(p.reverted).toBe(false);
    expect(p.shelfRow).not.toBe(1);
  });

  it("全段が満杯なら移動を取り消す（無言で消えたり重なったりしない）", () => {
    const full = Array.from({ length: 12 }, (_, i) =>
      item(`f${i}`, 78 + (i % 3) * 82, Math.floor(i / 3), 34)
    );
    const p = snapPlacement("newcomer", 160, 2, 34, full);
    expect(p.reverted).toBe(true);
  });

  it("定員に余裕があっても、隙間が無ければ取り消す（reverted は到達不能ではない）", () => {
    // 「棚の定員は 12、掴んでいる本人を除けば必ず 1 枠空くので reverted は
    // 常に false」という申し送りは**誤り**。空き枠の数ではなく、
    // 大きい子が入れる**隙間**があるかが問題になる。
    // 半径 34 の 2 匹を x=100 / 220 に置くと、その段の置ける範囲が
    // 丸ごと塞がる（最低間隔 63.92 を両側で満たす x が棚の内側に無い）。
    // 8 匹しか置いていない＝各段に 1 枠ずつ空いているのに、どこにも入れない。
    const blocked = Array.from({ length: 8 }, (_, i) =>
      item(`b${i}`, i % 2 === 0 ? 100 : 220, Math.floor(i / 2), 34)
    );
    const p = snapPlacement("newcomer", 160, 1, 34, blocked);
    expect(p.reverted, "隙間が無いのに置けたことになっている").toBe(true);
  });

  it("NaNの座標でも有限の結果を返す", () => {
    const p = snapPlacement("b", Number.NaN, Number.NaN, 32, others);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(p.shelfRow).toBeGreaterThanOrEqual(0);
  });
});

describe("snapPlacement — 隣になれる位置を優先する（仕様6.4）", () => {
  /**
   * 並べ替えは「誰の隣に誰を置くか」を決める操作なので、隣接距離の
   * すぐ外側へ落ちたまま確定すると、プレイヤーの意図が無言で空振りする。
   */
  it("隣のつもりで落としたら、隣接距離の内側に収まる", () => {
    const others = [item("a", 60, 1, 32)];
    // 120px 先。誰にも重ならないので、以前は 180 のまま確定していた。
    const p = snapPlacement("b", 180, 1, 32, others);
    expect(p.shelfRow).toBe(1);
    expect(p.reverted).toBe(false);
    expect(Math.abs(p.x - 60), "隣接距離の外側に置き去りにされている").toBeLessThan(
      NEIGHBOR_LINK_DISTANCE
    );
  });

  it("引き寄せは半径までで、狙った点をぬいぐるみが覆っている範囲を出ない", () => {
    const others = [item("a", 60, 1, 32)];
    const p = snapPlacement("b", 180, 1, 32, others);
    expect(Math.abs(p.x - 180), "狙いから半径以上ずらしている").toBeLessThanOrEqual(32);
  });

  it("明らかに離れた場所を狙った Drop は引き寄せない", () => {
    // 210px 先。隣に入れるには半径を超えて動かすしかないので、狙いが勝つ。
    const others = [item("a", 60, 1, 32)];
    const p = snapPlacement("b", 270, 1, 32, others);
    expect(p.x, "狙っていない相手のほうへ勝手に寄っている").toBeCloseTo(270, 0);
  });

  it("すでに隣になれる位置なら 1px も動かさない", () => {
    const others = [item("a", 160, 1, 32)];
    const p = snapPlacement("b", 240, 1, 32, others);
    expect(p.x).toBe(240);
  });

  it("誰も居ない棚では引き寄せる相手が無く、狙った位置のまま", () => {
    const p = snapPlacement("b", 240, 1, 32, []);
    expect(p.x).toBe(240);
  });

  it("上下の段の相手にも、隣接と同じ物差し（斜辺）で寄せる", () => {
    // 隣接は段をまたいでも成立する（`neighbors.ts` は斜辺で測る）。
    // 段の高さ 102 があるので、x 差 60 では hypot(60,102)=118 で届かない。
    const below = [item("a", 160, 1, 32)];
    const p = snapPlacement("b", 220, 0, 32, below);
    expect(p.shelfRow).toBe(0);
    const rowGap = SHELF.rowY[1] - SHELF.rowY[0];
    expect(
      Math.hypot(p.x - 160, rowGap),
      "上下の相手には寄せていない（x 差だけで測っている）"
    ).toBeLessThan(NEIGHBOR_LINK_DISTANCE);
    expect(Math.abs(p.x - 220), "狙いから半径以上ずらしている").toBeLessThanOrEqual(32);
  });

  it("引き寄せた先でも他の子と重ならない", () => {
    const others = [item("a", 60, 1, 32)];
    const p = snapPlacement("b", 180, 1, 32, others);
    expect(Math.abs(p.x - 60), "引き寄せた先で重なっている").toBeGreaterThanOrEqual(60);
    expect(p.x, "棚の左端をはみ出している").toBeGreaterThanOrEqual(SHELF.frameLeft);
    expect(p.x, "棚の右端をはみ出している").toBeLessThanOrEqual(SHELF.frameRight);
  });
});

describe("landingRowFor", () => {
  it("空いている段を返す", () => {
    expect(landingRowFor(SHELF.rowY[1], 32, [])).toBe(1);
  });

  it("満杯の段には置けない（null を返す）", () => {
    const full = Array.from({ length: 3 }, (_, i) => item(`f${i}`, 78 + i * 82, 1, 34));
    expect(landingRowFor(SHELF.rowY[1], 34, full)).toBeNull();
  });

  it("範囲外の y でも有効な段か null を返す", () => {
    for (const y of [-9999, 9999, Number.NaN]) {
      const r = landingRowFor(y, 32, []);
      expect(r === null || (r >= 0 && r < SHELF.rows)).toBe(true);
    }
  });

  it("他の段が満杯でも、狙っている段が空いていれば置ける", () => {
    // 段をまたいだ振り替えは snapPlacement の仕事。影は「いま指がある段」だけを見る。
    const full = Array.from({ length: 3 }, (_, i) => item(`f${i}`, 78 + i * 82, 0, 34));
    expect(landingRowFor(SHELF.rowY[1], 34, full)).toBe(1);
  });

  it("自分自身を数えない（others に自分を含めないのは呼び出し側の責任）", () => {
    // 掴んでいる子を除いた 2 匹しかいない段は、まだ空いている。
    // ここに自分を数え込むと、元の段へ戻すだけの操作で影が消える。
    const others = [item("a", 78, 1, 34), item("b", 160, 1, 34)];
    expect(landingRowFor(SHELF.rowY[1], 34, others)).toBe(1);
  });
});

describe("ドラッグの持ち上げ量", () => {
  it("最大の景品の半径より大きい（指で顔が隠れない）", () => {
    // 最大 size 34 × 個体差 1.05 = 35.7
    expect(DRAG_LIFT_PX).toBeGreaterThan(36);
  });

  it("段の間隔の半分より小さい（持ち上げただけで段が変わらない）", () => {
    const gap = SHELF.rowY[1] - SHELF.rowY[0];
    expect(DRAG_LIFT_PX).toBeLessThan(gap / 2);
  });

  it("Drop の滑走時間が、待たされない長さに収まっている", () => {
    expect(DROP_SETTLE_MS).toBeGreaterThan(0);
    expect(DROP_SETTLE_MS).toBeLessThanOrEqual(240);
  });
});
