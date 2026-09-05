import { renderToStaticMarkup } from "react-dom/server";
import { getPlush, hasPlush } from "../data/plushies";
import { PlushSVG } from "../render/PlushSVG";
import { NEUTRAL_POSE } from "../render/pose";
import type { PlushInstance } from "../state/types";
import { SHELF, rowY } from "../shelf/shelfLayout";

/**
 * 共有画像の寸法 (px)。縦 4:5。
 *
 * 部屋は縦長なので、正方形にすると左右に大きな余白が出て
 * 「見せたい絵」にならない。縦長にしたうえで、壁と床を画面の端まで
 * 伸ばして余白そのものを部屋の一部に見せる。
 */
export const SHARE_W = 1080;
export const SHARE_H = 1350;

const GAME_NAME = "ぬいぐるみのおうち";

// ---------------------------------------------------------------- 状態の直列化

/** 共有用の圧縮形。位置と見た目だけ。来歴は他人には渡さない。 */
type Compact = [plushTypeId: string, x: number, row: number, seed: number];

function toBase64Url(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * 棚の状態を短い文字列にする。
 *
 * MVP ではこの文字列を URL には使わないが、将来
 * `example.com/shelf/xxxxx` で他人の棚を見せられるよう、
 * 境界だけ先に切っておく（仕様 10 章）。
 *
 * ぬいぐるみの名前は日本語なので、btoa に直接渡さず UTF-8 を経由する。
 */
/** 直列化する最大件数。壊れた保存データで巨大な文字列を作らない。 */
const MAX_ENCODED = 64;
/** 復元を受け付ける最大文字数。 */
const MAX_ENCODED_CHARS = 8192;

export function encodeShelf(instances: PlushInstance[]): string {
  const compact: Compact[] = instances
    .filter((o) => o.shelfRow >= 0)
    .slice(0, MAX_ENCODED)
    .map((o) => [
      o.plushTypeId,
      Math.round(o.x),
      o.shelfRow,
      Math.round(o.personalitySeed * 1000) / 1000,
    ]);
  try {
    return toBase64Url(JSON.stringify(compact));
  } catch {
    return "";
  }
}

export function decodeShelf(s: string): PlushInstance[] | null {
  if (!s || s.length > MAX_ENCODED_CHARS) return null;
  if (!/^[A-Za-z0-9\-_]*$/.test(s)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(s));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: PlushInstance[] = [];
  for (const [i, item] of parsed.slice(0, MAX_ENCODED).entries()) {
    if (!Array.isArray(item)) continue;
    const [plushTypeId, x, row, seed] = item as Compact;
    if (typeof plushTypeId !== "string" || !hasPlush(plushTypeId)) continue;
    // 有限で、段は整数であること。1.5 段や巨大な x を通さない。
    if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 4000) continue;
    if (typeof row !== "number" || !Number.isInteger(row)) continue;
    if (row < 0 || row >= SHELF.rows) continue;
    out.push({
      instanceId: `s${i}`,
      plushTypeId,
      acquiredAt: 0,
      // 他人の棚を復元しただけなので、来歴は持ち込まない
      attemptsToAcquire: null,
      witnessedBy: null,
      origin: "unknown",
      x,
      shelfRow: row,
      personalitySeed: typeof seed === "number" && Number.isFinite(seed) ? seed : 0.5,
    });
  }
  return out;
}

// ---------------------------------------------------------------- SVG 生成

/**
 * 棚をスタンドアロンの SVG 文字列にする。
 *
 * ブラウザは SVG 画像の中から外部リソースを読めない。そのため
 * `<use>` / `<image>` / Web フォント / `url(...)` を一切使わず、
 * **文字も入れない**（フォント解決の差異を避けるため、文字は canvas 側で描く）。
 * PlushSVG がこの制約を最初から守っているので、そのまま埋め込める。
 */
export function buildShelfSvg(instances: PlushInstance[]): string {
  const onShelf = instances.filter((o) => o.shelfRow >= 0);

  // 棚の座標系 (320 x 573) を画面の中央に収める
  const roomW = SHELF.width;
  const roomH = SHELF.height + 53;
  const scale = (SHARE_H * 0.9) / roomH;
  const offX = (SHARE_W - roomW * scale) / 2;
  const offY = (SHARE_H - roomH * scale) / 2 - SHARE_H * 0.028;

  const plushMarkup = onShelf
    .map((o) => {
      const inner = renderToStaticMarkup(
        PlushSVG({ def: getPlush(o.plushTypeId), pose: NEUTRAL_POSE, seed: o.personalitySeed })
      );
      return `<g transform="translate(${o.x} ${rowY(o.shelfRow)})">${inner}</g>`;
    })
    .join("");

  // 群の外にはみ出す壁・床を描くための余白（棚の座標系での量）
  const bleed = Math.ceil(Math.max(offX, SHARE_H) / scale) + 40;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_W}" height="${SHARE_H}" viewBox="0 0 ${SHARE_W} ${SHARE_H}">`,
    `<rect width="${SHARE_W}" height="${SHARE_H}" fill="#efe7dc"/>`,
    `<g transform="translate(${offX.toFixed(2)} ${offY.toFixed(2)}) scale(${scale.toFixed(4)})">`,
    shareRoom(bleed),
    plushMarkup,
    `</g>`,
    `</svg>`,
  ].join("");
}

/**
 * 共有画像用の部屋。画面と同じ雰囲気を、文字なしで描く。
 * @param bleed 壁と床を左右上下へどれだけ伸ばすか。余白を部屋の続きに見せる。
 */
function shareRoom(bleed: number): string {
  const w = SHELF.width;
  const h = SHELF.height;
  const { frameLeft: fl, frameRight: fr, frameTop: ft } = SHELF;
  const parts: string[] = [];
  const bx = -bleed;
  const bw = w + bleed * 2;

  parts.push(`<rect x="${bx}" y="${-bleed}" width="${bw}" height="${h + 53 + bleed}" fill="#efe7dc"/>`);
  parts.push(`<rect x="${bx}" y="${h + 8}" width="${bw}" height="5" fill="#e0d3c0"/>`);
  parts.push(`<rect x="${bx}" y="${h + 13}" width="${bw}" height="${40 + bleed}" fill="#e5d8c5"/>`);
  parts.push(`<rect x="22" y="14" width="74" height="58" rx="9" fill="#dde9ea"/>`);
  parts.push(
    `<rect x="22" y="14" width="74" height="58" rx="9" fill="none" stroke="#dccfbb" stroke-width="4"/>`
  );
  parts.push(`<line x1="59" y1="14" x2="59" y2="72" stroke="#dccfbb" stroke-width="3"/>`);
  parts.push(`<path d="M 24 74 L 106 74 L 168 ${h + 13} L 4 ${h + 13} Z" fill="#fff8ea" opacity="0.3"/>`);
  parts.push(
    `<rect x="${fl - 9}" y="${ft - 12}" width="${fr - fl + 18}" height="${h + 25 - ft}" rx="12" fill="#e4d3b8"/>`
  );
  parts.push(`<rect x="${fl}" y="${ft}" width="${fr - fl}" height="${h + 10 - ft}" fill="#eae1d3"/>`);
  parts.push(
    `<rect x="${fl}" y="${ft}" width="6" height="${h + 10 - ft}" fill="#d7c6ae" opacity="0.5"/>`
  );
  parts.push(
    `<rect x="${fr - 6}" y="${ft}" width="6" height="${h + 10 - ft}" fill="#d7c6ae" opacity="0.5"/>`
  );
  parts.push(
    `<rect x="${fl - 13}" y="${ft - 19}" width="${fr - fl + 26}" height="10" rx="5" fill="#d9c3a5"/>`
  );
  parts.push(`<rect x="${fl + 2}" y="${h + 13}" width="11" height="9" rx="3" fill="#c9ad8c"/>`);
  parts.push(`<rect x="${fr - 13}" y="${h + 13}" width="11" height="9" rx="3" fill="#c9ad8c"/>`);
  for (const y of SHELF.rowY) {
    parts.push(`<rect x="${fl}" y="${y}" width="${fr - fl}" height="9" rx="2" fill="#d9c3a5"/>`);
    parts.push(
      `<rect x="${fl}" y="${y + 9}" width="${fr - fl}" height="5" rx="2" fill="#c3a884" opacity="0.5"/>`
    );
  }
  parts.push(
    `<ellipse cx="${w / 2 - 30}" cy="${h + 34}" rx="92" ry="13" fill="#ddcdb6"/>`,
    `<ellipse cx="${w / 2 - 30}" cy="${h + 34}" rx="62" ry="8" fill="#e6d9c6"/>`
  );
  return parts.join("");
}

// ---------------------------------------------------------------- PNG 化

/**
 * SVG 文字列を PNG の Blob にする。
 *
 * 文字は SVG に入れず、SVG を canvas に描いたあとで 2D コンテキストから描く。
 * SVG 画像内のフォント解決は環境差が大きく、機種によって崩れるためである。
 */
export function renderShelfPng(svg: string, count: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = SHARE_W;
    canvas.height = SHARE_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("canvas 2d context unavailable"));
      return;
    }

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    let timer = 0;

    const cleanup = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      img.onload = null;
      img.onerror = null;
    };

    // 読み込まれないまま固まらないようにする。
    // タイマーの設定自体が失敗しても URL を残さない。
    try {
      timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("svg load timeout"));
      }, 8000);
    } catch (e) {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, SHARE_W, SHARE_H);
        drawCaption(ctx, count);
        cleanup();
        canvas.toBlob(
          (out) => (out ? resolve(out) : reject(new Error("toBlob failed"))),
          "image/png"
        );
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("svg load failed"));
    };
    img.src = url;
  });
}

/** ゲーム名と所持数だけ。ロゴや広告は載せない（依頼書17章）。 */
function drawCaption(ctx: CanvasRenderingContext2D, count: number): void {
  const font = `"Hiragino Sans", "Yu Gothic", Meiryo, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#8a7a6a";
  ctx.font = `500 ${Math.round(SHARE_W * 0.028)}px ${font}`;
  ctx.fillText(GAME_NAME, SHARE_W / 2, SHARE_H * 0.951);
  ctx.fillStyle = "#b3a595";
  ctx.font = `400 ${Math.round(SHARE_W * 0.022)}px ${font}`;
  ctx.fillText(`おともだち ${count}`, SHARE_W / 2, SHARE_H * 0.981);
}

// ---------------------------------------------------------------- 共有

export type ShareResult = { method: "share" | "clipboard" | "download"; ok: boolean };

/**
 * 生成した画像を共有する。優先順は仕様 10 章のとおり。
 *   1. Web Share API（ファイル共有に対応していれば）
 *   2. クリップボードへコピー
 *   3. ダウンロード
 */
export async function shareShelf(blob: Blob): Promise<ShareResult> {
  const file = new File([blob], "my-shelf.png", { type: "image/png" });

  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: GAME_NAME });
      return { method: "share", ok: true };
    } catch (e) {
      // ユーザーが共有シートを閉じた場合もここに来る。失敗として扱い、次へは進まない。
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (aborted) return { method: "share", ok: false };
    }
  }

  try {
    const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (CI && navigator.clipboard?.write) {
      await navigator.clipboard.write([new CI({ "image/png": blob })]);
      return { method: "clipboard", ok: true };
    }
  } catch {
    // クリップボードが使えない環境。ダウンロードへ落とす。
  }

  let url: string | null = null;
  try {
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-shelf.png";
    a.click();
    const created = url;
    window.setTimeout(() => URL.revokeObjectURL(created), 1000);
    url = null;
    return { method: "download", ok: true };
  } catch {
    // 途中で失敗しても URL を残さない
    if (url) URL.revokeObjectURL(url);
    return { method: "download", ok: false };
  }
}
