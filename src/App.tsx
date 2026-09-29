import { useEffect } from "react";
import { useStore } from "./store";
import { Sprite } from "./components/Icons";
import { TopBar } from "./components/TopBar";
import { SessionRail } from "./components/SessionRail";
import { Constellation } from "./components/Constellation";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { Onboarding } from "./components/Onboarding";
import { Settings } from "./components/Settings";

export default function App() {
  const connect = useStore((s) => s.connect);
  const hasSessions = useStore(
    (s) => Object.keys(s.model.sessions).length > 0 || s.history.length > 0,
  );
  const mode = useStore((s) => s.mode);

  const openSettings = useStore((s) => s.openSettings);

  useEffect(() => {
    void connect();
  }, [connect]);

  // `#settings` opens the sheet directly — handy for support and screenshots.
  useEffect(() => {
    const sync = () => openSettings(window.location.hash === "#settings");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [openSettings]);

  return (
    <div className="app">
      <Sprite />
      <TopBar />
      {hasSessions || mode === "connecting" ? (
        <main className="main">
          <SessionRail />
          <section className="center">
            <Constellation />
            <Timeline />
          </section>
          <Inspector />
        </main>
      ) : (
        <Onboarding />
      )}
      <Settings />
    </div>
  );
}
