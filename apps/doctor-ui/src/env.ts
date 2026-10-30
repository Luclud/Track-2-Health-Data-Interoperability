// URL parameters decide how the doctor UI runs.
//   widget mode     — inside Element: ?roomId=…&userId=…&widgetId=…&parentUrl=… (template vars filled by Element)
//   standalone mode — ?mode=standalone (demo website, no Element)
//   mock            — ?mock=1 uses the in-browser mock API (no core needed); with &jury=1 the mock runs in jury mode
export const STANDALONE_ROOM_ID = "!standalone:klinikum.example";
export const DEV_USER = "@lena.hofer:klinikum.example";

export interface UiEnv {
  mode: "widget" | "standalone";
  mock: boolean;
  /** Mock only: pretend the core runs with JURY_MODE=true */
  mockJury: boolean;
  roomId: string;
  userId: string;
  widgetId?: string;
  parentUrl?: string;
}

export function readEnv(search: string = window.location.search): UiEnv {
  const p = new URLSearchParams(search);
  const widgetId = p.get("widgetId") ?? undefined;
  const parentUrl = p.get("parentUrl") ?? undefined;
  const mode = p.get("mode") === "standalone" || !widgetId ? "standalone" : "widget";
  return {
    mode,
    mock: p.get("mock") === "1",
    mockJury: p.get("jury") === "1",
    roomId: p.get("roomId") || STANDALONE_ROOM_ID,
    userId: p.get("userId") || DEV_USER,
    widgetId,
    parentUrl,
  };
}
