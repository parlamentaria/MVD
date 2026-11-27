/* Визуальный редактор текста для админ-панели:
   заголовки, жирный, курсив, размеры текста, списки, цитаты, ссылки, картинки */
import { sanitize } from "./sanitize.js";
import { icon, esc } from "./ui.js";

const tb = (cmd, inner, title) =>
  `<button type="button" class="tb" data-cmd="${cmd}" title="${title}" aria-label="${title}">${inner}</button>`;

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export function createEditor(mount, opts = {}) {
  const { placeholder = "Начните писать…", onChange = () => {}, onSave = null, compact = false } = opts;
  mount.classList.add("editor");
  if (compact) mount.classList.add("compact");
  mount.innerHTML = `
    <div class="ed-toolbar" role="toolbar" aria-label="Форматирование">
      <div class="tb-group">${tb("undo", icon("undo"), "Отменить (Ctrl+Z)")}${tb("redo", icon("redo"), "Повторить (Ctrl+Y)")}</div>
      <div class="tb-group">${tb("p", "¶", "Обычный текст")}${tb("h1", "H1", "Заголовок 1")}${tb("h2", "H2", "Заголовок 2")}${tb("h3", "H3", "Заголовок 3")}</div>
      <div class="tb-group">${tb("bold", "<b>Ж</b>", "Жирный (Ctrl+B)")}${tb("italic", "<i>К</i>", "Курсив (Ctrl+I)")}${tb("underline", "<u>Ч</u>", "Подчёркнутый (Ctrl+U)")}${tb("strikeThrough", "<s>З</s>", "Зачёркнутый")}</div>
      <div class="tb-group">
        ${tb("size:fs-sm", '<span class="sz" style="font-size:.72em">A</span>', "Мелкий текст")}
        ${tb("size:", '<span class="sz">A</span>', "Обычный размер текста")}
        ${tb("size:fs-lg", '<span class="sz" style="font-size:1.18em">A</span>', "Крупный текст")}
        ${tb("size:fs-xl", '<span class="sz" style="font-size:1.4em">A</span>', "Очень крупный текст")}
      </div>
      <div class="tb-group">${tb("ul", icon("list"), "Маркированный список")}${tb("ol", icon("listOrdered"), "Нумерованный список")}${tb("quote", icon("quote"), "Цитата")}${tb("hr", icon("minus"), "Разделительная линия")}</div>
      <div class="tb-group">${tb("link", icon("link"), "Ссылка")}${tb("image", icon("image"), "Картинка по ссылке")}${tb("clear", icon("eraser"), "Убрать форматирование")}</div>
      ${onSave ? `<button type="button" class="tb-save" data-save title="Сохранить (Ctrl+S)">${icon("save")}<span>Сохранить</span></button>` : ""}
    </div>
    <div class="ed-area prose" contenteditable="true" spellcheck="true" data-placeholder="${esc(placeholder)}"></div>
    <div class="ed-status"><span class="ed-count"></span><span class="ed-hint">Выделите текст и нажмите кнопку на панели · Ctrl+S — сохранить</span></div>`;

  const area = mount.querySelector(".ed-area");
  const toolbar = mount.querySelector(".ed-toolbar");
  const count = mount.querySelector(".ed-count");
  let saved = null;
  let clean = "";

  const sel = () => window.getSelection();
  const exec = (c, v = null) => document.execCommand(c, false, v);
  const inArea = (n) => !!n && area.contains(n.nodeType === 1 ? n : n.parentNode);
  const unwrap = (el) => el.replaceWith(...el.childNodes);

  function saveRange() {
    const s = sel();
    if (s.rangeCount && inArea(s.anchorNode)) saved = s.getRangeAt(0).cloneRange();
  }
  function restore() {
    const s = sel();
    if (s.rangeCount && inArea(s.anchorNode)) return;
    area.focus({ preventScroll: true });
    if (saved) { s.removeAllRanges(); s.addRange(saved); }
  }
  function blockValue() {
    try { return (document.queryCommandValue("formatBlock") || "").toLowerCase().replace(/[<>]/g, ""); }
    catch { return ""; }
  }
  function setBlock(tag) {
    exec("formatBlock", `<${blockValue() === tag ? "p" : tag}>`);
  }

  function applySize(cls) {
    exec("styleWithCSS", false);
    exec("fontSize", "7");
    area.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach((f) => {
      f.querySelectorAll('span[class*="fs-"]').forEach(unwrap);
      const sizedParent = f.parentElement?.closest('span[class*="fs-"]');
      const c = cls || (sizedParent && area.contains(sizedParent) ? "fs-md" : "");
      if (!c) return unwrap(f);
      const span = document.createElement("span");
      span.className = c;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
  }

  function insertLink() {
    const text = sel().toString();
    const range = saved && saved.cloneRange();
    const url = prompt("Вставьте адрес ссылки:", "https://");
    if (!url || !url.trim() || url.trim() === "https://") return;
    let href = url.trim();
    if (!/^(https?:|mailto:|tel:)/i.test(href)) href = "https://" + href;
    area.focus({ preventScroll: true });
    if (range) { const s = sel(); s.removeAllRanges(); s.addRange(range); }
    if (text) exec("createLink", href);
    else exec("insertHTML", `<a href="${esc(href)}">${esc(url.trim())}</a>&nbsp;`);
  }

  function insertImage() {
    const range = saved && saved.cloneRange();
    const url = prompt("Ссылка на картинку (должна начинаться с https://).\nКартинку можно загрузить, например, на imgbb.com или postimages.org", "https://");
    if (!url || !/^https:\/\/.+/i.test(url.trim())) return;
    area.focus({ preventScroll: true });
    if (range) { const s = sel(); s.removeAllRanges(); s.addRange(range); }
    exec("insertHTML", `<img src="${esc(url.trim())}" alt=""><p><br></p>`);
  }

  function clearFormat() {
    exec("removeFormat");
    exec("unlink");
    const s = sel();
    if (s.rangeCount) {
      const r = s.getRangeAt(0);
      area.querySelectorAll('span[class*="fs-"]').forEach((sp) => { if (r.intersectsNode(sp)) unwrap(sp); });
    }
    exec("formatBlock", "<p>");
  }

  toolbar.addEventListener("mousedown", (e) => { if (e.target.closest(".tb")) e.preventDefault(); });
  toolbar.addEventListener("click", (e) => {
    if (e.target.closest("[data-save]")) return onSave && onSave();
    const btn = e.target.closest(".tb");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    restore();
    if (cmd.startsWith("size:")) applySize(cmd.slice(5));
    else switch (cmd) {
      case "p": exec("formatBlock", "<p>"); break;
      case "h1": case "h2": case "h3": setBlock(cmd); break;
      case "quote": setBlock("blockquote"); break;
      case "ul": exec("insertUnorderedList"); break;
      case "ol": exec("insertOrderedList"); break;
      case "hr": exec("insertHorizontalRule"); break;
      case "link": insertLink(); break;
      case "image": insertImage(); break;
      case "clear": clearFormat(); break;
      default: exec(cmd); // bold, italic, underline, strikeThrough, undo, redo
    }
    changed();
    updateState();
  });

  // Вставка из Word / Google Docs / сайтов — чистим лишнее
  area.addEventListener("paste", (e) => {
    e.preventDefault();
    const htmlData = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (htmlData) exec("insertHTML", sanitize(htmlData));
    else if (text) {
      const htmlText = text
        .replace(/\r/g, "")
        .split(/\n{2,}/)
        .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
      exec("insertHTML", htmlText);
    }
    changed();
  });
  area.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) e.preventDefault(); });
  area.addEventListener("input", changed);
  area.addEventListener("focus", () => { if (!area.innerHTML.trim()) area.innerHTML = "<p><br></p>"; });
  area.addEventListener("keydown", (e) => {
    // Enter после заголовка — новый обычный абзац
    if (e.key === "Enter" && !e.shiftKey && /^h[1-4]$/.test(blockValue())) {
      setTimeout(() => { if (/^h[1-4]$/.test(blockValue()) && !sel().anchorNode?.textContent?.trim()) exec("formatBlock", "<p>"); }, 0);
    }
  });
  document.addEventListener("selectionchange", () => {
    if (inArea(sel().anchorNode)) { saveRange(); updateState(); }
  });

  function isEmpty() { return !area.textContent.trim() && !area.querySelector("img,hr"); }
  function updateCount() {
    const n = (area.innerText.match(/\S+/g) || []).length;
    count.textContent = `${n} ${plural(n, "слово", "слова", "слов")} · ≈ ${Math.max(1, Math.round(n / 180))} мин чтения`;
  }
  function changed() {
    area.classList.toggle("empty", isEmpty());
    updateCount();
    onChange();
  }
  function updateState() {
    const st = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const block = blockValue();
    const node = sel().anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const sizeEl = el?.closest?.('span[class*="fs-"]');
    const size = sizeEl && area.contains(sizeEl) ? (sizeEl.className.match(/fs-\w+/) || [""])[0] : "";
    toolbar.querySelectorAll(".tb").forEach((b) => {
      const c = b.dataset.cmd;
      let on = false;
      if (["bold", "italic", "underline", "strikeThrough"].includes(c)) on = st(c);
      else if (["h1", "h2", "h3"].includes(c)) on = block === c;
      else if (c === "p") on = block === "p";
      else if (c === "quote") on = block === "blockquote";
      else if (c === "ul") on = st("insertUnorderedList");
      else if (c === "ol") on = st("insertOrderedList");
      else if (c.startsWith("size:")) on = c === "size:" ? !size || size === "fs-md" : c.slice(5) === size;
      b.classList.toggle("on", on);
    });
  }

  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch {}

  return {
    get html() { return isEmpty() ? "" : sanitize(area.innerHTML).trim(); },
    set html(v) {
      area.innerHTML = sanitize(v || "") || "<p><br></p>";
      area.classList.toggle("empty", isEmpty());
      updateCount();
    },
    get dirty() { return this.html !== clean; },
    markClean() { clean = this.html; },
    focus() { area.focus(); },
  };
}
