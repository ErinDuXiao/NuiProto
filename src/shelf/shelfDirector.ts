import { pairKey, type NeighborLink } from "./neighbors";

/**
 * 関係演出の指揮（仕様5.4）。
 *
 * 隣接リンクは「誰と誰が隣にいるか」までしか言わない。この指揮が
 * 「その関係で、いま何が起きるか」を決める。
 *
 * 設計の柱は3つ。
 *
 * 1. **純粋関数**。タイマーも rAF も React も持たない。`now` と乱数を引数で
 *    受け取り、状態は返り値として返す。棚の rAF ループから毎フレーム呼ばれても
 *    再レンダーを一切起こさないことが Task 6 の前提であり、そのためには
 *    「状態がここに閉じている」ことが要る。テストが 120 秒を 50ms 刻みで
 *    回せるのも、時間が引数だからである。
 *
 * 2. **挿話は棚全体で同時に高々1つ**（計画の Global Constraint）。
 *    2匹が見つめ合っている横で別の2匹が跳ねていると、棚は「生活」ではなく
 *    「キャラクター育成ゲームの画面」になる。偶然見つけた一場面に見せるには、
 *    同時に1つしか起きてはいけない。
 *
 * 3. **数値を出さない・喋らせない**。棚の関係リアクションは姿勢だけで表す。
 *    吹き出しはタップと出会いの儀式に限る。
 *
 * 中断の後始末を状態として持つ理由:
 * `greeting` が走っている挿話を打ち切るとき、打ち切られた側の姿勢を 300ms
 * かけて中立へ戻す。そのため「いま走っている挿話」と「消えかけている挿話」の
 * 2つを同時に保持する。片方しか持たないと、割り込みの瞬間に姿勢が飛ぶ。
 *
 * 眠さを affinity に混ぜない理由:
 * `affinity` は「どのリンクを選ぶか」の値。そこに眠さを混ぜると、眠い子の
 * リンクで `look` や `greeting` まで起きやすくなる。性格は `personalities`
 * として別に渡し、**挿話の種類を選ぶときにだけ**使う。
 *
 * `removed`（リンクが切れたこと）はこの指揮の入力に含めない。
 * 再読み込み直後、前回のセッションで箱へ戻した個体のキーが `neighborSince` に
 * 残っていると `removed` が1回出る（Task 4 の申し送り）。それを挿話に流すと
 * 「アプリを開いた瞬間に、いま起きていない別れが演じられる」ことになる。
 * 別れは切れた瞬間に見せる意味しかないので、指揮は `removed` を知らない。
 * 代わりに、走っている挿話の相手が `links` から消えたときはその場で打ち切る
 * （下の `stillLinked` を参照）。これは「いま起きたこと」なので演じてよい。
 */

export type EpisodeKind = "look" | "sameDirection" | "sleepTogether" | "greeting";

export type Episode = {
  kind: EpisodeKind;
  /** 辞書順で小さい方の instanceId（NeighborLink と同じ向き） */
  a: string;
  b: string;
  startedAt: number;
  durationMs: number;
};

export type DirectorState = {
  /** いま走っている挿話 */
  episode: Episode | null;
  /** 打ち切られて中立へ戻りかけている挿話 */
  fading: { episode: Episode; until: number } | null;
  /** 次の挿話を始めてよい時刻 */
  nextAt: number;
};

/** 挿話の種類選びにだけ使う個体の性格。affinity には混ぜない。 */
export type Personality = { sleepiness: number };

/** 挿話と挿話の間隔（下限）。 */
export const EPISODE_MIN_GAP_MS = 6000;
/** 挿話と挿話の間隔（上限）。 */
export const EPISODE_MAX_GAP_MS = 14000;
/** 挿話の長さ（下限）。 */
export const EPISODE_MIN_MS = 2000;
/** 挿話の長さ（上限）。 */
export const EPISODE_MAX_MS = 3000;
/** 打ち切られた挿話が中立へ戻るまでの時間。 */
export const FADE_MS = 300;

/** 自発的に起きる挿話の種類。`greeting` は新しいリンクからしか起きない。 */
const SPONTANEOUS_KINDS: readonly EpisodeKind[] = ["look", "sameDirection", "sleepTogether"];

/** 挿話の役ごとの立ち上がりの遅れ（挿話の長さに対する比）。 */
const ROLE_DELAY: Record<EpisodeKind, [number, number]> = {
  // 片方が先に見て、もう片方が気づいて見返す
  look: [0, 0.2],
  // ほぼ同時に同じ方を向く。わずかにずらして「示し合わせ」に見せない
  sameDirection: [0, 0.15],
  // 同時にうとうとする
  sleepTogether: [0, 0.08],
  // 挨拶して、挨拶が返る
  greeting: [0, 0.3],
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * 重み付きルーレット。**最大値固定にしない。**
 *
 * 常に最も親密なリンクを選ぶと、棚に3匹以上いても同じ2匹の場面しか
 * 起きなくなり、「たまたま見かけた」感覚が消える。累積和を作って乱数で切る。
 *
 * 重みが全部 0（あるいは非有限）のときは一様に選ぶ。ここで -1 を返して
 * 「何も起きない」にすると、親密度が偶然 0 になった盤面で棚が永久に
 * 沈黙してしまう。
 */
function rouletteIndex(weights: number[], r: number): number {
  if (weights.length === 0) return -1;
  let total = 0;
  for (const w of weights) if (Number.isFinite(w) && w > 0) total += w;
  const x = clamp01(finiteOr(r, 0));
  if (total <= 0) return Math.min(weights.length - 1, Math.floor(x * weights.length));
  let acc = x * total;
  let last = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = Number.isFinite(weights[i]) && weights[i] > 0 ? weights[i] : 0;
    if (w > 0) last = i;
    acc -= w;
    if (acc < 0) return i;
  }
  // 浮動小数の誤差で落ちてきた場合は最後の有効な枠に寄せる
  return last;
}

/**
 * 選択に使えるリンクだけを、**入力配列の順序に依存しない**形に正規化する。
 *
 * 保存データの並び順は保証されない。並び順で挿話の相手が変わると、
 * 同じ盤面なのに「読み込み直したら別の子の場面ばかり起きる」ことになる。
 * pairKey で全順序に並べ替え、同じペアが2本来た場合は親密度の高い方を残す。
 */
function canonicalLinks(links: NeighborLink[]): NeighborLink[] {
  const byKey = new Map<string, NeighborLink>();
  for (const l of links) {
    if (typeof l?.a !== "string" || typeof l?.b !== "string") continue;
    if (l.a === "" || l.b === "" || l.a === l.b) continue;
    const key = pairKey(l.a, l.b);
    const seen = byKey.get(key);
    if (!seen || finiteOr(l.affinity, 0) > finiteOr(seen.affinity, 0)) byKey.set(key, l);
  }
  return [...byKey.keys()].sort().map((k) => byKey.get(k)!);
}

/** 性格表から眠さを読む。無ければ 0（分からないものを盛らない）。 */
function sleepinessOf(personalities: Record<string, Personality>, id: string): number {
  if (!personalities || !Object.prototype.hasOwnProperty.call(personalities, id)) return 0;
  const p = personalities[id];
  return p && Number.isFinite(p.sleepiness) ? clamp01(p.sleepiness) : 0;
}

/**
 * 挿話の種類の重み。`sleepTogether` だけが性格で動く。
 * `look` / `sameDirection` は一定 — 眠くない子でも棚は静かに動き続ける。
 */
function kindWeights(link: NeighborLink, personalities: Record<string, Personality>): number[] {
  const sleepy = (sleepinessOf(personalities, link.a) + sleepinessOf(personalities, link.b)) / 2;
  return [1, 1, 2 * sleepy];
}

function durationOf(rnd: () => number): number {
  return EPISODE_MIN_MS + clamp01(finiteOr(rnd(), 0)) * (EPISODE_MAX_MS - EPISODE_MIN_MS);
}

function gapOf(rnd: () => number): number {
  return EPISODE_MIN_GAP_MS + clamp01(finiteOr(rnd(), 0)) * (EPISODE_MAX_GAP_MS - EPISODE_MIN_GAP_MS);
}

/**
 * 新しくできたリンクのうち、挨拶を1本だけ選ぶ。
 *
 * 1回の配置確定で複数のリンクができることはある（3匹の間に置いたとき）。
 * 全部で挨拶させると棚が一斉に跳ねて騒がしくなるので、最も親密な1本に絞る。
 * 同値なら pairKey の小さい方 — 入力順で結果を変えないため。
 */
function pickCreatedLink(created: string[], byKey: Map<string, NeighborLink>): NeighborLink | null {
  let best: NeighborLink | null = null;
  let bestKey = "";
  for (const key of created) {
    const l = byKey.get(key);
    if (!l) continue;
    const affinity = finiteOr(l.affinity, 0);
    if (!best || affinity > finiteOr(best.affinity, 0) || (affinity === finiteOr(best.affinity, 0) && key < bestKey)) {
      best = l;
      bestKey = key;
    }
  }
  return best;
}

export function createDirector(now: number): DirectorState {
  const t = finiteOr(now, 0);
  return { episode: null, fading: null, nextAt: t + EPISODE_MIN_GAP_MS };
}

/**
 * 指揮を 1 ステップ進める。**入力（s / links / created / personalities）を
 * 一切書き換えない。**
 *
 * 返り値の `started` / `ended` はその瞬間に起きた遷移だけを報告する。
 * Task 6 はここが null でないときだけ setState / ログを行い、
 * それ以外のフレームでは React に触れない。
 */
export function tickDirector(
  s: DirectorState,
  links: NeighborLink[],
  created: string[],
  personalities: Record<string, Personality>,
  now: number,
  rnd: () => number
): { state: DirectorState; started: Episode | null; ended: Episode | null } {
  if (!Number.isFinite(now)) return { state: s, started: null, ended: null };

  let episode = s.episode;
  let fading = s.fading;
  let nextAt = finiteOr(s.nextAt, now + EPISODE_MIN_GAP_MS);
  let started: Episode | null = null;
  let ended: Episode | null = null;

  // 1. 消えかけの挿話が消え終わったら捨てる
  if (fading && !(Number.isFinite(fading.until) && now < fading.until)) fading = null;

  const usable = canonicalLinks(links);
  const byKey = new Map(usable.map((l) => [pairKey(l.a, l.b), l]));

  // 2. 新しいリンクの挨拶は、走っている挿話に割り込んでよい。
  //    置いた直後に何も起きないと「置いたこと」への反応が消えてしまう（仕様5.7）。
  //
  //    ただし、いま走っている greeting と同じペアの created は無視する。
  //    computeNeighbors はペアごとに created を1回しか出さないが、Task 6 は
  //    毎フレーム tickDirector を呼ぶ側であり、「配置確定時の created を
  //    ref に保持してそのまま渡し続ける」実装は自然にありうる。そこで
  //    無条件に再スタートすると、挨拶が完走する前に毎フレーム startedAt が
  //    now に置き換わり続け、姿勢は開始直後の一瞬（u がほぼ0）に凍り付いたまま
  //    挨拶が一生「終わらない」（レビューで実測: 2秒で41回開始・40回終了、
  //    hop は 0.082 に固着）。加えて Task 6 は非nullの started を見て
  //    setState する仕様なので、それが毎フレーム発火し続け、
  //    「物理と React の分離を維持する」という Global Constraint を破る。
  //
  //    同じペアだけを除外し、他のペアはそのまま created として扱うのが要点。
  //    こうすれば「違うペアの挨拶は割り込んでよい」という元々の意図
  //    （素早く2匹目・3匹目を置いたときの反応）はそのまま保たれる。
  const runningGreetKey =
    episode && episode.kind === "greeting" ? pairKey(episode.a, episode.b) : null;
  const creatable = runningGreetKey ? created.filter((key) => key !== runningGreetKey) : created;
  const greet = pickCreatedLink(creatable, byKey);
  if (greet) {
    if (episode) {
      ended = episode;
      fading = { episode, until: now + FADE_MS };
    }
    episode = { kind: "greeting", a: greet.a, b: greet.b, startedAt: now, durationMs: durationOf(rnd) };
    started = episode;
  } else if (episode) {
    const stillLinked = byKey.has(pairKey(episode.a, episode.b));
    if (!stillLinked) {
      // 相手が隣でなくなった（動かされた／箱へ戻された）。演じ続ける相手がいない。
      ended = episode;
      fading = { episode, until: now + FADE_MS };
      episode = null;
      nextAt = now + gapOf(rnd);
    } else if (now >= episode.startedAt + episode.durationMs) {
      // 3. 自然に終わる。姿勢は包絡線で既に中立へ戻っているので fading は要らない。
      ended = episode;
      episode = null;
      nextAt = now + gapOf(rnd);
    }
  }

  // 4. 間隔を置いて次の挿話。終わったのと同じフレームでは始まらない
  //    （上で nextAt を now より先へ動かしているため）。
  if (!episode && now >= nextAt && usable.length > 0) {
    const link = usable[rouletteIndex(usable.map((l) => finiteOr(l.affinity, 0)), rnd())];
    const kind = SPONTANEOUS_KINDS[rouletteIndex(kindWeights(link, personalities), rnd())];
    episode = { kind, a: link.a, b: link.b, startedAt: now, durationMs: durationOf(rnd) };
    started = episode;
  }

  if (episode === s.episode && fading === s.fading && nextAt === s.nextAt) {
    // 参照を保つ。毎フレーム新しいオブジェクトを返すと、呼び出し側が
    // うっかり state に入れたときに再レンダーの原因になる。
    return { state: s, started, ended };
  }
  return { state: { episode, fading, nextAt }, started, ended };
}

export type EpisodePose = { lookAt: number; hop: number; eyeOpen: number; tilt: number };

/**
 * 挿話が無い・関与していないときに返す共有の中立姿勢。
 *
 * `Object.freeze` で凍らせる理由: 計画の Task 6 は「episodePose の結果を
 * 上乗せする」と書いており、実装が `p.tilt += lean` のような in-place の
 * 加算になる可能性がある。凍らせていないと、この関数が返す共有オブジェクトへの
 * 書き込みがモジュールの NEUTRAL そのものを永久に書き換え、以後すべての個体・
 * すべての呼び出しの中立姿勢が汚染される — 「モジュールレベルの可変状態を
 * 持たない」という純粋性の要件が、公開 API の返り値経由で破られる形になる。
 *
 * 対案（毎回 `{ ...NEUTRAL }` を新規に返す）ではなくこちらを選んだのは、
 * ESM は常に strict mode なので、凍結後の書き込みはその場で TypeError に
 * なって即座に気づけるから。この関数は棚の毎フレーム・毎個体で呼ばれる
 * 経路なので、書き込みを検出できるなら余計な割り当てをしない方がよい。
 */
const NEUTRAL: EpisodePose = Object.freeze({ lookAt: 0, hop: 0, eyeOpen: 1, tilt: 0 });

/**
 * 挿話内の局所時間。`delay` の分だけ遅れて始まり、挿話の終わりで必ず 0 に戻る。
 *
 * 遅れた側の窓を後ろへずらすのではなく縮めるのが要点。ずらすと、挿話が
 * 終わったのに片方だけ姿勢が残る。
 */
function phaseOf(u: number, delay: number): { v: number; env: number } {
  if (!(u > delay) || !(delay < 1)) return { v: 0, env: 0 };
  const v = clamp01((u - delay) / (1 - delay));
  return { v, env: Math.sin(Math.PI * v) };
}

/** ペアから決まる向き。両者で同じ値になることが `sameDirection` の前提。 */
function pairDirection(a: string, b: string): number {
  const key = pairKey(a, b);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2 === 0 ? -1 : 1;
}

/**
 * 1つの挿話が、その瞬間に個体へ与える姿勢の差分。
 *
 * 関与していない個体には中立をそのまま返す。挿話の外（開始前・終了後）でも
 * 中立。**終了時刻ちょうどで厳密に中立**であることが要る — わずかでも残ると、
 * 挿話が終わったあとの棚に理由のない傾きが残り続ける。
 */
export function episodePose(ep: Episode, instanceId: string, now: number): EpisodePose {
  const isA = instanceId === ep.a;
  const isB = instanceId === ep.b;
  if (!isA && !isB) return NEUTRAL;
  if (!Number.isFinite(now)) return NEUTRAL;

  const startedAt = finiteOr(ep.startedAt, 0);
  const durationMs = Number.isFinite(ep.durationMs) && ep.durationMs > 0 ? ep.durationMs : EPISODE_MIN_MS;
  const u = (now - startedAt) / durationMs;
  if (u <= 0 || u >= 1) return NEUTRAL;

  const delays = ROLE_DELAY[ep.kind];
  if (!delays) return NEUTRAL;
  const { v, env } = phaseOf(u, isA ? delays[0] : delays[1]);
  if (env <= 0) return NEUTRAL;

  // 「相手の方」= a から見て右、b から見て左。リンクの a/b は辞書順であって
  // 棚の左右ではないが、2匹が互いに逆を向くことだけが要点なので符号で足りる。
  const toward = isA ? 1 : -1;

  switch (ep.kind) {
    case "look":
      return { lookAt: toward * 0.85 * env, hop: 0, eyeOpen: 1, tilt: toward * 3 * env };
    case "sameDirection": {
      const dir = pairDirection(ep.a, ep.b);
      return { lookAt: dir * 0.7 * env, hop: 0, eyeOpen: 1, tilt: dir * 2 * env };
    }
    case "sleepTogether":
      return { lookAt: 0, hop: 0, eyeOpen: 1 - 0.8 * env, tilt: toward * 4 * env };
    case "greeting":
      return {
        lookAt: toward * 0.6 * env,
        hop: 7 * env * Math.abs(Math.sin(Math.PI * 3 * v)),
        eyeOpen: 1,
        tilt: toward * 3 * env,
      };
  }
}

/**
 * 走っている挿話と消えかけの挿話を合成した姿勢。
 *
 * 消えかけの方は「打ち切られた瞬間の姿勢」を残り時間の比率で 0 へ縮める。
 * 打ち切り後に時間を進め続けると、中立へ戻る途中でさらに演技が進んでしまい、
 * 「割り込まれたのに動き続けている」ように見える。
 */
export function directorPose(s: DirectorState, instanceId: string, now: number): EpisodePose {
  let lookAt = 0;
  let hop = 0;
  let tilt = 0;
  let eyeClose = 0;

  const add = (ep: Episode, at: number, k: number) => {
    const p = episodePose(ep, instanceId, at);
    lookAt += p.lookAt * k;
    hop += p.hop * k;
    tilt += p.tilt * k;
    eyeClose += (1 - p.eyeOpen) * k;
  };

  if (s.episode) add(s.episode, now, 1);
  if (s.fading && Number.isFinite(s.fading.until)) {
    const k = clamp01((s.fading.until - now) / FADE_MS);
    if (k > 0) add(s.fading.episode, s.fading.until - FADE_MS, k);
  }

  return {
    lookAt: clamp(lookAt, -1, 1),
    hop: clamp(hop, -20, 20),
    eyeOpen: clamp01(1 - eyeClose),
    tilt: clamp(tilt, -10, 10),
  };
}
