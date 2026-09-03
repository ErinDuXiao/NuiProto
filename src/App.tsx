import { useEffect, useState } from "react";
import { ArcadeScreen } from "./arcade/ArcadeScreen";
import { DevMenu, useDevMenuTrigger, type DevFlags } from "./dev/DevMenu";
import { ShelfScreen } from "./shelf/ShelfScreen";
import { ShareSheet } from "./share/ShareSheet";
import { store } from "./state/store";

type Screen = "shelf" | "arcade";

export function App() {
  const [screen, setScreen] = useState<Screen>("shelf");
  const [sharing, setSharing] = useState(false);
  const [flags, setFlags] = useState<DevFlags>({ fps: false, physics: false });
  const dev = useDevMenuTrigger();

  useEffect(() => {
    store.startSession();
  }, []);

  return (
    <div className="app">
      {screen === "shelf" ? (
        <ShelfScreen
          onGoArcade={() => setScreen("arcade")}
          onShare={() => setSharing(true)}
          onSecretTap={dev.tap}
        />
      ) : (
        <ArcadeScreen
          onGoShelf={() => setScreen("shelf")}
          debugPhysics={flags.physics}
          showFps={flags.fps}
        />
      )}

      {sharing && <ShareSheet onClose={() => setSharing(false)} />}

      {dev.open && (
        <DevMenu flags={flags} onFlags={setFlags} onClose={() => dev.setOpen(false)} />
      )}
    </div>
  );
}
