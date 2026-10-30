// Tiny HTML helpers for server-rendered pages (portal, mock eID, SMS simulator). No framework.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Marker for already-escaped HTML so it is not escaped twice. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Tagged template: interpolated values are escaped unless they are SafeHtml (or arrays of it). */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? "");
  });
  return new SafeHtml(out);
}

function render(v: unknown): string {
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === undefined || v === null || v === false) return "";
  return esc(v);
}

export function page(opts: { title: string; body: SafeHtml; css?: string; head?: SafeHtml }): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(opts.title)}</title>
<link rel="stylesheet" href="${esc(opts.css ?? "/r/static/portal.css")}">
${opts.head?.value ?? ""}
</head>
<body>
${opts.body.value}
</body>
</html>`;
}
