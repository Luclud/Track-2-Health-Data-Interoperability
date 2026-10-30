# KI-Auswertung – MOCK (kein echtes Modell)

> **MOCK:** Das "Modell" gibt die Erwartungswerte zurück. Dieser Bericht prüft nur die Messung und die Verifikation, **nicht** die Lesequalität eines echten Modells. Echter Lauf: `LLM_PROVIDER=anthropic LLM_API_KEY=… npm run ai:eval`.

- Anbieter: mock
- Modell: Erwartungswerte aus den Fixtures
- Datum: 30. Oktober 2026 um 06:11
- Weg: nur KI (deterministischer Parser übersprungen), danach Verifikation gegen den Originaltext
- Dokumente: 13

| Dokument | Art | Werte richtig | Werte falsch | Von Verifikation abgelehnt | Patient richtig | Falle (erfundener Wert) abgelehnt |
|---|---|---|---|---|---|---|
| `tests/fixtures/documents/free-text-letter-not-in-format.md` | Labor | 4/4 | 0 | nein | ja | ja |
| `tests/fixtures/documents/lab-columns-reordered.md` | Labor | 3/3 | 0 | nein | ja | ja |
| `tests/fixtures/documents/lab-crlf-line-endings.md` | Labor | 4/4 | 0 | nein | ja | ja |
| `tests/fixtures/documents/lab-different-patient-martina.md` | Labor | 4/4 | 0 | nein | ja | ja |
| `tests/fixtures/documents/lab-donaustadt-crp-hb-creatinine.md` | Labor | 5/5 | 0 | nein | ja | ja |
| `tests/fixtures/documents/lab-extra-blank-lines.md` | Labor | 4/4 | 0 | nein | ja | ja |
| `tests/fixtures/documents/lab-german-month-names.md` | Labor | 4/4 | 0 | nein | ja | ja |
| `tests/fixtures/documents/lab-without-requested-by.md` | Labor | 3/3 | 0 | nein | ja | ja |
| `tests/fixtures/documents/rehab-cross-year-stay.md` | Reha | – | – | nein | ja | ja |
| `tests/fixtures/documents/rehab-seeblick-cross-month.md` | Reha | – | – | nein | ja | ja |
| `scenario/documents/lab-result-maria-beispiel.md` | Labor | 4/4 | 0 | nein | ja | ja |
| `scenario/documents/lab-result-max-beispiel.md` | Labor | 4/4 | 0 | nein | ja | ja |
| `scenario/documents/rehab-report-maria-beispiel.md` | Reha | – | – | nein | ja | ja |

## Summe

- Werte richtig: 39 von 39
- Werte falsch: 0
- Dokumente von der Verifikation abgelehnt: 0 von 13
- Patient richtig: 13 von 13 angenommenen Dokumenten
- Falle abgelehnt: 13 von 13
- Werte ohne Beleg im Original abgelegt: 0

KI-gelesene Dokumente werden nie automatisch abgelegt: Sie warten auf die Freigabe durch Dr. Hofer (mit Beleg-Zeile je Wert).
