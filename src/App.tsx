import { useEffect, useState } from "react";
import { ShelfScreen } from "./shelf/ShelfScreen";
import { store } from "./state/store";

type Screen = "shelf" | "arcade";

export function App() {
  const [screen, setScreen] = useState<Screen>("shelf");

  useEffect(() => {
    store.startSession();
  }, []);

  return (
    <div className="app">
      {screen === "shelf" && (
        <ShelfScreen
          onGoArcade={() => setScreen("arcade")}
          onShare={() => {
            /* Task 11 で実装する */
          }}
        />
      )}
      {screen === "arcade" && (
        <div className="screen" style={{ padding: 24 }}>
          <p>ゲームセンターは Task 8 で作る。</p>
          <button className="btn" onClick={() => setScreen("shelf")}>
            棚へもどる
          </button>
          {/* Task 8 でクレーンが繋がったら消す、演出確認用の暫定ボタン */}
          <button
            className="btn primary"
            style={{ marginTop: 12 }}
            onClick={() => {
              store.winPlush("rabbit_01");
              setScreen("shelf");
            }}
          >
            （開発用）新しい子を迎える
          </button>
        </div>
      )}
    </div>
  );
}
