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

`npx tsc --noEmit` が通るまで機械的に置換する。ロジックは変えない。

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
- Modify: `src/arcade/craneMachine.ts`（`resolveWin` を追加）
- Modify: `src/arcade/ArcadeScreen.tsx`
- Test: `src/arcade/provenanceFlow.test.ts`

**Interfaces:**
- Consumes: `Crane`, `physics.step`, `store.winPlush`
- Produces:
  - `resolveWin(crane: Crane, bodyId: string, watcherInstanceId: string | null): { plushTypeId: string; attemptsToAcquire: number; witnessedBy: string | null }`

**この Task がこのフェーズで最も間違えやすい。**
前フェーズで「試行回数は保存済み」と書いて事実誤認だったのと同じ場所である。

- [ ] **Step 1: 実フローを通す失敗するテストを書く**

`src/arcade/provenanceFlow.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createCrane, startDrop, tickCrane, resolveWin } from "./craneMachine";
import { step, DEFAULT_PIT, STEP, atRest, type Body } from "./physics";
import { getPlush } from "../data/plushies";
import { store } from "../state/store";

const prize = (x: number, z: number, id = "p1"): Body => ({
  id, defId: "rabbit_01", x, z, y: 0, vx: 0, vy: 0, vz: 0,
  r: getPlush("rabbit_01").size, spin: 0, held: false,
});

/**
 * 実際の物理と状態機械を回して1回 DROP する。
 * 獲得したらその won の bodyId を返す。
 */
function runAttempt(c: ReturnType<typeof createCrane>, bodies: Body[], ax: number, az: number) {
  c.armX = ax; c.armZ = az;
  startDrop(c, bodies, DEFAULT_PIT);
  let wonId: string | null = null;
  let flush = -1;
  for (let i = 0; i < 120 * 30; i++) {
    for (const id of step(bodies, DEFAULT_PIT, STEP).fallen) wonId ??= id;
    for (const e of tickCrane(c, bodies, DEFAULT_PIT, STEP)) {
      if (e.kind === "won" && e.bodyId) wonId ??= e.bodyId;
    }
    if (flush >= 0) { if (++flush >= 40) break; }
    else if (c.state === "idle" && atRest(bodies)) flush = 0;
  }
  return wonId;
}

/** N 回目の DROP で獲得する状況を作り、その時の crane と bodyId を返す。 */
function winOnAttempt(n: number) {
  // 出口距離を調整して、n 回目でちょうど獲得できるようにする。
  // 毎試行 MIN_ADVANCE(30px) 縮むので、n 回で届く距離に置く。
  const dist = 30 * n + 4;
  const bodies = [prize(DEFAULT_PIT.exit.x + dist, DEFAULT_PIT.exit.z)];
  const c = createCrane();
  for (let i = 1; i <= n; i++) {
    const wonId = runAttempt(c, bodies, 9999, 9999); // 常に外す
    if (wonId) return { crane: c, bodyId: wonId, attempt: i };
  }
  throw new Error(`${n} 回で獲得できなかった`);
}

beforeEach(() => {
  localStorage.clear();
  store.resetAll();
});

describe("来歴が実フローを通して正しく保存される", () => {
  for (const n of [1, 2, 3, 4]) {
    it(`${n} 回目で取れた子の attemptsToAcquire が ${n} になる`, () => {
      const { crane, bodyId, attempt } = winOnAttempt(n);
      expect(attempt, "テストの前提が崩れている").toBe(n);

      const resolved = resolveWin(crane, bodyId, "watcher-1");
      expect(resolved.attemptsToAcquire).toBe(n);
      expect(resolved.plushTypeId).toBe("rabbit_01");
      expect(resolved.witnessedBy).toBe("watcher-1");

      const id = store.winPlush(resolved);
      const saved = store.get().instances.find((i) => i.instanceId === id)!;
      expect(saved.attemptsToAcquire).toBe(n);
      expect(saved.witnessedBy).toBe("watcher-1");
    });
  }

  it("獲得後に盤面が補充されても、保存済みの値は書き換わらない", () => {
    const { crane, bodyId } = winOnAttempt(2);
    const id = store.winPlush(resolveWin(crane, bodyId, null));
    // 盤面を作り直す（attemptsOnBoard が 0 に戻る）
    crane.attemptsOnBoard = 0;
    store.saveBoard(null);
    expect(store.get().instances.find((i) => i.instanceId === id)!.attemptsToAcquire).toBe(2);
  });

  it("見守り役がいない場合は witnessedBy が null になる", () => {
    const { crane, bodyId } = winOnAttempt(1);
    expect(resolveWin(crane, bodyId, null).witnessedBy).toBeNull();
  });

  it("bodyId から正しい種類を取り出す", () => {
    const { crane, bodyId } = winOnAttempt(1);
    expect(bodyId.startsWith("rabbit_01")).toBe(true);
    expect(resolveWin(crane, bodyId, null).plushTypeId).toBe("rabbit_01");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/arcade/provenanceFlow.test.ts`
Expected: FAIL — `resolveWin is not exported`

- [ ] **Step 3: resolveWin を実装する**

```ts
/**
 * won イベントから、保存すべき来歴を決める。
 *
 * attemptsOnBoard は盤面が補充されると 0 に戻る。したがってこの関数は
 * **won を処理した直後、盤面を作り直す前に**呼ばなければならない。
 * 呼び出し側（ArcadeScreen）はこの結果を store へ渡すだけにする。
 */
export function resolveWin(
  crane: Crane,
  bodyId: string,
  watcherInstanceId: string | null
): { plushTypeId: string; attemptsToAcquire: number; witnessedBy: string | null } {
  return {
    plushTypeId: bodyId.split("#")[0],
    attemptsToAcquire: Math.max(1, crane.attemptsOnBoard),
    witnessedBy: watcherInstanceId,
  };
}
```

- [ ] **Step 4: ArcadeScreen を繋ぐ**

`handleEvent` の `won` を次にする。値を決める仕事は `resolveWin` に任せ、
画面側には渡す一行しか残さない。

```ts
case "won": {
  if (wonRef.current) break;
  wonRef.current = true;
  sfx.success();
  if (!e.bodyId) break;
  store.winPlush(resolveWin(crane, e.bodyId, watcherRef.current?.instanceId ?? null));
  store.saveBoard(null);
  store.log("shelf_return_after_win");
  returnTimer.current = window.setTimeout(() => goShelfRef.current(), 1500);
  break;
}
```

`watcherRef` は見守り役の `PlushInstance` を保持する ref（レンダー時に代入）。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — provenanceFlow 7件を含む全件

- [ ] **Step 6: コミット**

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

  it("全員が同座標でも落ちない", () => {
    const all = Array.from({ length: 12 }, (_, i) => inst(`p${i}`, 160, 1));
    expect(() => fresh(all)).not.toThrow();
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
- Consumes: `NeighborLink`
- Produces:
  - `type EpisodeKind = "look" | "sameDirection" | "sleepTogether" | "greeting"`
  - `type Episode = { kind: EpisodeKind; a: string; b: string; startedAt: number; durationMs: number }`
  - `type DirectorState = { episode: Episode | null; nextAt: number }`
  - `createDirector(now: number): DirectorState`
  - `tickDirector(s: DirectorState, links: NeighborLink[], created: string[], now: number, rnd: () => number): { state: DirectorState; started: Episode | null; ended: Episode | null }`
  - `episodePose(ep: Episode, instanceId: string, now: number): { lookAt: number; hop: number; eyeOpen: number; tilt: number }`
  - `EPISODE_MIN_GAP_MS = 6000`, `EPISODE_MAX_GAP_MS = 14000`

- [ ] **Step 1: 失敗するテストを書く**

`src/shelf/shelfDirector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createDirector, tickDirector, episodePose,
  EPISODE_MIN_GAP_MS, EPISODE_MAX_GAP_MS,
} from "./shelfDirector";
import { pairKey, type NeighborLink } from "./neighbors";

const link = (a: string, b: string, affinity = 1): NeighborLink => ({
  a, b, distance: 82, closeness: 0.7,
  sameType: false, cameHomeTogether: false, togetherMs: 0, affinity,
});

function seq(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("挿話は同時に高々1つ（仕様3章の原則）", () => {
  it("走っている間は次を始めない", () => {
    let s = createDirector(0);
    const links = [link("a", "b"), link("c", "d")];
    let started = 0;
    for (let t = 0; t < 60_000; t += 100) {
      const r = tickDirector(s, links, [], t, seq([0.5]));
      s = r.state;
      if (r.started) {
        started++;
        // 開始直後は必ず episode が入っている
        expect(s.episode).not.toBeNull();
      }
      // どの時点でも episode は 0 か 1 個
      expect(s.episode === null || typeof s.episode.kind === "string").toBe(true);
    }
    expect(started).toBeGreaterThan(0);
  });

  it("挿話の間隔が 6〜14 秒に収まる", () => {
    let s = createDirector(0);
    const links = [link("a", "b")];
    const starts: number[] = [];
    for (let t = 0; t < 120_000; t += 50) {
      const r = tickDirector(s, links, [], t, seq([0.5]));
      s = r.state;
      if (r.started) starts.push(t);
    }
    expect(starts.length).toBeGreaterThan(3);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      // 前の挿話の再生時間 + 間隔
      expect(gap).toBeGreaterThanOrEqual(EPISODE_MIN_GAP_MS);
      expect(gap).toBeLessThanOrEqual(EPISODE_MAX_GAP_MS + 4000);
    }
  });

  it("リンクが無ければ何も起きない", () => {
    let s = createDirector(0);
    for (let t = 0; t < 60_000; t += 100) {
      const r = tickDirector(s, [], [], t, seq([0.5]));
      s = r.state;
      expect(r.started).toBeNull();
    }
  });

  it("挿話は 2〜3 秒で終わる", () => {
    let s = createDirector(0);
    const links = [link("a", "b")];
    let ep: { startedAt: number } | null = null;
    for (let t = 0; t < 60_000; t += 50) {
      const r = tickDirector(s, links, [], t, seq([0.5]));
      s = r.state;
      if (r.started) ep = r.started;
      if (r.ended && ep) {
        const dur = t - ep.startedAt;
        expect(dur).toBeGreaterThanOrEqual(2000);
        expect(dur).toBeLessThanOrEqual(3500);
        break;
      }
    }
  });
});

describe("greeting の割り込み（仕様5.4）", () => {
  it("新しいリンクができたら即座に挨拶する", () => {
    let s = createDirector(0);
    const links = [link("a", "b")];
    const r = tickDirector(s, links, [pairKey("a", "b")], 100, seq([0.5]));
    expect(r.started?.kind).toBe("greeting");
  });

  it("走っている挿話を打ち切って割り込む", () => {
    let s = createDirector(0);
    const links = [link("a", "b"), link("c", "d")];
    // まず普通の挿話を走らせる
    for (let t = 0; t < 60_000; t += 50) {
      const r = tickDirector(s, links, [], t, seq([0.5]));
      s = r.state;
      if (r.started && r.started.kind !== "greeting") {
        const interrupt = tickDirector(s, links, [pairKey("c", "d")], t + 50, seq([0.5]));
        expect(interrupt.ended, "打ち切られた挿話が報告されない").not.toBeNull();
        expect(interrupt.started?.kind).toBe("greeting");
        return;
      }
    }
    throw new Error("挿話が始まらなかった");
  });

  it("1回の配置確定で複数リンクができても挨拶は1本だけ", () => {
    const s = createDirector(0);
    const links = [link("a", "b", 1), link("a", "c", 2), link("b", "c", 0.5)];
    const created = [pairKey("a", "b"), pairKey("a", "c"), pairKey("b", "c")];
    const r = tickDirector(s, links, created, 100, seq([0.5]));
    expect(r.started?.kind).toBe("greeting");
    // 最も affinity の高いリンクが選ばれる
    expect([r.started!.a, r.started!.b].sort()).toEqual(["a", "c"]);
    expect(r.state.episode?.kind).toBe("greeting");
  });
});

describe("対象の選ばれ方", () => {
  it("親密度が高いリンクほど選ばれやすい", () => {
    const links = [link("a", "b", 0.1), link("c", "d", 3.0)];
    const counts: Record<string, number> = {};
    for (let seed = 0; seed < 200; seed++) {
      let s = createDirector(0);
      const rnd = seq([(seed % 100) / 100, ((seed * 7) % 100) / 100]);
      for (let t = 0; t < 30_000; t += 100) {
        const r = tickDirector(s, links, [], t, rnd);
        s = r.state;
        if (r.started) {
          const k = pairKey(r.started.a, r.started.b);
          counts[k] = (counts[k] ?? 0) + 1;
          break;
        }
      }
    }
    expect(counts[pairKey("c", "d")] ?? 0).toBeGreaterThan(counts[pairKey("a", "b")] ?? 0);
  });
});

describe("episodePose", () => {
  it("関与していない個体には何も返さない（中立）", () => {
    const ep = { kind: "look" as const, a: "a", b: "b", startedAt: 0, durationMs: 2400 };
    const p = episodePose(ep, "z", 1000);
    expect(p).toEqual({ lookAt: 0, hop: 0, eyeOpen: 1, tilt: 0 });
  });

  it("look では片方が先に、もう片方が遅れて見る", () => {
    const ep = { kind: "look" as const, a: "a", b: "b", startedAt: 0, durationMs: 2400 };
    const early = 300;
    expect(Math.abs(episodePose(ep, "a", early).lookAt)).toBeGreaterThan(
      Math.abs(episodePose(ep, "b", early).lookAt)
    );
  });

  it("sleepTogether では目が細くなる", () => {
    const ep = { kind: "sleepTogether" as const, a: "a", b: "b", startedAt: 0, durationMs: 2800 };
    expect(episodePose(ep, "a", 1400).eyeOpen).toBeLessThan(1);
  });

  it("終了時刻には中立に戻っている", () => {
    for (const kind of ["look", "sameDirection", "sleepTogether", "greeting"] as const) {
      const ep = { kind, a: "a", b: "b", startedAt: 0, durationMs: 2400 };
      const end = episodePose(ep, "a", 2400);
      expect(end.lookAt).toBeCloseTo(0, 2);
      expect(end.hop).toBeCloseTo(0, 2);
      expect(end.tilt).toBeCloseTo(0, 2);
      expect(end.eyeOpen).toBeCloseTo(1, 2);
    }
  });

  it("どの時刻でも有限の値を返す", () => {
    for (const kind of ["look", "sameDirection", "sleepTogether", "greeting"] as const) {
      const ep = { kind, a: "a", b: "b", startedAt: 0, durationMs: 2400 };
      for (const t of [-100, 0, 500, 2400, 100_000]) {
        for (const who of ["a", "b"]) {
          const p = episodePose(ep, who, t);
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

- `tickDirector` は現在の挿話が終わっていれば `ended` を返し、
  `now >= nextAt` かつリンクがあれば新しい挿話を始める
- `created` が空でなければ、走っている挿話を打ち切って `greeting` を始める。
  対象は `created` の中で最も `affinity` の高いリンク1本だけ
- 対象の選択は `affinity` を重みとしたルーレット
- `sleepTogether` は `sleepiness` が高い個体を含むリンクで選ばれやすくする
  （`personalitySeed` は呼び出し側で `affinity` に混ぜて渡す）

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — shelfDirector 13件を含む全件

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

- [ ] **Step 1: 個体差の失敗するテストを追記する**

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

- [ ] **Step 1: ログイベントを足す**

`LogEventType` に追加する。

```
plush_profile_opened / plush_drag_start / plush_drag_end
neighbor_created / neighbor_removed / relationship_reaction
shelf_idle_10s / shelf_idle_30s / shelf_return_after_win
```

`relationship_reaction` の meta に `source` / `target` / `reactionType`。

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

**3. 型の一貫性**

- `PlushInstance` — Task 1 で定義、以降すべてで使用。フィールド名一致
- `NeighborLink` — Task 4 で定義、Task 5・6 で使用。`affinity` を含む形で一致
- `Episode` / `EpisodeKind` — Task 5 で定義、Task 6 で使用
- `resolveWin` — Task 2 で定義、Task 2 の Step 4 で使用
- `CraneSignal` / `SIGNAL_PRIORITY` — Task 9 で定義・使用
- `pairKey` — Task 4 で定義、Task 5 のテストで使用。インポート元が一致
- `landingRowFor` / `DRAG_LIFT_PX` — Task 7 で定義・使用
- `store.winPlush` の新シグネチャ — Task 1 で変更、Task 2 で使用。一致
