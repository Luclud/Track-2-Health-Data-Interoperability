import { useEffect, useRef } from "react";
import type { Api } from "../api/client.ts";
import { formatTime } from "../format.ts";
import { safeHtml } from "../safeHtml.ts";
import { usePolling } from "./usePolling.ts";

/** Standalone mode only: a read-only stand-in for the Matrix room, fed by /api/chat/messages. */
export function RoomTimeline({ api, roomId, roomName }: { api: Api; roomId: string; roomName: string }) {
  const { data, error } = usePolling(() => api.chatMessages(roomId), [api, roomId]);
  const end = useRef<HTMLDivElement>(null);
  const count = data?.length ?? 0;
  useEffect(() => {
    // Newer browsers return a Promise from scrollIntoView; an effect must not return it.
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  return (
    <section className="card room" aria-label="Raum-Verlauf">
      <header className="room-head">
        <span className="room-avatar" aria-hidden>
          #
        </span>
        <div>
          <b>{roomName}</b>
          <div className="muted small">Simulierter Matrix-Raum</div>
        </div>
      </header>
      <div className="room-body">
        {error && <div className="banner alert">Nachrichten konnten nicht geladen werden: {error}</div>}
        {data && data.length === 0 && <p className="muted small">Noch keine Nachrichten.</p>}
        {data?.map((m) => (
          <article key={m.id} className={`msg sev-${m.severity}`}>
            <div className="msg-meta">
              <b>{m.sender.startsWith("@brieftaube") ? "Brieftaube" : m.sender}</b>
              <span className="muted small">{formatTime(m.sentAt)}</span>
            </div>
            {m.html ? <div className="msg-body" dangerouslySetInnerHTML={{ __html: safeHtml(m.html) }} /> : <div className="msg-body">{m.body}</div>}
          </article>
        ))}
        <div ref={end} />
      </div>
    </section>
  );
}
