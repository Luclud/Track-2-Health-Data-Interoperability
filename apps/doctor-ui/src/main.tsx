// Account B, Dev Matrix — tasks UI-1..UI-3. See docs/TASKS.md.
// Two modes from ONE codebase:
//   widget mode     — inside Element (URL has widgetId & parentUrl); auth via matrix-widget-api OpenID token
//   standalone mode — ?mode=standalone; shows a simulated room timeline (GET /api/chat/messages), auth via X-Dev-User
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h1>Brieftaube</h1>
      <p>Doctor UI — not implemented yet (UI-1).</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
