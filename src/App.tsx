import { useEffect, useState } from "react";
import { ArcadeScreen } from "./arcade/ArcadeScreen";
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
      {screen === "shelf" ? (
        <ShelfScreen
          onGoArcade={() => setScreen("arcade")}
          onShare={() => {
            /* Task 11 で実装する */
          }}
        />
      ) : (
        <ArcadeScreen onGoShelf={() => setScreen("shelf")} debugPhysics={false} />
      )}
    </div>
  );
}
