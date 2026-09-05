import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlush } from "../data/plushies";
import { pickLine } from "../data/lines";
import { PlushSVG } from "../render/PlushSVG";
import { individuality, NEUTRAL_POSE, plushTop, type Pose } from "../render/pose";
import {
  useAmbientLife,
  type AmbientTarget,
  type ShelfRelations,
} from "../render/useAmbientLife";
import { sfx } from "../audio/sfx";
import { store, useGame } from "../state/store";
import { computeNeighbors, pairKey } from "./neighbors";
import { createDirector, type Episode, type Personality } from "./shelfDirector";
import { SHELF, rowY } from "./shelfLayout";
import { useDragPlacement } from "./useDragPlacement";
import { useCeremony, CeremonyActors, CeremonyOverlay } from "./MeetingCeremony";
import { PlushProfile } from "./PlushProfile";

type Props = {
  onGoArcade: () => void;
  onShare: () => void;
  /** 隅の小さなドット。3回押すと Developer Menu が開く（依頼書25章） */
  onSecretTap: () => void;
};

type Bubble = { instanceId: string; text: string; until: number };

/**
 * 隣接を計算し直す間隔 (ms)。
 *
 * 配置が確定したときだけでは `togetherMs` が伸びない。仕様5.7 の
 * 「しばらくすると寄りかかりが強くなる（togetherMs が伸びる）」は
 * 眺めている最中に起きなければ意味がないので、位置が変わらなくても
 * 低頻度で計算し直す。`computeNeighbors` は純粋で、位置が同じなら
 * リンクの構成も `neighborSince` も変わらない（`store.setNeighborSince`
 * は同じ内容なら書き込まない）。伸びるのは `togetherMs` だけ。
 */
const NEIGHBOR_REFRESH_MS = 5000;

/**
 * `relationship_reaction` をログに残す最短間隔 (ms)。
 *
 * ここは「記録の量」ではなく**指標 D の正しさ**で決まる。依頼書22章の D は
 * 「`relationship_reaction` から 30 秒以内の `plush_drag_end`」＝
 * 関係の演出を見て並べ替えたか、を数える。間引きすぎると
 * 「記録されなかった演出をきっかけにした並べ替え」が指標から丸ごと消え、
 * D は粗くなるのではなく**過小に出る**（1分に1件では挿話の 1/7 しか
 * 記録されず、残り 6/7 に反応した並べ替えは誰にも見えない）。
 *
 * 挿話の開始間隔は最大 17 秒（間隔 6〜14 秒 + 長さ 2〜3 秒）なので、
 * 最短間隔を 12 秒にすると記録どうしの空白は最悪でも 12 + 17 = 29 秒 < 30 秒。
 * 「棚で演出が起きている間、どの 30 秒窓にも必ず 1 件は記録がある」ことが
 * 保証され、D は取りこぼさない。それでいて記録は 1 時間あたり 300 件以下に
 * 収まるので、2000 件のリングバッファは 6 時間以上の連続凝視に耐える。
 */
const REACTION_LOG_GAP_MS = 12_000;

/** 何も操作せずに眺めていられた時間の観測点 (ms)。仕様5.8。 */
const IDLE_MARKS = [10_000, 30_000] as const;

/** 隣接キー（`pairKey` が作る "a|b"）がこの個体を含むか。 */
function keyInvolves(key: string, instanceId: string): boolean {
  const [a, b] = key.split("|");
  return a === instanceId || b === instanceId;
}

/**
 * 棚画面 = ぬいぐるみたちが暮らしている小さな部屋。
 *
 * 「インベントリ」や「コレクション一覧」に見せてはいけない（依頼書4章A）。
 * グリッド線・枠・通し番号・収集率（"2/10"）は一切出さない。
 */
export function ShelfScreen({ onGoArcade, onShare, onSecretTap }: Props) {
  const game = useGame();
  const refs = useRef(new Map<string, SVGGElement | null>());
  const svgRef = useRef<SVGSVGElement>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [squashed, setSquashed] = useState<Record<string, number>>({});
  /** 演出中はタップのリアクションを止める。コールバックを作り直さずに済ませる */
  const ceremonyActiveRef = useRef(false);
  /** touch コールバックを作り直さずに最新の所持品を読むため */
  const instancesRef = useRef(game.instances);
  instancesRef.current = game.instances;
  /** ドラッグフックへ渡すタップ処理。実体は下で差し込む */
  const touchRef = useRef<(instanceId: string) => void>(() => {});
  /** アンマウント後に発火させないための後片付け */
  const squashTimers = useRef(new Set<number>());
  const ringTimer = useRef(0);
  /** 迎えたばかりの子。少しの間だけ淡いリングを出す（仕様8章） */
  const [ringId, setRingId] = useState<string | null>(null);
  /** タップ中の子。プロフィールカードを出す対象（仕様4.6: リアクションと同時に開く） */
  const [profileId, setProfileId] = useState<string | null>(null);

  /**
   * 棚の関係。**React の state ではない。**
   *
   * リンクも指揮の状態も毎フレーム参照されるが、毎フレーム再レンダーを
   * 起こしてはならない（Global Constraint）。ここに置いて rAF から
   * 直接読み書きし、React へは挿話の開始・終了の瞬間だけ知らせる。
   */
  const relationsRef = useRef<ShelfRelations>({
    links: [],
    revision: 0,
    personalities: {},
    created: [],
    // 指揮の時刻軸は rAF のタイムスタンプ（performance.now）と同じでなければ
    // ならない。Date.now を混ぜると nextAt が 50 年先になる。
    director: createDirector(typeof performance !== "undefined" ? performance.now() : 0),
    onTransition: () => {},
  });
  /** 起動直後の1回目の隣接計算か。復元と配置確定を区別する（仕様5.4） */
  const firstNeighborPassRef = useRef(true);
  /**
   * この画面が立ち上がった時点で、まだ演出を終えていない「迎えたばかりの子」。
   *
   * 獲得のたびに App は棚を作り直す（アーケードへ行って戻ってくる）ので
   * `firstNeighborPassRef` は必ず true から始まる。一方、出会いの演出が
   * 走っている間は隣接を計算しないので、**1回目の計算は演出が終わったあと**に
   * ずれ込む。それを「起動直後の復元」と同じ扱いにすると、いま迎えたばかりの
   * 子のリンク — `store.findSlot` が必ず既存の子の隣を選ぶので必ず1本できる —
   * が「前のセッションから続いていた関係」として捨てられ、挨拶も
   * `neighbor_created` も永久に起きない。この機能でいちばん見せたい瞬間が
   * 消える経路なので、誰が「いま来た子」かをここに控えておき、
   * その子のリンクだけは1回目でも「いま起きた変化」として扱う。
   */
  const arrivedGuestRef = useRef<string | null>(store.get().pendingWelcome);
  /** ドラッグ中か。コールバックを作り直さずに読む */
  const draggingRef = useRef(false);
  /**
   * 直近で relationship_reaction を記録した時刻。
   * 単位は**挿話の時計**（rAF のタイムスタンプ）であって Date.now ではない。
   */
  const lastReactionLogRef = useRef(Number.NEGATIVE_INFINITY);
  /** 「何も操作していない時間」を測り直す。操作のたびに呼ぶ */
  const idleResetRef = useRef<() => void>(() => {});

  useEffect(
    () => () => {
      for (const t of squashTimers.current) window.clearTimeout(t);
      squashTimers.current.clear();
      window.clearTimeout(ringTimer.current);
    },
    []
  );

  const ceremonyId = game.pendingWelcome;
  const onShelf = useMemo(
    () => game.instances.filter((o) => o.shelfRow >= 0),
    [game.instances]
  );

  const ceremony = useCeremony(ceremonyId, !game.firstMeetingDone, (skipped) => {
    const arrived = store.get().pendingWelcome;
    store.finishWelcome(skipped);
    if (arrived) {
      setRingId(arrived);
      window.clearTimeout(ringTimer.current);
      ringTimer.current = window.setTimeout(() => setRingId(null), 2000);
    }
  });
  ceremonyActiveRef.current = ceremony.active;

  const targets: AmbientTarget[] = useMemo(
    () =>
      onShelf.map((o) => ({
        instanceId: o.instanceId,
        personalitySeed: o.personalitySeed,
        x: o.x,
        shelfRow: o.shelfRow,
      })),
    [onShelf]
  );

  /**
   * 挿話の種類選びに使う性格（仕様5.6）。個体の集合が変わったときだけ作り直す。
   *
   * `game.instances` の参照はログ書き込みでは変わらないので、
   * ここが再計算されるのは実際に個体が増減・移動したときだけ。
   */
  const personalities = useMemo(() => {
    const map: Record<string, Personality> = {};
    for (const o of onShelf) {
      map[o.instanceId] = { sleepiness: individuality(o.personalitySeed).sleepiness };
    }
    return map;
  }, [onShelf]);

  /**
   * 挿話の開始・終了。**ここだけが rAF から React に届く経路**であり、
   * 毎フレームではなく遷移の瞬間にしか呼ばれない。
   */
  const onTransition = useCallback((started: Episode | null) => {
    if (!started) return;
    // 間引きの基準は挿話と同じ時計（rAF のタイムスタンプ）を使う。Date.now は
    // 端末の時刻設定やスリープ復帰で飛ぶことがあり、未来へ飛ぶと以後の演出が
    // 長時間まったく記録されなくなる。startedAt なら挿話の間隔と同じ物差しで
    // 「29 秒以内に必ず1件」を保証できる（REACTION_LOG_GAP_MS のコメント）。
    if (started.startedAt - lastReactionLogRef.current < REACTION_LOG_GAP_MS) return;
    lastReactionLogRef.current = started.startedAt;
    // meta は Task 10 の集計（依頼書22章 指標 D）が読む形にする。
    // `kind` だけでは誰と誰の反応か分からず、D も E も組み立てられない。
    store.log("relationship_reaction", {
      meta: { source: started.a, target: started.b, reactionType: started.kind },
    });
  }, []);

  // ref の中身をレンダー中に差し替える。instancesRef と同じ扱い。
  relationsRef.current.personalities = personalities;
  relationsRef.current.onTransition = onTransition;

  const { onPointerDown, drag } = useDragPlacement({
    instances: game.instances,
    svgRef,
    enabled: !ceremony.active,
    onTap: (instanceId) => touchRef.current(instanceId),
  });
  draggingRef.current = drag !== null;

  /**
   * 隣接を計算し直す（仕様5.7）。
   *
   * **ドラッグ中は決して呼ばない。** ポインタの移動ごとに再計算すると
   * writeSave が毎フレーム走り、リンクの生成と消滅が連打される。
   */
  const recomputeNeighbors = useCallback(() => {
    if (draggingRef.current || ceremonyActiveRef.current) return;
    const rel = relationsRef.current;
    const res = computeNeighbors(
      instancesRef.current,
      rel.links,
      store.get().neighborSince,
      Date.now()
    );
    rel.links = res.links;
    rel.revision += 1;
    store.setNeighborSince(res.neighborSince);

    /**
     * 起動直後の1回目は「保存されていた関係の復元」であって、
     * いま起きた変化ではない。仕様5.4:「起動直後や移行直後に大量の
     * リンクが『新規』として検出される場合は挨拶しない」。
     *
     * removed も同じ理由で捨てる。前のセッションで箱へ戻した個体の
     * キーが neighborSince に残っていると、ここで一度だけ removed に
     * 現れる（Task 4 の申し送り）。それを「いま別れた」として記録すると、
     * 何日も前の別れに今日の時刻が付く。傾きも、復元直後は
     * 寄りかかっていないので戻すものがない。
     *
     * **「演出で遅れただけの1回目」は復元ではない。** 迎えたばかりの子
     * （`arrivedGuestRef`）のリンクだけは、1回目でも復元から除外する。
     * その子は数秒前にクレーンから帰ってきて、いま既存の子の隣に置かれた
     * ばかりであり、そのリンクこそプレイヤーに見せるべき「いま生まれた関係」
     * だからである。それ以外のリンクは、この子が来る前から棚にあった関係＝
     * 復元なので、これまでどおり黙って受け入れる。
     */
    const restoring = firstNeighborPassRef.current;
    firstNeighborPassRef.current = false;
    const guest = arrivedGuestRef.current;
    const created = restoring
      ? res.created.filter((key) => guest !== null && keyInvolves(key, guest))
      : res.created;
    const removed = restoring ? [] : res.removed;

    /**
     * `sameType` を meta に載せる。Task 10 の指標 E（同じ種類を隣に置くか）が
     * `neighbor_created` の `meta.sameType` を数えるため、ここで付けておかないと
     * 集計側が棚の実装まで遡ることになる。
     */
    const linkByKey = new Map(res.links.map((l) => [pairKey(l.a, l.b), l]));
    const sameTypeOf = (key: string): boolean => {
      const l = linkByKey.get(key);
      // 消えたリンクはもう res.links にいないので、個体から引き直す。
      if (l) return l.sameType;
      const [x, y] = key.split("|");
      const px = instancesRef.current.find((o) => o.instanceId === x);
      const py = instancesRef.current.find((o) => o.instanceId === y);
      // 個体が見つからないなら「同じ種類」とは言えない。分からないものを埋めない。
      return px !== undefined && py !== undefined && px.plushTypeId === py.plushTypeId;
    };

    for (const key of created) store.log("neighbor_created", { meta: { sameType: sameTypeOf(key) } });
    for (const key of removed) store.log("neighbor_removed", { meta: { sameType: sameTypeOf(key) } });

    if (created.length > 0) {
      // まだ消費されていない created が残っていることがある（演出中など）。
      // 取りこぼさず、同じキーを二重に積まない。
      const pending = new Set(rel.created);
      for (const key of created) pending.add(key);
      rel.created = [...pending];
    }
  }, []);

  // 配置が確定したとき（= instances が変わったとき）とドラッグが終わったときに回す。
  useEffect(() => {
    recomputeNeighbors();
  }, [game.instances, drag !== null, ceremony.active, recomputeNeighbors]);

  // togetherMs を伸ばすためだけの低頻度の更新。React には触れない。
  useEffect(() => {
    const id = window.setInterval(recomputeNeighbors, NEIGHBOR_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [recomputeNeighbors]);

  // 演出中・ドラッグ中は環境アニメーションを止める。
  // ambient が transform を書き換えると、掴んだ位置とずれてしまう。
  useAmbientLife(refs, targets, !ceremony.active && drag === null, relationsRef);

  // 滞在時間を計る。「一覧として消費されている」か「眺めている」かを見分ける指標（仕様17.2）
  useEffect(() => {
    store.log("shelf_view");
    const enteredAt = Date.now();
    return () => {
      store.log("shelf_dwell", { meta: { ms: Date.now() - enteredAt } });
    };
  }, []);

  /**
   * 何も操作せずに眺めていられた時間（仕様5.8）。
   *
   * 「滞在時間」ではなく「無操作で続いた時間」を測る。触ったら測り直す。
   * 記録は 1 回の滞在につき各 1 件まで — 眺め続けている人ほどログが
   * 増えるのでは、リングバッファを押し流すだけで何も分からない。
   */
  useEffect(() => {
    const timers: number[] = [];
    const fired = new Set<number>();
    const arm = () => {
      for (const t of timers) window.clearTimeout(t);
      timers.length = 0;
      for (const ms of IDLE_MARKS) {
        if (fired.has(ms)) continue;
        timers.push(
          window.setTimeout(() => {
            fired.add(ms);
            store.log(ms === 10_000 ? "shelf_idle_10s" : "shelf_idle_30s");
          }, ms)
        );
      }
    };
    idleResetRef.current = arm;
    arm();
    return () => {
      for (const t of timers) window.clearTimeout(t);
      idleResetRef.current = () => {};
    };
  }, []);

  // 吹き出しの寿命管理
  useEffect(() => {
    if (bubbles.length === 0) return;
    const id = window.setTimeout(() => {
      setBubbles((b) => b.filter((x) => x.until > Date.now()));
    }, 400);
    return () => window.clearTimeout(id);
  }, [bubbles]);

  const touch = useCallback(
    (instanceId: string) => {
      if (ceremonyActiveRef.current) return;
      const target = instancesRef.current.find((o) => o.instanceId === instanceId);
      if (!target) return;
      const { plushTypeId, personalitySeed } = target;
      sfx.init();
      sfx.place();
      store.log("plush_touched", { plushId: plushTypeId });
      setBubbles((b) => [
        ...b.filter((x) => x.instanceId !== instanceId),
        {
          instanceId,
          text: pickLine("shelfTouch", personalitySeed, Math.floor(Date.now() / 1000)),
          until: Date.now() + 2200,
        },
      ]);
      setSquashed((s) => ({ ...s, [instanceId]: Date.now() }));
      // リアクション（潰れ＋セリフ）とプロフィールは同時に起きる（仕様4.6）。
      // どちらかを起こしてどちらかを起こさない、は「一連の動作」を壊す。
      setProfileId(instanceId);
      const timer = window.setTimeout(() => {
        squashTimers.current.delete(timer);
        setSquashed((s) => {
          const next = { ...s };
          delete next[instanceId];
          return next;
        });
      }, 460);
      squashTimers.current.add(timer);
    },
    []
  );

  touchRef.current = touch;

  return (
    <div className="screen shelf">
      <header className="shelf-header">
        <span className="shelf-title">ぬいぐるみのおうち</span>
        <span className="shelf-count">おともだち {game.instances.length}</span>
        <MuteToggle />
      </header>

      <div className="room-wrap">
      <svg
        ref={svgRef}
        className="room"
        viewBox={`0 0 ${SHELF.width} ${SHELF.height + 53}`}
        role="img"
        aria-label="ぬいぐるみの部屋"
      >
        <Room />

        <CeremonyActors ceremony={ceremony} />

        {onShelf.map((o) => {
          if (ceremony.stagedIds.has(o.instanceId)) return null;
          const def = getPlush(o.plushTypeId);
          const dragging = drag?.instanceId === o.instanceId && drag.moved;
          const x = dragging ? drag.x : o.x;
          const row = dragging ? drag.shelfRow : o.shelfRow;
          const y = rowY(row);
          const pose = poseFor(squashed[o.instanceId], dragging);
          const bubble = bubbles.find((b) => b.instanceId === o.instanceId);
          return (
            <g key={o.instanceId} transform={`translate(0 ${y})`} opacity={dragging ? 0.92 : 1}>
              <g
                ref={(el) => {
                  // React は外すときに null を渡す。消さないと棚から居なくなった
                  // 個体のエントリが残り続ける
                  if (el) refs.current.set(o.instanceId, el);
                  else refs.current.delete(o.instanceId);
                }}
                transform={`translate(${x} 0)`}
                onPointerDown={(e) => {
                  // 触った時点で「何も操作していない時間」は途切れる（仕様5.8）
                  idleResetRef.current();
                  onPointerDown(o.instanceId, e);
                }}
                style={{ cursor: dragging ? "grabbing" : "grab" }}
              >
                <PlushSVG def={def} pose={pose} seed={o.personalitySeed} />
              </g>
              {o.instanceId === ringId && <WelcomeRing x={x} r={def.size} />}
              {bubble && <Bubble x={x} y={plushTop(def) - 14} text={bubble.text} />}
            </g>
          );
        })}
      </svg>
      </div>

      {/*
        保存できていないことは、隠れた開発メニューではなくここで伝える。
        遊んだ結果が消えることを黙っているのは不誠実。
      */}
      {!store.isPersisted() && (
        <p className="persist-warn">
          このブラウザでは記録を保存できないみたい。とじると消えてしまいます。
        </p>
      )}

      {/* 演出中はナビゲーションを止める。途中で画面を離れると演出が中断される */}
      <nav className="shelf-actions">
        <button className="btn primary" onClick={onGoArcade} disabled={ceremony.active}>
          ゲームセンターへ
        </button>
        <button className="btn" onClick={onShare} disabled={ceremony.active}>
          棚をシェア
        </button>
      </nav>

      <CeremonyOverlay ceremony={ceremony} />

      {profileId && <PlushProfile instanceId={profileId} onClose={() => setProfileId(null)} />}

      {/* Developer Menu の入口。通常プレイヤーの目に触れない大きさにする */}
      <button className="secret-dot" aria-hidden="true" tabIndex={-1} onClick={onSecretTap} />
    </div>
  );
}

/** 音のオン・オフ。小さく、常に出しておく（仕様13章）。 */
function MuteToggle() {
  const [muted, setMuted] = useState(sfx.isMuted());
  return (
    <button
      className="mute-btn"
      aria-label={muted ? "音を出す" : "音を消す"}
      onClick={() => {
        sfx.init();
        const next = !muted;
        sfx.setMuted(next);
        setMuted(next);
      }}
    >
      {muted ? "♪ off" : "♪ on"}
    </button>
  );
}

/** クリックされた直後だけ潰れて、オーバーシュートしながら戻る。 */
function poseFor(touchedAt: number | undefined, dragging = false): Pose {
  // つままれている間は少し伸びて揺れる
  if (dragging) return { ...NEUTRAL_POSE, squash: 1.06, tilt: -4 };
  if (!touchedAt) return NEUTRAL_POSE;
  const t = (Date.now() - touchedAt) / 460;
  if (t >= 1) return NEUTRAL_POSE;
  const squash = 0.85 + 0.15 * t + Math.sin(t * Math.PI * 2) * 0.06;
  return { ...NEUTRAL_POSE, squash };
}

/**
 * 部屋の背景。
 *
 * 「棚の図」ではなく「小さな部屋」に見せるための背景（依頼書4章A）。
 * 棚板だけを並べると収納棚の設計図に見えてしまうので、
 * キャビネットの枠・窓・窓からの光・鉢植え・ラグを置いて生活の気配を作る。
 * 装飾は少なく、彩度は低く、影は薄く。
 */
function Room() {
  const w = SHELF.width;
  const h = SHELF.height;
  const { frameLeft: fl, frameRight: fr, frameTop: ft } = SHELF;

  return (
    <g>
      {/* 壁 */}
      <rect x={0} y={0} width={w} height={h + 40} fill="#efe7dc" />
      {/* 幅木 */}
      <rect x={0} y={h + 8} width={w} height={5} fill="#e0d3c0" />
      {/* 床 */}
      <rect x={0} y={h + 13} width={w} height={40} fill="#e5d8c5" />

      {/* 窓と、そこから差す光。キャビネットより上に置く */}
      <g>
        <rect x={22} y={14} width={74} height={58} rx={9} fill="#dde9ea" />
        <rect x={22} y={14} width={74} height={58} rx={9} fill="none" stroke="#dccfbb" strokeWidth={4} />
        <line x1={59} y1={14} x2={59} y2={72} stroke="#dccfbb" strokeWidth={3} />
        <path d={`M 24 74 L 106 74 L 168 ${h + 13} L 4 ${h + 13} Z`} fill="#fff8ea" opacity={0.3} />
      </g>

      {/* キャビネット。左右に部屋の余白を残して「部屋の中の家具」に見せる */}
      <rect x={fl - 9} y={ft - 12} width={fr - fl + 18} height={h + 25 - ft} rx={12} fill="#e4d3b8" />
      <rect x={fl} y={ft} width={fr - fl} height={h + 10 - ft} fill="#eae1d3" />
      {/* 側板の内側の陰 */}
      <rect x={fl} y={ft} width={6} height={h + 10 - ft} fill="#d7c6ae" opacity={0.5} />
      <rect x={fr - 6} y={ft} width={6} height={h + 10 - ft} fill="#d7c6ae" opacity={0.5} />
      {/* 天板 */}
      <rect x={fl - 13} y={ft - 19} width={fr - fl + 26} height={10} rx={5} fill="#d9c3a5" />
      {/* 脚 */}
      <rect x={fl + 2} y={h + 13} width={11} height={9} rx={3} fill="#c9ad8c" />
      <rect x={fr - 13} y={h + 13} width={11} height={9} rx={3} fill="#c9ad8c" />

      {/* 棚板 */}
      {SHELF.rowY.map((y) => (
        <g key={y}>
          <rect x={fl} y={y} width={fr - fl} height={9} rx={2} fill="#d9c3a5" />
          <rect x={fl} y={y + 9} width={fr - fl} height={5} rx={2} fill="#c3a884" opacity={0.5} />
        </g>
      ))}

      {/* 天板の上の小物。生活の気配 */}
      <g transform={`translate(${fr - 34} ${ft - 19})`}>
        <path d="M -8 0 L 8 0 L 6 -13 L -6 -13 Z" fill="#cbab8c" />
        <ellipse cx={0} cy={-13} rx={6.4} ry={2.3} fill="#bd9c7d" />
        <ellipse cx={-5} cy={-22} rx={5} ry={7.5} fill="#a9bd9a" transform="rotate(-22 -5 -22)" />
        <ellipse cx={5} cy={-24} rx={4.6} ry={8} fill="#9db08e" transform="rotate(20 5 -24)" />
        <ellipse cx={0} cy={-28} rx={4.2} ry={6.8} fill="#b3c4a4" />
      </g>

      {/* 床のかご */}
      <g transform={`translate(16 ${h + 30})`}>
        <path d="M -13 0 L 13 0 L 10 -18 L -10 -18 Z" fill="#dcc7a6" />
        <rect x={-11} y={-20} width={22} height={4} rx={2} fill="#cfb691" />
      </g>

      {/* ラグ */}
      <ellipse cx={w / 2 - 30} cy={h + 34} rx={92} ry={13} fill="#ddcdb6" />
      <ellipse cx={w / 2 - 30} cy={h + 34} rx={62} ry={8} fill="#e6d9c6" />
    </g>
  );
}

/** 迎えたばかりの子の足元に出る、ごく淡いリング。 */
function WelcomeRing({ x, r }: { x: number; r: number }) {
  return (
    <ellipse
      cx={x}
      cy={2}
      rx={r * 1.15}
      ry={r * 0.3}
      fill="none"
      stroke="#d8b98a"
      strokeWidth={2}
      opacity={0.55}
    >
      <animate attributeName="opacity" values="0.55;0.15;0.55" dur="1.6s" repeatCount="indefinite" />
    </ellipse>
  );
}

function Bubble({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.min(150, text.length * 12 + 20);
  return (
    <g transform={`translate(${Math.max(w / 2 + 4, Math.min(SHELF.width - w / 2 - 4, x))} ${y})`}>
      <rect x={-w / 2} y={-20} width={w} height={24} rx={12} fill="#fffaf3" opacity={0.96} />
      <path d="M -5 3 L 0 10 L 5 3 Z" fill="#fffaf3" opacity={0.96} />
      <text
        x={0}
        y={-3}
        textAnchor="middle"
        fontSize={12}
        fill="#6b5a4e"
        style={{ fontFamily: "inherit" }}
      >
        {text}
      </text>
    </g>
  );
}
