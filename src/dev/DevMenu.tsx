import { useEffect, useState } from "react";
import { PLUSHIES } from "../data/plushies";
import { seriesName, SERIES } from "../data/series";
import { PlushSVG } from "../render/PlushSVG";
import { NEUTRAL_POSE } from "../render/pose";
import { clearSave } from "../state/persist";
import { store, useGame } from "../state/store";
import { buildLogJson, downloadJson } from "./devActions";

export type DevFlags = {
  fps: boolean;
  physics: boolean;
};

type Props = {
  flags: DevFlags;
  onFlags: (f: DevFlags) => void;
  onClose: () => void;
};

/**
 * 開発検証用メニュー（依頼書 25 章）。
 *
 * 通常プレイヤーの目に触れないよう、棚の隅のごく小さなドットを3回押すか
 * Ctrl+Shift+D でしか開かない。ゲーム内から「図鑑」への入口には**しない**。
 * 未所持の子を一覧で見せると、棚が「集めるべきリスト」になってしまい、
 * 目の前の子への愛着から注意がそれる。
 */
export function DevMenu({ flags, onFlags, onClose }: Props) {
  const game = useGame();
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="sheet" onPointerDown={onClose} role="dialog" aria-label="Developer Menu">
      <div className="sheet-body dev" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="dev-title">Developer Menu</h2>

        <p className="dev-stat">
          おともだち {game.owned.length} / 通算プレイ {game.attempts} / ログ {game.log.length}
          {!store.isPersisted() && <strong className="dev-warn"> 保存できていません</strong>}
        </p>

        <section className="dev-row">
          <button className="btn tiny" onClick={() => store.resetAll()}>
            所持品リセット
          </button>
          <button
            className="btn tiny"
            onClick={() => {
              clearSave();
              location.reload();
            }}
          >
            localStorage全消去
          </button>
        </section>

        <section className="dev-row">
          <button
            className="btn tiny"
            onClick={() => {
              store.saveBoard(null);
              location.reload();
            }}
          >
            クレーン景品を再配置
          </button>
          <button
            className="btn tiny"
            onClick={() => downloadJson("plushcrane-log.json", buildLogJson(store.get()))}
          >
            プレイログDL
          </button>
        </section>

        <section className="dev-row">
          <label className="dev-check">
            <input
              type="checkbox"
              checked={flags.fps}
              onChange={(e) => onFlags({ ...flags, fps: e.target.checked })}
            />
            FPS表示
          </label>
          <label className="dev-check">
            <input
              type="checkbox"
              checked={flags.physics}
              onChange={(e) => onFlags({ ...flags, physics: e.target.checked })}
            />
            物理デバッグ
          </label>
        </section>

        <section>
          <button className="btn tiny" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "全シリーズを隠す" : "全シリーズ表示"}
          </button>
          {showAll && (
            <div className="dev-series">
              {SERIES.map((s) => (
                <div key={s.id}>
                  <p className="dev-series-name">{seriesName(s.id)}</p>
                  <div className="dev-grid">
                    {PLUSHIES.filter((p) => p.series === s.id).map((p) => (
                      <button
                        key={p.id}
                        className="dev-plush"
                        title={`${p.name} (${p.rarity})`}
                        onClick={() => store.grantPlush(p.id)}
                      >
                        <svg viewBox="-48 -92 96 96" width="100%">
                          <PlushSVG def={p} pose={NEUTRAL_POSE} seed={0.5} />
                        </svg>
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="dev-hint">タップでその子を追加（演出は起きません）</p>
            </div>
          )}
        </section>

        <button className="btn" onClick={onClose}>
          とじる
        </button>
      </div>
    </div>
  );
}

/**
 * Developer Menu の開き方。
 * 隅の小さなドット3回タップ、または Ctrl+Shift+D。
 */
export function useDevMenuTrigger(): { open: boolean; setOpen: (v: boolean) => void; tap: () => void } {
  const [open, setOpen] = useState(false);
  const [taps, setTaps] = useState<number[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tap = () => {
    const now = Date.now();
    const recent = [...taps.filter((t) => now - t < 1200), now];
    if (recent.length >= 3) {
      setTaps([]);
      setOpen(true);
      return;
    }
    setTaps(recent);
  };

  return { open, setOpen, tap };
}
