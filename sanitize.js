/* Очистка HTML: оставляем только безопасное простое форматирование.
   Защищает сайт от вредного кода и чистит текст, вставленный из Word / Google Docs. */

const KEEP = new Set([
  "H1", "H2", "H3", "H4", "P", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL",
  "UL", "OL", "LI", "BLOCKQUOTE", "A", "SPAN", "HR", "CODE", "PRE", "SUB", "SUP", "MARK", "IMG",
]);
const REMOVE = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "TITLE", "HEAD", "NOSCRIPT",
  "TEMPLATE", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION",
  "VIDEO", "AUDIO", "CANVAS", "FRAME", "FRAMESET", "BASE",
]);
const BLOCKS = "p,div,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table,section,article,hr";
const SIZE = /^fs-(sm|md|lg|xl)$/;
const safeHref = (u) => /^(https?:|mailto:|tel:|#)/i.test(u.trim());
const safeSrc = (u) => /^https:\/\//i.test(u.trim());

export function sanitize(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  walk(doc.body);
  // Убираем пустые теги, которые оставляет браузер при редактировании
  doc.body.querySelectorAll("b,strong,i,em,u,s,strike,del,span,a,mark,sub,sup,code").forEach((el) => {
    if (!el.textContent && !el.querySelector("img,br")) el.remove();
  });
  doc.body.querySelectorAll("p,h1,h2,h3,h4,li,blockquote").forEach((el) => {
    if (!el.childNodes.length) el.remove();
  });
  return doc.body.innerHTML;
}

function unwrap(el) {
  el.replaceWith(...el.childNodes);
}
function rename(el, tag) {
  const n = el.ownerDocument.createElement(tag);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
  return n;
}
function wrapChildren(el, tag) {
  const w = el.ownerDocument.createElement(tag);
  while (el.firstChild) w.appendChild(el.firstChild);
  el.appendChild(w);
}

function walk(parent) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === 3) continue; // текст
    if (node.nodeType !== 1) { node.remove(); continue; } // комментарии и пр.

    let el = node;
    let tag = el.tagName;
    if (REMOVE.has(tag)) { el.remove(); continue; }

    const style = el.getAttribute("style") || "";
    const cls = el.getAttribute("class") || "";

    // Google Docs оборачивает всё в <b style="font-weight:normal">
    if (tag === "B" && /font-weight:\s*(normal|[1-4]00)/i.test(style)) { walk(el); unwrap(el); continue; }

    if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") {
      if (el.querySelector(BLOCKS)) { walk(el); unwrap(el); continue; }
      el = rename(el, "P"); tag = "P";
    }
    if (tag === "H5" || tag === "H6") { el = rename(el, "H4"); tag = "H4"; }
    if (!KEEP.has(tag)) { walk(el); unwrap(el); continue; }

    const href = el.getAttribute("href");
    const src = el.getAttribute("src");
    const alt = el.getAttribute("alt");
    for (const a of [...el.attributes]) el.removeAttribute(a.name);

    if (tag === "A") {
      if (!href || !safeHref(href)) { walk(el); unwrap(el); continue; }
      el.setAttribute("href", href.trim());
      if (!href.trim().startsWith("#")) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (tag === "IMG") {
      if (src && safeSrc(src)) {
        el.setAttribute("src", src.trim());
        el.setAttribute("alt", alt || "");
        el.setAttribute("loading", "lazy");
      } else el.remove();
      continue;
    }
    if (tag === "SPAN") {
      walk(el);
      const size = cls.split(/\s+/).find((c) => SIZE.test(c));
      if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) wrapChildren(el, "strong");
      if (/font-style:\s*italic/i.test(style)) wrapChildren(el, "em");
      if (size) el.className = size;
      else unwrap(el);
      continue;
    }
    walk(el);
  }
}
