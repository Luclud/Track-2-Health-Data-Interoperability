// Dev Matrix — UI-1..UI-3. One codebase, two modes (see env.ts):
//   widget mode     — inside Element; auth via matrix-widget-api OpenID token (Bearer)
//   standalone mode — ?mode=standalone; simulated room timeline on the left, auth via X-Dev-User
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MeResponse } from "@brieftaube/shared";
import "./styles.css";
import { readEnv } from "./env.ts";
import { createApi } from "./api/index.ts";
import { createWidgetAuth } from "./widget/auth.ts";
import { NewRequestForm } from "./components/NewRequestForm.tsx";
import { RequestsPanel } from "./components/RequestsPanel.tsx";
import { RoomTimeline } from "./components/RoomTimeline.tsx";

const ROOM_NAME = "Anfragen – Dr. Hofer";

function App() {
  const env = useMemo(() => readEnv(), []);
  const api = useMemo(() => createApi(env, env.mode === "widget" && !env.mock ? createWidgetAuth(env) : undefined), [env]);
  const [me, setMe] = useState<MeResponse | undefined>();
  const [authError, setAuthError] = useState<string | undefined>();
  const [lastCreated, setLastCreated] = useState<string | undefined>();
  const [tab, setTab] = useState<"new" | "list">("new");

  useEffect(() => {
    api.me().then(setMe, (e: unknown) => setAuthError((e as Error).message));
  }, [api]);

  const panels = (
    <div className="panel-col">
      <nav className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "new"} className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>
          Neue Anfrage
        </button>
        <button type="button" role="tab" aria-selected={tab === "list"} className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>
          Anfragen
        </button>
      </nav>
      <div className="panels">
        {tab === "new" ? (
          <NewRequestForm api={api} roomId={env.roomId} onCreated={(r) => setLastCreated(r.id)} />
        ) : (
          <RequestsPanel api={api} roomId={env.roomId} refreshKey={lastCreated} />
        )}
      </div>
    </div>
  );

  return (
    <div className={`app mode-${env.mode}`}>
      <header className="topbar">
        <svg className="logo" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="brand">Brieftaube</span>
        <span className="muted sub">Dokumente sicher von außen anfordern</span>
        <span className="spacer" />
        {env.mock && <span className="chip neutral">Demo-Daten</span>}
        {me && <span className="muted small">{me.displayName}</span>}
      </header>
      {authError && (
        <div className="banner alert global" role="alert">
          Anmeldung fehlgeschlagen: {authError}
        </div>
      )}
      {env.mode === "standalone" ? (
        <div className="split">
          <RoomTimeline api={api} roomId={env.roomId} roomName={ROOM_NAME} />
          {panels}
        </div>
      ) : (
        panels
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
