import type { LogEvent, SaveV1 } from "../state/types";

/**
 * プレイログを分析しやすい JSON にする（依頼書 24 章）。
 *
 * 生イベントだけ渡しても後で読み解くのが大変なので、
 * 仕様 17.2 の「愛着の代理指標」をあらかじめ集計しておく。
 */
export function buildLogJson(s: SaveV1): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      summary: summarize(s),
      owned: s.owned.map((o) => ({
        defId: o.defId,
        acquiredAt: new Date(o.acquiredAt).toISOString(),
        shelfRow: o.shelfRow,
        x: Math.round(o.x),
      })),
      events: s.log,
    },
    null,
    2
  );
}

function num(e: LogEvent, key: string): number | null {
  const v = e.meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(s: SaveV1) {
  const of = (t: LogEvent["type"]) => s.log.filter((e) => e.type === t);

  const dwells = of("shelf_dwell")
    .map((e) => num(e, "ms"))
    .filter((v): v is number => v !== null);

  const aimErrors = of("crane_drop")
    .map((e) => num(e, "d"))
    .filter((v): v is number => v !== null);

  const welcomes = of("welcome_played");

  return {
    sessions: s.sessionCount,
    attempts: s.attempts,
    ownedCount: s.owned.length,
    events: s.log.length,

    // --- 仕様 17.2 の弱い兆候 ---
    /** 8秒を超えていれば「眺めている」。2〜3秒なら一覧として消費されている */
    shelfDwellMedianMs: median(dwells),
    /** 用がないのに触っているか */
    touches: of("plush_touched").length,
    /** 飾り直しているか */
    repositions: of("plush_repositioned").length,
    /** 何匹目で演出をスキップし始めたか。空なら一度もスキップしていない */
    welcomeSkippedAt: welcomes
      .filter((e) => e.meta?.skipped === true)
      .map((e) => num(e, "count") ?? 0),
    welcomePlayed: welcomes.length,

    /** 照準誤差。仕様 7.6 の σ を実測で較正するために使う */
    aimErrors,
    aimErrorMedian: median(aimErrors),

    wins: of("plush_won").length,
    shares: of("share_clicked").length,
  };
}

/** JSON をファイルとしてダウンロードさせる。 */
export function downloadJson(name: string, json: string): void {
  let url: string | null = null;
  try {
    const blob = new Blob([json], { type: "application/json" });
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    const created = url;
    window.setTimeout(() => URL.revokeObjectURL(created), 1000);
    url = null;
  } catch {
    // 途中で失敗しても URL を残さない
    if (url) URL.revokeObjectURL(url);
  }
}
