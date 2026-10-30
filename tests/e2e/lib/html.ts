// Tiny, dependency-free HTML helpers so the e2e tests can drive the server-rendered portal
// without knowing its exact markup (it is built in parallel, OUT-3).

export interface FormField {
  tag: "input" | "textarea" | "select";
  name: string;
  type: string;
  value: string;
}
export interface HtmlForm {
  action: string;
  method: "get" | "post";
  enctype: string;
  fields: FormField[];
  html: string;
}
export interface HtmlLink {
  href: string;
  text: string;
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : undefined;
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Visible text of a page (tags, scripts and styles removed, entities decoded, whitespace collapsed). */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function parseForms(html: string): HtmlForm[] {
  const forms: HtmlForm[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const open = `<form${m[1] ?? ""}>`;
    const body = m[2] ?? "";
    const fields: FormField[] = [];
    for (const f of body.matchAll(/<(input|select)\b[^>]*>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
      const tag = f[0];
      const kind = (f[1]?.toLowerCase() ?? "textarea") as FormField["tag"];
      const name = attr(tag, "name");
      if (!name) continue;
      const type = (kind === "input" ? attr(tag, "type") ?? "text" : kind).toLowerCase();
      const value = kind === "textarea" ? decodeEntities(f[3] ?? "") : attr(tag, "value") ?? "";
      fields.push({ tag: kind, name, type, value });
    }
    forms.push({
      action: attr(open, "action") ?? "",
      method: (attr(open, "method") ?? "get").toLowerCase() === "post" ? "post" : "get",
      enctype: (attr(open, "enctype") ?? "application/x-www-form-urlencoded").toLowerCase(),
      fields,
      html: m[0],
    });
  }
  return forms;
}

export function parseLinks(html: string): HtmlLink[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap((m) => {
    const href = attr(`<a${m[1] ?? ""}>`, "href");
    return href ? [{ href, text: visibleText(m[2] ?? "") }] : [];
  });
}

/** Which form field holds what, guessed from field names (German or English). */
export function classifyAnswerFields(form: HtmlForm): {
  given?: string;
  family?: string;
  birthDate?: string;
  text?: string;
  file?: string;
} {
  const visible = form.fields.filter((f) => f.type !== "hidden" && f.type !== "submit");
  const by = (re: RegExp) => visible.find((f) => re.test(f.name))?.name;
  return {
    given: by(/given|vorname|first/i),
    family: by(/family|nachname|surname|last/i),
    birthDate: by(/birth|geburt|dob/i) ?? visible.find((f) => f.type === "date")?.name,
    text: visible.find((f) => f.tag === "textarea")?.name,
    file: visible.find((f) => f.type === "file")?.name,
  };
}
