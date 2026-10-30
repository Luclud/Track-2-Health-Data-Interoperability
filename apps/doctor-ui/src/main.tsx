// Dev Matrix — UI-1..UI-3. One codebase, two modes (see env.ts):
//   widget mode     — inside Element; auth via matrix-widget-api OpenID token
//   standalone mode — ?mode=standalone; simulated room timeline, auth via X-Dev-User
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { readEnv } from "./env.ts";
import { createApi } from "./api/index.ts";
import { NewRequestForm } from "./components/NewRequestForm.tsx";
import { RequestsPanel } from "./components/RequestsPanel.tsx";

function App() {
  const env = useMemo(() => readEnv(), []);
  const api = useMemo(() => createApi(env), [env]);
  const [lastCreated, setLastCreated] = useState<string | undefined>();
  const [tab, setTab] = useState<"new" | "list">("new");
  return (
    <div className={`app mode-${env.mode}`}>
      <header className="topbar">
        <svg className="logo" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        <span className="brand">Brieftaube</span>
        <span className="muted sub">Dokumente sicher von außen anfordern</span>
        {env.mock && <span className="chip neutral">Demo-Daten</span>}
      </header>
      <nav className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "new"} className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>
          Neue Anfrage
        </button>
        <button type="button" role="tab" aria-selected={tab === "list"} className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>
          Anfragen
        </button>
      </nav>
      <main className="panels">
        {tab === "new" ? (
          <NewRequestForm api={api} roomId={env.roomId} onCreated={(r) => setLastCreated(r.id)} />
        ) : (
          <RequestsPanel api={api} roomId={env.roomId} refreshKey={lastCreated} />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
