import { useEffect, useRef, useState } from "react";
import { store, useGame } from "../state/store";
import { buildShelfSvg, renderShelfPng, shareShelf } from "./shelfToPng";

type Props = { onClose: () => void };

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; url: string; blob: Blob }
  | { kind: "error" };

/**
 * 棚のシェア（依頼書 17 章）。
 *
 * 「この棚かわいいから見せたい」と思えるかが大事なので、
 * まず画像そのものを大きく見せる。ロゴや広告は載せない。
 */
export function ShareSheet({ onClose }: Props) {
  const game = useGame();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    store.log("share_clicked", { meta: { count: game.owned.length } });

    const onShelf = game.owned.filter((o) => o.shelfRow >= 0);
    renderShelfPng(buildShelfSvg(game.owned), onShelf.length)
      .then((blob) => {
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setPhase({ kind: "ready", url, blob });
      })
      .catch(() => {
        if (alive) setPhase({ kind: "error" });
      });

    return () => {
      alive = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
    // 開いた時点の棚を写す。開いている間に増えても撮り直さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doShare = async () => {
    if (phase.kind !== "ready") return;
    const r = await shareShelf(phase.blob);
    store.log("share_result", { meta: { method: r.method, ok: r.ok } });
  };

  return (
    <div className="sheet" role="dialog" aria-label="棚をシェア">
      <div className="sheet-body" onPointerDown={(e) => e.stopPropagation()}>
        {phase.kind === "loading" && <p className="sheet-note">用意しています……</p>}

        {phase.kind === "error" && (
          <p className="sheet-note">うまく作れませんでした。もう一度おためしください。</p>
        )}

        {phase.kind === "ready" && (
          <img className="sheet-preview" src={phase.url} alt="わたしの棚" />
        )}

        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            とじる
          </button>
          <button className="btn primary" onClick={doShare} disabled={phase.kind !== "ready"}>
            シェアする
          </button>
        </div>
      </div>
    </div>
  );
}
