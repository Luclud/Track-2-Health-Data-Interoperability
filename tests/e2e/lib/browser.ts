// Minimal "browser": fetch with a cookie jar and manual redirects, so each outside person has their own session.
import { parseForms, type HtmlForm } from "./html.ts";

export interface Page {
  url: string;
  status: number;
  html: string;
}

export class Browser {
  private readonly cookies = new Map<string, string>();
  /** Every URL visited, in order (for debugging failures). */
  readonly history: string[] = [];

  private store(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair?.indexOf("=") ?? -1;
      if (pair && i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  private cookieHeader(): Record<string, string> {
    return this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {};
  }

  async request(url: string, init: { method?: string; body?: RequestInit["body"]; headers?: Record<string, string> } = {}): Promise<Page> {
    let current = url;
    let method = init.method ?? "GET";
    let body: RequestInit["body"] = init.body;
    let headers = init.headers ?? {};
    for (let hop = 0; hop < 10; hop++) {
      this.history.push(`${method} ${current}`);
      const res = await fetch(current, { method, body, headers: { ...headers, ...this.cookieHeader() }, redirect: "manual" });
      this.store(res);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).toString();
        if (res.status !== 307 && res.status !== 308) {
          method = "GET";
          body = undefined;
          headers = {};
        }
        continue;
      }
      return { url: current, status: res.status, html: await res.text() };
    }
    throw new Error(`Too many redirects: ${this.history.slice(-10).join(" -> ")}`);
  }

  get(url: string): Promise<Page> {
    return this.request(url);
  }

  /** Submits a parsed form with the given values (hidden fields are kept). Files: { name: [fileName, content] }. */
  submit(page: Page, form: HtmlForm, values: Record<string, string>, files: Record<string, [string, string]> = {}): Promise<Page> {
    const action = new URL(form.action || page.url, page.url).toString();
    const data: Record<string, string> = {};
    for (const f of form.fields) if (f.type === "hidden" || (f.value && f.type !== "submit" && f.type !== "file")) data[f.name] = f.value;
    Object.assign(data, values);
    if (form.method === "get") {
      const u = new URL(action);
      for (const [k, v] of Object.entries(data)) u.searchParams.set(k, v);
      return this.get(u.toString());
    }
    if (form.enctype.includes("multipart")) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(data)) fd.set(k, v);
      for (const [k, [fileName, content]] of Object.entries(files)) fd.set(k, new Blob([content], { type: "text/markdown" }), fileName);
      return this.request(action, { method: "POST", body: fd });
    }
    return this.request(action, {
      method: "POST",
      body: new URLSearchParams(data).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  }

  forms(page: Page): HtmlForm[] {
    return parseForms(page.html);
  }
}
