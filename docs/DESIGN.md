# Design decisions and rules

This file is the source of truth for behaviour. If code and this file disagree, this file wins (or open a PR to change it, with a reason). The README's five design answers are drafted at the end.

## 1. Identity policy

Two independent checks:

| Check | Question | Catches |
|---|---|---|
| **Responder identity** | Is the person answering the named recipient? | M1 wrong address, M2 forwarded email |
| **Patient match** | Is the document about the requested patient? | M3 wrong patient |

Possessing the link is a necessary factor (it proves access to the mailbox/phone), but never sufficient.

### Policy per document type

| Document type | Policy id | Required | Why |
|---|---|---|---|
| `lab-result` | `eid-high+register` | eID (LoA high) + name match + recipient listed in the physician register (if `isPhysician`) | Lab values directly drive clinical decisions (here: a procedure). The lab result is validated by a physician, so we can check her against a public register. |
| `rehab-discharge-report` | `eid-high` | eID (LoA high) + name match | The sender (discharge manager) is not a physician, so there is no register to check. The author (Dr. Leitner) is taken from the document and recorded as author; the verified sender is recorded separately. |

If `isPhysician` is false for a lab request, the register check is skipped and the Provenance says so.

### Name matching (`matchesRecipient`)

- Normalise both names: lowercase, remove diacritics (NFD), `ß → ss`, drop titles (`dr`, `prof`, `mag`, `dipl`, `ing`, `med`, `univ`, `msc`, `phd`, `md`, trailing dots), collapse whitespace and hyphens.
- Match if family names are equal **and** the first given name is equal. Additional middle names may be missing on one side.
- `"Dr. Eva Brandl"` matches eID `{given:["Eva"], family:"Brandl"}`. `"Dr. Thomas Gruber"` does not.
- Doctor types the recipient as one string; core parses it: last token = family, rest = given, recognised titles → prefix.

### Register check outcomes

- Listed → policy satisfied, registration number goes into Practitioner.identifier and Provenance narrative.
- Not listed → answer is **held** (`heldReason: "not-in-register"`), not filed; Dr. Hofer sees it in Matrix and can release or reject (P2). (We do not block the answer, because a jury person may not be in our mock register; holding keeps a human in the loop.)

### What the outside person sees

| Stage | Visible |
|---|---|
| Email/SMS | requester name, clinic, recipient name, reference, link, expiry. **No patient name, no birth date, no document type, no medical words** (enforced by `assertNotificationIsClean`). |
| Landing page before eID | the same + "Bitte bestätigen Sie Ihre Identität". |
| After failed eID | "Wir konnten nicht bestätigen, dass Sie <recipient> sind. Die Anfrage wurde nicht angezeigt. Dr. Hofer wurde informiert." Nothing else. |
| After successful eID | patient name + birth date, document type (German label), note from Dr. Hofer, answer form. |

## 2. Misdelivery detection

| Test | Mechanism | Result | Audit | Matrix |
|---|---|---|---|---|
| M1 typo address `labor-kanaI.example` | (a) pre-send: `recipient-check` warns about an uppercase letter / confusable characters and an unknown contact; doctor can still send. (b) stranger logs in with eID → name mismatch → nothing shown, cannot answer. | blocked | `identity-checked` (failure) + `misdelivery-caught` (identity-mismatch) | ⚠ warning to Dr. Hofer |
| M2 forwarded to colleague | colleague's eID name (Thomas Gruber) ≠ Eva Brandl → blocked before seeing anything | blocked, not filed | same as M1 | ⚠ "jemand anderer als Dr. Eva Brandl" |
| M3 wrong patient (Max Beispiel, 1960-01-01) | form fields and parsed document compared with the request's patient (family + first given + birth date). Mismatch in either → reject. | not filed for Maria; responder told to check the document; request stays open | `answer-sent` + `misdelivery-caught` (wrong-patient) | 🛑 alert: "Antwort zu BT-XXXX betrifft eine andere Person (Max Beispiel, geb. 01.01.1960) – nicht abgelegt." |
| extra: wrong document type | parsed kind ≠ requested type → reject | not filed | `misdelivery-caught` (wrong-document-type) | 🛑 alert |

Note on M3: Max and Maria share the family name "Beispiel". Matching on family name alone would have filed an INR of 2.6 (anticoagulated) into Maria's record before her procedure. This is the clinical point for the pitch.

### Confusable / suspicious address check (pre-send)

Warn (never block) when:
- the address contains an uppercase letter (domains and most local parts are lower-case in practice) — catches `kanaI`;
- the address mixes scripts or contains look-alike characters (`I`/`l`/`1`, `O`/`0`, Cyrillic letters);
- the requester has never sent to this address before (`unknown-contact`);
- the recipient's family name does not appear in the local part (`name-not-in-address`) — soft hint only.

## 3. Reading the answer

1. **Deterministic parser first** (`services/core/src/parser`). Formats: see `scenario/documents/*.md`. Must also handle the jury's "other documents in the same format": other names, values, LOINC codes, units, number of rows, German month names, missing optional lines, extra blank lines, `\r\n`.
2. **LLM fallback** only if the parser returns `ok:false` and `LLM_PROVIDER != none`. Output is a JSON object matching the same `ParsedDocument` shape (JSON schema in `services/core/src/llm/schema.ts`).
3. **Verification of LLM output** (all must pass, otherwise `unreadable`):
   - every numeric value, every reference-range bound and every LOINC code appears literally in the source text;
   - LOINC codes pass the LOINC mod-10 check digit;
   - patient family name, given name and birth date appear in the source text (any supported date format);
   - dates parse.
4. LLM-read documents are **never filed automatically**: status `held` (`ai-extracted`), Dr. Hofer confirms in the widget (P2). In Matrix: "KI-gelesen – bitte Werte prüfen".
5. Without an LLM, an unreadable document is rejected with a friendly message to the responder ("bitte im Standardformat senden") and a Matrix notice.

### Parser rules

- Title line `# <Organization>: <kind>`; `lab report` → lab-result, `discharge report` → rehab-discharge-report.
- `Patient: <Given...> <Family>, born <D> <Month> <YYYY>` (English or German month names).
- Lab: `Sample taken:` / `Reported:` `<D> <Month> <YYYY>, <HH:MM>` → ISO 8601 in Europe/Vienna (CEST/CET correctly, e.g. `2026-10-22T08:10:00+02:00`).
- Lab table: columns Test | Result | Unit | Reference range | LOINC code (match by header name, not position). Range `A to B` (also `A - B`, `A–B`, `<B`, `>A`).
- Units → UCUM: `10^9/L → 10*9/L`, `10^12/L → 10*12/L`, `s → s`, `g/L`, `g/dL`, `mg/dL`, `mmol/L`, `µmol/L|umol/L → umol/L`, `U/L`, `%`, empty (INR) → `{INR}` for LOINC 6301-6 else `1`. Unknown unit → Quantity with `unit` only (no `system`/`code`) — this is valid FHIR.
- The sentence after the table → `conclusion`. `Validated by: <name>, <role>`.
- Rehab: `Stay: 2 to 23 September 2026` (also `2 September to 3 October 2026`, cross-year), `Reason:`, `Written by:`, `Sent by:`.

## 4. Notifications (templates, German)

Email — subject: `Sichere Anfrage von Klinikum Beispielstadt (Ref. BT-7K2Q)`

```
Guten Tag Dr. Eva Brandl,

Dr. Lena Hofer (Klinikum Beispielstadt) hat Ihnen eine sichere Anfrage gesendet.

Bitte öffnen Sie diesen Link und bestätigen Sie Ihre Identität:
http://localhost:3000/r/<token>

Referenz: BT-7K2Q · gültig bis 02.11.2026, 09:05
Sie benötigen kein Konto und müssen nichts installieren.

Sind Sie nicht Dr. Eva Brandl? Dann leiten Sie diese Nachricht bitte nicht weiter und löschen Sie sie.
```

SMS (≤ 160 chars if possible):
`Klinikum Beispielstadt: sichere Anfrage von Dr. Lena Hofer für Stefan Kern. Ref. BT-3MX9: http://localhost:3000/r/<token>`

## 5. Audit (six steps)

| Step | When | Who | What (example) |
|---|---|---|---|
| `request-sent` | notification sent | Dr. Hofer (Matrix id) | "Request BT-7K2Q for a lab result sent by email to eva.brandl@…" |
| `link-opened` | GET /r/:token | unverified visitor (ip hash, user agent) | "Link of BT-7K2Q opened" |
| `identity-checked` | eID callback | verified person (bPK) | "Identity confirmed: Eva Brandl, LoA high, register listed" / failure "Ines Fremd is not Eva Brandl" |
| `answer-sent` | POST answer received | verified person | "Answer received: lab-result-maria-beispiel.md, 812 bytes, sha256 …" |
| `answer-filed` | FHIR transaction ok | system | "Filed DiagnosticReport/…, 4 Observations, Provenance/… for Patient/maria-beispiel" |
| `misdelivery-caught` | any catch | the actor that triggered it | "Wrong patient: document is about Max Beispiel (1960-01-01), request is about Maria Beispiel (1961-03-12)" |

Stored: SQLite table `audit` + `data/audit.jsonl` (one JSON per line, human-readable) + FHIR `AuditEvent` (best effort; failure to mirror never blocks the flow, but is itself logged). Shape: `fhir-examples/auditevent-*.json`.

## 6. Matrix messages (German, in the doctor's room)

- 📨 `Anfrage BT-7K2Q an Dr. Eva Brandl (E-Mail) gesendet – Laborbefund für Maria Beispiel.`
- ⚠️ `BT-7K2Q: Jemand anderer als Dr. Eva Brandl hat versucht, die Anfrage zu öffnen (verifiziert als: Ines Fremd). Es wurde nichts angezeigt. Bitte Adresse prüfen: eva.brandl@labor-kanaI.example`
- ✅ `BT-7K2Q: Laborbefund von Dr. Eva Brandl abgelegt. INR 1.0 (0.8–1.2) · aPTT 31 s · Thrombozyten 245 · Fibrinogen 3.1 g/L – alle im Referenzbereich. Identität: ID Austria (simuliert), Ärzteliste ✓`
- 🛑 `BT-7K2Q: Antwort betrifft eine andere Person (Max Beispiel, geb. 01.01.1960) – NICHT abgelegt. Dr. Eva Brandl wurde gebeten, das richtige Dokument zu senden.`
- ⏸ `BT-7K2Q: Antwort wartet auf Ihre Freigabe (Grund: …)`

The Matrix room is inside the closed network, so patient names are allowed here.

## 7. Where it runs

At the clinic (the requester), next to its homeserver. Reasons: the clinic requested the data and is the controller for the filed copy; no third party sees patient data; the outside side needs only a browser. A PGK-wide shared instance is possible later (multi-tenant) but not needed.

## Draft answers for the README "Your design" section

1. **Proof of identity without a directory:** possession of a single-use, expiring link sent to the one contact Dr. Hofer knows, **plus** an eID login (ID Austria, simulated) whose verified name must match the named recipient; physicians are additionally checked against the physician register.
2. **Check per document type:** lab result → eID LoA high + name match + physician register; rehab discharge report → eID LoA high + name match (sender is not a physician; the authoring physician is recorded from the document). Reason: lab values drive immediate decisions and are signed by a physician who can be checked publicly.
3. **FHIR resources:** Task (the request) → on filing: lab = DiagnosticReport + Observations (LOINC, UCUM, reference ranges, interpretation) + Practitioner + Organization; rehab = DocumentReference (Markdown attached) + Practitioners (author, sender) + Organization; always one Provenance targeting all filed resources (author, sender/informant, assembler; signature = identity check; policy = identity policy) and AuditEvents for the six steps. Everything references `Patient/maria-beispiel`. See docs/FHIR-MAPPING.md.
4. **Misdelivery:** identity mismatch at eID (M1, M2), pre-send address warnings (M1), patient match on form + document (M3), document type match.
5. **Where it runs:** at the clinic, next to its Matrix homeserver.
