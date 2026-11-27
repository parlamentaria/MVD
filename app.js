/* Публичная часть сайта: меню, главная страница, лекции, режим чтения */
import { SITE } from "./config.js";
import { isConfigured, initError } from "./firebase.js";
import { fetchPublicLectures, fetchSettings } from "./data.js";
import { trackView } from "./analytics.js";
import { sanitize } from "./sanitize.js";
import { icon, esc, toggleTheme, renderFooter, revealOnScroll, toast, store, fmtDate, hydrateIcons } from "./ui.js";

const $ = (s) => document.querySelector(s);
const html = document.documentElement;
const view = $("#view");
const navList = $("#navLectures");
const indicator = $("#navIndicator");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { lectures: [], settings: null, filter: "", active: null, renderId: 0, first: true, loadError: null };

hydrateIcons();
boot();

async function boot() {
  $("#siteName").textContent = SITE.name;
  $("#siteTagline").textContent = SITE.tagline;
  bindUI();
  view.innerHTML = skeleton();

  const [lectures, settings] = await Promise.all([
    fetchPublicLectures().catch((e) => { console.error(e); state.loadError = e; return []; }),
    fetchSettings(),
  ]);
  state.lectures = lectures;
  state.settings = settings;

  renderNav();
  renderFooter($("#footer"), settings, { reveal: true });
  revealOnScroll();
  renderSidebarFoot();
  window.addEventListener("hashchange", route);
  route();
}

/* ======================= МАРШРУТЫ ======================= */
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  return { type: parts[0] || "home", id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function route() {
  const r = parseHash();
  closeNav();
  if (r.type === "home") return showHome();
  if (r.type === "lecture") {
    const lec = state.lectures.find((l) => l.id === r.id);
    return lec ? showLecture(lec) : showNotFound();
  }
  showNotFound();
}

/** Плавная смена содержимого страницы */
async function swap(markup, { crumb, title, active }) {
  const id = ++state.renderId;
  if (!state.first && !reduceMotion) {
    view.classList.remove("enter");
    view.classList.add("leave");
    await wait(170);
    if (id !== state.renderId) return false;
  }
  state.first = false;
  view.classList.remove("leave", "enter");
  view.innerHTML = markup;
  window.scrollTo(0, 0);
  void view.offsetWidth; // перезапуск анимации
  view.classList.add("enter");
  $("#crumb").innerHTML = crumb;
  document.title = title;
  setActive(active);
  updateProgress();
  return true;
}

/* ======================= ГЛАВНАЯ ======================= */
function showHome() {
  const s = state.settings;
  const words = String(s.homeTitle || "").trim().split(/\s+/).filter(Boolean);
  const title = words
    .map((w, i) => `<span class="w${i === words.length - 1 && words.length > 1 ? " grad" : ""}" style="--i:${i}">${esc(w)}</span>`)
    .join(" ");
  const target = SITE.homeButtonNewTab ? ' target="_blank" rel="noopener"' : "";

  const markup = `
    <section class="home">
      <div class="hero" id="hero">
        ${s.homeBadge ? `<span class="badge"><span class="dot"></span>${esc(s.homeBadge)}</span>` : ""}
        <h1 class="hero-title">${title}</h1>
        <div class="hero-text prose prose-ui">${sanitize(s.homeText)}</div>
        <div class="hero-cta">
          <a class="btn-primary" href="${esc(SITE.homeButtonUrl)}"${target}>
            <span>${esc(s.homeButtonText || "Перейти")}</span>${icon("arrowUpRight")}
          </a>
        </div>
        ${state.loadError ? `<p class="load-error">${icon("alert")}Не удалось загрузить лекции. Проверьте интернет или настройки Firebase.</p>` : ""}
      </div>
    </section>`;

  swap(markup, { crumb: `${icon("home")}<b>Главная</b>`, title: `${SITE.name} — ${s.homeTitle}`, active: "home" }).then((ok) => {
    if (!ok) return;
    const hero = $("#hero");
    hero?.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty("--mx", `${e.clientX - r.left}px`);
      hero.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
    trackView("home");
  });
}

/* ======================= ЛЕКЦИЯ ======================= */
function showLecture(lec) {
  const idx = state.lectures.indexOf(lec);
  const prev = state.lectures[idx - 1];
  const next = state.lectures[idx + 1];

  const tmp = document.createElement("div");
  tmp.innerHTML = sanitize(lec.content || "");
  const words = (tmp.textContent.match(/\S+/g) || []).length;
  const minutes = Math.max(1, Math.round(words / 180));
  [...tmp.children].forEach((el, i) => el.style.setProperty("--d", Math.min(i, 12)));
  const content = tmp.innerHTML || '<p class="muted">Текст лекции пока не добавлен.</p>';
  const date = fmtDate(lec.updatedAt);
  const link = (l) => `#/lecture/${encodeURIComponent(l.id)}`;

  const markup = `
    <article class="lecture">
      <header class="lec-head">
        <div class="lec-meta">
          <span class="chip">Лекция ${idx + 1}</span>
          <span class="meta-i">${icon("clock")}${minutes} мин чтения</span>
          ${date ? `<span class="meta-i">${icon("calendar")}${date}</span>` : ""}
        </div>
        <h1 class="lec-title">${esc(lec.title)}</h1>
      </header>
      <div class="prose" id="prose">${content}</div>
      <nav class="pager" aria-label="Другие лекции">
        ${prev ? `<a class="prev" href="${link(prev)}"><small>${icon("arrowLeft")}Предыдущая</small><b>${esc(prev.title)}</b></a>` : ""}
        ${next ? `<a class="next" href="${link(next)}"><small>Следующая${icon("arrowRight")}</small><b>${esc(next.title)}</b></a>` : ""}
      </nav>
    </article>`;

  swap(markup, {
    crumb: `<span class="crumb-num">Лекция ${idx + 1}</span><span class="sep">/</span><b>${esc(lec.title)}</b>`,
    title: `${lec.title} — ${SITE.name}`,
    active: lec.id,
  }).then((ok) => ok && trackView("lecture", lec.id));
}

function showNotFound() {
  swap(`
    <section class="empty-view">
      <div class="big-num">404</div>
      <h1>Страница не найдена</h1>
      <p class="muted">Возможно, лекция была удалена или ссылка указана с ошибкой.</p>
      <a class="btn-primary" href="#/">${icon("home")}<span>На главную</span></a>
    </section>`, { crumb: "<b>Не найдено</b>", title: `Не найдено — ${SITE.name}`, active: null });
}

function skeleton() {
  return `<div class="skeleton">
    <div class="sk" style="width:120px;height:26px;border-radius:99px"></div>
    <div class="sk" style="width:78%;height:44px;margin:22px 0 30px"></div>
    ${Array.from({ length: 6 }, (_, i) => `<div class="sk" style="width:${[100, 96, 88, 100, 92, 60][i]}%;height:16px;margin-bottom:14px"></div>`).join("")}
  </div>`;
}

/* ======================= МЕНЮ ======================= */
function highlight(text, q) {
  text = String(text || "");
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
}

function renderNav() {
  const q = state.filter.trim().toLowerCase();
  const items = state.lectures
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !q || String(l.title || "").toLowerCase().includes(q));

  $("#lecCount").textContent = state.lectures.length || "";
  navList.innerHTML = items.length
    ? items.map(({ l, i }, k) => `
        <a class="nav-item" href="#/lecture/${encodeURIComponent(l.id)}" data-route="${esc(l.id)}" style="--i:${k + 1}">
          <span class="num">${String(i + 1).padStart(2, "0")}</span><span class="t">${highlight(l.title, q)}</span>
        </a>`).join("")
    : `<p class="nav-empty">${q ? "Ничего не найдено" : "Лекций пока нет"}</p>`;
  setActive(state.active);
}

function setActive(key) {
  state.active = key;
  let target = null;
  document.querySelectorAll(".nav-item").forEach((a) => {
    const on = key != null && a.dataset.route === key;
    a.classList.toggle("active", on);
    if (on) { target = a; a.setAttribute("aria-current", "page"); } else a.removeAttribute("aria-current");
  });
  if (!target) { indicator.style.opacity = 0; return; }

  const first = !indicator.dataset.ready;
  if (first) indicator.style.transition = "none";
  indicator.style.opacity = 1;
  indicator.style.height = target.offsetHeight + "px";
  indicator.style.transform = `translateY(${target.offsetTop}px)`;
  if (first) { void indicator.offsetWidth; indicator.style.transition = ""; indicator.dataset.ready = "1"; }

  const nav = $("#nav");
  if (target.offsetTop < nav.scrollTop || target.offsetTop + target.offsetHeight > nav.scrollTop + nav.clientHeight) {
    nav.scrollTo({ top: target.offsetTop - nav.clientHeight / 3, behavior: reduceMotion ? "auto" : "smooth" });
  }
}

function renderSidebarFoot() {
  const el = $("#sidebarFoot");
  if (!isConfigured) el.innerHTML = `<span class="demo-pill">${icon("sparkles")}Демо-режим · подключите Firebase</span>`;
  else if (initError) el.innerHTML = `<span class="demo-pill warn">${icon("alert")}Firebase не загрузился</span>`;
  else el.innerHTML = `<span>© ${new Date().getFullYear()} ${esc(SITE.name)}</span>`;
}

/* ======================= УПРАВЛЕНИЕ ======================= */
function bindUI() {
  $("#openNav").onclick = openNav;
  $("#closeNav").onclick = closeNav;
  $("#overlay").onclick = closeNav;
  $("#themeBtn").onclick = toggleTheme;
  $("#readBtn").onclick = toggleReading;
  $("#fontUp").onclick = () => setFont(0.1);
  $("#fontDown").onclick = () => setFont(-0.1);
  $("#search").addEventListener("input", (e) => { state.filter = e.target.value; renderNav(); });
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => { setActive(state.active); updateProgress(); });
  addEventListener("keydown", onKey);
  syncReadingBtn();
}

function openNav() { document.body.classList.add("nav-open"); }
function closeNav() { document.body.classList.remove("nav-open"); }

function toggleReading() {
  const on = html.classList.toggle("reading");
  store.set("lec_reading", on ? "1" : "0");
  syncReadingBtn();
  toast(on ? "Режим чтения включён" : "Режим чтения выключен", "bookOpen");
  setTimeout(() => { setActive(state.active); updateProgress(); }, 600);
}
function syncReadingBtn() {
  $("#readBtn").setAttribute("aria-pressed", html.classList.contains("reading") ? "true" : "false");
}
function setFont(delta) {
  const cur = parseFloat(getComputedStyle(html).getPropertyValue("--fs-scale")) || 1;
  const v = Math.min(1.5, Math.max(0.8, Math.round((cur + delta) * 10) / 10));
  html.style.setProperty("--fs-scale", v);
  store.set("lec_fs", v);
  toast(`Размер текста: ${Math.round(v * 100)}%`, "");
}

function onKey(e) {
  if (e.target.closest?.("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape") closeNav();
  if (e.code === "KeyR") toggleReading();
  if (e.key === "ArrowRight") document.querySelector(".pager .next")?.click();
  if (e.key === "ArrowLeft") document.querySelector(".pager .prev")?.click();
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { updateProgress(); ticking = false; });
}
function updateProgress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = max > 4 ? Math.min(1, scrollY / max) : 0;
  $("#progress").style.transform = `scaleX(${p})`;
  $("#topbar").classList.toggle("scrolled", scrollY > 8);
}
