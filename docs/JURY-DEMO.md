# Jury demo (pitch script)

Goal: a judge becomes the outside person **live, on their own phone**. Dr. Lena Hofer (laptop, Element) asks for a lab result, the judge scans a QR code, logs in with the simulated e-ID, sends the document, and the result lands in the Element room as ✅ with a values table.

## Before the pitch (15 min ahead)

1. `scripts/jury.sh` — stack up → seed → UI build → Cloudflare quick tunnel → core with `JURY_MODE=true`, Matrix chat/auth, SMTP (Mailpit).
   - Prints the public `https://….trycloudflare.com` URL and a terminal QR of it. Wait for `Ready.`
   - `cloudflared` is used from `PATH`, else downloaded once into `~/.cache/brieftaube/`. Tunnel log: `~/.cache/brieftaube/tunnel.log`.
   - A fresh quick-tunnel hostname can take up to ~1 min until it resolves. The script waits up to ~90 s and warns if it is still not reachable.
2. Open Element at http://localhost:8080 (lena.hofer / demo-lena-2026), room "Anfragen – Dr. Hofer", open the Brieftaube widget.
3. **Test once with your own phone** (mobile data, not the venue Wi-Fi): scan the terminal QR → the page must load over https. Then do one full run (Jury-Schnellauswahl → QR → e-ID → Beispielbefund einsetzen → senden) and check the ✅ in Element.
4. Phone screen brightness up; laptop: Element zoom 125 %, notifications off.

## During the pitch (≈ 3 min)

1. "Wie heißen Sie?" — ask the judge's name.
2. Widget → **Jury-Schnellauswahl** (patient Maria Beispiel, Laborbefund, e-mail `jury@demo.example`). Type the judge's name as recipient, exactly as the judge will type it at the e-ID step (otherwise the name check blocks them, M2 path) → **Anfrage senden**.
3. The QR modal appears. Note on screen: in real operation this link only goes out by e-mail/SMS. Judge scans it.
4. Judge on the phone: e-ID (simulated) → **Andere Person** → types their own name and birth date → answer page → **Beispielbefund einsetzen (Demo)** → patient Maria Beispiel, 12.03.1961 → **senden**.
   - The judge is not in the physician register, so the answer is **held** ("Nicht in der Ärzteliste – bitte prüfen"): show the review with evidence, then **Freigeben**.
     The review with evidence lines needs V2-AI-1 and V2-UI-1 merged. Before that, the held banner shows only the reason and the release/reject buttons.
5. Element shows ✅ with the table (INR 1,0 · Thrombozyten 245 10⁹/L …) and a link to the FHIR record.
6. Optional second judge: same flow, button **Beispiel: falsche Patientin (Demo)** → 🛑 mismatch, nothing filed.

Talking points: identity first (e-ID), nothing about the patient before the check, wrong patient never filed, every AI-read value shows its source line, every step audited.

## Fallbacks

| Problem | Fallback |
|---|---|
| Tunnel URL not printed / not reachable | `scripts/jury.sh --lan` and put the phone on the laptop's hotspot (or same Wi-Fi). Base URL becomes `http://<LAN IP>:3000`; override the IP with `JURY_LAN_IP=…`. |
| Venue Wi-Fi blocks client-to-client traffic | Laptop hotspot + `--lan`, or the phone's hotspot with the laptop joined to it. |
| Phone can't scan / no network at all | Do the outside part yourself on the laptop: open the link shown under the QR in a second browser window. |
| Nothing works | Pre-recorded video of the full flow. |

## Notes

- `JURY_MODE=true` returns the link to the doctor UI so it can show the QR. **Demo only** — the core logs a warning on startup.
- The widget in Element keeps using `http://localhost:3000` (seed runs with the local URL); only links for the outside person use the public URL. The script also sets `EID_ISSUER_URL=<public>/mock-eid` so the e-ID redirect works on the phone.
- Ctrl-C stops core and tunnel; `npm run stack:down` stops Docker. `JURY_SKIP_BUILD=1` reuses `apps/doctor-ui/dist`.
- Verified on a Devin Linux VM: tunnel path (full outside flow over https through `trycloudflare.com`, filed) and `--lan` path (links use the LAN IP, e-ID login works).
