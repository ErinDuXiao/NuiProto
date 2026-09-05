import { useEffect, useRef, type RefObject } from "react";
import { individuality } from "./pose";
import type { NeighborLink } from "../shelf/neighbors";
import {
  directorPose,
  tickDirector,
  type DirectorState,
  type Episode,
  type Personality,
} from "../shelf/shelfDirector";

export type AmbientTarget = {
  instanceId: string;
  personalitySeed: number;
  /** 棚上の水平位置。隣を見る演出の向き判定に使う */
  x: number;
  shelfRow: number;
};

type Registry = RefObject<Map<string, SVGGElement | null>>;

/**
 * 棚の関係を rAF ループへ渡すための**可変の受け皿**。
 *
 * React の state ではなく ref に入れて渡す。ここを props / state にすると、
 * 挿話が始まるたびにフックの依存が変わって rAF が張り直され、
 * 瞬きや呼吸の位相がその都度リセットされる。さらに `links` を state に
 * 置くと、隣接を計算し直すたびに棚全体が再レンダーされる。
 *
 * 中身はループが**直接書き換える**（`director` の更新と `created` の消費）。
 * React はここを読まない。
 */
export type ShelfRelations = {
  /** いまの隣接リンク。配置が確定したときと、定期的な更新でだけ作り直される */
  links: NeighborLink[];
  /** `links` / `personalities` の世代。変わったら常時層の目標値を作り直す */
  revision: number;
  /** 挿話の種類選びにだけ使う性格（仕様5.6） */
  personalities: Record<string, Personality>;
  /**
   * まだ消費していない「新しくできたリンク」。
   * ループが**1回だけ**読んで空にする。詳細は `stepRelations`。
   */
  created: string[];
  /** 指揮の状態。ループが毎フレーム進める */
  director: DirectorState;
  /** 挿話が始まった／終わった瞬間**だけ**呼ばれる。毎フレームは呼ばれない */
  onTransition: (started: Episode | null, ended: Episode | null) => void;
};

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
  /** 寄りかかりの深さの個体差（仕様5.6）。閾値には使わない */
  leanStrength: number;
};

const BLINK_MS = 90;
const GLANCE_MS = 1500;

/** 常時層の傾きの上限 (deg)。仕様5.4「最大 3.5 度」。 */
export const MAX_LEAN_DEG = 3.5;
/** affinity 1 あたりの傾き (deg)。 */
const LEAN_DEG_PER_AFFINITY = 1.8;
/**
 * 傾きが目標へ寄っていく時定数 (ms)。
 *
 * 仕様5.7「離されたときも何も起きないのではなく、**傾きがゆっくり戻る**」。
 * 指揮（`shelfDirector`）は `removed` を意図的に見ない — 起動直後に
 * 前セッションの別れを演じてしまうため。したがって「関係が解けたことが見える」
 * のはこの常時層の減衰だけが担っている。**ここを瞬時反映にすると仕様が消える。**
 */
export const LEAN_TAU_MS = 520;
/**
 * 挿話の傾きを弱め始める基準 (deg)。実機計測に基づく Task 5 の振れ幅の補正。
 * 詳細はフレーム内の `headroom` のコメント。
 */
const TILT_HEADROOM_DEG = 7;
/** 挿話の lookAt (-1..1) を顔の平行移動 (px) に直す係数。 */
const EPISODE_LOOK_PX = 3.6;
/** 隣を見る動きの振れ幅 (px)。 */
const GLANCE_PX = 3.2;

function makeLife(seed: number, now: number): Life {
  const iv = individuality(seed);
  return {
    seed,
    breathPeriod: iv.breathPeriod * 1000,
    breathPhase: iv.chatty * Math.PI * 2,
    blinkBase: iv.blinkBase * 1000,
    nextBlink: now + iv.blinkBase * 1000 * (0.4 + iv.linePick * 0.6),
    blinkUntil: 0,
    // 隣を見る間隔。12〜20秒だと気づかないので 5〜11 秒に詰める
    nextGlance: now + 5000 + iv.linePick * 6000,
    glanceUntil: 0,
    glanceDir: 0,
    // socialDistance も寄りかかりの深さに効かせる（仕様5.6:
    // 「近寄りたがりの子は少し深く傾く」）。隣接の閾値には決して使わない。
    leanStrength: iv.leanPreference * iv.socialDistance,
  };
}

function clampDeg(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const c = v < -MAX_LEAN_DEG ? -MAX_LEAN_DEG : v > MAX_LEAN_DEG ? MAX_LEAN_DEG : v;
  // -0 を 0 に畳む。符号付きゼロが向きの判定に紛れ込まないようにする。
  return c === 0 ? 0 : c;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 非有限を 0 に畳む。SVG 属性へ NaN を書かないための最後の関門。 */
function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export type AmbientRelationTarget = {
  /** 常時層の目標の傾き (deg)。相手のいる側が正 */
  lean: number;
  /** 最も近い隣の closeness。呼吸の位相の引き寄せに使う */
  near: number;
  /**
   * 最も近い隣のいる向き（-1 / 0 / +1）。「隣をちらっと見る」の向き。
   *
   * `lean` の符号では代用できない。左右に1匹ずつ隣がいる子は傾きが
   * 打ち消し合って 0 になるが、その子にも見る相手はいる。
   */
  dir: number;
};

/**
 * 隣接リンクから、各個体の**常時層**の目標値を作る（仕様5.4 常時層）。
 *
 * 純粋関数。リンクは相互なので、a が b の方へ傾く分と b が a の方へ傾く分を
 * 同じリンクから両方作る。上下のリンクで x が完全に同じ場合は左右どちらへも
 * 傾けない（0）— 適当な向きを選ぶと、真上に置いただけの2匹が理由なく
 * 同じ方向へ倒れる。
 */
export function ambientRelationTargets(
  positions: Map<string, number>,
  links: NeighborLink[],
  leanStrength: Map<string, number>
): Map<string, AmbientRelationTarget> {
  const out = new Map<string, AmbientRelationTarget>();
  const add = (id: string, lean: number, near: number, dir: number) => {
    const cur = out.get(id);
    if (cur) {
      cur.lean += lean;
      // 「いちばん近い隣」の向きを見る。同率なら先に見た方を残す。
      if (near > cur.near) {
        cur.near = near;
        cur.dir = dir;
      }
    } else {
      out.set(id, { lean, near, dir });
    }
  };

  for (const l of links) {
    const ax = positions.get(l.a);
    const bx = positions.get(l.b);
    if (ax === undefined || bx === undefined) continue;
    const affinity = Number.isFinite(l.affinity) ? Math.max(0, l.affinity) : 0;
    const near = Number.isFinite(l.closeness) ? clamp01(l.closeness) : 0;
    const dx = bx - ax;
    const dir = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    add(l.a, dir * affinity, near, dir);
    add(l.b, -dir * affinity, near, -dir);
  }

  for (const [id, v] of out) {
    const k = leanStrength.get(id);
    v.lean = clampDeg(v.lean * LEAN_DEG_PER_AFFINITY * (Number.isFinite(k) ? (k as number) : 1));
  }
  return out;
}

/**
 * 現在値を目標へ指数的に寄せる。dt に依存しない速さで減衰する。
 *
 * フレームレートが変わっても同じ速さで戻ること。`current * 0.9` のような
 * フレーム数依存の書き方だと、120Hz の端末で倍の速さで戻ってしまう。
 */
export function easeLean(current: number, target: number, dtMs: number): number {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return current;
  const k = 1 - Math.exp(-Math.min(dtMs, 1000) / LEAN_TAU_MS);
  const next = current + (target - current) * k;
  // 指数減衰は 0 に到達しない。十分近づいたら畳んで、
  // 誰の隣でもない子が永久に 0.0001 度だけ傾いたままになるのを防ぐ。
  return Math.abs(next - target) < 0.002 ? target : next;
}

/**
 * 関係を 1 フレーム進める。**DOM も React も触らない。**
 *
 * `created` をここで**必ず空にする**のが要点。`computeNeighbors` は
 * ペアごとに `created` を1回しか返さないが、それを受け皿に置いたまま
 * 毎フレーム `tickDirector` に渡し続けると、挨拶が自然に終わった次の
 * フレームで同じ `created` がまた挨拶を始める。指揮側は「走っている
 * greeting と同じペアの created」しか無視しないので、終わった瞬間の
 * 再開は止められない。結果、同じ2匹が 2〜3 秒ごとに永久に挨拶し続ける。
 *
 * 消費は `tickDirector` に渡した**後**、結果によらず行う。渡す前に
 * 空にすると挨拶が一度も起きず、条件付きで残すと上の無限ループに戻る。
 */
export function stepRelations(rel: ShelfRelations, now: number, rnd: () => number): void {
  const res = tickDirector(rel.director, rel.links, rel.created, rel.personalities, now, rnd);
  if (rel.created.length > 0) rel.created = [];
  rel.director = res.state;
  if (res.started || res.ended) rel.onTransition(res.started, res.ended);
}

/**
 * 棚のぬいぐるみに生活感を与える（仕様 5.4 / 6.1 / 依頼書 13 章）。
 *
 * 呼吸・瞬き・隣を見る動きに加えて、隣接関係から生まれる
 * **常時層（寄りかかり・呼吸同期）** と **挿話層（look / sameDirection /
 * sleepTogether / greeting）** を、単一の rAF ループから DOM 属性の
 * 直接書き換えで行う。
 *
 * **React の再レンダーを一切発生させない。** 12匹が同時に呼吸していても、
 * 挿話が走っていても、コンポーネントツリーは静止したままになる。
 * 唯一 React に届くのは `relations.onTransition` で、これは挿話が
 * 始まった／終わった瞬間にしか呼ばれない。
 *
 * ceremony 再生中やアーケード画面では enabled=false にして完全に止める。
 * ポーズを props で制御したい場面と、このフックは同時に使わない。
 */
export function useAmbientLife(
  registry: Registry,
  targets: AmbientTarget[],
  enabled: boolean,
  relations?: RefObject<ShelfRelations>
): void {
  // targets は毎レンダー新しい配列になるので、比較用のキーで依存を安定させる
  const key = targets
    .map((t) => `${t.instanceId}:${t.personalitySeed.toFixed(4)}:${t.x}:${t.shelfRow}`)
    .join("|");

  /**
   * いま実際に付いている傾き。**エフェクトの張り直しを跨いで残す。**
   *
   * 配置が確定すると `key` が変わってエフェクトが作り直されるが、
   * リンクが切れたことによる「ゆっくり戻る」はまさにその瞬間に始まる。
   * ここをエフェクトの中に置くと、離した瞬間に傾きが 0 から始まり直して
   * 見た目には**瞬時に戻った**ことになり、仕様5.7 が消える。
   */
  const leanNowRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) return;
    if (typeof requestAnimationFrame !== "function") return;

    const list = targets.filter((t) => t.shelfRow >= 0);
    if (list.length === 0) return;

    const now = performance.now();
    const lives = new Map<string, Life>(
      list.map((t) => [t.instanceId, makeLife(t.personalitySeed, now)])
    );

    // 棚から居なくなった個体の傾きは捨てる。残すと Map が延々と育つ。
    const leanNow = leanNowRef.current;
    const alive = new Set(list.map((t) => t.instanceId));
    for (const id of [...leanNow.keys()]) if (!alive.has(id)) leanNow.delete(id);

    const positions = new Map(list.map((t) => [t.instanceId, t.x]));
    const leanStrength = new Map(
      list.map((t) => [t.instanceId, lives.get(t.instanceId)?.leanStrength ?? 1])
    );

    let relTargets = new Map<string, AmbientRelationTarget>();
    let builtRevision = Number.NaN;
    /** links が変わったときだけ目標値を作り直す。毎フレームは作らない。 */
    const relationTargetsFor = (rel: ShelfRelations | null): Map<string, AmbientRelationTarget> => {
      if (!rel) return relTargets;
      if (rel.revision !== builtRevision) {
        builtRevision = rel.revision;
        relTargets = ambientRelationTargets(positions, rel.links, leanStrength);
      }
      return relTargets;
    };

    let raf = 0;
    let running = true;
    let prevT = now;

    const frame = (t: number) => {
      if (!running) return;
      const dt = t - prevT;
      prevT = t;

      const rel = relations?.current ?? null;
      // 指揮は個体の描画より先に 1 ステップ進める。
      // 同じフレームの中で「今の状態」を全員が見るため。
      if (rel) stepRelations(rel, t, Math.random);
      const relTarget = relationTargetsFor(rel);

      const map = registry.current;
      if (map) {
        for (const target of list) {
          const el = map.get(target.instanceId);
          const life = lives.get(target.instanceId);
          if (!el || !life) continue;

          const rt = relTarget.get(target.instanceId);
          const near = rt?.near ?? 0;

          // 挿話の姿勢は **directorPose** で取る。`episodePose` を直接呼ぶと
          // 「打ち切られて中立へ戻りかけている挿話」が見えず、割り込みの
          // 瞬間に姿勢が飛ぶ（仕様5.4 の 300ms の後始末が消える）。
          const ep = rel ? directorPose(rel.director, target.instanceId, t) : null;

          // 呼吸: 個体ごとに位相をずらしたごく小さな上下。
          // 隣に誰かいると、呼吸の位相が少しずつ引き寄せられる。
          // 並んでいる2匹が同じリズムで息をしていると、
          // 「一緒にいる」ように見える。
          const phase = life.breathPhase * (1 - near * 0.55);
          const breath = Math.sin((t / life.breathPeriod) * Math.PI * 2 + phase);
          const sy = 1 + breath * 0.014;
          const sx = 1 - breath * 0.009;

          // 隣の方へごくわずかに傾く。寄りかかっているように見せる。
          // 目標へ**ゆっくり**寄せる。離された瞬間に 0 へ飛ばさない（仕様5.7）。
          const prevLean = leanNow.get(target.instanceId);
          const goal = rt?.lean ?? 0;
          const lean =
            prevLean === undefined ? goal : easeLean(prevLean, goal, dt);
          leanNow.set(target.instanceId, lean);

          // SVG の属性に NaN を流さない。壊れた 1 個の数値で
          // 個体まるごとが描画されなくなる（transform が無効だと消える）。
          const hop = num(ep?.hop);
          /**
           * 挿話の傾きは、**すでに寄りかかっている分だけ控えめにする。**
           *
           * 単純に足すと、深く寄りかかっている子（常時層で最大 3.5 度）に
           * `sleepTogether` の 4 度が乗って 7.5 度になる。実機で計測したところ
           * 実際に 7.25 度が出ており、それは「寄りかかっている」ではなく
           * 「倒れかけている」に見える。かといって合計を固定値で切ると、
           * 山の頂点で数フレーム止まって見え、動きが壊れて見える。
           *
           * 残っている余裕に比例させると連続なまま上限が付く。
           * 合計は lean + 4*(1 - lean/7) なので、最悪でも 5.5 度で頭打ちになり、
           * 誰の隣でもない子（lean=0）では挿話の振れ幅は元のまま残る。
           */
          const headroom = clamp01(1 - Math.abs(num(lean)) / TILT_HEADROOM_DEG);
          const tilt = num(lean) + num(ep?.tilt) * headroom;
          el.setAttribute(
            "transform",
            `translate(${target.x} ${(-hop).toFixed(2)}) rotate(${tilt.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)})`
          );

          // 瞬き。挿話の眠さ（eyeOpen）と重ねる。
          if (t >= life.nextBlink) {
            life.blinkUntil = t + BLINK_MS;
            life.nextBlink = t + life.blinkBase * (0.7 + Math.random() * 0.9);
          }
          const blinking = t < life.blinkUntil;
          const openness = clamp01(Math.min(blinking ? 0.2 : 1, ep ? ep.eyeOpen : 1));
          for (const eye of el.querySelectorAll<SVGEllipseElement>('[data-part="eye"]')) {
            const base = eye.dataset.baseRy ?? eye.getAttribute("ry") ?? "3.4";
            eye.dataset.baseRy = base;
            const baseRy = Number.parseFloat(base);
            const ry = (Number.isFinite(baseRy) ? baseRy : 3.4) * openness;
            eye.setAttribute("ry", ry.toFixed(2));
          }

          // 隣を見る
          const dir = rt?.dir ?? 0;
          if (dir !== 0 && t >= life.nextGlance) {
            life.glanceUntil = t + GLANCE_MS;
            life.glanceDir = dir;
            life.nextGlance = t + 5000 + Math.random() * 6000;
          }
          const face = el.querySelector<SVGGElement>('[data-part="face"]');
          if (face) {
            let look = 0;
            if (t < life.glanceUntil) {
              // 出入りをなめらかにする台形カーブ。
              // **0-1 に必ず収める。** 時計が巻き戻ると p が大きな負になり、
              // 顔の <g> が数千 px 外へ飛んで**顔が消える**（計測中に実際に出た）。
              // rAF のタイムスタンプは単調なので通常は起きないが、
              // 顔が消えるという壊れ方に対して 1 回の clamp は安い。
              const p = 1 - (life.glanceUntil - t) / GLANCE_MS;
              const ease = clamp01(Math.min(p, 1 - p) * 5);
              look = life.glanceDir * ease * GLANCE_PX;
            }
            look = num(look) + num(ep?.lookAt) * EPISODE_LOOK_PX;
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
        // 隠れていた間の経過を dt として扱わない。
        prevT = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);

      // 瞬きの途中で止まると目が閉じたままになる。挿話の途中で止まれば
      // 跳ねた高さや傾きが残る。**書き換えた属性を必ず元に戻してから抜ける。**
      const map = registry.current;
      if (!map) return;
      for (const target of list) {
        const el = map.get(target.instanceId);
        if (!el) continue;
        el.setAttribute("transform", `translate(${target.x} 0)`);
        for (const eye of el.querySelectorAll<SVGEllipseElement>('[data-part="eye"]')) {
          const base = eye.dataset.baseRy;
          if (base) eye.setAttribute("ry", base);
        }
        const face = el.querySelector<SVGGElement>('[data-part="face"]');
        face?.setAttribute("transform", "translate(0 0)");
      }
    };
    // targets は key で同一性を判定する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, registry, relations]);
}
