import { useEffect, useState } from "react";
import { ArcadeScreen } from "./arcade/ArcadeScreen";
import { ShelfScreen } from "./shelf/ShelfScreen";
import { ShareSheet } from "./share/ShareSheet";
import { store } from "./state/store";

type Screen = "shelf" | "arcade";

export function App() {
  const [screen, setScreen] = useState<Screen>("shelf");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    store.startSession();
  }, []);

  return (
    <div className="app">
      {screen === "shelf" ? (
        <ShelfScreen
          onGoArcade={() => setScreen("arcade")}
          onShare={() => setSharing(true)}
        />
      ) : (
        <ArcadeScreen onGoShelf={() => setScreen("shelf")} debugPhysics={false} />
      )}

      {sharing && <ShareSheet onClose={() => setSharing(false)} />}
    </div>
  );
}
