const ALLOWED = new Set(["b", "strong", "i", "em", "br", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "code"]);

/** Keep only the simple tags ChatMessageView.html may contain; strip all attributes. */
export function safeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const out = document.createElement("div");
  const walk = (src: Node, dst: Node) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) dst.appendChild(document.createTextNode(n.textContent ?? ""));
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = (n as Element).tagName.toLowerCase();
        if (ALLOWED.has(tag)) {
          const el = document.createElement(tag);
          walk(n, el);
          dst.appendChild(el);
        } else walk(n, dst);
      }
    });
  };
  walk(doc.body.firstChild ?? doc.body, out);
  return out.innerHTML;
}
