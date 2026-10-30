// Drives the outside person's flow over HTTP: link -> mock eID -> answer form -> submit.
// Discovers links and forms from the HTML so it does not depend on exact markup.
import { classifyAnswerFields, parseLinks, visibleText, type HtmlForm } from "./html.ts";
import { Browser, type Page } from "./browser.ts";

export type Person =
  | { persona: "eva-brandl" | "stefan-kern" | "thomas-gruber" | "ines-fremd" }
  | { given: string; family: string; birthDate: string };

export class OutsidePerson {
  readonly browser = new Browser();
  landing?: Page;
  afterLogin?: Page;

  constructor(readonly link: string) {}

  /** Opens the link (audit: link-opened). */
  async open(): Promise<Page> {
    this.landing = await this.browser.get(this.link);
    if (this.landing.status >= 400) throw new Error(`Landing page ${this.link} -> ${this.landing.status}`);
    return this.landing;
  }

  /** Starts the eID login from the landing page and logs in at the mock eID. Returns the page after the callback. */
  async loginWithEid(person: Person): Promise<Page> {
    const landing = this.landing ?? (await this.open());
    const authorize = await this.reachAuthorize(landing);
    const u = new URL(authorize.url);
    const state = u.searchParams.get("state") ?? "";
    const redirectUri = u.searchParams.get("redirect_uri") ?? "";
    const fields: Record<string, string> =
      "persona" in person ? { state, redirect_uri: redirectUri, persona: person.persona } : { state, redirect_uri: redirectUri, ...person };
    this.afterLogin = await this.browser.request(new URL("/mock-eid/login", authorize.url).toString(), {
      method: "POST",
      body: new URLSearchParams(fields).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    return this.afterLogin;
  }

  private async reachAuthorize(landing: Page): Promise<Page> {
    if (new URL(landing.url).pathname.startsWith("/mock-eid/authorize")) return landing;
    const isEid = (s: string) => /mock-eid|e-?id|login|anmeld|identit/i.test(s);
    const form = this.browser.forms(landing).find((f) => isEid(f.action) || isEid(f.html));
    const link = parseLinks(landing.html).find((l) => isEid(l.href) || isEid(l.text));
    let next: Page | undefined;
    if (link) next = await this.browser.get(new URL(link.href, landing.url).toString());
    else if (form) next = await this.browser.submit(landing, form, {});
    if (!next || !new URL(next.url).pathname.startsWith("/mock-eid/authorize")) {
      throw new Error(`Could not reach /mock-eid/authorize from ${landing.url}. Visited: ${this.browser.history.join(" -> ")}`);
    }
    return next;
  }

  /** Finds the answer form (on the current page or behind a link). undefined if there is none. */
  async answerForm(): Promise<{ page: Page; form: HtmlForm } | undefined> {
    const start = this.afterLogin ?? this.landing;
    if (!start) return undefined;
    const find = (p: Page) => this.browser.forms(p).find((f) => f.method === "post" && (classifyAnswerFields(f).text || classifyAnswerFields(f).file));
    let form = find(start);
    if (form) return { page: start, form };
    const link = parseLinks(start.html).find((l) => /answer|antwort|dokument|senden/i.test(l.href + l.text));
    if (!link) return undefined;
    const page = await this.browser.get(new URL(link.href, start.url).toString());
    form = find(page);
    return form ? { page, form } : undefined;
  }

  /** Fills and submits the answer form. Throws if there is no form. */
  async submitAnswer(a: { given: string; family: string; birthDate: string; content: string; fileName: string }): Promise<Page> {
    const found = await this.answerForm();
    if (!found) throw new Error(`No answer form found. Visited: ${this.browser.history.join(" -> ")}`);
    const c = classifyAnswerFields(found.form);
    const values: Record<string, string> = {};
    if (c.given) values[c.given] = a.given;
    if (c.family) values[c.family] = a.family;
    if (c.birthDate) values[c.birthDate] = a.birthDate;
    const files: Record<string, [string, string]> = {};
    if (c.text) values[c.text] = a.content;
    else if (c.file) files[c.file] = [a.fileName, a.content];
    return this.browser.submit(found.page, found.form, values, files);
  }

  /** Tries to POST an answer directly to /r/:token/answer without a valid session (must be refused). */
  async forceAnswer(content: string): Promise<Page> {
    return this.browser.request(`${this.link}/answer`, {
      method: "POST",
      body: new URLSearchParams({ patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12", content }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  }
}

export const text = (p: Page | undefined) => (p ? visibleText(p.html) : "");
