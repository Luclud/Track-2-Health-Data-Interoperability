// Unit tests for the e2e HTML helpers (no stack needed).
import { describe, expect, it } from "vitest";
import { classifyAnswerFields, parseForms, parseLinks, visibleText } from "../e2e/lib/html.ts";
import { linkIn } from "../e2e/lib/stack.ts";

const PAGE = `<html><head><style>p{}</style></head><body>
<h1>Anfrage für Dr. Eva Brandl</h1><a class="btn" href="/r/abc/login?x=1&amp;y=2">Mit e-ID anmelden</a>
<form method="POST" action="/r/abc/answer" enctype="multipart/form-data">
  <input type="hidden" name="csrf" value="t0k">
  <label>Vorname <input name="patientGiven" type="text"></label>
  <input name="patientFamily"><input type="date" name="patientBirthDate">
  <input type="file" name="file" accept=".md,.txt">
  <textarea name="content">&lt;leer&gt;</textarea><button type="submit">Senden</button>
</form></body></html>`;

describe("e2e html helpers", () => {
  it("finds links with decoded hrefs", () => {
    expect(parseLinks(PAGE)).toEqual([{ href: "/r/abc/login?x=1&y=2", text: "Mit e-ID anmelden" }]);
  });

  it("parses forms and classifies answer fields", () => {
    const [form] = parseForms(PAGE);
    expect(form).toMatchObject({ action: "/r/abc/answer", method: "post", enctype: "multipart/form-data" });
    expect(form!.fields.find((f) => f.name === "content")?.value).toBe("<leer>");
    expect(classifyAnswerFields(form!)).toEqual({ given: "patientGiven", family: "patientFamily", birthDate: "patientBirthDate", text: "content", file: "file" });
  });

  it("extracts visible text without styles", () => {
    expect(visibleText(PAGE)).toContain("Anfrage für Dr. Eva Brandl");
    expect(visibleText(PAGE)).not.toContain("p{}");
  });

  it("finds the portal link in an email body", () => {
    const t = "Bitte öffnen Sie diesen Link:\nhttp://localhost:3000/r/AbC_def-0123456789xyzXYZ\nReferenz: BT-7K2Q";
    expect(linkIn(t)).toEqual({ url: "http://localhost:3000/r/AbC_def-0123456789xyzXYZ", token: "AbC_def-0123456789xyzXYZ" });
  });
});
