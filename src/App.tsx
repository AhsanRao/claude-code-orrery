import { useEffect } from "react";
import { useStore } from "./store";
import { Sprite } from "./components/Icons";
import { TopBar } from "./components/TopBar";
import { SessionRail } from "./components/SessionRail";
import { Constellation } from "./components/Constellation";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { Onboarding } from "./components/Onboarding";

export default function App() {
  const connect = useStore((s) => s.connect);
  const hasSessions = useStore((s) => Object.keys(s.model.sessions).length > 0);
  const mode = useStore((s) => s.mode);

  useEffect(() => {
    void connect();
  }, [connect]);

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
    </div>
  );
}
