# ぬいぐるみのおうち

Webブラウザで遊べる、クレーンゲーム＋ぬいぐるみ棚の MVP。

このゲームはクレーンゲームシミュレーターでも、ぬいぐるみ図鑑でもありません。
プレイヤーが「この子を取った」ではなく **「この子を家に連れて帰った」** と
感じるかどうかを検証するために作られています。

- クレーン = 入手方法
- 棚 = 生活する場所
- ぬいぐるみ同士の関係 = 感情的報酬

## 動かす

```bash
npm install
npm run dev
```

スマートフォンの縦画面を最優先に作ってあります。PC でも動きます。

```bash
npm test        # 単体テスト
npm run build   # 本番ビルド
npm run typecheck
```

## 遊びかた

1. 起動すると、部屋にぬいぐるみが1匹います。触ると反応します
2. 「ゲームセンターへ」でクレーンゲームへ
3. **長押しで左右に動かして、はなすと止まる** → 決定 → 奥ゆきも同じ → 落とす
4. 取れると棚へ帰り、先にいた子が新しい子を迎えます
5. ぬいぐるみはドラッグして好きな場所へ置けます
6. 「棚をシェア」で画像を書き出せます

数回以内に必ず取れるように作ってあります。取れずに終わることはありません。

## Developer Menu

通常プレイでは見えません。次のどちらかで開きます。

- 棚画面の**右下の小さなドットを3回タップ**
- `Ctrl + Shift + D`

できること: 所持品リセット / localStorage全消去 / 任意のぬいぐるみ追加 /
クレーン景品の再配置 / 全シリーズ表示 / **プレイログのJSONダウンロード** /
FPS表示 / 物理デバッグ表示。

プレイログには、あとで分析しやすいようサマリが付きます
（棚の滞在時間の中央値、触った回数、置き直した回数、演出をスキップし始めた匹数、
クレーンの照準誤差）。

## データの保存

`localStorage` に保存します。アカウント登録はありません。
保存キーは `plushcrane.v1`。壊れたデータを読んだ場合は
黙って壊れた状態で起動せず、初期状態に戻します。

## 新しいぬいぐるみを足す

`src/data/plushies.ts` の配列にオブジェクトを1つ足すだけです。コードの変更は要りません。

```ts
{
  id: "cat_01",
  name: "しろねこ",
  series: "forest_friends",
  rarity: "common",
  size: 30,        // 26-34
  weight: 0.95,    // 0.8-1.2 （レンジ厳守）
  softness: 0.8,   // 0-1
  art: { body: "#eee6dd", accent: "#f6efe6", face: "#5b4636",
         shape: "round", ears: "pointed", extras: ["tail"] },
}
```

`weight` と `softness` のレンジは必ず守ってください。この範囲が
クレーンの難易度設計（個体差を 1.8 倍幅に抑える）の前提になっています。

## 設計

- 設計書: [docs/superpowers/specs/2026-09-03-plush-crane-mvp-design.md](docs/superpowers/specs/2026-09-03-plush-crane-mvp-design.md)
- 実装計画: [docs/superpowers/plans/2026-09-03-plush-crane-mvp.md](docs/superpowers/plans/2026-09-03-plush-crane-mvp.md)
- 実プレイ評価: [docs/playtest-report.md](docs/playtest-report.md)

ランタイム依存は React / ReactDOM のみ。物理エンジン、アニメーションライブラリ、
画像・音声アセットは一切使っていません。ぬいぐるみはコードで描画し、
効果音は WebAudio でその場生成しています。
