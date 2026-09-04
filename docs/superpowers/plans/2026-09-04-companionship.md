# 同居フェーズ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ぬいぐるみを「種類」ではなく「個体」として扱い、その来歴を残し、棚に戻ったあとも関係が持続するようにする。新しい景品を足さずに棚へ戻りたくなるかを検証できる状態にする。

**Architecture:** 保存スキーマを v2 へ移行し `PlushInstance` に一本化する。棚の関係は「隣接リンクの計算（純粋）」「関係演出の指揮（純粋）」「描画（DOM 直接書き換え）」の3層に分ける。クレーンの反応も同じく純粋な指揮関数に切り出す。既存の 257 テストを壊さずに積み増す。

**Tech Stack:** 既存のまま。TypeScript strict / React 18 / Vite / Vitest。**新しいランタイム依存を足さない。**

## Global Constraints

仕様書 `docs/superpowers/specs/2026-09-04-companionship-design.md` から逐語的に引く。全タスクの要件に暗黙に含まれる。

- **ランタイム依存は react / react-dom のみ**。物理エンジン・アニメーションライブラリ・状態管理ライブラリを足さない。
- **TypeScript は strict**。`any` を使わない。
- **棚での関係リアクションに吹き出しを使わない。** 動きだけで表す。吹き出しはタップ時と出会いの演出にだけ残す。
- **挿話的な演出は棚全体で同時に高々1つ。**
- **親密度などの数値を UI に出さない。**「Affinity +3」の類を作らない。
- **自律移動を作らない。** ぬいぐるみが勝手に位置を変えることはしない。
- **今回作らないもの**: 日替わり景品、ログインボーナス、広告、課金、アカウント、ソーシャル、トレード、ガチャ、命名、家具（仕様2章）。
- **保存キーは `plushcrane.v1` のまま変えない。** バージョンは中の `version` フィールドで判定する。
- **既存の保存データを破棄しない。** v1 は必ず移行する。
- **分からない来歴を捏造しない。** v1 移行分の `origin` は `"unknown"`。
- 物理と React の分離を維持する。棚の環境アニメーションは React 再レンダーを発生させない。
- 「4回以内に取れる」は **同じ景品を継続して狙った場合**に限る。この条件をコード・テスト・レポートに必ず併記する。

---

## ファイル構成

### 新規

| ファイル | 責務 |
|---|---|
| `src/state/migrate.ts` | v1 → v2 の変換のみ。検証はしない |
| `src/shelf/neighbors.ts` | 隣接リンクの計算（純粋） |
| `src/shelf/shelfDirector.ts` | 関係演出の指揮（純粋） |
| `src/shelf/PlushProfile.tsx` | プロフィールの Bottom Sheet |
| `src/shelf/provenance.ts` | 来歴を日本語の行にする（純粋） |
| `src/render/bubble.ts` | 吹き出しの配置計算（純粋） |
| `src/arcade/reactionDirector.ts` | クレーンの反応の指揮（純粋） |

### 変更

`src/state/types.ts` / `persist.ts` / `store.ts` / `src/render/useAmbientLife.ts` /
`src/shelf/ShelfScreen.tsx` / `useDragPlacement.ts` / `MeetingCeremony.tsx` /
`src/arcade/ArcadeScreen.tsx` / `craneMachine.ts` / `physics.ts` / `watcherState.ts` /
`Watcher.tsx` / `src/dev/devActions.ts` / `src/share/shelfToPng.ts`

`OwnedPlush` → `PlushInstance` の改名は全域に及ぶ。Task 1 でまとめて行い、以降のタスクでは触らない。

---

## フェーズと Codex レビュー

| Phase | Tasks | 内容 | 末尾 |
|---|---|---|---|
| A | 1-3 | **Priority 1**: 個体・来歴・プロフィール | Codex ② |
| B | 4-6 | **Priority 2**: 隣接・関係の持続・Idle | Codex ③ |
| C | 7 | **Priority 3**: 並べ替えの改善 | Codex ④ |
| D | 8-10 | **Priority 4**: Reaction Director・吹き出し・ログ・実プレイ | Codex ⑤ |

（Codex ① は仕様レビューとして実施済み）

---

# Phase A: 個体と来歴

## Task 1: スキーマ v2 と PlushInstance への改名

**Files:**
- Modify: `src/state/types.ts`
- Create: `src/state/migrate.ts`
- Modify: `src/state/persist.ts`, `src/state/store.ts`
- Modify: 参照側すべて（`ShelfScreen.tsx`, `MeetingCeremony.tsx`, `ceremonyTimeline.ts`, `useDragPlacement.ts`, `useAmbientLife.ts`, `ArcadeScreen.tsx`, `shelfToPng.ts`, `devActions.ts`, `DevMenu.tsx`）
- Test: `src/state/migrate.test.ts`, `src/state/persist.test.ts`（追記）, `src/state/store.test.ts`（更新）

**Interfaces:**
- Consumes: なし
- Produces:
  - `type PlushOrigin = "starter" | "crane" | "granted" | "unknown"`
  - `type PlushInstance = { instanceId; plushTypeId; acquiredAt; attemptsToAcquire: number | null; witnessedBy: string | null; origin: PlushOrigin; x; shelfRow; personalitySeed }`
  - `type SaveV2 = { version: 2; sessionCount; instances: PlushInstance[]; craneBoard; attempts; pendingWelcome; firstMeetingDone; neighborSince: Record<string, number>; log }`
  - `migrateV1(raw: SaveV1Raw): SaveV2`
  - `parseV1(raw: unknown): SaveV1Raw | null`, `parseV2(raw: unknown): SaveV2 | null`
  - `loadSave(): SaveV2`（既存のシグネチャを保つ）
  - `store.winPlush(input: { plushTypeId: string; attemptsToAcquire: number; witnessedBy: string | null }): string`
  - `store.grantPlush(plushTypeId: string): void`（`origin: "granted"`）
  - **このフェーズで使うログイベント型をすべてここで足す**（下記 Step 0）

### 改名のスコープ（重要）

改名するのは **`OwnedPlush` の型と、そのプロパティだけ**。

**次は絶対に改名しない。** 別物であり、全域置換すると壊れる。

| 触らないもの | 場所 |
|---|---|
| `Body.defId` | `src/arcade/physics.ts` — クレーン盤面の景品 |
| `CraneBoardSave.prizes[].defId` | `src/state/types.ts` — 盤面の保存形 |
| `PlushDef.id` | `src/data/plushies.ts` — 種類の定義 |

`defId` を無条件に `plushTypeId` へ置換すると、物理・盤面保存・`getPlush()` が
すべて壊れる。**型名で絞って置換すること。**

### 変更が必要なファイルの見つけ方

手で並べた一覧に頼らない。次を実行して、出てきたファイルをすべて直す。
**テストファイルも対象**。

```bash
grep -rln 'OwnedPlush\|\.owned\|game\.owned' src/
grep -rln '\buid\b' src/ | grep -v arcade/
grep -rn 'seed:' src/ | grep -v arcade/
```

`Watcher.tsx` / `ShareSheet.tsx` / `shelfToPng.test.ts` など、
最初の想定から漏れやすいものがここで出る。

- [ ] **Step 0: このフェーズで使うログイベント型を先に全部足す**

後続のタスクが使う前に用意しておく。型と、`persist.ts` の実行時許可リスト
（`LOG_TYPES`）の**両方**に足すこと。片方だけだと、型は通るのに
リロードで消える。

`src/state/types.ts` の `LogEventType` に追加:

```
| "plush_profile_opened"
| "plush_drag_start"
| "plush_drag_end"
| "neighbor_created"
| "neighbor_removed"
| "relationship_reaction"
| "shelf_idle_10s"
| "shelf_idle_30s"
| "shelf_return_after_win"
```

`src/state/persist.ts` の `LOG_TYPES` にも同じものを足す。

`persist.test.ts` に回帰テストを足す。**型と許可リストがずれないようにする。**

```ts
it("LogEventType の全種別が保存で生き残る（許可リストとずれない）", () => {
  const all: LogEventType[] = [
    "session_start", "shelf_view", "arcade_enter", "crane_start", "crane_drop",
    "plush_grabbed", "plush_dropped", "plush_moved", "plush_won", "shelf_return",
    "plush_placed", "plush_repositioned", "share_clicked", "share_result",
    "welcome_played", "plush_touched", "shelf_dwell",
    "plush_profile_opened", "plush_drag_start", "plush_drag_end",
    "neighbor_created", "neighbor_removed", "relationship_reaction",
    "shelf_idle_10s", "shelf_idle_30s", "shelf_return_after_win",
  ];
  const s = initialSave();
  s.log = all.map((type, i) => ({ type, t: i, sessionId: "s" }));
  writeSave(s);
  expect(loadSave().log.map((e) => e.type)).toEqual(all);
});
```

この配列は手で書く。`LogEventType` から自動生成すると、
型に足し忘れたときにテストも一緒に見逃してしまう。

- [ ] **Step 1: 移行の失敗するテストを書く**

`src/state/migrate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { migrateV1 } from "./migrate";

const v1 = {
  version: 1,
  sessionCount: 3,
  owned: [
    { uid: "a", defId: "bear_01", acquiredAt: 1000, x: 160, shelfRow: 1, seed: 0.3 },
    { uid: "b", defId: "rabbit_01", acquiredAt: 2000, x: 242, shelfRow: 1, seed: 0.7 },
  ],
  craneBoard: null,
  attempts: 5,
  pendingWelcome: null,
  firstMeetingDone: true,
  log: [{ type: "shelf_view", t: 1, sessionId: "s" }],
};

describe("migrateV1", () => {
  it("所持品を1匹も失わない", () => {
    expect(migrateV1(v1).instances).toHaveLength(2);
  });

  it("フィールドを対応づけて移す", () => {
    const [a] = migrateV1(v1).instances;
    expect(a.instanceId).toBe("a");
    expect(a.plushTypeId).toBe("bear_01");
    expect(a.personalitySeed).toBe(0.3);
    expect(a.acquiredAt).toBe(1000);
    expect(a.x).toBe(160);
    expect(a.shelfRow).toBe(1);
  });

  it("最古の1匹だけ starter、他は unknown（来歴を捏造しない）", () => {
    const [a, b] = migrateV1(v1).instances;
    expect(a.origin).toBe("starter");
    expect(b.origin).toBe("unknown");
  });

  it("分からない来歴は null のまま残す", () => {
    for (const i of migrateV1(v1).instances) {
      expect(i.attemptsToAcquire).toBeNull();
      expect(i.witnessedBy).toBeNull();
    }
  });

  it("version が 2 になり、neighborSince が空で始まる", () => {
    const out = migrateV1(v1);
    expect(out.version).toBe(2);
    expect(out.neighborSince).toEqual({});
  });

  it("プレイ回数・セッション数・ログ・演出フラグを保つ", () => {
    const out = migrateV1(v1);
    expect(out.attempts).toBe(5);
    expect(out.sessionCount).toBe(3);
    expect(out.firstMeetingDone).toBe(true);
    expect(out.log).toHaveLength(1);
  });

  it("pendingWelcome が所持品を指していれば保つ", () => {
    const out = migrateV1({ ...v1, pendingWelcome: "b" });
    expect(out.pendingWelcome).toBe("b");
  });

  it("所持品が空でも落ちない", () => {
    expect(() => migrateV1({ ...v1, owned: [] })).not.toThrow();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/state/migrate.test.ts`
Expected: FAIL — `Failed to resolve import "./migrate"`

- [ ] **Step 3: types.ts を v2 の型に更新する**

`OwnedPlush` を消し `PlushInstance` を足す。`SaveV1` は `SaveV1Raw` に改名して
移行専用にし、`SaveV2` を新設する。`SaveV1Raw` は `persist.ts` と
`migrate.ts` の外へ出さない。

- [ ] **Step 4: migrate.ts を書く**

`migrateV1` は**変換のみ**。検証は `parseV1` の仕事。
`origin` は `acquiredAt` が最小の1匹を `"starter"`、残りを `"unknown"`。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npx vitest run src/state/migrate.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 6: persist.ts を分解する**

`parseV2` / `parseV1` / `loadSave` に分ける。`loadSave` の順序は仕様 4.2.1 のとおり。
v1 を読んだら移行して即座に `writeSave` する。

`persist.test.ts` に追記する。

```ts
it("v1 の保存データを読み込んで移行する", () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Fixture));
  const s = loadSave();
  expect(s.version).toBe(2);
  expect(s.instances).toHaveLength(2);
  expect(s.instances[0].origin).toBe("starter");
});

it("移行結果を即座に v2 として保存し直す", () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Fixture));
  loadSave();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(2);
});

it("保存キーは変えない（旧データを見失わない）", () => {
  expect(STORAGE_KEY).toBe("plushcrane.v1");
});

it("version が 1 でも 2 でもなければ初期状態", () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99 }));
  expect(loadSave().instances[0].origin).toBe("starter");
});

it("v2 の instances に不正な origin があれば unknown に落とす", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      instances: [{ instanceId: "a", plushTypeId: "bear_01", acquiredAt: 1, x: 160,
                    shelfRow: 1, personalitySeed: 0.5, attemptsToAcquire: null,
                    witnessedBy: null, origin: "nonsense" }],
      log: [], neighborSince: {},
    })
  );
  expect(loadSave().instances[0].origin).toBe("unknown");
});

it("neighborSince が壊れていても落ちない", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 2, instances: [], neighborSince: "nope", log: [] })
  );
  expect(loadSave().neighborSince).toEqual({});
});
```

- [ ] **Step 7: store.ts を v2 に合わせる**

`owned` → `instances`、`uid` → `instanceId`、`defId` → `plushTypeId`、`seed` → `personalitySeed`。

`winPlush` のシグネチャを変える。

```ts
winPlush(input: {
  plushTypeId: string;
  attemptsToAcquire: number;
  witnessedBy: string | null;
}): string
```

`grantPlush(plushTypeId)` は `origin: "granted"`、`attemptsToAcquire: null`。
初期状態の1匹は `origin: "starter"`。

`store.test.ts` を新しいシグネチャに合わせ、次を追記する。

```ts
it("winPlush が来歴を保存する", () => {
  const uid = store.winPlush({
    plushTypeId: "rabbit_01", attemptsToAcquire: 3, witnessedBy: "bear-1",
  });
  const i = store.get().instances.find((x) => x.instanceId === uid)!;
  expect(i.attemptsToAcquire).toBe(3);
  expect(i.witnessedBy).toBe("bear-1");
  expect(i.origin).toBe("crane");
});

it("grantPlush は来歴を残さず granted になる", () => {
  store.grantPlush("fox_01");
  const i = store.get().instances[1];
  expect(i.origin).toBe("granted");
  expect(i.attemptsToAcquire).toBeNull();
});

it("初期の1匹は starter", () => {
  expect(store.get().instances[0].origin).toBe("starter");
});

it("同じ種類を2匹取っても別個体として保存される（スタックしない）", () => {
  store.winPlush({ plushTypeId: "duck_01", attemptsToAcquire: 1, witnessedBy: null });
  store.winPlush({ plushTypeId: "duck_01", attemptsToAcquire: 4, witnessedBy: null });
  const ducks = store.get().instances.filter((i) => i.plushTypeId === "duck_01");
  expect(ducks).toHaveLength(2);
  expect(ducks[0].instanceId).not.toBe(ducks[1].instanceId);
  expect(ducks[0].attemptsToAcquire).not.toBe(ducks[1].attemptsToAcquire);
});
```

- [ ] **Step 8: 参照側をすべて更新する**

上の `grep` で出たファイルをすべて直す。**ロジックは変えない。**

`Body.defId` と `CraneBoardSave.prizes[].defId` は**触らない**。
`npx tsc --noEmit` が通り、かつ `src/arcade/` のテストが全部通ることを確認する。
アーケード側のテストが落ちたら、それは触ってはいけないものを触った合図。

- [ ] **Step 9: 全テストを実行する**

Run: `npm test`
Expected: PASS — 既存 257 件 + 新規分。**1件も落とさない。**

- [ ] **Step 10: コミット**

```bash
git add -A
git commit -m "feat: スキーマv2とPlushInstanceへの移行"
```

---

## Task 2: 取得時の来歴を実フロー経由で保存する

**Files:**
- Modify: `src/arcade/physics.ts`（`fallen` が種類も運ぶ）
- Modify: `src/arcade/craneMachine.ts`（`resolveWin` を追加、`CraneEvent` に `defId`）
- Create: `src/arcade/commitWin.ts`
- Modify: `src/arcade/ArcadeScreen.tsx`
- Test: `src/arcade/provenanceFlow.test.ts`, `src/arcade/physics.test.ts`（更新）, `src/arcade/craneMachine.test.ts`（更新）

**Interfaces:**
- Consumes: `Crane`, `physics.step`, `store.winPlush`
- Produces:
  - `type FallenPrize = { id: string; defId: string }`
  - `StepResult.fallen: FallenPrize[]`（`string[]` から変更）
  - `CraneEvent = { kind; bodyId?; defId? }`
  - `resolveWin(crane: Crane, won: FallenPrize, watcherInstanceId: string | null): { plushTypeId; attemptsToAcquire; witnessedBy }`
  - `commitWin(crane: Crane, won: FallenPrize, watcherInstanceId: string | null): string`

**この Task がこのフェーズで最も間違えやすい。**
前フェーズで「試行回数は保存済み」と書いて事実誤認だったのと同じ場所である。

### 設計上の注意 1: 種類を ID 文字列から復元しない

盤面の景品 ID は `"rabbit_01#0"` の形をしているが、**そこから
`split("#")[0]` で種類を取り出す設計にしてはならない。**
ID の作り方を変えた瞬間に、来歴の種類が静かに壊れる。

代わりに、**物理が景品を取り除くときに種類も一緒に報告する**。

```ts
export type FallenPrize = { id: string; defId: string };
// StepResult.fallen: FallenPrize[]
```

`step()` は `bodies.splice()` する直前に `defId` を読めるので、
情報を失わずに渡せる。`craneMachine` の `acquire()` も同様。

これは既存テストの `expect(settle(b, 4)).toContain("a")` を壊す。
`.map(f => f.id)` を挟んで直す。**壊れたテストは正しい設計の代償として受け入れる。**

### 設計上の注意 2: 距離の作り方

`n` 回目で獲得する状況を作るには、`advanceGoal` と出口半径の関係を使う。

- 各試行で出口距離は `MIN_ADVANCE`(30px) 以上縮む
- `settle` は `advanceGoal(before) = before - 30` が `exit.r`(34) 以下になったとき獲得

したがって「その試行で獲得する」条件は `before <= exit.r + MIN_ADVANCE = 64`。

開始距離 `D` から `k` 回目の試行に入るときの距離は `D - 30(k-1)`。
`n` 回目でちょうど獲得させたいので

```
D - 30(n-1) <= 64        かつ     D - 30(n-2) > 64
→  34 + 30(n-1) < D <= 64 + 30(n-1)
```

**定数から導く。数値を直接埋め込まない。**

```ts
const dist = DEFAULT_PIT.exit.r + MIN_ADVANCE * n - 5;
// n=1 → 59, n=2 → 89, n=3 → 119, n=4 → 149
```

当初この計画に書いた `30n + 4` は誤りで、n=2 が1回目で取れてしまう。
**テストの前提が崩れていることに気づけるよう、実際に何回目で取れたかを
必ず assert する。**

- [ ] **Step 1: 物理が種類も報告するテストを書く**

`src/arcade/physics.test.ts` の既存の出口テストを更新し、次を追記する。

```ts
it("落ちた景品の種類も一緒に報告する（IDから復元させない）", () => {
  const b = [body({ id: "x1", defId: "rabbit_01",
                     x: DEFAULT_PIT.exit.x, z: DEFAULT_PIT.exit.z, y: 100 })];
  let fallen: { id: string; defId: string }[] = [];
  for (let i = 0; i < 600; i++) fallen.push(...step(b, DEFAULT_PIT, STEP).fallen);
  expect(fallen).toHaveLength(1);
  expect(fallen[0].id).toBe("x1");
  expect(fallen[0].defId).toBe("rabbit_01");
});
```

既存の `expect(settle(b, 4)).toContain("a")` は
`expect(settle(b, 4).map((f) => f.id)).toContain("a")` に直す。

- [ ] **Step 2: 実フローを通す失敗するテストを書く**

`src/arcade/provenanceFlow.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  createCrane, startDrop, tickCrane, resolveWin, commitWin, MIN_ADVANCE,
} from "./craneMachine";
import { step, DEFAULT_PIT, STEP, atRest, type Body, type FallenPrize } from "./physics";
import { getPlush } from "../data/plushies";
import { store } from "../state/store";

const prize = (x: number, z: number, id = "rabbit_01#0"): Body => ({
  id, defId: "rabbit_01", x, z, y: 0, vx: 0, vy: 0, vz: 0,
  r: getPlush("rabbit_01").size, spin: 0, held: false,
});

/** 実際の物理と状態機械を回して1回 DROP し、獲得したらその景品を返す。 */
function runAttempt(
  c: ReturnType<typeof createCrane>,
  bodies: Body[],
  ax: number,
  az: number
): FallenPrize | null {
  c.armX = ax;
  c.armZ = az;
  startDrop(c, bodies, DEFAULT_PIT);
  let won: FallenPrize | null = null;
  let flush = -1;
  for (let i = 0; i < 120 * 30; i++) {
    for (const f of step(bodies, DEFAULT_PIT, STEP).fallen) won ??= f;
    for (const e of tickCrane(c, bodies, DEFAULT_PIT, STEP)) {
      if (e.kind === "won" && e.bodyId && e.defId) {
        won ??= { id: e.bodyId, defId: e.defId };
      }
    }
    if (flush >= 0) {
      if (++flush >= 40) break;
    } else if (c.state === "idle" && atRest(bodies)) {
      flush = 0;
    }
  }
  return won;
}

/**
 * ちょうど n 回目の DROP で獲得する状況を作る。
 *
 * 各試行で出口距離は MIN_ADVANCE 以上縮み、
 * before <= exit.r + MIN_ADVANCE になった試行で獲得する。
 * 数値は定数から導く（直接埋め込むと、定数が変わったとき静かに壊れる）。
 */
function winOnAttempt(n: number) {
  const dist = DEFAULT_PIT.exit.r + MIN_ADVANCE * n - 5;
  const bodies = [prize(DEFAULT_PIT.exit.x + dist, DEFAULT_PIT.exit.z)];
  const c = createCrane();
  for (let i = 1; i <= n; i++) {
    const won = runAttempt(c, bodies, 9999, 9999); // 常に外す
    if (won) return { crane: c, won, attempt: i };
  }
  throw new Error(`${n} 回で獲得できなかった（開始距離 ${dist}）`);
}

beforeEach(() => {
  localStorage.clear();
  store.resetAll();
});

describe("来歴が実フローを通して正しく保存される", () => {
  for (const n of [1, 2, 3, 4]) {
    it(`${n} 回目で取れた子の attemptsToAcquire が ${n} になる`, () => {
      const { crane, won, attempt } = winOnAttempt(n);
      // テストの前提が崩れていたらここで落ちる
      expect(attempt, `${n} 回目のはずが ${attempt} 回目で取れた`).toBe(n);
      expect(crane.attemptsOnBoard).toBe(n);

      const resolved = resolveWin(crane, won, "watcher-1");
      expect(resolved.attemptsToAcquire).toBe(n);
      expect(resolved.plushTypeId).toBe("rabbit_01");
      expect(resolved.witnessedBy).toBe("watcher-1");

      const id = store.winPlush(resolved);
      const saved = store.get().instances.find((i) => i.instanceId === id)!;
      expect(saved.attemptsToAcquire).toBe(n);
      expect(saved.witnessedBy).toBe("watcher-1");
      expect(saved.origin).toBe("crane");
    });
  }

  it("獲得後に盤面が補充されても、保存済みの値は書き換わらない", () => {
    const { crane, won } = winOnAttempt(2);
    const id = commitWin(crane, won, null);
    crane.attemptsOnBoard = 0; // 盤面を作り直した状況
    store.saveBoard(null);
    expect(
      store.get().instances.find((i) => i.instanceId === id)!.attemptsToAcquire
    ).toBe(2);
  });

  it("種類は ID 文字列ではなく景品そのものから決まる", () => {
    const { crane } = winOnAttempt(1);
    // ID の形が変わっても種類は壊れない
    const odd: FallenPrize = { id: "whatever-42", defId: "penguin_01" };
    expect(resolveWin(crane, odd, null).plushTypeId).toBe("penguin_01");
  });

  it("見守り役がいない場合は witnessedBy が null になる", () => {
    const { crane, won } = winOnAttempt(1);
    expect(resolveWin(crane, won, null).witnessedBy).toBeNull();
  });
});

describe("commitWin の順序", () => {
  it("盤面を捨てる前に来歴を保存する", () => {
    const { crane, won } = winOnAttempt(1);
    const order: string[] = [];
    const realWin = store.winPlush.bind(store);
    const realSave = store.saveBoard.bind(store);
    store.winPlush = (i) => {
      order.push("win");
      return realWin(i);
    };
    store.saveBoard = (b) => {
      order.push("save");
      realSave(b);
    };
    try {
      commitWin(crane, won, null);
    } finally {
      store.winPlush = realWin;
      store.saveBoard = realSave;
    }
    expect(order).toEqual(["win", "save"]);
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npx vitest run src/arcade/provenanceFlow.test.ts`
Expected: FAIL — `resolveWin is not exported`

- [ ] **Step 4: 物理とクレーンを更新する**

`physics.ts`:

```ts
export type FallenPrize = { id: string; defId: string };

export type StepResult = {
  /** このステップで出口へ落ちた景品。種類も一緒に運ぶ */
  fallen: FallenPrize[];
  impacts: number;
};
```

出口判定で `bodies.splice()` する直前に `{ id: b.id, defId: b.defId }` を積む。

`craneMachine.ts` の `CraneEvent` に `defId?: string` を足し、
`acquire()` で `{ kind: "won", bodyId: target.id, defId: target.defId }` を積む。

- [ ] **Step 5: resolveWin と commitWin を書く**

```ts
/**
 * won イベントから、保存すべき来歴を決める。
 *
 * attemptsOnBoard は盤面が補充されると 0 に戻る。したがってこの関数は
 * **won を処理した直後、盤面を作り直す前に**呼ばなければならない。
 * 種類は ID 文字列から復元せず、落ちた景品そのものから受け取る。
 */
export function resolveWin(
  crane: Crane,
  won: FallenPrize,
  watcherInstanceId: string | null
): { plushTypeId: string; attemptsToAcquire: number; witnessedBy: string | null } {
  return {
    plushTypeId: won.defId,
    attemptsToAcquire: Math.max(1, crane.attemptsOnBoard),
    witnessedBy: watcherInstanceId,
  };
}
```

`src/arcade/commitWin.ts`:

```ts
/**
 * 獲得の後始末をまとめて行う。
 *
 * **順序が意味を持つ。** 盤面を捨てる前に来歴を保存すること。
 * 逆にすると attemptsOnBoard がリセットされてから読むことになりかねない。
 * 画面側にこの順序を任せず、ここに閉じ込める。
 */
export function commitWin(
  crane: Crane,
  won: FallenPrize,
  watcherInstanceId: string | null
): string {
  const id = store.winPlush(resolveWin(crane, won, watcherInstanceId));
  store.saveBoard(null);
  store.log("shelf_return_after_win", { plushId: won.defId });
  return id;
}
```

- [ ] **Step 6: ArcadeScreen を繋ぐ**

画面側には一行しか残さない。

```ts
case "won": {
  if (wonRef.current) break;
  wonRef.current = true;
  sfx.success();
  if (!e.bodyId || !e.defId) break;
  commitWin(crane, { id: e.bodyId, defId: e.defId }, watcherRef.current?.instanceId ?? null);
  returnTimer.current = window.setTimeout(() => goShelfRef.current(), 1500);
  break;
}
```

物理由来の `fallen` も同じ経路に流す。

```ts
for (const f of r.fallen) handleEvent({ kind: "won", bodyId: f.id, defId: f.defId });
```

`watcherRef` は見守り役の `PlushInstance` を保持する ref（レンダー時に代入）。

- [ ] **Step 7: 全テストを実行する**

Run: `npm test`
Expected: PASS — provenanceFlow 7件を含む全件。
既存の `fallen` を使うテストを `.map(f => f.id)` に直すこと。

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: 取得時の来歴を実フロー経由で保存"
```

---

## Task 3: 来歴の文面とプロフィール表示

**Files:**
- Create: `src/shelf/provenance.ts`, `src/shelf/PlushProfile.tsx`
- Modify: `src/shelf/ShelfScreen.tsx`, `src/styles.css`
- Test: `src/shelf/provenance.test.ts`

**Interfaces:**
- Consumes: `PlushInstance`, `getPlush`, `seriesName`
- Produces:
  - `provenanceLines(inst: PlushInstance, all: PlushInstance[], now: number): string[]`
  - `<PlushProfile instanceId={string} onClose={() => void} />`

- [ ] **Step 1: 失敗するテストを書く**

`src/shelf/provenance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { provenanceLines } from "./provenance";
import type { PlushInstance } from "../state/types";

const base: PlushInstance = {
  instanceId: "r1", plushTypeId: "rabbit_01",
  acquiredAt: new Date("2026-09-04T10:00:00").getTime(),
  attemptsToAcquire: 3, witnessedBy: "b1", origin: "crane",
  x: 160, shelfRow: 1, personalitySeed: 0.5,
};
const bear: PlushInstance = {
  ...base, instanceId: "b1", plushTypeId: "bear_01",
  attemptsToAcquire: null, witnessedBy: null, origin: "starter",
};
const NOW = new Date("2026-09-10T10:00:00").getTime();

describe("provenanceLines", () => {
  it("いつ・何回目で・誰が見ていたかを出す", () => {
    const lines = provenanceLines(base, [base, bear], NOW);
    expect(lines).toContain("9月4日にやってきた");
    expect(lines).toContain("3回目でおうちに来た");
    expect(lines).toContain("ブラウンベアが一緒に見ていた");
  });

  it("1回で取れた子は「1回目で」と書かない", () => {
    const lines = provenanceLines({ ...base, attemptsToAcquire: 1 }, [base, bear], NOW);
    expect(lines.some((l) => l.includes("1回目"))).toBe(false);
    expect(lines).toContain("すぐにおうちに来た");
  });

  it("starter は1行だけ", () => {
    expect(provenanceLines(bear, [bear], NOW)).toEqual(["はじめからここにいた"]);
  });

  it("unknown は来歴を捏造しない", () => {
    const u = { ...base, origin: "unknown" as const, attemptsToAcquire: null, witnessedBy: null };
    expect(provenanceLines(u, [u], NOW)).toEqual(["いつからか、ここにいる"]);
  });

  it("granted は来歴を捏造しない", () => {
    const g = { ...base, origin: "granted" as const, attemptsToAcquire: null, witnessedBy: null };
    expect(provenanceLines(g, [g], NOW)).toEqual(["いつからか、ここにいる"]);
  });

  it("見守り役が居なくなっていたらその行を出さない", () => {
    const lines = provenanceLines(base, [base], NOW);
    expect(lines.some((l) => l.includes("見ていた"))).toBe(false);
    expect(lines).toContain("3回目でおうちに来た");
  });

  it("今日来た子は「きょう」と書く", () => {
    const lines = provenanceLines({ ...base, acquiredAt: NOW - 60_000 }, [base, bear], NOW);
    expect(lines[0]).toBe("きょう、やってきた");
  });

  it("数値・レアリティ・能力値を出さない", () => {
    const all = provenanceLines(base, [base, bear], NOW).join(" ");
    expect(/rare|common|special|レア|Lv|ポイント|好感度/i.test(all)).toBe(false);
  });

  it("どの入力でも空配列にならない", () => {
    for (const o of ["starter", "crane", "granted", "unknown"] as const) {
      expect(provenanceLines({ ...base, origin: o }, [base], NOW).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/shelf/provenance.test.ts`
Expected: FAIL — `Failed to resolve import "./provenance"`

- [ ] **Step 3: provenance.ts を書く**

`origin` で分岐する。`"starter"` → `["はじめからここにいた"]`。
`"unknown"` / `"granted"` → `["いつからか、ここにいる"]`。
`"crane"` → 日付・試行回数・見守り役の順に、分かる行だけを積む。

見守り役は `all` から `witnessedBy` で引く。居なければその行を出さない。

- [ ] **Step 4: PlushProfile.tsx を書く**

下から出る小さなカード。**大きなモーダルにしない。ステータス画面にしない。**

```
ミルクラビット

9月4日にやってきた
3回目でおうちに来た
ブラウンベアが一緒に見ていた

もりのおともだち
```

- 背景の暗転はごく薄く。棚が見えたままにする
- カードの外をタップで閉じる
- `plush_profile_opened` をログ（meta: `{ plushTypeId, origin }`）

- [ ] **Step 5: ShelfScreen のタップ処理を繋ぐ**

タップで**リアクションとプロフィールが同時に起きる**（仕様 4.6）。
既存の潰れ＋セリフを消さず、プロフィールを足す。

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — provenance 9件を含む全件

- [ ] **Step 7: 目視確認**

`npm run dev` でスマホ幅にし、次を確認する。

- タップでその子が反応し、同時にカードが出るか
- カードがステータス画面に見えないか
- starter の Bear が「はじめからここにいた」だけになっているか
- 数値が一切出ていないか

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: 個体の来歴とプロフィール表示"
```

---

## Phase A 完了: Codex レビュー ②

- [ ] **Codex に Phase A をレビューさせる**

> src/state/ と src/shelf/provenance.ts, PlushProfile.tsx, src/arcade/craneMachine.ts の resolveWin をレビューしてほしい。仕様書は docs/superpowers/specs/2026-09-04-companionship-design.md。見てほしい点: (1) v1→v2 移行で所持品や来歴が失われる経路がないか。移行に失敗したときに黙って初期化していないか (2) parseV2 の検証に穴がないか。壊れた v2 データで起動不能にならないか (3) resolveWin が attemptsOnBoard のリセットより後に呼ばれうる経路がないか (4) provenanceFlow.test.ts が実物の物理と状態機械を本当に通しているか。弱いテストになっていないか (5) 来歴の文面が、分からないことを分かったように書いていないか

指摘を採否判断してから修正し、コミットする。仕様と衝突する指摘は却下し、理由を記録する。

---

# Phase B: 隣接と関係の持続

## Task 4: 隣接リンクの計算

**Files:**
- Create: `src/shelf/neighbors.ts`
- Test: `src/shelf/neighbors.test.ts`

**Interfaces:**
- Consumes: `PlushInstance`, `SHELF`
- Produces:
  - （このタスクで `individuality()` に `leanPreference` / `sleepiness` /
    `socialDistance` を足す。Task 5 の指揮が `sleepiness` を必要とするため、
    元の計画の Task 6 から前倒しする）
  - `NEIGHBOR_LINK_DISTANCE = 110`, `NEIGHBOR_BREAK_DISTANCE = 124`
  - `type NeighborLink = { a: string; b: string; distance: number; closeness: number; sameType: boolean; cameHomeTogether: boolean; togetherMs: number; affinity: number }`
  - `shelfPointOf(p: PlushInstance): { x: number; y: number }`
  - `pairKey(a: string, b: string): string`
  - `computeNeighbors(instances: PlushInstance[], prev: NeighborLink[], neighborSince: Record<string, number>, now: number): { links: NeighborLink[]; neighborSince: Record<string, number>; created: string[]; removed: string[] }`

- [ ] **Step 1: 失敗するテストを書く**

`src/shelf/neighbors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeNeighbors, pairKey, shelfPointOf,
  NEIGHBOR_LINK_DISTANCE, NEIGHBOR_BREAK_DISTANCE,
} from "./neighbors";
import { SHELF } from "./shelfLayout";
import { SLOT_SPACING } from "../state/persist";
import type { PlushInstance } from "../state/types";

const inst = (id: string, x: number, row: number, type = "bear_01"): PlushInstance => ({
  instanceId: id, plushTypeId: type, acquiredAt: 0,
  attemptsToAcquire: null, witnessedBy: null, origin: "crane",
  x, shelfRow: row, personalitySeed: 0.5,
});

const fresh = (instances: PlushInstance[], now = 1000) =>
  computeNeighbors(instances, [], {}, now);

describe("隣接の距離条件（仕様5.1）", () => {
  it("同じ段の隣は隣接する", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 78 + SLOT_SPACING, 1)]);
    expect(r.links).toHaveLength(1);
  });

  it("真上・真下は隣接する", () => {
    const r = fresh([inst("a", 160, 1), inst("b", 160, 2)]);
    expect(r.links).toHaveLength(1);
  });

  it("斜めは隣接しない（配置が読み取れるようにするため）", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 78 + SLOT_SPACING, 2)]);
    expect(r.links).toHaveLength(0);
  });

  it("段の間隔とスロット間隔が前提どおり", () => {
    expect(SLOT_SPACING).toBeLessThanOrEqual(NEIGHBOR_LINK_DISTANCE);
    const rowGap = SHELF.rowY[1] - SHELF.rowY[0];
    expect(rowGap).toBeLessThanOrEqual(NEIGHBOR_LINK_DISTANCE);
    expect(Math.hypot(SLOT_SPACING, rowGap)).toBeGreaterThan(NEIGHBOR_BREAK_DISTANCE);
  });

  it("箱の中（shelfRow < 0）は隣接判定に入らない", () => {
    const r = fresh([inst("a", 160, 1), inst("b", 160, -1)]);
    expect(r.links).toHaveLength(0);
  });
});

describe("ヒステリシス（点滅させない）", () => {
  it("一度隣になったら、少し離れただけでは切れない", () => {
    const a = inst("a", 100, 1);
    const b = inst("b", 100 + NEIGHBOR_LINK_DISTANCE - 2, 1);
    const first = computeNeighbors([a, b], [], {}, 0);
    expect(first.links).toHaveLength(1);

    const bFar = { ...b, x: 100 + NEIGHBOR_LINK_DISTANCE + 8 }; // 118 < 124
    const second = computeNeighbors([a, bFar], first.links, first.neighborSince, 100);
    expect(second.links, "解消閾値の内側なのに切れた").toHaveLength(1);
  });

  it("解消閾値を超えれば切れる", () => {
    const a = inst("a", 100, 1);
    const b = inst("b", 100 + NEIGHBOR_LINK_DISTANCE - 2, 1);
    const first = computeNeighbors([a, b], [], {}, 0);
    const bFar = { ...b, x: 100 + NEIGHBOR_BREAK_DISTANCE + 6 };
    const second = computeNeighbors([a, bFar], first.links, first.neighborSince, 100);
    expect(second.links).toHaveLength(0);
    expect(second.removed).toContain(pairKey("a", "b"));
  });
});

describe("リンクの生成と消滅", () => {
  it("新しいリンクを created で報告する", () => {
    const r = fresh([inst("a", 78, 1), inst("b", 160, 1)]);
    expect(r.created).toEqual([pairKey("a", "b")]);
  });

  it("既存のリンクは created に入らない", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = fresh(list);
    const second = computeNeighbors(list, first.links, first.neighborSince, 2000);
    expect(second.created).toEqual([]);
  });

  it("切れたリンクの neighborSince を削除する", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = fresh(list);
    expect(Object.keys(first.neighborSince)).toHaveLength(1);
    const apart = [list[0], { ...list[1], x: 300 }];
    const second = computeNeighbors(apart, first.links, first.neighborSince, 2000);
    expect(second.neighborSince).toEqual({});
  });

  it("pairKey は順序に依存しない", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});

describe("togetherMs は連続して隣にいる時間", () => {
  it("時間とともに増える", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 1000);
    expect(first.links[0].togetherMs).toBe(0);
    const later = computeNeighbors(list, first.links, first.neighborSince, 6000);
    expect(later.links[0].togetherMs).toBe(5000);
  });

  it("一度離すと 0 に戻る", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 0);
    const apart = [list[0], { ...list[1], x: 300 }];
    const gone = computeNeighbors(apart, first.links, first.neighborSince, 60_000);
    const again = computeNeighbors(list, gone.links, gone.neighborSince, 61_000);
    expect(again.links[0].togetherMs).toBe(0);
  });
});

describe("親密度", () => {
  it("近いほど高い", () => {
    const near = fresh([inst("a", 100, 1), inst("b", 160, 1)]).links[0];
    const far = fresh([inst("a", 100, 1), inst("b", 205, 1)]).links[0];
    expect(near.affinity).toBeGreaterThan(far.affinity);
  });

  it("同じ種類のほうが高い", () => {
    const same = fresh([inst("a", 78, 1, "bear_01"), inst("b", 160, 1, "bear_01")]).links[0];
    const diff = fresh([inst("a", 78, 1, "bear_01"), inst("b", 160, 1, "fox_01")]).links[0];
    expect(same.affinity).toBeGreaterThan(diff.affinity);
    expect(same.sameType).toBe(true);
  });

  it("一緒に迎えた関係のほうが高い", () => {
    const a = inst("a", 78, 1);
    const b = { ...inst("b", 160, 1), witnessedBy: "a" };
    const together = fresh([a, b]).links[0];
    const apart = fresh([a, inst("b", 160, 1)]).links[0];
    expect(together.cameHomeTogether).toBe(true);
    expect(together.affinity).toBeGreaterThan(apart.affinity);
  });

  it("長く隣にいるほど高い", () => {
    const list = [inst("a", 78, 1), inst("b", 160, 1)];
    const first = computeNeighbors(list, [], {}, 0);
    const later = computeNeighbors(list, first.links, first.neighborSince, 200_000);
    expect(later.links[0].affinity).toBeGreaterThan(first.links[0].affinity);
  });
});

describe("隣接は各方向でいちばん近い1匹だけ（仕様5.1）", () => {
  it("同じ段に3匹並ぶと、端どうしは隣接しない", () => {
    const r = fresh([
      inst("l", 78, 1),
      inst("m", 78 + SLOT_SPACING, 1),
      inst("rr", 78 + SLOT_SPACING * 2, 1),
    ]);
    const keys = r.links.map((k) => pairKey(k.a, k.b));
    expect(keys).toContain(pairKey("l", "m"));
    expect(keys).toContain(pairKey("m", "rr"));
    // 端どうしは間に m がいるので隣ではない
    expect(keys).not.toContain(pairKey("l", "rr"));
  });

  it("重なって置かれても、隣は左右上下でそれぞれ1匹まで", () => {
    // 距離だけで判定すると 3 匹が総当たりで 3 本張ってしまう
    const r = fresh([inst("a", 160, 1), inst("b", 168, 1), inst("c", 176, 1)]);
    for (const id of ["a", "b", "c"]) {
      const degree = r.links.filter((k) => k.a === id || k.b === id).length;
      expect(degree, `${id} の隣が多すぎる`).toBeLessThanOrEqual(4);
    }
    expect(r.links.map((k) => pairKey(k.a, k.b))).not.toContain(pairKey("a", "c"));
  });

  it("リンクは対称。片方から見て隣なら、もう片方から見ても隣", () => {
    const r = fresh([inst("a", 100, 1), inst("b", 170, 1), inst("c", 240, 1)]);
    for (const k of r.links) {
      expect(k.a < k.b, "リンクの端点は辞書順に正規化されている").toBe(true);
    }
    expect(new Set(r.links.map((k) => pairKey(k.a, k.b))).size).toBe(r.links.length);
  });
});

describe("規模", () => {
  it("棚が満杯でもリンクは幾何的な上界を超えない", () => {
    const all: PlushInstance[] = [];
    for (let row = 0; row < SHELF.rows; row++) {
      for (let col = 0; col < 3; col++) {
        all.push(inst(`p${row}-${col}`, 78 + col * SLOT_SPACING, row));
      }
    }
    const r = fresh(all);
    // 各個体の隣は左右上下の最大4つ。12 * 4 / 2 = 24
    expect(r.links.length).toBeLessThanOrEqual(24);
    expect(r.links.length).toBeGreaterThan(0);
  });

  it("全員が同座標でも、リンクが総当たりにならない", () => {
    // 距離だけで判定すると C(12,2) = 66 本になる。それは「隣にいる」ではない。
    const all = Array.from({ length: 12 }, (_, i) => inst(`p${i}`, 160, 1));
    const r = fresh(all);
    expect(r.links.length, "総当たりになっている").toBeLessThanOrEqual(24);
    expect(Object.keys(r.neighborSince).length).toBeLessThanOrEqual(24);
  });

  it("0匹・1匹でも落ちない", () => {
    expect(fresh([]).links).toEqual([]);
    expect(fresh([inst("a", 160, 1)]).links).toEqual([]);
  });
});

describe("shelfPointOf", () => {
  it("段のY座標を返す", () => {
    expect(shelfPointOf(inst("a", 160, 2))).toEqual({ x: 160, y: SHELF.rowY[2] });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/shelf/neighbors.test.ts`
Expected: FAIL — `Failed to resolve import "./neighbors"`

- [ ] **Step 3: neighbors.ts を書く**

純粋関数。DOM にも React にも触れない。

**隣接は距離だけで決めない。** 各個体について左・右・上・下のそれぞれで
いちばん近い1匹を候補にし、その候補が距離条件を満たすときだけリンクを張る。

```
左  = 同じ段で x が小さい側のうち最も近い1匹
右  = 同じ段で x が大きい側のうち最も近い1匹
上  = 1段上で、x の差が最も小さい1匹
下  = 1段下で、x の差が最も小さい1匹
```

距離だけで判定すると、重ねて置かれた 12 匹が総当たりで 66 本のリンクを
張ってしまい、「隣にいる」という言葉の意味が壊れる。

リンクは `a < b`（辞書順）に正規化して重複を持たない。

`affinity = closeness * 1.0 + sameType * 0.5 + cameHomeTogether * 0.8 + min(togetherMs/120000, 1) * 0.4`

`closeness = 1 - distance / NEIGHBOR_BREAK_DISTANCE`（0-1にクランプ）。

ヒステリシス: `prev` に存在するリンクは `NEIGHBOR_BREAK_DISTANCE` で判定し、
存在しないリンクは `NEIGHBOR_LINK_DISTANCE` で判定する。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — neighbors 20件を含む全件

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: 棚の隣接リンク計算"
```

---

## Task 5: 関係演出の指揮

**Files:**
- Create: `src/shelf/shelfDirector.ts`
- Test: `src/shelf/shelfDirector.test.ts`

**Interfaces:**
- Consumes: `NeighborLink`, `pairKey`
- Produces:
  - `type EpisodeKind = "look" | "sameDirection" | "sleepTogether" | "greeting"`
  - `type Episode = { kind: EpisodeKind; a: string; b: string; startedAt: number; durationMs: number }`
  - `type DirectorState = { episode: Episode | null; fading: { episode: Episode; until: number } | null; nextAt: number }`
  - `type Personality = { sleepiness: number }`
  - `createDirector(now: number): DirectorState`
  - `tickDirector(s, links, created, personalities: Record<string, Personality>, now, rnd): { state; started: Episode | null; ended: Episode | null }`
  - `directorPose(s: DirectorState, instanceId: string, now: number): { lookAt; hop; eyeOpen; tilt }`
  - `EPISODE_MIN_GAP_MS = 6000`, `EPISODE_MAX_GAP_MS = 14000`
  - `EPISODE_MIN_MS = 2000`, `EPISODE_MAX_MS = 3000`, `FADE_MS = 300`

### 設計上の注意 1: 中断の後始末を状態として持つ

`greeting` が走っている挿話を打ち切るとき、関与していた個体の姿勢を
**300ms かけて中立へ戻す**（仕様5.4）。

そのため状態は「いま走っている挿話」と「消えかけている挿話」の
**2つを同時に持つ**。片方しか持たないと、割り込みの瞬間に
姿勢が飛んで見える。

姿勢は `directorPose` が両方を合成して返す。

### 設計上の注意 2: 眠さは affinity に混ぜない

`affinity` は「どのリンクを選ぶか」を決める値。そこに眠さを混ぜると、
眠い子のリンクで `look` や `greeting` まで起きやすくなってしまう。

個体の性格は別の引数 `personalities` として渡し、
**挿話の種類を選ぶときにだけ**使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/shelf/shelfDirector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createDirector, tickDirector, directorPose,
  EPISODE_MIN_GAP_MS, EPISODE_MAX_GAP_MS, EPISODE_MAX_MS, FADE_MS,
  type DirectorState, type Episode, type Personality,
} from "./shelfDirector";
import { pairKey, type NeighborLink } from "./neighbors";

const link = (a: string, b: string, affinity = 1): NeighborLink => ({
  a, b, distance: 82, closeness: 0.7,
  sameType: false, cameHomeTogether: false, togetherMs: 0, affinity,
});

/** 等間隔に 0..1 を返す決定論的な乱数。呼ぶたびに次へ進む。 */
function evenRnd(step = 0.137, start = 0.05) {
  let v = start;
  return () => {
    const out = v;
    v = (v + step) % 1;
    return out;
  };
}

const NO_PERSONALITY: Record<string, Personality> = {};

/**
 * 指揮を回して、始まった挿話を集める。
 * 乱数はループの外で1つ作り、順に消費させる。
 */
function run(
  links: NeighborLink[],
  ms: number,
  opts: { rnd?: () => number; personalities?: Record<string, Personality> } = {}
) {
  const rnd = opts.rnd ?? evenRnd();
  const personalities = opts.personalities ?? NO_PERSONALITY;
  let s = createDirector(0);
  const started: Array<Episode & { at: number }> = [];
  const ended: Array<Episode & { at: number }> = [];
  /** いま走っているとテストが考えている挿話 */
  let active: Episode | null = null;
  const violations: string[] = [];

  for (let t = 0; t <= ms; t += 50) {
    const r = tickDirector(s, links, [], personalities, t, rnd);
    s = r.state;

    if (r.ended) {
      ended.push({ ...r.ended, at: t });
      if (active && r.ended.startedAt === active.startedAt) active = null;
    }
    if (r.started) {
      // 走っている最中に別の挿話が始まってはいけない
      if (active) violations.push(`t=${t}: 前の挿話が終わる前に次が始まった`);
      started.push({ ...r.started, at: t });
      active = r.started;
    }
    // 走っているはずの挿話が state から消えていないこと
    if (active && !s.episode) violations.push(`t=${t}: 挿話が黙って消えた`);
  }
  return { started, ended, violations, state: s };
}

describe("挿話は同時に高々1つ（仕様3章の原則）", () => {
  it("走っている最中に次の挿話が始まらない", () => {
    const r = run([link("a", "b"), link("c", "d")], 120_000);
    expect(r.violations).toEqual([]);
    expect(r.started.length, "そもそも一度も始まっていない").toBeGreaterThan(3);
  });

  it("始まった挿話は必ず終わる（数が釣り合う）", () => {
    const r = run([link("a", "b")], 120_000);
    expect(r.ended.length).toBeGreaterThanOrEqual(r.started.length - 1);
  });

  it("挿話の再生時間が 2〜3 秒に収まる", () => {
    const r = run([link("a", "b")], 120_000);
    expect(r.ended.length, "一度も終わっていない").toBeGreaterThan(0);
    for (const e of r.ended) {
      const dur = e.at - e.startedAt;
      expect(dur).toBeGreaterThanOrEqual(2000);
      expect(dur).toBeLessThanOrEqual(EPISODE_MAX_MS + 50);
    }
  });

  it("挿話の間隔が 6〜14 秒に収まる", () => {
    const r = run([link("a", "b")], 180_000);
    expect(r.started.length).toBeGreaterThan(3);
    for (let i = 1; i < r.started.length; i++) {
      const prevEnd = r.ended.find((e) => e.startedAt === r.started[i - 1].startedAt);
      expect(prevEnd, "前の挿話の終わりが見つからない").toBeDefined();
      const gap = r.started[i].at - prevEnd!.at;
      expect(gap).toBeGreaterThanOrEqual(EPISODE_MIN_GAP_MS - 50);
      expect(gap).toBeLessThanOrEqual(EPISODE_MAX_GAP_MS + 50);
    }
  });

  it("リンクが無ければ何も起きない", () => {
    const r = run([], 120_000);
    expect(r.started).toEqual([]);
  });
});

describe("greeting の割り込み（仕様5.4）", () => {
  it("新しいリンクができたら即座に挨拶する", () => {
    const s = createDirector(0);
    const r = tickDirector(s, [link("a", "b")], [pairKey("a", "b")],
                           NO_PERSONALITY, 100, evenRnd());
    expect(r.started?.kind).toBe("greeting");
  });

  it("走っている挿話を打ち切り、打ち切ったことを報告する", () => {
    const rnd = evenRnd();
    const links = [link("a", "b"), link("c", "d")];
    let s = createDirector(0);
    for (let t = 0; t <= 120_000; t += 50) {
      const r = tickDirector(s, links, [], NO_PERSONALITY, t, rnd);
      s = r.state;
      if (r.started && r.started.kind !== "greeting") {
        const cut = tickDirector(s, links, [pairKey("c", "d")],
                                 NO_PERSONALITY, t + 50, rnd);
        expect(cut.ended, "打ち切られた挿話が報告されない").not.toBeNull();
        expect(cut.ended!.startedAt).toBe(r.started.startedAt);
        expect(cut.started?.kind).toBe("greeting");
        expect(cut.state.fading, "消えかけの挿話が保持されていない").not.toBeNull();
        return;
      }
    }
    throw new Error("挿話が一度も始まらなかった");
  });

  it("打ち切られた側の姿勢が 300ms かけて中立へ戻る（飛ばない）", () => {
    const cut: Episode = { kind: "look", a: "a", b: "b", startedAt: 0, durationMs: 2400 };
    const state: DirectorState = {
      episode: { kind: "greeting", a: "c", b: "d", startedAt: 1000, durationMs: 2000 },
      fading: { episode: cut, until: 1000 + FADE_MS },
      nextAt: 99_999,
    };
    const at0 = directorPose(state, "a", 1000);
    const mid = directorPose(state, "a", 1000 + FADE_MS / 2);
    const done = directorPose(state, "a", 1000 + FADE_MS);
    // 中立へ単調に近づく
    expect(Math.abs(mid.lookAt)).toBeLessThanOrEqual(Math.abs(at0.lookAt));
    expect(Math.abs(done.lookAt)).toBeLessThanOrEqual(Math.abs(mid.lookAt));
    expect(done.lookAt).toBeCloseTo(0, 3);
    expect(done.tilt).toBeCloseTo(0, 3);
  });

  it("1回の配置確定で複数リンクができても挨拶は1本だけ", () => {
    const s = createDirector(0);
    const links = [link("a", "b", 1), link("a", "c", 2), link("b", "c", 0.5)];
    const created = [pairKey("a", "b"), pairKey("a", "c"), pairKey("b", "c")];
    const r = tickDirector(s, links, created, NO_PERSONALITY, 100, evenRnd());
    expect(r.started?.kind).toBe("greeting");
    // 最も affinity の高いリンクが選ばれる
    expect([r.started!.a, r.started!.b].sort()).toEqual(["a", "c"]);
    expect(r.state.episode?.kind).toBe("greeting");
  });
});

describe("対象の選ばれ方は重み付き（最大値固定ではない）", () => {
  it("両方のリンクが選ばれ、親密度の高いほうが多く選ばれる", () => {
    const counts: Record<string, number> = {};
    // 乱数の位相を変えて何度も回す
    for (let phase = 0; phase < 120; phase++) {
      const rnd = evenRnd(0.0731, phase / 120);
      const r = run([link("a", "b", 1), link("c", "d", 3)], 40_000, { rnd });
      for (const e of r.started) {
        const k = pairKey(e.a, e.b);
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    const low = counts[pairKey("a", "b")] ?? 0;
    const high = counts[pairKey("c", "d")] ?? 0;
    expect(high, "高い方が選ばれていない").toBeGreaterThan(low);
    // 常に最大値を選ぶ実装だと low が 0 になる。それはルーレットではない。
    expect(low, "低い方が一度も選ばれていない（最大値固定になっている）").toBeGreaterThan(0);
  });

  it("配列の順序を変えても結果の傾向が変わらない", () => {
    const tally = (links: NeighborLink[]) => {
      const c: Record<string, number> = {};
      for (let phase = 0; phase < 60; phase++) {
        const r = run(links, 40_000, { rnd: evenRnd(0.0731, phase / 60) });
        for (const e of r.started) {
          const k = pairKey(e.a, e.b);
          c[k] = (c[k] ?? 0) + 1;
        }
      }
      return c;
    };
    const forward = tally([link("a", "b", 1), link("c", "d", 3)]);
    const reversed = tally([link("c", "d", 3), link("a", "b", 1)]);
    for (const k of [pairKey("a", "b"), pairKey("c", "d")]) {
      const f = forward[k] ?? 0;
      const rv = reversed[k] ?? 0;
      const ratio = Math.max(f, rv) / Math.max(1, Math.min(f, rv));
      expect(ratio, `${k} が配列の順序に依存している`).toBeLessThan(2);
    }
  });
});

describe("性格が挿話の種類に効く（affinity には混ぜない）", () => {
  it("眠い子のリンクでは sleepTogether が起きやすい", () => {
    const links = [link("a", "b", 1)];
    const countKind = (sleepiness: number) => {
      let n = 0;
      for (let phase = 0; phase < 60; phase++) {
        const r = run(links, 60_000, {
          rnd: evenRnd(0.0731, phase / 60),
          personalities: { a: { sleepiness }, b: { sleepiness } },
        });
        n += r.started.filter((e) => e.kind === "sleepTogether").length;
      }
      return n;
    };
    expect(countKind(1)).toBeGreaterThan(countKind(0));
  });

  it("眠さはリンクの選ばれやすさを変えない", () => {
    const links = [link("a", "b", 1), link("c", "d", 1)];
    const share = (sleepiness: number) => {
      let ab = 0;
      let total = 0;
      for (let phase = 0; phase < 60; phase++) {
        const r = run(links, 40_000, {
          rnd: evenRnd(0.0731, phase / 60),
          personalities: { a: { sleepiness }, b: { sleepiness } },
        });
        for (const e of r.started) {
          total++;
          if (pairKey(e.a, e.b) === pairKey("a", "b")) ab++;
        }
      }
      return total === 0 ? 0 : ab / total;
    };
    // 眠さを変えても a-b が選ばれる割合はほぼ変わらないこと
    expect(Math.abs(share(1) - share(0))).toBeLessThan(0.15);
  });
});

describe("directorPose", () => {
  const ep = (kind: Episode["kind"]): DirectorState => ({
    episode: { kind, a: "a", b: "b", startedAt: 0, durationMs: 2400 },
    fading: null,
    nextAt: 99_999,
  });

  it("関与していない個体は中立のまま", () => {
    expect(directorPose(ep("look"), "z", 1000)).toEqual({
      lookAt: 0, hop: 0, eyeOpen: 1, tilt: 0,
    });
  });

  it("look では片方が先に、もう片方が遅れて見る", () => {
    const early = 300;
    expect(Math.abs(directorPose(ep("look"), "a", early).lookAt)).toBeGreaterThan(
      Math.abs(directorPose(ep("look"), "b", early).lookAt)
    );
  });

  it("sameDirection では2匹が同じ向きを見る", () => {
    const t = 1200;
    const a = directorPose(ep("sameDirection"), "a", t).lookAt;
    const b = directorPose(ep("sameDirection"), "b", t).lookAt;
    expect(Math.sign(a)).toBe(Math.sign(b));
    expect(Math.abs(a)).toBeGreaterThan(0.1);
  });

  it("sleepTogether では目が細くなる", () => {
    expect(directorPose(ep("sleepTogether"), "a", 1400).eyeOpen).toBeLessThan(1);
  });

  it("終了時刻には中立に戻っている", () => {
    for (const kind of ["look", "sameDirection", "sleepTogether", "greeting"] as const) {
      const p = directorPose(ep(kind), "a", 2400);
      expect(p.lookAt).toBeCloseTo(0, 2);
      expect(p.hop).toBeCloseTo(0, 2);
      expect(p.tilt).toBeCloseTo(0, 2);
      expect(p.eyeOpen).toBeCloseTo(1, 2);
    }
  });

  it("どの時刻でも有限の値を返す", () => {
    for (const kind of ["look", "sameDirection", "sleepTogether", "greeting"] as const) {
      for (const t of [-100, 0, 500, 2400, 100_000]) {
        for (const who of ["a", "b"]) {
          const p = directorPose(ep(kind), who, t);
          for (const [k, v] of Object.entries(p)) {
            expect(Number.isFinite(v), `${kind} ${who}@${t} ${k}`).toBe(true);
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/shelf/shelfDirector.test.ts`
Expected: FAIL — `Failed to resolve import "./shelfDirector"`

- [ ] **Step 3: shelfDirector.ts を書く**

純粋関数。乱数は引数で受け取り、テストから固定できるようにする。

`tickDirector` の流れ:

1. `fading` が期限切れなら消す
2. `created` が空でなければ、その中で最も `affinity` の高いリンク1本で
   `greeting` を始める。走っている挿話があれば `fading` へ移して `ended` で報告する
3. 走っている挿話が `startedAt + durationMs` を過ぎたら終了し、
   `nextAt = now + 6000..14000` を決める
4. 挿話が無く `now >= nextAt` かつリンクがあれば、
   `affinity` を重みとしたルーレットでリンクを1本選び、挿話の種類を決める

**種類の選び方**: `sleepTogether` の重みは両端の `sleepiness` の平均に比例させる。
`look` / `sameDirection` は一定。`affinity` には触らない。

**ルーレットは最大値固定にしない。** 累積和を作って乱数で切る。
テストが「低い方も選ばれること」を要求している。

`directorPose` は `episode` と `fading` を合成する。
`fading` は残り時間の比率で 0 へ向かって減衰させる。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — shelfDirector 18件を含む全件

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: 棚の関係演出の指揮"
```

---

## Task 6: 棚への組み込みと Idle

**Files:**
- Modify: `src/render/useAmbientLife.ts`, `src/shelf/ShelfScreen.tsx`, `src/render/pose.ts`, `src/state/store.ts`
- Test: `src/render/pose.test.ts`（追記）

**Interfaces:**
- Consumes: `computeNeighbors`, `tickDirector`, `episodePose`
- Produces:
  - `individuality(seed)` に `leanPreference` / `sleepiness` / `socialDistance` を追加
  - `store.setNeighborSince(map: Record<string, number>): void`
  - `useAmbientLife(registry, targets, enabled, links, episode)` — 引数を拡張

（個体差 `leanPreference` / `sleepiness` / `socialDistance` の追加は
Task 4 で済ませてある。ここでは棚への組み込みだけを行う。）

- [ ] **Step 1: 個体差が Task 4 で入っていることを確認する**

`src/render/pose.test.ts`:

```ts
it("個体差に leanPreference / sleepiness / socialDistance が含まれる", () => {
  for (let s = 0; s <= 1; s += 0.05) {
    const iv = individuality(s);
    expect(iv.leanPreference).toBeGreaterThanOrEqual(0.7);
    expect(iv.leanPreference).toBeLessThanOrEqual(1.3);
    expect(iv.sleepiness).toBeGreaterThanOrEqual(0);
    expect(iv.sleepiness).toBeLessThanOrEqual(1);
    expect(iv.socialDistance).toBeGreaterThanOrEqual(0.85);
    expect(iv.socialDistance).toBeLessThanOrEqual(1.15);
  }
});

it("追加した個体差も決定論的", () => {
  expect(individuality(0.42)).toEqual(individuality(0.42));
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/render/pose.test.ts`
Expected: FAIL — `leanPreference` が undefined

- [ ] **Step 3: individuality を拡張する**

既存の値を変えない。`f(9)` 以降の新しいスロットを使う。
既存の「彩度・明度も個体差の軸にする」修正を壊さないこと。

- [ ] **Step 4: useAmbientLife に関係を渡す**

**React の再レンダーを一切発生させない**制約を維持する。

- 常時層: `links` から各個体の傾き（`affinity * leanPreference`、最大 3.5 度）と
  呼吸の位相引き寄せを計算し、`transform` に直接書く
- 挿話層: `episode` があれば `episodePose` の結果を上乗せする
- 挿話の対象でない個体は常時層だけ

前フェーズで直した「瞬きの途中で止まると目が閉じたままになる」問題を
再発させない。クリーンアップで必ず属性を戻す。

- [ ] **Step 5: ShelfScreen に隣接と指揮を組み込む**

- 配置が確定したとき（`store.instances` が変わったとき）に `computeNeighbors`
  を回し、`neighborSince` をストアへ保存する
- **ドラッグ中は再計算しない**（仕様 5.7）
- rAF ループの中で `tickDirector` を回す。**これも React の state を毎フレーム
  更新しない**。挿話が始まった／終わったときだけ `setState` する
- `tickDirector` には `personalities`（`instanceId` → `{ sleepiness }`）を渡す。
  `individuality(personalitySeed)` から作り、個体の集合が変わったときだけ作り直す
- `neighbor_created` / `neighbor_removed` / `relationship_reaction` をログ
- 棚の滞在が 10 秒・30 秒を超えたら `shelf_idle_10s` / `shelf_idle_30s` をログ

- [ ] **Step 6: 全テストを実行する**

Run: `npm test`
Expected: PASS — 全件

- [ ] **Step 7: 目視確認（このフェーズで最も重要）**

スマホ幅で次を確認する。**30秒間、何も操作せずに眺める。**

- 2匹を隣に置くと寄りかかるか
- 離すと傾きが戻るか
- 挿話が同時に2つ以上走っていないか
- 連発していないか（「偶然見つけた」感覚があるか）
- 騒がしくないか。キャラクター育成ゲームに見えないか

納得いくまで間隔と強さを調整する。**ここに時間をかけてよい。**

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: 棚で持続する関係"
```

---

## Phase B 完了: Codex レビュー ③

- [ ] **Codex に Phase B をレビューさせる**

> src/shelf/neighbors.ts, shelfDirector.ts と src/render/useAmbientLife.ts, src/shelf/ShelfScreen.tsx をレビューしてほしい。仕様書は docs/superpowers/specs/2026-09-04-companionship-design.md の5章。見てほしい点: (1) computeNeighbors が 12匹満杯・同座標多重・箱の中の個体で破綻しないか。neighborSince が無制限に育つ経路がないか (2) tickDirector が「同時に高々1つ」を本当に守れているか。greeting の割り込みで姿勢が中立に戻らず固まる経路がないか (3) useAmbientLife が React の再レンダーを発生させていないか。rAF とリスナのリークがないか。前フェーズで直した「瞬きの途中で止まると目が閉じたまま」が再発していないか (4) ShelfScreen がドラッグ中に隣接を再計算していないか。writeSave が連打されていないか (5) 挿話が連発して「騒がしい」状態になりうるパラメータの組み合わせがないか

---

# Phase C: 並べ替え

## Task 7: ドラッグの改善

**Files:**
- Modify: `src/shelf/useDragPlacement.ts`, `src/shelf/ShelfScreen.tsx`, `src/shelf/shelfLayout.ts`, `src/styles.css`
- Test: `src/shelf/shelfLayout.test.ts`（追記）

**Interfaces:**
- Produces:
  - `DRAG_LIFT_PX = 46`, `DROP_SETTLE_MS = 180`
  - `DragState` に `settling?: { fromX: number; fromRow: number; startedAt: number }` を追加
  - `landingRowFor(y: number, r: number, others: Placed[]): number | null` — 置けない段なら null

- [ ] **Step 1: 失敗するテストを追記する**

```ts
import { landingRowFor, DRAG_LIFT_PX } from "./shelfLayout";

describe("landingRowFor", () => {
  it("空いている段を返す", () => {
    expect(landingRowFor(SHELF.rowY[1], 32, [])).toBe(1);
  });

  it("満杯の段には置けない（null を返す）", () => {
    const full = Array.from({ length: 3 }, (_, i) =>
      item(`f${i}`, 78 + i * 82, 1, 34)
    );
    expect(landingRowFor(SHELF.rowY[1], 34, full)).toBeNull();
  });

  it("範囲外の y でも有効な段か null を返す", () => {
    for (const y of [-9999, 9999, Number.NaN]) {
      const r = landingRowFor(y, 32, []);
      expect(r === null || (r >= 0 && r < SHELF.rows)).toBe(true);
    }
  });
});

describe("ドラッグの持ち上げ量", () => {
  it("最大の景品の半径より大きい（指で顔が隠れない）", () => {
    // 最大 size 34 × 個体差 1.05 = 35.7
    expect(DRAG_LIFT_PX).toBeGreaterThan(36);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/shelf/shelfLayout.test.ts`
Expected: FAIL — `landingRowFor is not exported`

- [ ] **Step 3: shelfLayout.ts に landingRowFor を足す**

`rowFromY` で段を求め、その段が満杯なら `null`。

- [ ] **Step 4: useDragPlacement を改善する**

仕様6章の4点を実装する。

1. **指で隠れない**: ぬいぐるみを指の `DRAG_LIFT_PX`(46px) 上に描く。
   掴んだ瞬間に飛び上がらないよう、オフセットは 120ms かけて付ける
2. **棚板から浮かない**: 縦位置は常に最寄りの棚板の上面ラインに吸着する。
   指の位置ではなく段が変わったときだけ縦に動く
3. **置ける場所が分かる**: `landingRowFor` が返した段に淡い楕円の影を出す。
   `null` なら影を出さない
4. **Drop 時にジャンプしない**: 確定位置へ `DROP_SETTLE_MS`(180ms) で滑らせる

`plush_drag_start` / `plush_drag_end` をログ（meta に `fromRow` / `toRow` / `reverted`）。

- [ ] **Step 5: 全テストを実行する**

Run: `npm test`
Expected: PASS — 全件

- [ ] **Step 6: 目視確認（スマホ幅で必ず行う）**

依頼書13章の6条件をひとつずつ確認する。

- 指でつまんで動かせるか
- **ぬいぐるみが指で完全に隠れないか**
- 置ける場所が分かるか
- 他のぬいぐるみとの距離感が自然か
- **移動中に棚板から浮かないか**
- **Drop 時に不自然なジャンプをしないか**

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 並べ替えの操作性改善"
```

---

## Phase C 完了: Codex レビュー ④

- [ ] **Codex に Phase C をレビューさせる**

> src/shelf/useDragPlacement.ts と shelfLayout.ts をレビューしてほしい。仕様書は docs/superpowers/specs/2026-09-04-companionship-design.md の6章、依頼書13章。見てほしい点: (1) 持ち上げオフセットと棚板吸着が同時に成り立っているか。矛盾する経路がないか (2) DROP_SETTLE_MS のアニメーション中にアンマウントやもう一度のドラッグが起きたときに壊れないか (3) 前フェーズで直した pointerId の追跡と pointercancel の中断が壊れていないか (4) landingRowFor が満杯判定を誤らないか。自分自身を数えていないか

---

# Phase D: Reaction Director と仕上げ

## Task 8: 吹き出しの配置

**Files:**
- Create: `src/render/bubble.ts`
- Modify: `src/shelf/ShelfScreen.tsx`, `src/shelf/MeetingCeremony.tsx`, `src/arcade/Watcher.tsx`
- Test: `src/render/bubble.test.ts`

**Interfaces:**
- Produces:
  - `placeBubble(opts): { x: number; y: number; below: boolean }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from "vitest";
import { placeBubble } from "./bubble";

const bounds = { minX: 0, maxX: 320, minY: 0 };

describe("placeBubble", () => {
  it("通常は頭の上に出る", () => {
    const r = placeBubble({ anchorX: 160, headTopY: 200, textWidth: 100, bounds, others: [] });
    expect(r.below).toBe(false);
    expect(r.y).toBeLessThan(200);
  });

  it("上端に近ければ下側へ回す（画面外に出ない）", () => {
    const r = placeBubble({ anchorX: 160, headTopY: 10, textWidth: 100, bounds, others: [] });
    expect(r.below).toBe(true);
    expect(r.y).toBeGreaterThanOrEqual(bounds.minY);
  });

  it("左右の端をはみ出さない", () => {
    for (const x of [0, 5, 315, 320]) {
      const r = placeBubble({ anchorX: x, headTopY: 200, textWidth: 140, bounds, others: [] });
      expect(r.x - 70).toBeGreaterThanOrEqual(bounds.minX);
      expect(r.x + 70).toBeLessThanOrEqual(bounds.maxX);
    }
  });

  it("他の子の顔に被らないよう横へずらす", () => {
    const others = [{ x: 160, headTopY: 150 }];
    const clean = placeBubble({ anchorX: 160, headTopY: 250, textWidth: 100, bounds, others: [] });
    const avoid = placeBubble({ anchorX: 160, headTopY: 250, textWidth: 100, bounds, others });
    expect(avoid.x).not.toBeCloseTo(clean.x, 1);
  });

  it("どの入力でも有限の値を返す", () => {
    for (const anchorX of [-1000, 0, 160, 5000, Number.NaN]) {
      for (const headTopY of [-500, 0, 300, Number.NaN]) {
        const r = placeBubble({ anchorX, headTopY, textWidth: 100, bounds, others: [] });
        expect(Number.isFinite(r.x)).toBe(true);
        expect(Number.isFinite(r.y)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2 → 4: 実装して通す**

Run: `npx vitest run src/render/bubble.test.ts` → PASS

3箇所（棚のタップ、出会いの演出、見守り）を `placeBubble` に統一する。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: 吹き出しの配置を統一"
```

---

## Task 9: クレーンの Reaction Director

**Files:**
- Create: `src/arcade/reactionDirector.ts`
- Modify: `src/arcade/physics.ts`, `craneMachine.ts`, `watcherState.ts`, `ArcadeScreen.tsx`
- Test: `src/arcade/reactionDirector.test.ts`, `src/arcade/physics.test.ts`（追記）

**Interfaces:**
- Produces:
  - `StepResult` に `maxImpactSpeed: number` と `movingCount: number` を追加
  - `type CraneSignal = "won" | "almost_goal" | "near_miss" | "grab_success" | "big_bounce" | "two_plushes_move" | "weird_stuck" | "idle"`
  - `SIGNAL_PRIORITY: Record<CraneSignal, number>`
  - `type DirectedReaction = { mood: WatcherMood; signal: CraneSignal; until: number }`
  - `directCrane(current: DirectedReaction | null, signals: CraneSignal[], now: number): DirectedReaction`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from "vitest";
import { directCrane, SIGNAL_PRIORITY, type CraneSignal } from "./reactionDirector";

describe("優先順位（依頼書17章）", () => {
  it("仕様の順序どおり", () => {
    const order: CraneSignal[] = [
      "won", "almost_goal", "near_miss", "grab_success",
      "big_bounce", "two_plushes_move", "weird_stuck", "idle",
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        SIGNAL_PRIORITY[order[i - 1]],
        `${order[i - 1]} が ${order[i]} より高くない`
      ).toBeGreaterThan(SIGNAL_PRIORITY[order[i]]);
    }
  });

  it("同時に起きたら高いほうが勝つ", () => {
    const r = directCrane(null, ["big_bounce", "won", "idle"], 0);
    expect(r.signal).toBe("won");
  });

  it("最低表示時間の間は低い順位で上書きされない", () => {
    const first = directCrane(null, ["won"], 0);
    const later = directCrane(first, ["idle", "big_bounce"], first.until - 10);
    expect(later.signal).toBe("won");
  });

  it("最低表示時間を過ぎれば切り替わる", () => {
    const first = directCrane(null, ["won"], 0);
    const later = directCrane(first, ["idle"], first.until + 10);
    expect(later.signal).toBe("idle");
  });

  it("より高い順位なら最低表示時間中でも割り込める", () => {
    const first = directCrane(null, ["big_bounce"], 0);
    const later = directCrane(first, ["won"], first.until - 10);
    expect(later.signal).toBe("won");
  });

  it("信号が無ければ idle になる", () => {
    expect(directCrane(null, [], 0).signal).toBe("idle");
  });

  it("すべての信号に対応する mood がある", () => {
    for (const s of Object.keys(SIGNAL_PRIORITY) as CraneSignal[]) {
      expect(directCrane(null, [s], 0).mood).toBeTruthy();
    }
  });

  it("同じ信号が続いても until が伸び続けない（固まらない）", () => {
    let r = directCrane(null, ["idle"], 0);
    const firstUntil = r.until;
    r = directCrane(r, ["idle"], 100);
    expect(r.until).toBe(firstUntil);
  });
});
```

`physics.test.ts` に追記:

```ts
it("最大衝突速度と移動中の個数を報告する", () => {
  const b = [body({ id: "a", x: 100, vx: 400 }), body({ id: "b", x: 165 })];
  let sawImpact = false;
  let sawTwoMoving = false;
  for (let i = 0; i < 240; i++) {
    const r = step(b, DEFAULT_PIT, STEP);
    if (r.maxImpactSpeed > 0) sawImpact = true;
    if (r.movingCount >= 2) sawTwoMoving = true;
  }
  expect(sawImpact).toBe(true);
  expect(sawTwoMoving).toBe(true);
});

it("静止していれば movingCount は 0", () => {
  const b = [body()];
  for (let i = 0; i < 600; i++) step(b, DEFAULT_PIT, STEP);
  expect(step(b, DEFAULT_PIT, STEP).movingCount).toBe(0);
});
```

- [ ] **Step 2 → 4: 実装して通す**

`ArcadeScreen` は物理とクレーンの状態から `CraneSignal[]` を作り、
`directCrane` に渡して mood を得る。`moodFor` は `directCrane` に置き換える。

`weird_stuck` は `crane.advanceRetries >= MAX_ADVANCE_RETRIES` で立てる。

- [ ] **Step 5: 目視確認**

クレーンを何度か回し、次を確認する。

- 掴んだ瞬間・落とした瞬間・出口に近づいた瞬間の反応が混ざらないか
- 吹き出しが重ならないか
- 反応が細かく切り替わりすぎないか

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: クレーンのReaction Director"
```

---

## Task 10: ログ・E2Eシミュレーション・実プレイ

**Files:**
- Modify: `src/state/types.ts`, `src/dev/devActions.ts`
- Create: `src/arcade/winRate.test.ts`
- Create: `docs/playtest-report-2.md`
- Modify: `README.md`
- Test: `src/dev/devActions.test.ts`（追記）

- [ ] **Step 1: ログの meta を確認する**

イベントの**型と許可リストは Task 1 の Step 0 で追加済み**。
ここでは meta の中身が揃っていることだけ確認する。

| イベント | meta |
|---|---|
| `relationship_reaction` | `source` / `target` / `reactionType` |
| `neighbor_created` / `neighbor_removed` | `sameType` |
| `plush_drag_end` | `fromRow` / `toRow` / `reverted` |
| `plush_profile_opened` | `plushTypeId` / `origin` |

足りないものがあればここで足す。

- [ ] **Step 2: サマリに依頼書22章の A〜F を足す**

`devActions.test.ts` に追記:

```ts
it("依頼書22章の A〜F を集計する", () => {
  const s = initialSave();
  const t0 = 1_000_000;
  s.log.push(
    { type: "shelf_return_after_win", t: t0, sessionId: "a" },
    { type: "plush_drag_end", t: t0 + 20_000, sessionId: "a" },
    { type: "neighbor_created", t: t0 + 21_000, sessionId: "a", meta: { sameType: true } },
    { type: "shelf_dwell", t: t0 + 40_000, sessionId: "a", meta: { ms: 40_000 } },
    { type: "relationship_reaction", t: t0 + 50_000, sessionId: "a",
      meta: { source: "a", target: "b", reactionType: "look" } },
    { type: "plush_drag_end", t: t0 + 60_000, sessionId: "a" },
    { type: "plush_profile_opened", t: t0 + 70_000, sessionId: "a" }
  );
  const p = JSON.parse(buildLogJson(s)).summary;
  expect(p.dwellAfterWinMs).toBe(40_000);          // A
  expect(p.rearrangeAfterWin).toBe(1);              // B
  expect(p.neighborCreatedAfterWin).toBe(1);        // C
  expect(p.rearrangeAfterReaction).toBe(1);         // D
  expect(p.sameTypeNeighbors).toBe(1);              // E
  expect(p.profilesOpened).toBe(1);                 // F
});

it("イベントが無くても壊れない", () => {
  const p = JSON.parse(buildLogJson(initialSave())).summary;
  expect(p.dwellAfterWinMs).toBeNull();
  expect(p.profilesOpened).toBe(0);
});
```

**サマリのコメントに「これは相関であって因果ではない」と明記する**（仕様12.5）。

- [ ] **Step 3: クレーン E2E シミュレーションを強化する**

`src/arcade/winRate.test.ts`:

```ts
/**
 * 依頼書24章。Drop → Grab → Physics → Drop/Win を実際に回して
 * 1〜4回目の累積獲得率を測る。
 *
 * 「4回以内に取れる」は **同じ景品を継続して狙った場合** の保証であり、
 * 毎回別の景品を狙えば成立しない（仕様11章）。
 * このシミュレーションも同じ子を狙い続ける前提で回している。
 */
```

- 300 セッション
- 1回目・2回目まで・3回目まで・4回目までの累積獲得率を計算
- `console.log` で数値を出す（レポートに載せるため）
- 期待値: 1回目 0.15〜0.45、4回まで >= 0.95

- [ ] **Step 4: 全テストとビルドを通す**

```bash
npm test
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: 実際にプレイする（依頼書27章）**

localStorage をクリアして初回から遊ぶ。**必ず全部やる。**

| | 内容 |
|---|---|
| A | 新しいぬいぐるみを取る |
| B | 棚へ戻る |
| C | 新入りを既存ぬいぐるみの隣に置く |
| D | **30秒間、何も操作せず棚を見る** |
| E | 配置を変える |
| F | 同じ種類を2匹並べる |

加えて、**v1 の保存データからの移行**も実際に試す。

- [ ] **Step 6: 評価レポートを書く**

`docs/playtest-report-2.md` に、依頼書28章の8項目に答える。

1. Strongest Emotional Moment
2. Weakest Moment（ぬいぐるみが単なる UI オブジェクトに見えた瞬間）
3. Shelf Behavior（30秒眺めていられたか）
4. Rearrangement（配置を変えたくなったか、その理由）
5. Duplicate Test（同種2匹が「別々の2匹」に見えたか）
6. Provenance Test（来歴が愛着に影響したか）
7. Relationship Test（最も自然だった／人工的に見えた挙動）
8. Next Hypothesis

**前フェーズの教訓を守る。**

- コードを読んで推測したことを書かない
- 検証できていないことを検証したように書かない
- 「保証」と書くときは条件を併記する
- 成功条件（仕様13章）に「○」を付けるときは、根拠を必ず添える

- [ ] **Step 7: 見つけたバグを直す**

体験を損なうものを修正する。修正ごとにコミットする。

- [ ] **Step 8: README を更新する**

新しい要素（プロフィール、隣接関係、並べ替え）の説明を足す。

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "feat: ログ追加・E2E測定・実プレイ評価"
```

---

## Phase D 完了: Codex レビュー ⑤（最終）

- [ ] **Codex に全体をレビューさせる**

> src/ 全体と docs/playtest-report-2.md をレビューしてほしい。仕様書は docs/superpowers/specs/2026-09-04-companionship-design.md、成功条件は13章。見てほしい点: (1) 13章の成功条件のうち、実際にはコード上満たせていないものがないか (2) 全体を通したリソースリーク。特に新しく足した rAF・タイマー・リスナ (3) v1 の保存データを持っているプレイヤーが起動不能にならないか (4) 実プレイレポートの記述がコードの実態と矛盾していないか。誇張や事実誤認がないか。前フェーズでレポートに2件の事実誤認があったので特に厳しく見てほしい (5) 「4回以内保証」の限定条件がコード・テスト・レポートのすべてに書かれているか

---

## 自己レビュー結果

**1. 仕様カバレッジ**

| 仕様セクション | 実装タスク |
|---|---|
| 4.1 データモデル | Task 1 |
| 4.1.1 SaveV2 | Task 1 |
| 4.2 v1→v2 移行 | Task 1 |
| 4.3 試行回数の保存 | Task 2 |
| 4.4 実フロー検証 | Task 2 |
| 4.5 プロフィール | Task 3 |
| 4.6 タップの振る舞い | Task 3 |
| 5.1 隣接の定義・ヒステリシス | Task 4 |
| 5.2 リンク・togetherMs | Task 4 |
| 5.3 親密度 | Task 4 |
| 5.4 常時層・挿話層・greeting | Task 5 + Task 6 |
| 5.5 同種の挙動 | Task 4（sameType）+ Task 5 |
| 5.6 個体差 | Task 6 |
| 5.7 配置→反応 | Task 6 |
| 5.8 Idle | Task 6 |
| 6. 並べ替え | Task 7 |
| 7. Reaction Director | Task 9 |
| 8. 吹き出し | Task 8 |
| 9. ログ | Task 10 |
| 10.2 E2E | Task 10 |
| 11. 4回以内保証の表現 | Task 10 |
| 12. 取得判定 | 前フェーズで実装済み。Task 10 の E2E で回帰 |
| 13. 成功条件 | Task 10 |
| 14. 実装後の報告 | Task 10 |

漏れなし。

**2. プレースホルダ走査**

「TBD」「後で実装」「適切に処理」の類は無い。すべてのテストに実コードを書いた。

**2.5 Codex レビュー②で直した点**

| 指摘 | 対応 |
|---|---|
| `winOnAttempt` の距離が1回ずれる（`30n+4` だと n=2 が1回目で取れる） | 定数から導く式に変更。実際に何回目で取れたかを assert |
| フィクスチャ ID `"p1"` と `split("#")[0]` が矛盾 | **ID から種類を復元する設計自体をやめる**。物理が `fallen` で種類も運ぶ |
| ログイベント型を Task 10 で足すが Task 2〜7 が先に使う | Task 1 Step 0 へ前倒し。型と許可リストのずれを防ぐ回帰テストも追加 |
| `sleepiness` が Task 6 だが Task 5 が使う | Task 4 へ前倒し。`personalities` を別引数で渡す（`affinity` に混ぜない） |
| 全域 `defId → plushTypeId` 置換が物理と盤面保存を壊す | 触らないものを表で明示。`grep` での洗い出し手順を追加 |
| 同座標 12 匹で 66 リンクになり「最大24本」の主張が崩れる | 隣接を**トポロジカル**に定義（左右上下でいちばん近い1匹） |
| 「同時に高々1つ」のテストがトートロジー | 挿話をテスト側で追跡し、走行中の開始を違反として記録 |
| 「2〜3秒で終わる」テストが終了しなくても通る | 終了が一度も無ければ落ちるよう assert |
| ルーレットのテストが「最大値固定」でも通る | 低い方も選ばれることを要求。配列順序への非依存も検証 |
| 中断時の 300ms 復帰が状態として表現できない | `DirectorState.fading` を追加し、`directorPose` が合成 |
| `commitWin` の順序（保存 → 盤面破棄）が保証されない | `commitWin` に閉じ込め、順序をテスト |
| `NEIGHBOR_DISTANCE` と `NEIGHBOR_LINK_DISTANCE` の名前不一致 | 仕様側を実装名に合わせた |

**却下した指摘**

- 「Task 1 を分割し一時的な互換エイリアスを置く」
  → 却下。半分だけ移行した状態はレビューも実行も難しく、
    エイリアスの削除漏れが残る。Task 1 は不可分のまま、
    代わりに対象ファイルの洗い出し手順と「触らないもの」を明示した。

**3. 型の一貫性**

- `PlushInstance` — Task 1 で定義、以降すべてで使用。フィールド名一致
- `NeighborLink` — Task 4 で定義、Task 5・6 で使用。`affinity` を含む形で一致
- `Episode` / `EpisodeKind` — Task 5 で定義、Task 6 で使用
- `resolveWin` / `commitWin` / `FallenPrize` — Task 2 で定義・使用
- `StepResult.fallen` — Task 2 で `string[]` から `FallenPrize[]` へ変更。
  既存テストの `.toContain("a")` を `.map(f => f.id)` 経由に直す
- `Personality` / `DirectorState.fading` — Task 5 で定義、Task 6 で使用
- `individuality().sleepiness` — Task 4 で追加、Task 5 のテストと Task 6 で使用
- `CraneSignal` / `SIGNAL_PRIORITY` — Task 9 で定義・使用
- `pairKey` — Task 4 で定義、Task 5 のテストで使用。インポート元が一致
- `landingRowFor` / `DRAG_LIFT_PX` — Task 7 で定義・使用
- `store.winPlush` の新シグネチャ — Task 1 で変更、Task 2 で使用。一致
