# ぬいぐるみクレーン + 棚 MVP 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレイヤーが「この子を家に連れて帰った」と感じる、Webクレーンゲーム＋ぬいぐるみ棚のMVPを作る。

**Architecture:** 全画面をSVGで描画し、ぬいぐるみ描画を単一コンポーネント `PlushSVG` に統一する。クレーン物理は球体のみを扱う自作ソルバで、難易度は確率抽選ではなく「掴み半径の拡大 + 保持減衰の緩和 + 盤面の幾何的前進」で保証する。状態は `useSyncExternalStore` ベースの自作ストアに集約し localStorage へ永続化する。

**Tech Stack:** TypeScript (strict) / React 18 / Vite / Vitest / WebAudio。ランタイム依存は react と react-dom のみ。画像・音声アセットはゼロ。

## Global Constraints

これらは全タスクの要件に暗黙に含まれる。仕様書 `docs/superpowers/specs/2026-09-03-plush-crane-mvp-design.md` から逐語的に引く。

- **ランタイム依存は react / react-dom のみ**。物理エンジン、アニメーションライブラリ、html2canvas、UIフレームワークを追加しない。
- **TypeScript は strict**。`any` を使わない。
- **`PlushDef.weight` は [0.8, 1.2]、`softness` は [0, 1]、`size` は [26, 34]**。データ追加時もこのレンジを守る。
- **SVG直列化制約**: 色・寸法はすべてインライン属性。`<use>` / `<image>` / Webフォント / 外部参照 `filter` を使わない。**SVG 内に文字を置かない**（文字は canvas 2D で描く）。影は `feGaussianBlur` ではなく半透明の楕円で表現する。
- **物理ループは React の再レンダーを 1 ステップごとに発生させない**。rAF ごとに 1 回だけスナップショットを流す。棚の呼吸・瞬きは CSS アニメーションと ref 経由の属性直接書き換えで行い、React 再レンダーを発生させない。
- **UI は日本語**。英語は獲得時の `Welcome home.` のみ。
- **禁止表現**: 「GET!!!」等の強い演出、金色、宝箱、カジノ的表現、赤丸通知バッジ、レアリティの誇張演出。
- **禁止機能**: ぬいぐるみ交換、ガチャ、課金、広告、アカウント登録（依頼書21章）。
- **クエスト化する台詞を書かない**（「〇〇を取ってきて」等）。
- スマートフォン縦画面を最優先。PC でも動作すること。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/data/plushies.ts` | `PlushDef` 全10種の定義 |
| `src/data/series.ts` | シリーズ定義 |
| `src/data/lines.ts` | セリフ辞書 |
| `src/state/types.ts` | 永続スキーマ型・ドメイン型 |
| `src/state/persist.ts` | localStorage 読み書き・破損フォールバック |
| `src/state/log.ts` | プレイログのリングバッファ |
| `src/state/store.ts` | ストア本体とアクション |
| `src/render/pose.ts` | `Pose` 型・補間ヘルパ・個体差導出 |
| `src/render/PlushSVG.tsx` | ぬいぐるみ描画（唯一のレンダラ） |
| `src/render/useAmbientLife.ts` | 呼吸・瞬き・視線（React再レンダーなし） |
| `src/shelf/shelfLayout.ts` | 棚の座標計算・重なり解消（純粋関数） |
| `src/shelf/ShelfScreen.tsx` | 棚画面 |
| `src/shelf/useDragPlacement.ts` | ドラッグ配置 |
| `src/shelf/MeetingCeremony.tsx` | 出会いの演出 |
| `src/arcade/physics.ts` | 球体ソルバ（純粋、DOM非依存） |
| `src/arcade/craneMachine.ts` | クレーン状態機械・アシスト・保証（純粋） |
| `src/arcade/CraneView.tsx` | 盤面 SVG 描画 |
| `src/arcade/Watcher.tsx` | 見守りぬいぐるみ |
| `src/arcade/ArcadeScreen.tsx` | クレーン画面の統合 |
| `src/share/shelfToPng.ts` | SVG → PNG、`encodeShelf` |
| `src/share/ShareSheet.tsx` | シェアUI |
| `src/audio/sfx.ts` | WebAudio 生成音 |
| `src/dev/DevMenu.tsx` | 開発メニュー |
| `src/App.tsx` | 画面ルーティング |
| `src/styles.css` | 全体スタイル |

---

## フェーズと Codex レビュー

| Phase | Tasks | 内容 | 末尾 |
|---|---|---|---|
| A | 1-3 | 基盤（データ・描画・状態） | Codex レビュー ① |
| B | 4-5 | **Priority 1: 出会いの瞬間** | Codex レビュー ② |
| C | 6-9 | **Priority 2: クレーンの感触** | Codex レビュー ③ |
| D | 10-11 | Priority 3-4: 配置・シェア | Codex レビュー ④ |
| E | 12-14 | 音・DevMenu・仕上げ・実プレイ | Codex レビュー ⑤ |

各レビューは `codex:rescue` サブエージェントに、そのフェーズで書いたファイルを対象として依頼する。

---

# Phase A: 基盤

## Task 1: プロジェクト雛形とぬいぐるみデータ

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`
- Create: `src/state/types.ts`
- Create: `src/data/series.ts`, `src/data/plushies.ts`
- Test: `src/data/plushies.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type Rarity = "common" | "rare" | "special"`
  - `type PlushShape = "round" | "pear" | "long" | "blob"`
  - `type PlushEars = "round" | "long" | "pointed" | "none"`
  - `type PlushExtra = "beak" | "tentacles" | "flipper" | "tail"`
  - `type PlushArt = { body: string; accent: string; face: string; shape: PlushShape; ears: PlushEars; extras?: PlushExtra[] }`
  - `type PlushDef = { id: string; name: string; series: string; rarity: Rarity; size: number; weight: number; softness: number; art: PlushArt }`
  - `PLUSHIES: PlushDef[]`, `getPlush(id: string): PlushDef`, `plushCoefficient(def: PlushDef): number`
  - `SERIES: { id: string; name: string }[]`

- [ ] **Step 1: 雛形を作る**

```bash
npm create vite@latest . -- --template react-ts
```

対話が出た場合は既存ディレクトリに展開する選択をする。その後:

```bash
npm install
npm install -D vitest jsdom @testing-library/react @testing-library/dom
```

`package.json` の `scripts` に追加する。

```json
"test": "vitest run",
"test:watch": "vitest"
```

`vite.config.ts` を次にする。

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true },
});
```

`vite.config.ts` 冒頭に `/// <reference types="vitest" />` を足す。

- [ ] **Step 2: 失敗するテストを書く**

`src/data/plushies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PLUSHIES, getPlush, plushCoefficient } from "./plushies";

describe("plush data", () => {
  it("10種ある", () => {
    expect(PLUSHIES).toHaveLength(10);
  });

  it("idが重複しない", () => {
    const ids = PLUSHIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("全個体がパラメータレンジを守る", () => {
    for (const p of PLUSHIES) {
      expect(p.weight, p.id).toBeGreaterThanOrEqual(0.8);
      expect(p.weight, p.id).toBeLessThanOrEqual(1.2);
      expect(p.softness, p.id).toBeGreaterThanOrEqual(0);
      expect(p.softness, p.id).toBeLessThanOrEqual(1);
      expect(p.size, p.id).toBeGreaterThanOrEqual(26);
      expect(p.size, p.id).toBeLessThanOrEqual(34);
    }
  });

  it("個体係数kが1.8倍幅に収まる", () => {
    const ks = PLUSHIES.map(plushCoefficient);
    expect(Math.min(...ks)).toBeGreaterThanOrEqual(0.65);
    expect(Math.max(...ks)).toBeLessThanOrEqual(1.18);
  });

  it("bear_01とrabbit_01が存在する", () => {
    expect(getPlush("bear_01").name).toBeTruthy();
    expect(getPlush("rabbit_01").name).toBeTruthy();
  });

  it("rabbit_01は最も掴みやすい部類（k>=1.05）", () => {
    expect(plushCoefficient(getPlush("rabbit_01"))).toBeGreaterThanOrEqual(1.05);
  });

  it("2シリーズに分かれている", () => {
    const s = new Set(PLUSHIES.map((p) => p.series));
    expect(s).toEqual(new Set(["forest_friends", "ocean_friends"]));
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./plushies"`

- [ ] **Step 4: 型を書く**

`src/state/types.ts`:

```ts
export type Rarity = "common" | "rare" | "special";
export type PlushShape = "round" | "pear" | "long" | "blob";
export type PlushEars = "round" | "long" | "pointed" | "none";
export type PlushExtra = "beak" | "tentacles" | "flipper" | "tail";

export type PlushArt = {
  body: string;
  accent: string;
  face: string;
  shape: PlushShape;
  ears: PlushEars;
  extras?: PlushExtra[];
};

export type PlushDef = {
  id: string;
  name: string;
  series: string;
  rarity: Rarity;
  size: number;
  weight: number;
  softness: number;
  art: PlushArt;
};
```

- [ ] **Step 5: データを書く**

`src/data/series.ts`:

```ts
export const SERIES = [
  { id: "forest_friends", name: "もりのおともだち" },
  { id: "ocean_friends", name: "うみのおともだち" },
];
```

`src/data/plushies.ts`: 10種を定義する。色は彩度を抑えたくすんだパステル。

```ts
import type { PlushDef } from "../state/types";

export const PLUSHIES: PlushDef[] = [
  { id: "bear_01", name: "ブラウンベア", series: "forest_friends", rarity: "common",
    size: 32, weight: 1.0, softness: 0.7,
    art: { body: "#c9a37c", accent: "#e8d3bd", face: "#5b4636", shape: "round", ears: "round" } },
  { id: "rabbit_01", name: "ミルクラビット", series: "forest_friends", rarity: "common",
    size: 33, weight: 0.85, softness: 0.9,
    art: { body: "#efe6dc", accent: "#e6bfc4", face: "#6b5a4e", shape: "pear", ears: "long" } },
  { id: "fox_01", name: "こぎつね", series: "forest_friends", rarity: "rare",
    size: 30, weight: 0.95, softness: 0.6,
    art: { body: "#d99a6c", accent: "#f3e7dc", face: "#5b4636", shape: "pear", ears: "pointed", extras: ["tail"] } },
  { id: "frog_01", name: "はっぱガエル", series: "forest_friends", rarity: "common",
    size: 28, weight: 0.9, softness: 0.85,
    art: { body: "#a9c49a", accent: "#e4eddc", face: "#4a5a44", shape: "blob", ears: "none" } },
  { id: "deer_01", name: "こじか", series: "forest_friends", rarity: "special",
    size: 31, weight: 1.1, softness: 0.5,
    art: { body: "#d8b89a", accent: "#f5ece2", face: "#5b4636", shape: "pear", ears: "pointed", extras: ["tail"] } },
  { id: "seal_01", name: "しろあざらし", series: "ocean_friends", rarity: "common",
    size: 32, weight: 1.05, softness: 0.8,
    art: { body: "#e3e6ea", accent: "#c9d3dc", face: "#4d5560", shape: "long", ears: "none", extras: ["flipper"] } },
  { id: "octopus_01", name: "たこさん", series: "ocean_friends", rarity: "rare",
    size: 29, weight: 0.9, softness: 0.95,
    art: { body: "#e0a9a9", accent: "#f4dcdc", face: "#6b4a4a", shape: "blob", ears: "none", extras: ["tentacles"] } },
  { id: "duck_01", name: "あひるのこ", series: "ocean_friends", rarity: "common",
    size: 27, weight: 0.85, softness: 0.75,
    art: { body: "#f0dda6", accent: "#f8efd2", face: "#5e5236", shape: "round", ears: "none", extras: ["beak"] } },
  { id: "jellyfish_01", name: "くらげ", series: "ocean_friends", rarity: "rare",
    size: 28, weight: 0.8, softness: 1.0,
    art: { body: "#c9bcdc", accent: "#ece5f4", face: "#544a63", shape: "blob", ears: "none", extras: ["tentacles"] } },
  { id: "penguin_01", name: "ペンギン", series: "ocean_friends", rarity: "special",
    size: 30, weight: 1.15, softness: 0.55,
    art: { body: "#7c8a99", accent: "#f2f4f6", face: "#3d4652", shape: "long", ears: "none", extras: ["flipper", "beak"] } },
];

const BY_ID = new Map(PLUSHIES.map((p) => [p.id, p]));

export function getPlush(id: string): PlushDef {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`unknown plush: ${id}`);
  return p;
}

/** 仕様 7.5: k = soft(s) / heft(w)。掴みやすさの個体係数。 */
export function plushCoefficient(def: PlushDef): number {
  const soft = 0.75 + 0.25 * def.softness;
  const heft = 0.85 + 0.3 * ((def.weight - 0.8) / 0.4);
  return soft / heft;
}
```

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 7 tests

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: プロジェクト雛形とぬいぐるみデータ10種"
```

---

## Task 2: PlushSVG レンダラ

**Files:**
- Create: `src/render/pose.ts`, `src/render/PlushSVG.tsx`
- Test: `src/render/PlushSVG.test.tsx`, `src/render/pose.test.ts`

**Interfaces:**
- Consumes: `PlushDef`, `getPlush`（Task 1）
- Produces:
  - `type Pose = { squash: number; tilt: number; eyeOpen: number; lookAt: number; armRaise: number; hop: number }`
  - `NEUTRAL_POSE: Pose`
  - `individuality(seed: number): { hueShift: number; scale: number; breathPeriod: number; blinkBase: number }`
  - `applyIndividuality(def: PlushDef, seed: number): PlushDef`
  - `<PlushSVG def={PlushDef} pose={Pose} seed={number} />` — `<g>` を返す。親の `<svg>` 内に置く。

- [ ] **Step 1: 失敗するテストを書く**

`src/render/pose.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { individuality, applyIndividuality, NEUTRAL_POSE } from "./pose";
import { getPlush } from "../data/plushies";

describe("individuality", () => {
  it("seedが違えば別の個体差になる", () => {
    const a = individuality(0.1);
    const b = individuality(0.9);
    expect(a.hueShift).not.toBe(b.hueShift);
  });

  it("同じseedなら常に同じ", () => {
    expect(individuality(0.42)).toEqual(individuality(0.42));
  });

  it("色相ずれは±6度以内", () => {
    for (let s = 0; s <= 1; s += 0.05) {
      expect(Math.abs(individuality(s).hueShift)).toBeLessThanOrEqual(6);
    }
  });

  it("サイズずれは±4%以内", () => {
    for (let s = 0; s <= 1; s += 0.05) {
      expect(Math.abs(individuality(s).scale - 1)).toBeLessThanOrEqual(0.04);
    }
  });

  it("applyIndividualityは元のdefを変更しない", () => {
    const def = getPlush("bear_01");
    const before = def.art.body;
    applyIndividuality(def, 0.7);
    expect(def.art.body).toBe(before);
  });

  it("applyIndividualityはsizeとbody色を変える", () => {
    const def = getPlush("bear_01");
    const v = applyIndividuality(def, 0.7);
    expect(v.size).not.toBe(def.size);
    expect(v.art.body).not.toBe(def.art.body);
  });
});

describe("NEUTRAL_POSE", () => {
  it("無変形である", () => {
    expect(NEUTRAL_POSE).toEqual({ squash: 1, tilt: 0, eyeOpen: 1, lookAt: 0, armRaise: 0, hop: 0 });
  });
});
```

`src/render/PlushSVG.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PlushSVG } from "./PlushSVG";
import { NEUTRAL_POSE } from "./pose";
import { PLUSHIES, getPlush } from "../data/plushies";

function renderPlush(id: string) {
  const { container } = render(
    <svg><PlushSVG def={getPlush(id)} pose={NEUTRAL_POSE} seed={0.5} /></svg>
  );
  return container.querySelector("svg")!;
}

describe("PlushSVG 直列化制約 (仕様10章)", () => {
  it("全種で <use> / <image> / <text> を使わない", () => {
    for (const p of PLUSHIES) {
      const svg = renderPlush(p.id);
      expect(svg.querySelector("use"), p.id).toBeNull();
      expect(svg.querySelector("image"), p.id).toBeNull();
      expect(svg.querySelector("text"), p.id).toBeNull();
    }
  });

  it("全種で外部参照フィルタを使わない", () => {
    for (const p of PLUSHIES) {
      const svg = renderPlush(p.id);
      expect(svg.querySelector("filter"), p.id).toBeNull();
      expect(svg.innerHTML.includes("url(")).toBe(false);
    }
  });

  it("classNameに依存せず色をインラインで持つ", () => {
    const svg = renderPlush("bear_01");
    expect(svg.innerHTML).toContain("#");
    expect(svg.querySelector("[class]")).toBeNull();
  });

  it("全種が描画され、要素が1つ以上ある", () => {
    for (const p of PLUSHIES) {
      expect(renderPlush(p.id).querySelectorAll("*").length, p.id).toBeGreaterThan(3);
    }
  });
});

describe("PlushSVG ポーズ", () => {
  it("eyeOpen=0 のとき目が閉じる（瞳の円が消える）", () => {
    const open = render(<svg><PlushSVG def={getPlush("bear_01")} pose={NEUTRAL_POSE} seed={0.5} /></svg>);
    const shut = render(<svg><PlushSVG def={getPlush("bear_01")} pose={{ ...NEUTRAL_POSE, eyeOpen: 0 }} seed={0.5} /></svg>);
    const countEllipses = (c: HTMLElement) => c.querySelectorAll("ellipse, circle").length;
    expect(countEllipses(shut.container)).toBeLessThan(countEllipses(open.container));
  });

  it("tiltがtransformに反映される", () => {
    const { container } = render(
      <svg><PlushSVG def={getPlush("bear_01")} pose={{ ...NEUTRAL_POSE, tilt: 12 }} seed={0.5} /></svg>
    );
    expect(container.querySelector("g")!.getAttribute("transform")).toContain("rotate(12");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./pose"`

- [ ] **Step 3: pose.ts を書く**

```ts
import type { PlushDef } from "../state/types";

export type Pose = {
  squash: number;
  tilt: number;
  eyeOpen: number;
  lookAt: number;
  armRaise: number;
  hop: number;
};

export const NEUTRAL_POSE: Pose = {
  squash: 1, tilt: 0, eyeOpen: 1, lookAt: 0, armRaise: 0, hop: 0,
};

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    squash: lerp(a.squash, b.squash, t),
    tilt: lerp(a.tilt, b.tilt, t),
    eyeOpen: lerp(a.eyeOpen, b.eyeOpen, t),
    lookAt: lerp(a.lookAt, b.lookAt, t),
    armRaise: lerp(a.armRaise, b.armRaise, t),
    hop: lerp(a.hop, b.hop, t),
  };
}

/** seed から決定論的に個体差を導く（仕様 5.4）。 */
export function individuality(seed: number) {
  const f = (n: number) => {
    const x = Math.sin(seed * 9973 + n * 137.13) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    hueShift: (f(1) * 2 - 1) * 6,
    scale: 1 + (f(2) * 2 - 1) * 0.04,
    breathPeriod: 2.4 + f(3) * 0.8,
    blinkBase: 3 + f(4) * 4,
    chatty: f(5),
    linePick: f(6),
  };
}

function shiftHue(hex: string, deg: number): string { /* hex→hsl→hex 変換 */ }

/** 個体差を反映した表示用の PlushDef を返す。元は変更しない。 */
export function applyIndividuality(def: PlushDef, seed: number): PlushDef {
  const iv = individuality(seed);
  return {
    ...def,
    size: def.size * iv.scale,
    art: { ...def.art, body: shiftHue(def.art.body, iv.hueShift), accent: shiftHue(def.art.accent, iv.hueShift) },
  };
}
```

`shiftHue` は hex → HSL → hex の純粋関数として実装する。外部ライブラリを使わない。

- [ ] **Step 4: PlushSVG.tsx を書く**

原点はぬいぐるみの**足元中央** (0, 0)、上が負。ローカル座標で描き、`transform` で配置する。

```tsx
import type { PlushDef } from "../state/types";
import { applyIndividuality, type Pose } from "./pose";

type Props = { def: PlushDef; pose: Pose; seed: number };

export function PlushSVG({ def, pose, seed }: Props) {
  const d = applyIndividuality(def, seed);
  const r = d.size;
  const { body, accent, face, shape, ears, extras = [] } = d.art;

  // shape によって胴の楕円比を変える
  const ratio = shape === "round" ? 1 : shape === "pear" ? 0.92 : shape === "long" ? 0.78 : 1.08;
  const rx = r * ratio * (2 - pose.squash);   // squash<1 で横に潰れる
  const ry = r * pose.squash;
  const cy = -ry - pose.hop;

  const eye = 3.2 * pose.eyeOpen;
  const eyeDx = pose.lookAt * r * 0.14;

  return (
    <g transform={`translate(0 ${-pose.hop}) rotate(${pose.tilt} 0 ${-ry})`}>
      {/* 影: feGaussianBlur を使わず半透明楕円で表現する（仕様10章） */}
      <ellipse cx={0} cy={2} rx={rx * 0.85} ry={r * 0.16} fill="#000" opacity={0.08} />
      {/* 耳・手足・尻尾などを胴の後ろに描く */}
      {/* 胴 */}
      <ellipse cx={0} cy={cy} rx={rx} ry={ry} fill={body} />
      {/* お腹 */}
      <ellipse cx={0} cy={cy + ry * 0.28} rx={rx * 0.55} ry={ry * 0.5} fill={accent} opacity={0.85} />
      {/* 目: eyeOpen=0 のとき描かない（閉じた線を引く） */}
      {pose.eyeOpen > 0.08 ? (
        <>
          <ellipse cx={-rx * 0.3 + eyeDx} cy={cy - ry * 0.12} rx={3.2} ry={eye} fill={face} />
          <ellipse cx={rx * 0.3 + eyeDx} cy={cy - ry * 0.12} rx={3.2} ry={eye} fill={face} />
        </>
      ) : (
        <>
          <rect x={-rx * 0.3 + eyeDx - 3.2} y={cy - ry * 0.12 - 0.7} width={6.4} height={1.4} rx={0.7} fill={face} />
          <rect x={rx * 0.3 + eyeDx - 3.2} y={cy - ry * 0.12 - 0.7} width={6.4} height={1.4} rx={0.7} fill={face} />
        </>
      )}
      {/* 鼻・口 */}
    </g>
  );
}
```

`ears`（round/long/pointed/none）と `extras`（beak/tentacles/flipper/tail）はそれぞれ小さな関数に切り出し、胴の前後に描き分ける。`armRaise` は左右の手の楕円を上へ回転させることで表現する。**`<text>` を一切使わない**。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — pose 7件 + PlushSVG 6件

- [ ] **Step 6: 目視確認**

`src/App.tsx` を一時的に全10種を並べる画面にし、`npm run dev` で開いて全種が「丸く、柔らかく、少し転がりそう」に見えることを確認する。見えなければ形状パラメータを調整する。この確認は自動テストでは代替できない。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: PlushSVG レンダラと個体差"
```

---

## Task 3: ストア・永続化・プレイログ

**Files:**
- Create: `src/state/log.ts`, `src/state/persist.ts`, `src/state/store.ts`
- Modify: `src/state/types.ts`
- Test: `src/state/persist.test.ts`, `src/state/store.test.ts`, `src/state/log.test.ts`

**Interfaces:**
- Consumes: `PlushDef`, `PLUSHIES`（Task 1）
- Produces:
  - `type OwnedPlush = { uid: string; defId: string; acquiredAt: number; x: number; shelfRow: number; seed: number }`
  - `type CraneBoardSave = { prizes: { defId: string; x: number; z: number }[]; attemptsOnBoard: number }`
  - `type LogEventType`（仕様11章の全16種）
  - `type LogEvent = { type: LogEventType; t: number; sessionId: string; plushId?: string; attempt?: number; meta?: Record<string, number | string | boolean> }`
  - `type SaveV1 = { version: 1; sessionCount: number; owned: OwnedPlush[]; craneBoard: CraneBoardSave | null; attempts: number; pendingWelcome: string | null; log: LogEvent[] }`
  - `loadSave(): SaveV1`, `writeSave(s: SaveV1): void`, `initialSave(): SaveV1`, `STORAGE_KEY`
  - `pushLog(log: LogEvent[], ev: LogEvent): LogEvent[]`, `LOG_LIMIT = 2000`
  - `store`: `{ get(): SaveV1; subscribe(cb): () => void; ... }` と `useGame(): SaveV1`
  - アクション: `winPlush(defId: string): string`（返り値 uid）, `clearPendingWelcome(): void`, `movePlush(uid, x, shelfRow): void`, `saveBoard(b: CraneBoardSave | null): void`, `bumpAttempts(): void`, `log(type, extra?): void`, `resetAll(): void`, `grantPlush(defId): void`
  - `SHELF_CAPACITY = 12`

- [ ] **Step 1: 失敗するテストを書く**

`src/state/log.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pushLog, LOG_LIMIT } from "./log";
import type { LogEvent } from "./types";

const ev = (n: number): LogEvent => ({ type: "shelf_view", t: n, sessionId: "s" });

describe("pushLog", () => {
  it("追加できる", () => {
    expect(pushLog([], ev(1))).toHaveLength(1);
  });

  it("上限を超えたら古いものから捨てる", () => {
    let log: LogEvent[] = [];
    for (let i = 0; i < LOG_LIMIT + 50; i++) log = pushLog(log, ev(i));
    expect(log).toHaveLength(LOG_LIMIT);
    expect(log[0].t).toBe(50);
    expect(log[log.length - 1].t).toBe(LOG_LIMIT + 49);
  });

  it("元の配列を変更しない", () => {
    const a: LogEvent[] = [ev(1)];
    pushLog(a, ev(2));
    expect(a).toHaveLength(1);
  });
});
```

`src/state/persist.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadSave, writeSave, initialSave, STORAGE_KEY } from "./persist";

beforeEach(() => localStorage.clear());

describe("persist", () => {
  it("初期状態はBearを1匹持つ", () => {
    const s = initialSave();
    expect(s.owned).toHaveLength(1);
    expect(s.owned[0].defId).toBe("bear_01");
  });

  it("保存→読込で一致する", () => {
    const s = initialSave();
    s.attempts = 7;
    s.owned[0].x = 123;
    writeSave(s);
    const back = loadSave();
    expect(back.attempts).toBe(7);
    expect(back.owned[0].x).toBe(123);
  });

  it("壊れたJSONなら初期状態に戻す", () => {
    localStorage.setItem(STORAGE_KEY, "{{{ not json");
    expect(loadSave().owned[0].defId).toBe("bear_01");
  });

  it("versionが違えば初期状態に戻す", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, owned: [] }));
    expect(loadSave().owned).toHaveLength(1);
  });

  it("未知のdefIdを持つ所持品は捨てる", () => {
    const s = initialSave();
    s.owned.push({ uid: "x", defId: "dragon_99", acquiredAt: 0, x: 0, shelfRow: 0, seed: 0.5 });
    writeSave(s);
    expect(loadSave().owned.every((o) => o.defId !== "dragon_99")).toBe(true);
  });

  it("localStorageが使えなくても例外を投げない", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("quota"); };
    expect(() => writeSave(initialSave())).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});
```

`src/state/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "./store";

beforeEach(() => { localStorage.clear(); store.resetAll(); });

describe("store", () => {
  it("初期はBear1匹", () => {
    expect(store.get().owned).toHaveLength(1);
  });

  it("winPlushは1回の更新で所持追加とpendingWelcome設定を行う", () => {
    const uid = store.winPlush("rabbit_01");
    const s = store.get();
    expect(s.owned).toHaveLength(2);
    expect(s.owned[1].uid).toBe(uid);
    expect(s.pendingWelcome).toBe(uid);
    expect(s.log.some((e) => e.type === "plush_won")).toBe(true);
  });

  it("winPlushはuidを毎回変える", () => {
    expect(store.winPlush("rabbit_01")).not.toBe(store.winPlush("rabbit_01"));
  });

  it("winPlushはseedを個体ごとに変える", () => {
    store.winPlush("rabbit_01");
    store.winPlush("rabbit_01");
    const [a, b] = store.get().owned.slice(1);
    expect(a.seed).not.toBe(b.seed);
  });

  it("clearPendingWelcomeで演出フラグが消える", () => {
    store.winPlush("rabbit_01");
    store.clearPendingWelcome();
    expect(store.get().pendingWelcome).toBeNull();
  });

  it("winPlushはlocalStorageへ即座に永続化する", () => {
    store.winPlush("rabbit_01");
    expect(localStorage.getItem("plushcrane.v1")).toContain("rabbit_01");
  });

  it("subscribeが変更時に呼ばれる", () => {
    let n = 0;
    const un = store.subscribe(() => n++);
    store.winPlush("rabbit_01");
    expect(n).toBeGreaterThan(0);
    un();
  });

  it("棚の上限12匹を超えた分はshelfRow=-1（箱の中）になる", () => {
    for (let i = 0; i < 14; i++) store.winPlush("duck_01");
    const onShelf = store.get().owned.filter((o) => o.shelfRow >= 0);
    expect(onShelf.length).toBeLessThanOrEqual(12);
    expect(store.get().owned.length).toBe(15);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./log"`

- [ ] **Step 3: types.ts を拡張する**

上の Interfaces に挙げた `OwnedPlush` / `CraneBoardSave` / `LogEventType` / `LogEvent` / `SaveV1` を `src/state/types.ts` に追記する。`LogEventType` は仕様11章の16種を漏れなく書く。

- [ ] **Step 4: log.ts を書く**

```ts
import type { LogEvent } from "./types";

export const LOG_LIMIT = 2000;

export function pushLog(log: LogEvent[], ev: LogEvent): LogEvent[] {
  const next = [...log, ev];
  return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
}
```

- [ ] **Step 5: persist.ts を書く**

```ts
export const STORAGE_KEY = "plushcrane.v1";
export const SHELF_CAPACITY = 12;
```

- `initialSave()` は Bear 1匹（`shelfRow: 1`, `x: 160`, `seed: Math.random()`）を持つ `SaveV1` を返す。
- `loadSave()` は try/catch で JSON パースし、`version !== 1` なら `initialSave()`。`owned` は配列でない/要素の型が合わない/`defId` が `PLUSHIES` にない要素を除去し、結果が空なら `initialSave()` に戻す。`log` が配列でなければ `[]`。
- `writeSave()` は try/catch で握りつぶす（容量超過やプライベートモードで落とさない）。

- [ ] **Step 6: store.ts を書く**

`useSyncExternalStore` 用の最小ストア。

```ts
let state: SaveV1 = loadSave();
const listeners = new Set<() => void>();

function set(updater: (s: SaveV1) => SaveV1) {
  state = updater(state);
  writeSave(state);
  listeners.forEach((l) => l());
}
```

`winPlush(defId)` は**単一の `set` 呼び出し**で、盤面からの削除ではなく所持追加・`pendingWelcome` 設定・`plush_won` ログ記録をまとめて行う（仕様5.3の原子性）。空き棚位置は `shelfRow`/`x` を走査して決め、12匹を超える分は `shelfRow: -1`（箱の中）にする。

`useGame()` は `useSyncExternalStore(store.subscribe, store.get)` を返す。

- [ ] **Step 7: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — log 3件 + persist 6件 + store 9件

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: ストア・永続化・プレイログ"
```

---

## Phase A 完了: Codex レビュー ①

- [ ] **Codex に Phase A をレビューさせる**

`codex:rescue` サブエージェントに次を依頼する。

> src/data/, src/state/, src/render/ をレビューしてほしい。ぬいぐるみクレーンゲームMVPの基盤部分。仕様書は docs/superpowers/specs/2026-09-03-plush-crane-mvp-design.md。見てほしい点: (1) 永続化の破損データ処理に穴がないか (2) winPlush の原子性が本当に保たれているか、途中で例外が出た場合に状態が壊れないか (3) PlushSVG が SVG直列化制約（仕様10章: use/image/text/外部filter禁止）を全経路で守れているか (4) individuality の決定論性 (5) 型の抜け穴、any の混入

指摘を採否判断してから修正し、コミットする。仕様と衝突する指摘は却下し、理由を記録する。

---

# Phase B: Priority 1 — 出会いの瞬間

## Task 4: 棚画面（表示のみ）と生活感

**Files:**
- Create: `src/shelf/shelfLayout.ts`, `src/shelf/ShelfScreen.tsx`, `src/render/useAmbientLife.ts`, `src/data/lines.ts`
- Modify: `src/App.tsx`, `src/styles.css`
- Test: `src/shelf/shelfLayout.test.ts`

**Interfaces:**
- Consumes: `useGame`, `OwnedPlush`（Task 3）, `PlushSVG`, `Pose`（Task 2）
- Produces:
  - `SHELF: { width: 320; rows: 3; rowY: [number, number, number]; padding: number }`
  - `rowCapacity(row: number): number`
  - `resolveOverlaps(items: {uid:string; x:number; shelfRow:number; r:number}[]): {uid:string; x:number; shelfRow:number}[]`
  - `clampToShelf(x: number, r: number): number`
  - `<ShelfScreen onGoArcade={() => void} />`
  - `LINES: Record<string, string[]>`（`shelfIdle` / `shelfTouch` / `welcomeHost` / `welcomeGuest` / `craneIdle` / `craneAiming` / `craneGrabbed` / `craneMissed` / `craneNearExit` / `craneSuccess`）

- [ ] **Step 1: 失敗するテストを書く**

`src/shelf/shelfLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveOverlaps, clampToShelf, SHELF, rowCapacity } from "./shelfLayout";

const item = (uid: string, x: number, shelfRow = 0, r = 32) => ({ uid, x, shelfRow, r });

describe("clampToShelf", () => {
  it("左端をはみ出さない", () => {
    expect(clampToShelf(-100, 32)).toBeGreaterThanOrEqual(32);
  });
  it("右端をはみ出さない", () => {
    expect(clampToShelf(9999, 32)).toBeLessThanOrEqual(SHELF.width - 32);
  });
});

describe("resolveOverlaps", () => {
  it("重なった2匹を離す", () => {
    const out = resolveOverlaps([item("a", 100), item("b", 110)]);
    const [a, b] = out;
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(64 * 0.9);
  });

  it("解消後も全員が棚の内側にいる", () => {
    const out = resolveOverlaps([item("a", 100), item("b", 102), item("c", 104), item("d", 106)]);
    for (const o of out) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThanOrEqual(SHELF.width);
    }
  });

  it("1段に入りきらない分は別の段へ移す", () => {
    const many = Array.from({ length: 6 }, (_, i) => item(`p${i}`, 160, 0, 32));
    const out = resolveOverlaps(many);
    expect(new Set(out.map((o) => o.shelfRow)).size).toBeGreaterThan(1);
  });

  it("重ならない配置はそのまま保つ", () => {
    const input = [item("a", 60), item("b", 160), item("c", 260)];
    expect(resolveOverlaps(input).map((o) => o.x)).toEqual([60, 160, 260]);
  });

  it("uidを失わない", () => {
    const input = [item("a", 100), item("b", 105), item("c", 110)];
    expect(new Set(resolveOverlaps(input).map((o) => o.uid))).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("rowCapacity", () => {
  it("1段あたり4匹以上入る", () => {
    expect(rowCapacity(0)).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./shelfLayout"`

- [ ] **Step 3: shelfLayout.ts を書く**

`resolveOverlaps` は同じ `shelfRow` 内で x 昇順に並べ、隣接距離が `ra + rb` 未満なら右へ押し出す。右端に収まらなくなった個体は空きのある段へ移す。全段が埋まっていれば `shelfRow: -1`（箱の中）にはせず、最も空いている段へ最小の重なりで置く（表示上の破綻より、消えないことを優先する）。純粋関数として書き、DOM に触れない。

- [ ] **Step 4: lines.ts を書く**

仕様9章のトーンに沿った短いセリフ集。クエスト化する台詞を入れない。

```ts
export const LINES = {
  shelfIdle: ["今日は誰かいるかな？", "おだやかだね。", "……ふぁ。"],
  shelfTouch: ["ん？", "なあに？", "ここ、いごこちいいよ。", "えへへ。"],
  welcomeHost: ["はじめまして！", "ようこそ。", "あたらしい子だ！"],
  welcomeGuest: ["……よろしくね。", "わぁ。"],
  craneIdle: ["あの子、気になる。"],
  craneAiming: ["そこ……！"],
  craneGrabbed: ["きた！"],
  craneMissed: ["あっ！"],
  craneNearExit: ["もうちょっとかも。"],
  craneSuccess: ["やった！"],
};
```

- [ ] **Step 5: useAmbientLife.ts を書く**

**React の再レンダーを起こさないこと**（Global Constraints）。`ref` に渡された `SVGGElement` に対し、単一の rAF ループから直接 `transform` と目の属性を書き換える。

```ts
export function useAmbientLife(refs: Map<string, SVGGElement | null>, plushes: {uid: string; seed: number; x: number}[]): void
```

- 呼吸: `individuality(seed).breathPeriod` 周期で `scale(1, 1±0.012)`
- 瞬き: `blinkBase` 秒間隔 ±ゆらぎで 80ms、目の `ry` を 0 にする
- 隣を見る: 12〜20秒に一度、最も近い個体の方向へ `lookAt` を 1.5 秒
- `document.visibilityState === "hidden"` の間は rAF を止める

- [ ] **Step 6: ShelfScreen.tsx を書く**

- 「棚」ではなく「小さな部屋」に見せる。壁・床・窓・棚板を淡いウッドとオフホワイトで描く。インベントリのグリッド線・枠・アイテム番号を出さない
- 所持ぬいぐるみを `shelfRow`/`x` に配置して `PlushSVG` で描く（`shelfRow: -1` は描かない）
- クリックで `squash 0.85 → オーバーシュート復帰` と `LINES.shelfTouch` の吹き出し、`plush_touched` をログ
- ヘッダに所持数（「おともだち 2」程度。バッジや「/10」のような収集率表示にしない）
- 「ゲームセンターへ」ボタン、「棚をシェア」ボタン（Task 11 まではダミー）
- 表示時に `shelf_view` を、離脱時に `shelf_dwell`（meta.ms）をログ

- [ ] **Step 7: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — shelfLayout 7件

- [ ] **Step 8: 目視確認**

`npm run dev` で棚を開き、次を確認する。
- Bear が1匹いて、呼吸で微かに動いている
- クリックすると潰れて戻り、セリフが出る
- 「コレクション一覧」ではなく「部屋」に見える

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "feat: 棚画面と生活感アニメーション"
```

---

## Task 5: 出会いの演出（Priority 1）

**Files:**
- Create: `src/shelf/MeetingCeremony.tsx`
- Modify: `src/shelf/ShelfScreen.tsx`
- Test: `src/shelf/ceremonyTimeline.test.ts`
- Create: `src/shelf/ceremonyTimeline.ts`

**Interfaces:**
- Consumes: `PlushSVG`, `Pose`, `lerpPose`, `store`, `LINES`
- Produces:
  - `type CeremonyPhase = { t: number; hostLine?: string; guestLine?: string; caption?: string; hostLook: number; guestHop: number; sparkle: boolean }`
  - `ceremonyDuration(isFirstMeeting: boolean): number`
  - `ceremonyAt(ms: number, isFirstMeeting: boolean): CeremonyPhase`
  - `<MeetingCeremony guestUid={string} onDone={() => void} />`

- [ ] **Step 1: 失敗するテストを書く**

`src/shelf/ceremonyTimeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ceremonyAt, ceremonyDuration } from "./ceremonyTimeline";

describe("ceremonyDuration", () => {
  it("初回はフル4.0秒", () => {
    expect(ceremonyDuration(true)).toBe(4000);
  });
  it("2回目以降は短縮2.4秒", () => {
    expect(ceremonyDuration(false)).toBe(2400);
  });
});

describe("ceremonyAt (初回)", () => {
  it("開始時は先輩がまだ向いていない", () => {
    expect(ceremonyAt(0, true).hostLook).toBe(0);
  });

  it("0.6秒以降に先輩が新入りを向く", () => {
    expect(Math.abs(ceremonyAt(900, true).hostLook)).toBeGreaterThan(0.5);
  });

  it("1.0秒に「はじめまして！」が出る", () => {
    expect(ceremonyAt(1100, true).hostLine).toBe("はじめまして！");
  });

  it("1.8秒に新入りが跳ねて粒子が出る", () => {
    const p = ceremonyAt(1900, true);
    expect(p.guestHop).toBeGreaterThan(0);
    expect(p.sparkle).toBe(true);
  });

  it("3.2秒に Welcome home. が出る", () => {
    expect(ceremonyAt(3300, true).caption).toBe("Welcome home.");
  });

  it("終了時は両者が静止している", () => {
    const p = ceremonyAt(4000, true);
    expect(p.guestHop).toBe(0);
  });

  it("GET などの強い文言を一切出さない", () => {
    for (let t = 0; t <= 4000; t += 50) {
      const p = ceremonyAt(t, true);
      const all = `${p.hostLine ?? ""}${p.guestLine ?? ""}${p.caption ?? ""}`;
      expect(/GET|ゲット|レア|RARE|！！/.test(all)).toBe(false);
    }
  });
});

describe("ceremonyAt (短縮版)", () => {
  it("2.4秒までに「はじめまして！」が出る", () => {
    let seen = false;
    for (let t = 0; t <= 2400; t += 50) if (ceremonyAt(t, false).hostLine) seen = true;
    expect(seen).toBe(true);
  });

  it("短縮版でも先輩が向く", () => {
    expect(Math.abs(ceremonyAt(1200, false).hostLook)).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./ceremonyTimeline"`

- [ ] **Step 3: ceremonyTimeline.ts を書く**

演出を**時刻 → 状態の純粋関数**として書く。これによりタイムラインだけをテストでき、DOM から独立して調整できる。仕様8章のタイムラインをそのまま実装する。短縮版は 0.6/1.0/2.2 秒に圧縮する。

- [ ] **Step 4: MeetingCeremony.tsx を書く**

- rAF で経過時間を進め、`ceremonyAt` の結果を Pose と吹き出しに反映する
- 先輩役は新入りの最近傍1匹。同じ子が続けて選ばれたら `welcomeHost` の別のセリフを使う
- **画面のどこをタップしてもスキップ**し、即座に最終状態へ遷移する
- 再生中は配置ドラッグを無効化する
- 終了時に `store.clearPendingWelcome()` を呼び、`welcome_played`（meta: `{ count, skipped }`）をログ
- 背景をわずかに落とすが、暗転させない

- [ ] **Step 5: ShelfScreen に組み込む**

`store.get().pendingWelcome` が非 null なら `MeetingCeremony` を表示する。所持数が2匹目のときだけ `isFirstMeeting = true`。

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — ceremony 11件

- [ ] **Step 7: 目視確認（このMVPで最も重要な確認）**

DevMenu がまだ無いので、ブラウザのコンソールから次を実行して演出を起こす。

```js
// dev用に window.__store = store を store.ts で公開しておく
__store.winPlush("rabbit_01")
```

確認すること。
- **2匹が並んだ瞬間に嬉しさがあるか**
- Bear が Rabbit を見るタイミングが自然か（早すぎ／遅すぎでないか）
- 4秒が長すぎないか
- 「GET」感がなく、静かで温かいか

納得いくまでタイムラインの数値を調整する。**ここに時間をかけてよい。** このMVPで最も重要な4秒間である。

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: 出会いの演出 (Priority 1)"
```

---

## Phase B 完了: Codex レビュー ②

- [ ] **Codex に Phase B をレビューさせる**

> src/shelf/ をレビューしてほしい。ぬいぐるみクレーンゲームMVPの「棚」と「出会いの演出」。仕様書は docs/superpowers/specs/2026-09-03-plush-crane-mvp-design.md の 8章・9章・6.1。見てほしい点: (1) resolveOverlaps が全段満杯や同座標多重などの境界で無限ループや個体消失を起こさないか (2) useAmbientLife の rAF がアンマウント時やタブ非表示で確実に止まるか、リークがないか (3) MeetingCeremony のスキップとリロードが競合したとき pendingWelcome が残留・二重再生しないか (4) 演出中にドラッグやナビゲーションが漏れて入らないか

---

# Phase C: Priority 2 — クレーンの感触

## Task 6: 物理ソルバ

**Files:**
- Create: `src/arcade/physics.ts`
- Test: `src/arcade/physics.test.ts`

**Interfaces:**
- Consumes: なし（純粋、DOM非依存）
- Produces:
  - `type Body = { id: string; defId: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; spin: number; held: boolean }`
  - `type Pit = { minX: number; maxX: number; minZ: number; maxZ: number; exit: { x: number; z: number; r: number } }`
  - `DEFAULT_PIT: Pit`, `STEP = 1 / 120`
  - `step(bodies: Body[], pit: Pit, dt: number): { fallen: string[]; impacts: number }`
  - `atRest(bodies: Body[]): boolean`
  - `exitDistance(b: Body, pit: Pit): number`

- [ ] **Step 1: 失敗するテストを書く**

`src/arcade/physics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { step, atRest, exitDistance, DEFAULT_PIT, STEP, type Body } from "./physics";

const body = (over: Partial<Body> = {}): Body => ({
  id: "a", defId: "bear_01", x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0, r: 30, spin: 0, held: false, ...over,
});

function settle(bodies: Body[], seconds = 5) {
  const fallen: string[] = [];
  for (let i = 0; i < seconds * 120; i++) fallen.push(...step(bodies, DEFAULT_PIT, STEP).fallen);
  return fallen;
}

describe("重力と床", () => {
  it("落ちて床で止まる", () => {
    const b = [body({ y: 200 })];
    settle(b);
    expect(b[0].y).toBeCloseTo(0, 0);
    expect(atRest(b)).toBe(true);
  });

  it("held の物体は落ちない", () => {
    const b = [body({ y: 200, held: true })];
    settle(b, 1);
    expect(b[0].y).toBe(200);
  });

  it("跳ね返りは減衰し、無限に跳ね続けない", () => {
    const b = [body({ y: 300 })];
    settle(b, 10);
    expect(Math.abs(b[0].vy)).toBeLessThan(1);
  });
});

describe("壁", () => {
  it("外へ出ない", () => {
    const b = [body({ x: 0, vx: -9999 })];
    settle(b, 3);
    expect(b[0].x).toBeGreaterThanOrEqual(DEFAULT_PIT.minX);
    expect(b[0].x).toBeLessThanOrEqual(DEFAULT_PIT.maxX);
  });
});

describe("衝突", () => {
  it("重なった2体は離れる", () => {
    const b = [body({ id: "a", x: 0 }), body({ id: "b", x: 10 })];
    settle(b, 2);
    expect(Math.abs(b[0].x - b[1].x)).toBeGreaterThan(50);
  });

  it("衝突後も全体のエネルギーが増えない（爆発しない）", () => {
    const b = [body({ id: "a", x: 0, vx: 200 }), body({ id: "b", x: 40 })];
    settle(b, 3);
    for (const o of b) expect(Math.abs(o.vx)).toBeLessThan(200);
  });

  it("多数の物体が重なっても発散しない", () => {
    const b = Array.from({ length: 8 }, (_, i) => body({ id: `p${i}`, x: 100 + i, z: 100 }));
    settle(b, 5);
    for (const o of b) {
      expect(Number.isFinite(o.x)).toBe(true);
      expect(Math.abs(o.x)).toBeLessThan(10000);
    }
  });
});

describe("出口", () => {
  it("出口の上に来ると落ちて fallen に入る", () => {
    const b = [body({ x: DEFAULT_PIT.exit.x, z: DEFAULT_PIT.exit.z, y: 100 })];
    expect(settle(b, 4)).toContain("a");
  });

  it("出口から遠ければ落ちない", () => {
    const b = [body({ x: DEFAULT_PIT.exit.x + 250, z: DEFAULT_PIT.exit.z, y: 100 })];
    expect(settle(b, 4)).not.toContain("a");
  });

  it("落ちた物体は二度と fallen に入らない", () => {
    const b = [body({ x: DEFAULT_PIT.exit.x, z: DEFAULT_PIT.exit.z, y: 100 })];
    const f = settle(b, 6);
    expect(f.filter((id) => id === "a")).toHaveLength(1);
  });
});

describe("exitDistance", () => {
  it("出口の真上なら0に近い", () => {
    expect(exitDistance(body({ x: DEFAULT_PIT.exit.x, z: DEFAULT_PIT.exit.z }), DEFAULT_PIT)).toBeLessThan(1);
  });
  it("離れれば大きくなる", () => {
    const near = exitDistance(body({ x: DEFAULT_PIT.exit.x + 50, z: DEFAULT_PIT.exit.z }), DEFAULT_PIT);
    const far = exitDistance(body({ x: DEFAULT_PIT.exit.x + 150, z: DEFAULT_PIT.exit.z }), DEFAULT_PIT);
    expect(far).toBeGreaterThan(near);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./physics"`

- [ ] **Step 3: physics.ts を書く**

仕様7.2の通り実装する。

```ts
export const STEP = 1 / 120;
const GRAVITY = 1400;      // px/s^2
const RESTITUTION = 0.35;
const FLOOR_FRICTION = 0.86;
const PAIR_RESTITUTION = 0.4;
const REST_SPEED = 6;      // これ未満を静止とみなす

export const DEFAULT_PIT: Pit = {
  minX: 0, maxX: 320, minZ: 0, maxZ: 180,
  exit: { x: 46, z: 24, r: 34 },
};
```

- `held: true` の物体は積分をスキップする（`vy` も加算しない）
- 床接地時 `y <= 0` で `vy = -vy * RESTITUTION`、`|vy| < 40` なら `vy = 0, y = 0`
- 接地中は `vx, vz *= FLOOR_FRICTION ** (dt * 60)`
- 球同士は x-z 平面の距離で判定し、重なり分を質量等分で押し出したうえで法線方向の速度を交換する（`PAIR_RESTITUTION`）。**位置補正は 1 回の `step` で最大 1 回**にして発散を防ぐ
- `spin += vx * dt * 0.06`（見た目専用）
- 出口判定: 落下済みを `fallen` セットで管理し、二度目を返さない。`held` でなく、中心が出口円内かつ `y <= 0` に到達したら `fallen` に入れ、`y` を下げ続けて視界外へ落とす
- `atRest` は全 body が `y <= 0.5` かつ速度3成分すべて `< REST_SPEED`

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — physics 12件

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: 球体物理ソルバ"
```

---

## Task 7: クレーン状態機械と難易度（このMVPで最も重要なロジック）

**Files:**
- Create: `src/arcade/craneMachine.ts`
- Test: `src/arcade/craneMachine.test.ts`, `src/arcade/difficulty.test.ts`

**Interfaces:**
- Consumes: `physics.ts`, `plushCoefficient`, `getPlush`
- Produces:
  - `type CraneState = "idle" | "aimX" | "aimZ" | "descend" | "grab" | "lift" | "carry" | "release" | "settle"`
  - `R0 = 44`, `DRAIN0 = 0.62`, `T_LIFT = 1.1`, `RELEASE_THRESHOLD = 0.15`, `MIN_ADVANCE = 30`, `AUTO_DROP_RANGE = 60`
  - `radiusAssist(n: number): number`, `drainAssist(n: number): number`
  - `grabRadius(n: number): number`, `drain(n: number): number`, `requiredHold(n: number): number`
  - `initialHold(d: number, def: PlushDef, n: number): number`
  - `willHold(d: number, def: PlushDef, n: number): boolean`
  - `maxAimError(def: PlushDef, n: number): number`
  - `advanceImpulse(b: Body, pit: Pit): { vx: number; vz: number }`
  - `enforceAdvance(before: number, after: Body, pit: Pit): void`
  - `type Crane = { state: CraneState; armX: number; armZ: number; armY: number; hold: number; heldId: string | null; attemptsOnBoard: number; liftElapsed: number }`
  - `createCrane(): Crane`
  - `tickCrane(c: Crane, bodies: Body[], pit: Pit, dt: number): CraneEvent[]`
  - `type CraneEvent = { kind: "drop" | "grabbed" | "released" | "won" | "nudged" | "settled"; bodyId?: string }`

- [ ] **Step 1: 難易度の失敗するテストを書く**

`src/arcade/difficulty.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { grabRadius, drain, requiredHold, initialHold, willHold, maxAimError,
         R0, DRAIN0, RELEASE_THRESHOLD, MIN_ADVANCE, AUTO_DROP_RANGE } from "./craneMachine";
import { PLUSHIES, getPlush, plushCoefficient } from "../data/plushies";

/** レイリー分布に従う照準誤差 d を生成する（仕様7.6）。 */
function aimError(sigma: number, rnd: () => number): number {
  const ex = gauss(rnd) * sigma;
  const ez = gauss(rnd) * sigma;
  return Math.hypot(ex, ez);
}
function gauss(rnd: () => number): number {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("アシスト表 (仕様7.6)", () => {
  const rows = [
    { n: 1, R: 44, req: 0.77 },
    { n: 2, R: 55, req: 0.60 },
    { n: 3, R: 66, req: 0.45 },
    { n: 4, R: 77, req: 0.33 },
  ];
  for (const { n, R, req } of rows) {
    it(`n=${n} の掴み半径が ${R}px`, () => {
      expect(grabRadius(n)).toBeCloseTo(R, 0);
    });
    it(`n=${n} の必要hold0が ${req}`, () => {
      expect(requiredHold(n)).toBeCloseTo(req, 2);
    });
  }
  it("5回目以降は4回目と同じ（上限で頭打ち）", () => {
    expect(grabRadius(9)).toBe(grabRadius(4));
    expect(drain(9)).toBe(drain(4));
  });
  it("必要hold0 = RELEASE_THRESHOLD + drain(n)", () => {
    for (let n = 1; n <= 4; n++) expect(requiredHold(n)).toBeCloseTo(RELEASE_THRESHOLD + drain(n), 6);
  });
  it("R0とDRAIN0が仕様値", () => {
    expect(R0).toBe(44);
    expect(DRAIN0).toBeCloseTo(0.62, 6);
  });
});

describe("initialHold", () => {
  it("0以上1以下にクランプされる", () => {
    for (const p of PLUSHIES) for (let n = 1; n <= 5; n++) {
      for (const d of [0, 10, 50, 200]) {
        const h = initialHold(d, p, n);
        expect(h, `${p.id} n=${n} d=${d}`).toBeGreaterThanOrEqual(0);
        expect(h, `${p.id} n=${n} d=${d}`).toBeLessThanOrEqual(1);
      }
    }
  });
  it("掴み半径の外なら0", () => {
    expect(initialHold(999, getPlush("rabbit_01"), 1)).toBe(0);
  });
  it("dが小さいほど大きい", () => {
    const r = getPlush("rabbit_01");
    expect(initialHold(0, r, 2)).toBeGreaterThan(initialHold(20, r, 2));
  });
  it("試行が進むほど同じdで大きくなる", () => {
    const r = getPlush("rabbit_01");
    expect(initialHold(20, r, 3)).toBeGreaterThan(initialHold(20, r, 1));
  });
});

describe("maxAimError (仕様7.6の表)", () => {
  it("Rabbit の許容誤差が仕様表と一致する", () => {
    const r = getPlush("rabbit_01");
    expect(maxAimError(r, 1)).toBeCloseTo(13.2, 0);
    expect(maxAimError(r, 2)).toBeCloseTo(25.0, 0);
    expect(maxAimError(r, 3)).toBeCloseTo(38.9, 0);
    expect(maxAimError(r, 4)).toBeCloseTo(54.0, 0);
  });

  it("全10種が n=4 で 35px 以上の許容誤差を持つ", () => {
    for (const p of PLUSHIES) {
      expect(maxAimError(p, 4), `${p.id} k=${plushCoefficient(p).toFixed(3)}`).toBeGreaterThanOrEqual(35);
    }
  });

  it("許容誤差は試行とともに単調増加する", () => {
    for (const p of PLUSHIES) {
      for (let n = 1; n < 4; n++) {
        expect(maxAimError(p, n + 1)).toBeGreaterThanOrEqual(maxAimError(p, n));
      }
    }
  });
});

describe("成功率シミュレーション (仕様7.8)", () => {
  function simulate(sigma: number, trials: number) {
    const rnd = mulberry32(20260903);
    const rabbit = getPlush("rabbit_01");
    let firstTry = 0, within4 = 0;
    for (let i = 0; i < trials; i++) {
      for (let n = 1; n <= 4; n++) {
        if (willHold(aimError(sigma, rnd), rabbit, n)) {
          if (n === 1) firstTry++;
          within4++;
          break;
        }
      }
    }
    return { firstTry: firstTry / trials, within4: within4 / trials };
  }

  it("初見(σ=18px): 1回目 0.15〜0.45、4回以内 >= 0.95", () => {
    const r = simulate(18, 1000);
    expect(r.firstTry).toBeGreaterThanOrEqual(0.15);
    expect(r.firstTry).toBeLessThanOrEqual(0.45);
    expect(r.within4).toBeGreaterThanOrEqual(0.95);
  });

  it("上手いプレイヤー(σ=9px): 1回目 >= 0.50", () => {
    expect(simulate(9, 1000).firstTry).toBeGreaterThanOrEqual(0.5);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./craneMachine"`

- [ ] **Step 3: 難易度の数式を実装する**

```ts
export const R0 = 44;
export const DRAIN0 = 0.62;
export const T_LIFT = 1.1;
export const RELEASE_THRESHOLD = 0.15;
export const MIN_ADVANCE = 30;
export const AUTO_DROP_RANGE = 60;

const RADIUS_ASSIST = [1.0, 1.25, 1.5, 1.75];
const DRAIN_ASSIST = [1.0, 0.72, 0.48, 0.29];

const idx = (n: number) => Math.min(Math.max(n, 1), 4) - 1;

export const radiusAssist = (n: number) => RADIUS_ASSIST[idx(n)];
export const drainAssist = (n: number) => DRAIN_ASSIST[idx(n)];
export const grabRadius = (n: number) => R0 * radiusAssist(n);
export const drain = (n: number) => DRAIN0 * drainAssist(n);
export const requiredHold = (n: number) => RELEASE_THRESHOLD + drain(n);

export function initialHold(d: number, def: PlushDef, n: number): number {
  const R = grabRadius(n);
  if (d >= R) return 0;
  return Math.min(1, Math.max(0, (1 - d / R) * plushCoefficient(def)));
}

export function willHold(d: number, def: PlushDef, n: number): boolean {
  return initialHold(d, def, n) >= requiredHold(n);
}

/** hold0 >= requiredHold を満たす最大の d。取れないなら 0。 */
export function maxAimError(def: PlushDef, n: number): number {
  const k = plushCoefficient(def);
  const ratio = 1 - requiredHold(n) / k;
  return ratio <= 0 ? 0 : grabRadius(n) * ratio;
}
```

**注意**: `initialHold` のクランプは `willHold` の判定前に効く。k > 1 の個体で `(1 - d/R) * k` が 1 を超える場合、クランプにより `maxAimError` の理論値と実挙動がずれる。`requiredHold(n) <= 1` なので、クランプが判定を変えるのは hold0 が 1 を超える領域のみであり、その領域では常に成功する。したがって `maxAimError` の式は正しい。この理由をコード内のコメントに書くこと。

- [ ] **Step 4: 難易度テストを実行して通ることを確認する**

Run: `npx vitest run src/arcade/difficulty.test.ts`
Expected: PASS — 全件

数値が仕様表とずれた場合、**仕様の表が正**。実装を直す。シミュレーション結果が範囲外になった場合のみ、仕様書の `RADIUS_ASSIST` / `DRAIN_ASSIST` を再チューニングし、仕様書も同時に更新する。

- [ ] **Step 5: 盤面前進と状態機械の失敗するテストを書く**

`src/arcade/craneMachine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createCrane, tickCrane, MIN_ADVANCE, AUTO_DROP_RANGE } from "./craneMachine";
import { DEFAULT_PIT, STEP, exitDistance, atRest, type Body } from "./physics";

const prize = (x: number, z: number, id = "p1"): Body => ({
  id, defId: "rabbit_01", x, z, y: 0, vx: 0, vy: 0, vz: 0, r: 33, spin: 0, held: false,
});

/** アームを (ax, az) に置いて1回DROPし、盤面が静止するまで進める。 */
function runAttempt(c: ReturnType<typeof createCrane>, bodies: Body[], ax: number, az: number) {
  c.armX = ax; c.armZ = az; c.state = "descend"; c.attemptsOnBoard++;
  const events = [];
  for (let i = 0; i < 120 * 12; i++) {
    events.push(...tickCrane(c, bodies, DEFAULT_PIT, STEP));
    if (c.state === "idle" && atRest(bodies)) break;
  }
  return events;
}

describe("盤面前進の保証 (仕様7.7)", () => {
  it("掴んで落とした後、出口距離が必ず MIN_ADVANCE 以上縮む", () => {
    for (let trial = 0; trial < 20; trial++) {
      const b = [prize(200 + trial * 3, 120)];
      const before = exitDistance(b[0], DEFAULT_PIT);
      const c = createCrane();
      runAttempt(c, b, b[0].x, b[0].z);
      if (b.length === 0) continue;           // 獲得した場合は対象外
      const after = exitDistance(b[0], DEFAULT_PIT);
      expect(before - after, `trial ${trial}`).toBeGreaterThanOrEqual(MIN_ADVANCE - 0.5);
    }
  });

  it("狙いを完全に外しても最近傍の景品が動く（何も起きないの禁止）", () => {
    const b = [prize(280, 150)];
    const before = { x: b[0].x, z: b[0].z };
    const c = createCrane();
    runAttempt(c, b, 20, 20);
    expect(b[0].x !== before.x || b[0].z !== before.z).toBe(true);
  });

  it("他の景品に阻まれても出口距離は縮む", () => {
    const b = [prize(200, 120, "p1"), prize(150, 90, "block")];
    const before = exitDistance(b[0], DEFAULT_PIT);
    const c = createCrane();
    runAttempt(c, b, 200, 120);
    const target = b.find((x) => x.id === "p1");
    if (!target) return;
    expect(before - exitDistance(target, DEFAULT_PIT)).toBeGreaterThanOrEqual(MIN_ADVANCE - 0.5);
  });
});

describe("4回以内の構造的保証 (仕様7.7)", () => {
  it("狙いを毎回外しても4回以内に必ず獲得する", () => {
    const b = [prize(DEFAULT_PIT.exit.x + 140, DEFAULT_PIT.exit.z)];  // D0 = 140px
    const c = createCrane();
    let won = false;
    for (let n = 1; n <= 4 && !won; n++) {
      const evs = runAttempt(c, b, 9999, 9999);   // 常に完全に外す
      won = evs.some((e) => e.kind === "won") || b.length === 0;
    }
    expect(won).toBe(true);
  });

  it("D0の上限140pxで、3回失敗後は必ずAUTO_DROP_RANGE圏内に入る", () => {
    const b = [prize(DEFAULT_PIT.exit.x + 140, DEFAULT_PIT.exit.z)];
    const c = createCrane();
    for (let n = 1; n <= 3; n++) {
      if (b.length === 0) break;
      runAttempt(c, b, 9999, 9999);
    }
    if (b.length > 0) expect(exitDistance(b[0], DEFAULT_PIT)).toBeLessThanOrEqual(AUTO_DROP_RANGE);
  });
});

describe("状態機械", () => {
  it("DROPからidleへ必ず戻る（状態が詰まらない）", () => {
    const b = [prize(200, 120)];
    const c = createCrane();
    runAttempt(c, b, 200, 120);
    expect(c.state).toBe("idle");
  });

  it("試行カウンタは結果に関わらず増える", () => {
    const b = [prize(280, 150)];
    const c = createCrane();
    runAttempt(c, b, 9999, 9999);
    expect(c.attemptsOnBoard).toBe(1);
  });

  it("獲得時に won イベントを1回だけ出す", () => {
    const b = [prize(DEFAULT_PIT.exit.x + 10, DEFAULT_PIT.exit.z)];
    const c = createCrane();
    const evs = runAttempt(c, b, b[0].x, b[0].z);
    expect(evs.filter((e) => e.kind === "won")).toHaveLength(1);
  });
});
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `npx vitest run src/arcade/craneMachine.test.ts`
Expected: FAIL — `createCrane is not a function`

- [ ] **Step 7: 状態機械と保証を実装する**

状態遷移: `idle → aimX → aimZ → descend → grab → lift → carry → release → settle → idle`

- `descend` 開始時に `attemptsOnBoard++`、`drop` イベント
- `grab`: 最近傍 body との x-z 距離 `d` から `initialHold(d, def, n)` を求める。`hold > 0` なら `held = true` にして `grabbed` イベント。`hold === 0`（掴めなかった）なら最近傍 body に小さなインパルスを与えて `nudged` イベント（「何も起きない」の禁止）
- `lift`: `liftElapsed += dt`、`hold = hold0 - drain(n) * (liftElapsed / T_LIFT)`。`hold < RELEASE_THRESHOLD` で `held = false` にし `released` イベント → `advanceImpulse` を適用
- `carry`: `liftElapsed >= T_LIFT` まで保持できたらアームを出口上空へ移動し、`release` で離す → `won`
- `release`/`settle`: `atRest` になるまで待ち、`enforceAdvance` を適用してから `idle` へ

**`enforceAdvance` が仕様7.7の保証を実装する中核である。**

```ts
/** 落下前の出口距離を記録し、静止後に MIN_ADVANCE 未満しか縮んでいなければ差分を転がりで補う。 */
export function enforceAdvance(before: number, b: Body, pit: Pit): void {
  const after = exitDistance(b, pit);
  const gained = before - after;
  if (gained >= MIN_ADVANCE) return;
  const need = MIN_ADVANCE - gained;
  const dx = pit.exit.x - b.x;
  const dz = pit.exit.z - b.z;
  const len = Math.hypot(dx, dz) || 1;
  // 位置を直接動かすのではなく、転がる速度として与える。見た目が「ころころ」になる。
  const speed = Math.sqrt(2 * need * ROLL_DECEL);
  b.vx = (dx / len) * speed;
  b.vz = (dz / len) * speed;
}
```

`ROLL_DECEL` は床摩擦から導かれる減速度。`enforceAdvance` の後は再び静止するまで `settle` を続け、必要なら再適用する（最大3回で打ち切り、それでも足りなければ位置を直接補正する）。

`advanceImpulse` は落下時に 25〜70px 相当の初速を出口方向へ与える。`AUTO_DROP_RANGE`(60px) 圏内の body はアームが触れただけで出口へ転がるよう、`nudged` 時の力を距離に応じて強める。

- [ ] **Step 8: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — difficulty 全件 + craneMachine 8件

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "feat: クレーン状態機械と難易度保証"
```

---

## Task 8: クレーン画面

**Files:**
- Create: `src/arcade/CraneView.tsx`, `src/arcade/ArcadeScreen.tsx`
- Modify: `src/App.tsx`, `src/state/store.ts`
- Test: なし（描画と操作は目視確認）

**Interfaces:**
- Consumes: `physics.ts`, `craneMachine.ts`, `PlushSVG`, `store`
- Produces:
  - `project(x, y, z): { sx: number; sy: number; scale: number }`
  - `<CraneView bodies={Body[]} crane={Crane} pit={Pit} debug={boolean} />`
  - `<ArcadeScreen onGoShelf={() => void} />`

- [ ] **Step 1: 投影と盤面描画を書く**

`CraneView.tsx`:

```ts
export function project(x: number, y: number, z: number) {
  return { sx: x + z * 0.35, sy: 260 - z * 0.55 - y, scale: 1 - z * 0.0012 };
}
```

- 描画順は z の降順（奥から手前）
- 筐体はガラス面・淡いウッドの枠・出口シュートを描く。派手な装飾やロゴを入れない
- `debug` が真なら当たり判定円・速度ベクトル・出口領域を重ねる
- 景品は `PlushSVG` に `pose = { squash: 1, tilt: spin, ... }` を渡して描く

- [ ] **Step 2: ArcadeScreen を書く**

- 物理ループは `useRef` に置き、rAF ごとに 1 回だけ `setFrame(bodies.map(snapshot))` する（Global Constraints）
- `1/120` 固定ステップ、1フレーム最大8ステップ
- 操作 UI: 状態に応じて「← →」「奥 手前」「これでいく」の3ボタン。長押しで移動、離すと止まる。`aimZ` の決定で自動 DROP
- 画面上部に操作説明を1行（「長押しで動かして、はなすと止まるよ」）
- 盤面初期化: 主景品 Rabbit を出口から 90〜140px（仕様7.7）に置く。他4個をランダム配置。`store.get().craneBoard` があれば復元し、無ければ生成
- `atRest` かつ `state === "idle"` のときだけ `store.saveBoard()` する（仕様5.3）
- `won` イベントで `store.winPlush(defId)` を呼び、少し待ってから棚へ遷移する
- ログ: `arcade_enter` / `crane_start` / `crane_drop` / `plush_grabbed` / `plush_dropped` / `plush_moved` / `plush_won` / `shelf_return`。`crane_drop` の meta に照準誤差 `d` を入れる（仕様7.6の σ 較正に使う）

- [ ] **Step 3: 目視確認**

`npm run dev` で次を確認する。
- 説明なしで操作方法が分かるか
- 狙った場所へ動かせるか
- 景品がちゃんと動くか
- ころころ転がる様子がかわいいか
- 3〜4回以内に取れるか

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "feat: クレーン画面"
```

---

## Task 9: 見守りぬいぐるみ

**Files:**
- Create: `src/arcade/Watcher.tsx`, `src/arcade/watcherState.ts`
- Modify: `src/arcade/ArcadeScreen.tsx`
- Test: `src/arcade/watcherState.test.ts`

**Interfaces:**
- Consumes: `CraneEvent`, `CraneState`, `Pose`, `LINES`
- Produces:
  - `type WatcherMood = "idle" | "aiming" | "dropping" | "grabbed" | "missed" | "nearExit" | "success"`
  - `moodFor(craneState: CraneState, lastEvent: CraneEvent | null, exitDist: number): WatcherMood`
  - `watcherPose(mood: WatcherMood, elapsed: number): Pose`
  - `MISSED_DURATION = 800`
  - `<Watcher uid={string} mood={WatcherMood} />`

- [ ] **Step 1: 失敗するテストを書く**

`src/arcade/watcherState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { moodFor, watcherPose, MISSED_DURATION } from "./watcherState";

describe("moodFor (仕様7.9)", () => {
  it("待機中はidle", () => {
    expect(moodFor("idle", null, 200)).toBe("idle");
  });
  it("狙っている間はaiming", () => {
    expect(moodFor("aimX", null, 200)).toBe("aiming");
    expect(moodFor("aimZ", null, 200)).toBe("aiming");
  });
  it("下降中はdropping", () => {
    expect(moodFor("descend", null, 200)).toBe("dropping");
  });
  it("掴んだ瞬間はgrabbed", () => {
    expect(moodFor("lift", { kind: "grabbed" }, 200)).toBe("grabbed");
  });
  it("落とした瞬間はmissed", () => {
    expect(moodFor("settle", { kind: "released" }, 200)).toBe("missed");
  });
  it("獲得したらsuccess", () => {
    expect(moodFor("idle", { kind: "won" }, 0)).toBe("success");
  });
  it("出口に近づいたらnearExit", () => {
    expect(moodFor("idle", { kind: "settled" }, 40)).toBe("nearExit");
  });
});

describe("watcherPose", () => {
  it("aimingは目が大きく身を乗り出す", () => {
    const p = watcherPose("aiming", 100);
    expect(p.eyeOpen).toBeGreaterThan(1);
  });
  it("droppingは瞬きせず静止する", () => {
    expect(watcherPose("dropping", 100).eyeOpen).toBe(1);
    expect(watcherPose("dropping", 100).hop).toBe(0);
  });
  it("successは万歳して跳ねる", () => {
    const p = watcherPose("success", 200);
    expect(p.armRaise).toBeGreaterThan(0.5);
    expect(p.hop).toBeGreaterThan(0);
  });
  it("missedは0.8秒で通常に戻る（悲しみを引きずらない）", () => {
    const late = watcherPose("missed", MISSED_DURATION + 10);
    expect(Math.abs(late.tilt)).toBeLessThan(2);
  });
  it("どのmoodでもsquashが正で有限", () => {
    for (const m of ["idle","aiming","dropping","grabbed","missed","nearExit","success"] as const) {
      for (const t of [0, 100, 500, 3000]) {
        const p = watcherPose(m, t);
        expect(Number.isFinite(p.squash) && p.squash > 0, `${m}@${t}`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./watcherState"`

- [ ] **Step 3: watcherState.ts を書く**

`moodFor` は純粋関数。`watcherPose` は経過時間から Pose を返す純粋関数（sin による揺れを含む）。仕様7.9 の表をそのまま実装する。`missed` は `MISSED_DURATION`(800ms) で idle 相当へ戻す。

- [ ] **Step 4: Watcher.tsx を書く**

盤面の手前・左下に配置する。所持ぬいぐるみの先頭1匹（`shelfRow >= 0` のうち `acquiredAt` が最古）を使う。mood に応じたセリフを吹き出しで出す。`success` では小さな粒子3つ。

- [ ] **Step 5: ArcadeScreen に組み込む**

`CraneEvent` を Watcher へ渡す。

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — watcherState 12件

- [ ] **Step 7: 目視確認**

- 見守っているぬいぐるみを自然に見てしまうか
- 掴んだ瞬間に期待を感じるか
- 落ちた瞬間の「あっ」が効いているか
- 悲しませすぎていないか

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: 見守りぬいぐるみ"
```

---

## Phase C 完了: Codex レビュー ③

- [ ] **Codex に Phase C をレビューさせる**

> src/arcade/ をレビューしてほしい。ぬいぐるみクレーンゲームMVPのクレーン部分。仕様書は docs/superpowers/specs/2026-09-03-plush-crane-mvp-design.md の 7章。見てほしい点: (1) physics.step が多体重なり・高速度・0除算で発散またはNaNを出さないか (2) enforceAdvance が無限ループや振動を起こさないか、MIN_ADVANCE の保証が本当に成立しているか (3) craneMachine の状態機械が詰まる経路（idleに戻らない）がないか、body が途中で消えた場合の heldId 参照 (4) ArcadeScreen の rAF がアンマウント・タブ非表示で止まるか、物理ループがReact再レンダーを毎ステップ起こしていないか (5) difficulty.test.ts のシミュレーションが実装の性質を本当に検証しているか、トートロジーになっていないか

---

# Phase D: Priority 3-4 — 配置とシェア

## Task 10: ドラッグ配置

**Files:**
- Create: `src/shelf/useDragPlacement.ts`
- Modify: `src/shelf/ShelfScreen.tsx`
- Test: `src/shelf/shelfLayout.test.ts`（追記）

**Interfaces:**
- Consumes: `shelfLayout.ts`, `store.movePlush`
- Produces: `useDragPlacement(opts): { onPointerDown(uid, e): void; draggingUid: string | null; ghost: {x, row} | null }`

- [ ] **Step 1: 失敗するテストを追記する**

`src/shelf/shelfLayout.test.ts` に追記:

```ts
import { rowFromY, snapPlacement } from "./shelfLayout";

describe("rowFromY", () => {
  it("各段のY座標が対応する段に落ちる", () => {
    for (let row = 0; row < SHELF.rows; row++) {
      expect(rowFromY(SHELF.rowY[row])).toBe(row);
    }
  });
  it("範囲外のYは端の段にクランプされる", () => {
    expect(rowFromY(-9999)).toBe(0);
    expect(rowFromY(9999)).toBe(SHELF.rows - 1);
  });
});

describe("snapPlacement", () => {
  const others = [{ uid: "a", x: 100, shelfRow: 1, r: 32 }];
  it("空いている場所にはそのまま置ける", () => {
    expect(snapPlacement("b", 250, 1, 32, others).x).toBeCloseTo(250, 0);
  });
  it("重なる位置に置くと押し出される", () => {
    const p = snapPlacement("b", 105, 1, 32, others);
    expect(Math.abs(p.x - 100)).toBeGreaterThanOrEqual(60);
  });
  it("棚の外には置けない", () => {
    expect(snapPlacement("b", -500, 1, 32, others).x).toBeGreaterThanOrEqual(32);
  });
  it("全段が満杯なら移動を取り消して元の位置を返す", () => {
    const full = Array.from({ length: 12 }, (_, i) => ({
      uid: `f${i}`, x: 40 + (i % 4) * 80, shelfRow: Math.floor(i / 4), r: 34,
    }));
    const p = snapPlacement("f0", 160, 2, 34, full.slice(1));
    expect(p.reverted).toBe(true);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `rowFromY is not exported`

- [ ] **Step 3: shelfLayout.ts に `rowFromY` と `snapPlacement` を追加する**

`snapPlacement(uid, x, row, r, others)` は `{ x, shelfRow, reverted }` を返す純粋関数。押し出し不能なら空きのある段へ、それも不可なら `reverted: true` を返す。

- [ ] **Step 4: useDragPlacement.ts を書く**

- `pointerdown`/`pointermove`/`pointerup` を使いマウスとタッチを共通で扱う
- `setPointerCapture` で指が要素外へ出ても追従する
- ドラッグ中は `touch-action: none` を当ててスクロールを止める
- ドラッグ開始のしきい値は 4px（クリックによるリアクションと区別する）
- ドロップ時に `snapPlacement` を通してから `store.movePlush` を呼ぶ
- `reverted` なら元の位置へ戻すアニメーションを 200ms かける
- `plush_repositioned` をログ（meta: `{ fromRow, toRow }`）
- **`MeetingCeremony` 再生中は無効化する**

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — shelfLayout 13件

- [ ] **Step 6: 目視確認（スマホ幅で必ず行う）**

DevTools のデバイスエミュレーションで iPhone 幅にし、次を確認する。
- 指でつまんで動かせるか
- ドラッグ中にページがスクロールしないか
- 配置を少し変えたくなるか
- リロードしても配置が残るか

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 棚のドラッグ配置"
```

---

## Task 11: シェア

**Files:**
- Create: `src/share/shelfToPng.ts`, `src/share/ShareSheet.tsx`
- Modify: `src/shelf/ShelfScreen.tsx`
- Test: `src/share/shelfToPng.test.ts`

**Interfaces:**
- Consumes: `store`, `SHELF`
- Produces:
  - `encodeShelf(owned: OwnedPlush[]): string`
  - `decodeShelf(s: string): OwnedPlush[] | null`
  - `buildShelfSvg(owned: OwnedPlush[], size: number): string`
  - `renderShelfPng(svg: string, caption: string, size: number): Promise<Blob>`
  - `shareShelf(blob: Blob): Promise<{ method: "share" | "clipboard" | "download"; ok: boolean }>`

- [ ] **Step 1: 失敗するテストを書く**

`src/share/shelfToPng.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeShelf, decodeShelf, buildShelfSvg } from "./shelfToPng";
import type { OwnedPlush } from "../state/types";

const owned: OwnedPlush[] = [
  { uid: "u1", defId: "bear_01", acquiredAt: 1, x: 100, shelfRow: 1, seed: 0.3 },
  { uid: "u2", defId: "rabbit_01", acquiredAt: 2, x: 200, shelfRow: 1, seed: 0.7 },
];

describe("encodeShelf / decodeShelf", () => {
  it("往復して一致する", () => {
    const back = decodeShelf(encodeShelf(owned));
    expect(back).toHaveLength(2);
    expect(back![0].defId).toBe("bear_01");
    expect(back![1].x).toBe(200);
  });
  it("URLに載せられる文字だけを使う", () => {
    expect(encodeShelf(owned)).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
  it("壊れた文字列にはnullを返す", () => {
    expect(decodeShelf("!!!!")).toBeNull();
  });
  it("空の棚も往復できる", () => {
    expect(decodeShelf(encodeShelf([]))).toEqual([]);
  });
});

describe("buildShelfSvg 直列化制約 (仕様10章)", () => {
  const svg = buildShelfSvg(owned, 1080);

  it("スタンドアロンSVGとして完結している", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
  it("文字を含まない（文字はcanvas側で描く）", () => {
    expect(svg).not.toContain("<text");
  });
  it("外部参照を含まない", () => {
    expect(svg).not.toContain("<use");
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("url(");
    expect(svg).not.toContain("<filter");
    expect(svg).not.toContain("@font-face");
  });
  it("classに依存しない", () => {
    expect(svg).not.toContain("class=");
  });
  it("全ぬいぐるみが描かれる", () => {
    const empty = buildShelfSvg([], 1080);
    expect(svg.length).toBeGreaterThan(empty.length);
  });
  it("箱の中(shelfRow=-1)は描かない", () => {
    const withBoxed = [...owned, { uid: "u3", defId: "fox_01", acquiredAt: 3, x: 0, shelfRow: -1, seed: 0.1 }];
    expect(buildShelfSvg(withBoxed, 1080).length).toBe(svg.length);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./shelfToPng"`

- [ ] **Step 3: shelfToPng.ts を書く**

- `encodeShelf` は最小限の配列（`[defId, x, shelfRow, seed]` の組）を JSON 化し、`btoa` で base64url に変換する。将来 `example.com/shelf/xxxxx` に載せる境界（仕様10章）
- `buildShelfSvg` は `renderToStaticMarkup`（`react-dom/server`）で `PlushSVG` を含む棚全体を文字列化する。**文字を含めない**
- `renderShelfPng` は SVG 文字列 → `Blob` → `URL.createObjectURL` → `<img>` → canvas に描画。その後 **canvas の 2D コンテキストでゲーム名と所持数を描く**。最後に `URL.revokeObjectURL` する
- `shareShelf` は `navigator.canShare({ files })` → `navigator.share` → `navigator.clipboard.write` → ダウンロードの順に試し、どこまで行ったかを返す

- [ ] **Step 4: ShareSheet.tsx を書く**

生成した PNG をプレビュー表示し、「共有」「保存」ボタンを出す。ロゴや広告を入れない。`share_clicked` と `share_result`（meta: `{ method, ok }`）をログ。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — shelfToPng 10件

- [ ] **Step 6: 目視確認**

実際に「棚をシェア」を押し、生成された PNG を見る。**自分がこれを人に見せたいと思うか**を確認する。思わなければ余白・背景・構図を調整する。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 棚のシェア"
```

---

## Phase D 完了: Codex レビュー ④

- [ ] **Codex に Phase D をレビューさせる**

> src/shelf/useDragPlacement.ts と src/share/ をレビューしてほしい。仕様書は docs/superpowers/specs/2026-09-03-plush-crane-mvp-design.md の 9章・10章。見てほしい点: (1) ポインタイベントがタッチとマウスの両方で正しく動くか、pointercancel やマルチタッチで壊れないか (2) snapPlacement が全段満杯や自分自身との衝突で誤動作しないか (3) renderShelfPng の objectURL リークと、img.onload が発火しない場合のハング (4) SVG直列化が実際のブラウザで CSP や tainted canvas に引っかからないか (5) encodeShelf が非ASCII文字（日本語名）を含んでも btoa で壊れないか

---

# Phase E: 仕上げ

## Task 12: サウンド

**Files:**
- Create: `src/audio/sfx.ts`
- Modify: `src/arcade/ArcadeScreen.tsx`, `src/shelf/ShelfScreen.tsx`, `src/shelf/MeetingCeremony.tsx`
- Test: `src/audio/sfx.test.ts`

**Interfaces:**
- Produces: `sfx.init()`, `sfx.move(on: boolean)`, `sfx.descend()`, `sfx.bump(strength: number)`, `sfx.koron()`, `sfx.success()`, `sfx.place()`, `sfx.setMuted(m: boolean)`, `sfx.isMuted()`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect, vi } from "vitest";
import { sfx } from "./sfx";

describe("sfx", () => {
  it("AudioContextが無い環境でも例外を投げない", () => {
    const orig = globalThis.AudioContext;
    // @ts-expect-error 意図的に消す
    delete globalThis.AudioContext;
    expect(() => { sfx.init(); sfx.koron(); sfx.success(); }).not.toThrow();
    globalThis.AudioContext = orig;
  });

  it("init前に鳴らしても例外を投げない", () => {
    expect(() => sfx.koron()).not.toThrow();
  });

  it("ミュート状態を保持する", () => {
    sfx.setMuted(true);
    expect(sfx.isMuted()).toBe(true);
    sfx.setMuted(false);
    expect(sfx.isMuted()).toBe(false);
  });

  it("ミュート中は音源を作らない", () => {
    sfx.init();
    sfx.setMuted(true);
    expect(() => sfx.success()).not.toThrow();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./sfx"`

- [ ] **Step 3: sfx.ts を書く**

- `AudioContext` は最初のユーザー操作（pointerdown）で遅延生成する。存在しない環境では全 API を no-op にする
- **「ころん」を最も作り込む**: 300-800Hz のバンドパスを通した2連のソフトアタック、減衰120ms。ピッチをわずかにランダム化して機械的な反復感を消す
- `move` はループ音のオン/オフ。`bump` は接触の強さでゲインを変える
- ミュート状態は localStorage に保存する

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — sfx 4件

- [ ] **Step 5: 目視・試聴確認**

**「ころん」が気持ちよいか**を実際に聞いて確認する。うるさければ音量を下げる。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: 生成サウンド"
```

---

## Task 13: Developer Menu

**Files:**
- Create: `src/dev/DevMenu.tsx`
- Modify: `src/App.tsx`, `src/shelf/ShelfScreen.tsx`, `src/state/store.ts`
- Test: `src/dev/devActions.test.ts`
- Create: `src/dev/devActions.ts`

**Interfaces:**
- Produces: `downloadLogJson(log: LogEvent[]): void`, `buildLogJson(s: SaveV1): string`, `<DevMenu open onClose />`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from "vitest";
import { buildLogJson } from "./devActions";
import { initialSave } from "../state/persist";

describe("buildLogJson", () => {
  it("正しいJSONを返す", () => {
    const s = initialSave();
    s.log.push({ type: "plush_won", t: 123, sessionId: "s1", plushId: "rabbit_01", attempt: 2 });
    const parsed = JSON.parse(buildLogJson(s));
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].plushId).toBe("rabbit_01");
  });

  it("サマリを含む（分析しやすくする）", () => {
    const parsed = JSON.parse(buildLogJson(initialSave()));
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.ownedCount).toBe(1);
    expect(parsed.exportedAt).toBeDefined();
  });

  it("空のログでも壊れない", () => {
    expect(() => JSON.parse(buildLogJson(initialSave()))).not.toThrow();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./devActions"`

- [ ] **Step 3: devActions.ts と DevMenu.tsx を書く**

起動導線は**棚画面右下の小さなドットを3回タップ**、または `Ctrl+Shift+D`。通常プレイヤーから目立たないこと。

機能（仕様12章の全項目）:
- 所持品リセット / localStorage 全消去
- 任意ぬいぐるみ追加（10種のリストから選ぶ。演出をスキップして直接追加する）
- クレーン景品再配置（`attemptsOnBoard` を 0 に戻す）
- 全シリーズ表示（未所持も含めた一覧をシリーズごとに見る。**通常プレイでは見せない**。図鑑化を避けるため）
- プレイログ DL（`buildLogJson` → Blob → ダウンロード）
- FPS 表示 ON/OFF
- 物理デバッグ表示 ON/OFF（`CraneView` の `debug` に接続）

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — devActions 3件

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: Developer Menu"
```

---

## Task 14: 統合・レスポンシブ・実プレイ評価

**Files:**
- Modify: `src/App.tsx`, `src/styles.css`, `index.html`
- Create: `README.md`, `docs/playtest-report.md`

- [ ] **Step 1: レスポンシブを仕上げる**

- `index.html` に `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- 縦画面を基準にし、幅は `min(100vw, 480px)` で中央寄せ。PC では余白に淡い背景色を敷く
- `safe-area-inset` を尊重する
- `overscroll-behavior: none` でプルトゥリフレッシュを止める
- `user-select: none` と `touch-action: manipulation` でダブルタップズームを止める
- `prefers-reduced-motion` を尊重し、演出時間を短縮する（アニメーションを完全に消すと出会いの演出が成立しないため、短縮に留める）

- [ ] **Step 2: 全テストとビルドを通す**

```bash
npm test
npx tsc --noEmit
npm run build
```

すべて成功すること。型エラーを `any` で潰さない。

- [ ] **Step 3: 完成条件を1つずつ確認する**

依頼書28章の14項目をチェックリストとして確認し、結果を記録する。

1. Webで起動できる / 2. 最初から1匹いる / 3. ゲームセンターに行ける / 4. 実際に掴める /
5. 転がる・落ちる / 6. 数回以内に獲得できる / 7. 見守りがリアクションする /
8. 棚へ持ち帰れる / 9. 2匹が出会う演出がある / 10. 自由に配置できる /
11. 状態が保存される / 12. シェア操作ができる / 13. ログをJSON出力できる /
14. スマートフォンで快適に遊べる

- [ ] **Step 4: 実際にプレイする（依頼書26章・29章）**

ブラウザで**最低3セッション**プレイする。うち1回は localStorage をクリアした初回体験として、1回はスマホ幅で行う。

依頼書26章のチェック項目と、仕様17.2の「愛着」評価基準の全項目に答える。

- [ ] **Step 5: 評価レポートを書く**

`docs/playtest-report.md` に次を書く（依頼書29章）。

- A. Bugs — 実際にプレイして見つけた問題
- B. Friction — 遊びにくかった部分
- C. Emotion — 「かわいい」「嬉しい」と感じた瞬間
- D. Dead Moments — 退屈だった瞬間
- E. Hypotheses — 継続的に遊ばれるために不足しているもの
- F. Next 3 Improvements — 次に実装するなら効果が高い改善3つ

**コードを読んで推測した内容ではなく、実際にプレイした結果を書く。**

- [ ] **Step 6: 見つけたバグを直す**

Step 4 で見つけた問題のうち、体験を損なうものを修正する。修正ごとにコミットする。

- [ ] **Step 7: README を書く**

起動方法、操作方法、Developer Menu の開き方、データの保存場所を書く。

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: 統合・レスポンシブ対応と実プレイ評価"
```

---

## Phase E 完了: Codex レビュー ⑤（最終）

- [ ] **Codex に全体をレビューさせる**

> src/ 全体と docs/playtest-report.md をレビューしてほしい。ぬいぐるみクレーンゲームMVPの完成版。仕様書は docs/superpowers/specs/2026-09-03-plush-crane-mvp-design.md、元の依頼書の完成条件は仕様17.1（依頼書28章の14項目）。見てほしい点: (1) 完成条件14項目のうち実際には満たせていないものがないか (2) 全体を通したリソースリーク（rAF、AudioContext、objectURL、イベントリスナ、setTimeout） (3) localStorage が壊れた・容量超過した場合にアプリが起動不能にならないか (4) 実プレイレポートの内容がコードの実態と矛盾していないか (5) 次に手を入れるとしたら最も危険な箇所はどこか

指摘を採否判断し、体験に影響するものを修正してコミットする。

---

## 自己レビュー結果

**1. 仕様カバレッジ**

| 仕様セクション | 実装タスク |
|---|---|
| 3. 技術構成 | Task 1 |
| 5.1-5.2 データモデル・10種 | Task 1 |
| 5.3 永続スキーマ・原子性 | Task 3 |
| 5.4 個体差 | Task 2（導出）+ Task 3（seed生成） |
| 6. Pose / PlushSVG | Task 2 |
| 6.1 棚での生活感 | Task 4 |
| 7.1 投影 | Task 8 |
| 7.2 物理ソルバ・React分離 | Task 6 + Task 8 |
| 7.3 操作 | Task 8 |
| 7.4 試行カウンタ | Task 7 |
| 7.5 掴みと落下 | Task 7 |
| 7.6 アシスト | Task 7 |
| 7.7 構造的保証 | Task 7 |
| 7.8 回帰テスト | Task 7 |
| 7.9 見守り | Task 9 |
| 8. 出会いの演出 | Task 5 |
| 9. 棚の配置 | Task 4（レイアウト）+ Task 10（ドラッグ） |
| 10. シェア | Task 11 |
| 11. プレイログ | Task 3（基盤）+ 各タスクで記録 |
| 12. Developer Menu | Task 13 |
| 13. 音 | Task 12 |
| 14. アートディレクション | Task 4, 8, 14 |
| 15. テスト方針 | Task 1,3,6,7,10,11 |
| 16. 優先順位 | Phase A→E の順序 |
| 17. 完成条件・愛着評価 | Task 14 |

漏れなし。

**2. プレースホルダ走査**

「TBD」「後で実装」「適切なエラー処理を追加」の類は無い。`shiftHue` は Task 2 Step 3 で「hex → HSL → hex の純粋関数」と実装方法を指定済み。

**3. 型の一貫性**

- `plushCoefficient` — Task 1 で定義、Task 7 で使用。名前一致
- `Pose` — Task 2 で定義、Task 5・9 で使用。フィールド名一致
- `Body` / `Pit` / `exitDistance` / `atRest` — Task 6 で定義、Task 7・8 で使用。名前一致
- `CraneEvent.kind` — Task 7 で `"drop" | "grabbed" | "released" | "won" | "nudged" | "settled"`、Task 9 のテストで `grabbed` / `released` / `won` / `settled` を使用。矛盾なし
- `OwnedPlush.shelfRow: -1` の意味（箱の中）— Task 3 で導入、Task 4・11 で除外処理。一貫
- `store.winPlush` の返り値 uid — Task 3 で定義、Task 5 で `pendingWelcome` として使用。一貫
