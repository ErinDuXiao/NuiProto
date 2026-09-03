import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../audio/sfx";
import { store, useGame } from "../state/store";
import { boardToSave, makeBoard, restoreBoard } from "./board";
import { CraneView, VIEW } from "./CraneView";
import {
  createCrane,
  startDrop,
  tickCrane,
  type Crane,
  type CraneEvent,
} from "./craneMachine";
import { atRest, DEFAULT_PIT, exitDistance, step, STEP, type Body } from "./physics";
import { Watcher } from "./Watcher";
import { moodFor, type WatcherMood } from "./watcherState";

type Props = {
  onGoShelf: () => void;
  debugPhysics: boolean;
  showFps: boolean;
};

/** 画面に流すスナップショット。物理の内部状態はここに漏らさない。 */
type Frame = {
  bodies: Body[];
  crane: Crane;
  mood: WatcherMood;
  moodElapsed: number;
  moodCount: number;
};

const AIM_SPEED = 150;
const PIT = DEFAULT_PIT;

/**
 * クレーン画面。
 *
 * 物理ループは ref の中で回し、1 ステップごとに React を再レンダーしない。
 * rAF ごとに 1 回だけスナップショットを state に流す（仕様 7.2）。
 *
 * 操作は 2 段階ボタン式（仕様 7.3）。
 *   横移動 → 決定 → 奥移動 → 決定 → 自動で下降
 * 説明されなくても分かることを、操作の複雑さより優先する。
 */
export function ArcadeScreen({ onGoShelf, debugPhysics, showFps }: Props) {
  const game = useGame();

  const bodiesRef = useRef<Body[]>([]);
  const craneRef = useRef<Crane>(createCrane());
  const dirRef = useRef(0);
  const lastEventRef = useRef<CraneEvent | null>(null);
  const moodRef = useRef<{ mood: WatcherMood; at: number; count: number }>({
    mood: "idle",
    at: 0,
    count: 0,
  });
  const wonRef = useRef(false);
  /** ループのクロージャから最新の props を読むため */
  const goShelfRef = useRef(onGoShelf);
  goShelfRef.current = onGoShelf;
  const returnTimer = useRef(0);

  const [frame, setFrame] = useState<Frame | null>(null);
  const [fps, setFps] = useState(0);

  // 見守り役は最初に迎えた子
  const watcher = useMemo(() => {
    const onShelf = game.owned.filter((o) => o.shelfRow >= 0);
    const pool = onShelf.length > 0 ? onShelf : game.owned;
    return [...pool].sort((a, b) => a.acquiredAt - b.acquiredAt)[0];
  }, [game.owned]);

  // 盤面の用意。保存があれば復元し、無ければ作る
  useEffect(() => {
    const saved = store.get().craneBoard;
    bodiesRef.current = saved ? restoreBoard(saved) : makeBoard(PIT);
    craneRef.current = createCrane();
    craneRef.current.attemptsOnBoard = saved?.attemptsOnBoard ?? 0;
    store.log("arcade_enter");
    return () => {
      store.log("shelf_return");
      window.clearTimeout(returnTimer.current);
      sfx.move(false);
    };
  }, []);

  // 物理と状態機械のループ。React の再レンダーは rAF ごとに1回だけ。
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let frames = 0;
    let fpsAt = last;
    let running = true;

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      acc += dt;

      const bodies = bodiesRef.current;
      const crane = craneRef.current;

      // 狙いの移動（長押し）
      if (dirRef.current !== 0) {
        if (crane.state === "aimX") {
          crane.armX = clamp(crane.armX + dirRef.current * AIM_SPEED * dt, PIT.minX + 16, PIT.maxX - 16);
        } else if (crane.state === "aimZ") {
          crane.armZ = clamp(crane.armZ + dirRef.current * AIM_SPEED * dt, PIT.minZ + 12, PIT.maxZ - 12);
        }
      }

      // 固定ステップ。タブ復帰時の処理雪崩を防ぐため1フレーム最大8ステップ。
      let steps = 0;
      while (acc >= STEP && steps < 8) {
        acc -= STEP;
        steps++;
        const r = step(bodies, PIT, STEP);
        if (r.impacts > 0) sfx.bump(Math.min(1, r.impacts * 0.4));
        for (const id of r.fallen) handleEvent({ kind: "won", bodyId: id });
        for (const e of tickCrane(crane, bodies, PIT, STEP)) handleEvent(e);
      }
      if (steps >= 8) acc = 0;

      // 盤面が落ち着いたら保存し、すぐ次の狙いに入れるようにする。
      // idle のまま待たせると「方向ボタンを押すまで決定が効かない」状態になり、
      // 説明なしでは操作が分からなくなる（依頼書26章）。
      if (crane.state === "idle" && atRest(bodies) && bodies.length > 0) {
        maybeSave(bodies, crane);
        if (!wonRef.current) crane.state = "aimX";
      }

      // 気持ちの更新
      const target = crane.targetId
        ? bodies.find((b) => b.id === crane.targetId)
        : bodies[0];
      const dist = target ? exitDistance(target, PIT) : 9999;
      const nextMood = moodFor(crane.state, lastEventRef.current, dist);
      if (nextMood !== moodRef.current.mood) {
        moodRef.current = { mood: nextMood, at: now, count: moodRef.current.count + 1 };
      }

      setFrame({
        bodies: bodies.map((b) => ({ ...b })),
        crane: { ...crane },
        mood: moodRef.current.mood,
        moodElapsed: now - moodRef.current.at,
        moodCount: moodRef.current.count,
      });

      frames++;
      if (now - fpsAt >= 500) {
        setFps(Math.round((frames * 1000) / (now - fpsAt)));
        frames = 0;
        fpsAt = now;
      }

      raf = requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = performance.now();
        acc = 0;
        raf = requestAnimationFrame(loop);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function handleEvent(e: CraneEvent) {
    lastEventRef.current = e;
    const crane = craneRef.current;
    switch (e.kind) {
      case "drop":
        sfx.descend();
        store.log("crane_drop", { attempt: crane.attemptsOnBoard });
        break;
      case "grabbed":
        store.log("plush_grabbed", { attempt: crane.attemptsOnBoard });
        break;
      case "released":
      case "nudged":
        sfx.koron();
        store.log("plush_dropped", { attempt: crane.attemptsOnBoard });
        break;
      case "settled":
        store.log("plush_moved", { attempt: crane.attemptsOnBoard });
        break;
      case "won": {
        if (wonRef.current) break;
        wonRef.current = true;
        sfx.success();
        const defId = e.bodyId?.split("#")[0];
        if (defId) {
          store.bumpAttempts();
          store.winPlush(defId);
          store.saveBoard(null);
          // 少し余韻を置いてから棚へ帰る
          returnTimer.current = window.setTimeout(() => goShelfRef.current(), 1500);
        }
        break;
      }
    }
  }

  const maybeSave = useCallback((bodies: Body[], crane: Crane) => {
    const now = Date.now();
    if (now - lastSaveRef.current < 1000) return;
    lastSaveRef.current = now;
    store.saveBoard(boardToSave(bodies, crane.attemptsOnBoard));
  }, []);
  const lastSaveRef = useRef(0);

  const state = frame?.crane.state ?? "idle";
  const busy = state !== "idle" && state !== "aimX" && state !== "aimZ";

  const confirm = () => {
    sfx.init();
    const c = craneRef.current;
    dirRef.current = 0;
    sfx.move(false);
    if (c.state === "idle") {
      // 位置を動かさずに決定した場合も先へ進める
      c.state = "aimZ";
      store.log("crane_start", { attempt: c.attemptsOnBoard + 1 });
    } else if (c.state === "aimX") {
      c.state = "aimZ";
      store.log("crane_start", { attempt: c.attemptsOnBoard + 1 });
    } else if (c.state === "aimZ") {
      startDrop(c, bodiesRef.current, PIT);
    }
  };

  const hold = (d: number) => () => {
    sfx.init();
    const c = craneRef.current;
    if (c.state === "idle") c.state = "aimX";
    dirRef.current = d;
    sfx.move(true);
  };
  const release = () => {
    dirRef.current = 0;
    sfx.move(false);
  };

  return (
    <div className="screen arcade">
      <header className="arcade-header">
        <button className="link-btn" onClick={onGoShelf} disabled={busy}>
          ← おうちへ
        </button>
        <span className="arcade-hint">
          {(state === "idle" || state === "aimX") && "長押しで左右に動かして、はなすと止まるよ"}
          {state === "aimZ" && "つぎは奥ゆき。長押しで動かそう"}
          {busy && "……"}
        </span>
      </header>

      {/*
        見守りぬいぐるみは筐体の手前に置く（依頼書8章）。
        別の行に並べると盤面から視線が切れて、この子の反応を見なくなる。
      */}
      <div className="pit-wrap">
        <svg className="pit" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-label="クレーンゲーム">
          {frame && (
            <CraneView bodies={frame.bodies} crane={frame.crane} pit={PIT} debug={debugPhysics} />
          )}
        </svg>

        <svg className="watcher" viewBox="0 0 200 120" aria-hidden="true">
          <g transform="translate(0 112)">
            {frame && watcher && (
              <Watcher
                plush={watcher}
                mood={frame.mood}
                elapsed={frame.moodElapsed}
                moodCount={frame.moodCount}
              />
            )}
          </g>
        </svg>
      </div>

      <nav className="crane-pad">
        {state === "aimZ" ? (
          <>
            <PadButton label="奥へ" onHold={hold(1)} onRelease={release} disabled={busy} />
            <PadButton label="手前へ" onHold={hold(-1)} onRelease={release} disabled={busy} />
          </>
        ) : (
          <>
            <PadButton label="←" onHold={hold(-1)} onRelease={release} disabled={busy} />
            <PadButton label="→" onHold={hold(1)} onRelease={release} disabled={busy} />
          </>
        )}
        <button className="btn primary decide" onClick={confirm} disabled={busy}>
          {state === "aimZ" ? "ここに落とす" : "これでいく"}
        </button>
      </nav>

      {showFps && <div className="fps">{fps} fps</div>}
    </div>
  );
}

function PadButton({
  label,
  onHold,
  onRelease,
  disabled,
}: {
  label: string;
  onHold: () => void;
  onRelease: () => void;
  disabled: boolean;
}) {
  return (
    <button
      className="btn pad"
      disabled={disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onPointerLeave={onRelease}
    >
      {label}
    </button>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
