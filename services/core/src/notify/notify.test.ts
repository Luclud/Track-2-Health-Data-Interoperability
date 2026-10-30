import Fastify from "fastify";
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import type { Deps } from "../container.ts";
import { assertOutboundIsClean, MemorySender, SmtpSender } from "./index.ts";
import { PrivacyViolationError } from "./privacy.ts";
import { linkify, registerNotifyRoutes } from "./routes.ts";

const cfg = { smtpHost: "localhost", smtpPort: 1025, mailFrom: "Brieftaube <no-reply@klinikum.example>" };
const cleanEmail = {
  channel: "email" as const,
  to: "eva.brandl@labor-kanal.example",
  subject: "Sichere Anfrage von Klinikum Beispielstadt (Ref. BT-7K2Q)",
  text: "Guten Tag Dr. Eva Brandl,\n\nDr. Lena Hofer (Klinikum Beispielstadt) hat Ihnen eine sichere Anfrage gesendet.\n\nhttp://localhost:3000/r/inrKURreha_lab-xyz\n\nReferenz: BT-7K2Q · gültig bis 02.11.2026, 09:05",
};

describe("SmtpSender", () => {
  it("sends through the transport with from, subject and text", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const res = await new SmtpSender(cfg, transport).send(cleanEmail);
    expect(res.providerMessageId).toMatch(/@/);
  });

  it("refuses a message with a document word (defensive check)", async () => {
    let sent = 0;
    const transport = { sendMail: async () => { sent++; return { messageId: "x" }; } } as unknown as nodemailer.Transporter;
    await expect(new SmtpSender(cfg, transport).send({ ...cleanEmail, text: "Bitte senden Sie den Laborbefund." })).rejects.toBeInstanceOf(PrivacyViolationError);
    await expect(new SmtpSender(cfg, transport).send({ ...cleanEmail, subject: "Reha-Entlassungsbericht" })).rejects.toBeInstanceOf(PrivacyViolationError);
    expect(sent).toBe(0);
  });
});

describe("assertOutboundIsClean", () => {
  it("ignores the random portal token and the recipient address", () => {
    expect(() => assertOutboundIsClean(cleanEmail)).not.toThrow();
  });
  it("still flags medical words in the text", () => {
    expect(() => assertOutboundIsClean({ channel: "sms", to: "+43 660 1234567", text: "Ihr Befund ist da" })).toThrow(PrivacyViolationError);
  });
});

describe("SMS simulator", () => {
  it("lists SMS newest first with clickable, escaped links", async () => {
    const sms = new MemorySender();
    await sms.send({ channel: "sms", to: "+436601111111", text: "Erste Nachricht http://localhost:3000/r/aaa" });
    await sms.send({ channel: "sms", to: "+436602222222", text: "Zweite <b>Nachricht</b>: http://localhost:3000/r/bbb." });
    const app = Fastify();
    await registerNotifyRoutes(app, { sms } as unknown as Deps);
    const res = await app.inject({ url: "/dev/sms" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<a href="http://localhost:3000/r/bbb">');
    expect(res.body).toContain("&lt;b&gt;Nachricht&lt;/b&gt;");
    expect(res.body.indexOf("/r/bbb")).toBeLessThan(res.body.indexOf("/r/aaa"));
    const json = await app.inject({ url: "/api/dev/sms" });
    expect(json.json()).toHaveLength(2);
  });

  it("linkify keeps trailing punctuation outside the link", () => {
    expect(linkify("Link: https://x.example/r/a?b=1&c=2.").value).toBe('Link: <a href="https://x.example/r/a?b=1&amp;c=2">https://x.example/r/a?b=1&amp;c=2</a>.');
  });
});
