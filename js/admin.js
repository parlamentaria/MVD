/* Админ-панель: вход, статистика, управление лекциями и текстами */
import { ADMIN_EMAIL, SITE, DEFAULT_SETTINGS } from "./config.js";
import { isConfigured, db, fs, loadAuth, initError } from "./firebase.js";
import { DEMO_LECTURES } from "./demo.js";
import { byOrder } from "./data.js";
import { createEditor } from "./editor.js";
import { icon, esc, toast, store, toggleTheme, fmtDate, fmtNum, hydrateIcons, renderFooter } from "./ui.js";
import { localDate } from "./analytics.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad2 = (n) => String(n).padStart(2, "0");
const TABS = ["stats", "lectures", "settings"];

let A = null;               // модуль авторизации
let lectures = [];
let lecturesLoaded = false;
let editor = null;          // редактор лекции
let textEditor = null;      // редактор текста главной
let editing = null;         // { id, title, published } — открытая лекция
let currentTab = null;
let statsLoading = false;
let statsLoaded = false;
let settingsLoaded = false;
let settingsDirty = false;
let saving = false;

hydrateIcons();
$("#admSite").textContent = SITE.name;
init();

/* ======================= ЗАПУСК И ВХОД ======================= */
async function init() {
  if (!isConfigured || !db) {
    if (initError) $("#ncText").textContent = "Не удалось загрузить Firebase. Проверьте подключение к интернету и настройки в файле js/config.js.";
    return showScreen("notConfigured");
  }
  try {
    A = await loadAuth();
  } catch (e) {
    $("#ncText").textContent = "Не удалось загрузить модуль входа Firebase. Проверьте подключение к интернету.";
    return showScreen("notConfigured");
  }
  bindLogin();
  bindApp();
  A.onAuthStateChanged(A.auth, (user) => (user ? enterApp(user) : leaveApp()));
}

function showScreen(id) {
  $("#boot")?.remove();
  for (const s of ["notConfigured", "login", "app"]) $("#" + s).classList.toggle("hidden", s !== id);
}

function authError(code) {
  return ({
    "auth/invalid-credential": "Неверный пароль",
    "auth/wrong-password": "Неверный пароль",
    "auth/user-not-found": "Пользователь не найден — проверьте ADMIN_EMAIL в js/config.js",
    "auth/invalid-email": "Некорректный email",
    "auth/too-many-requests": "Слишком много попыток. Подождите несколько минут и попробуйте снова",
    "auth/network-request-failed": "Нет соединения с интернетом",
    "auth/unauthorized-domain": "Этот домен не разрешён в Firebase → Authentication → Settings → Authorized domains",
    "auth/operation-not-allowed": "Вход по email и паролю не включён в Firebase → Authentication",
    "auth/user-disabled": "Аккаунт отключён",
  })[code] || "Не удалось войти (" + (code || "неизвестная ошибка") + ")";
}

function bindLogin() {
  const placeholderEmail = !ADMIN_EMAIL || /@example\.com$/i.test(ADMIN_EMAIL);
  if (!placeholderEmail) {
    $("#email").value = ADMIN_EMAIL;
    $("#emailField").classList.add("hidden");
  }
  $("#pwEye").onclick = () => {
    const p = $("#password");
    const show = p.type === "password";
    p.type = show ? "text" : "password";
    $("#pwEye").innerHTML = icon(show ? "eyeOff" : "eye");
  };
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#loginError");
    const email = $("#email").value.trim();
    const password = $("#password").value;
    err.textContent = "";
    if (!email) { err.textContent = "Укажите email"; return shake(); }
    if (!password) { err.textContent = "Введите пароль"; return shake(); }
    const btn = $("#loginBtn");
    btn.classList.add("loading");
    btn.disabled = true;
    try {
      await A.signInWithEmailAndPassword(A.auth, email, password);
      $("#password").value = "";
    } catch (ex) {
      err.textContent = authError(ex.code);
      shake();
    } finally {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  });
}
function shake() {
  const c = $("#loginForm");
  c.classList.remove("shake");
  void c.offsetWidth;
  c.classList.add("shake");
}

function enterApp() {
  showScreen("app");
  // Просмотры администратора по умолчанию не учитываются
  if (store.get("lec_no_track") === null) store.set("lec_no_track", "1");
  const tab = location.hash.slice(1);
  currentTab = null;
  switchTab(TABS.includes(tab) ? tab : "stats");
}
function leaveApp() {
  showScreen("login");
  editing = null;
  statsLoaded = settingsLoaded = lecturesLoaded = false;
  setTimeout(() => (($("#emailField").classList.contains("hidden") ? $("#password") : $("#email")).focus()), 60);
}

/* ======================= ВКЛАДКИ ======================= */
async function switchTab(tab) {
  if (tab === currentTab) return;
  if (currentTab === "lectures" && isDirty() && !(await confirmLeave())) return;
  if (currentTab === "lectures" && editing) closeEditor(true);
  currentTab = tab;
  history.replaceState(null, "", "#" + tab);
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === tab));
  movePill();
  window.scrollTo(0, 0);
  if (tab === "stats" && !statsLoaded) loadStats();
  if (tab === "lectures") loadLectures().catch(() => {});
  if (tab === "settings" && !settingsLoaded) loadSettings();
}
function movePill() {
  const active = $(".tab.active");
  const pill = $("#tabPill");
  if (!active) return;
  pill.style.width = active.offsetWidth + "px";
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
}

/* ======================= СТАТИСТИКА ======================= */
async function loadStats() {
  if (statsLoading) return;
  statsLoading = true;
  const body = $("#statsBody");
  if (!statsLoaded) body.innerHTML = statsSkeleton();
  $("#refreshStats").classList.add("spinning");
  try {
    if (!lecturesLoaded) await loadLectures();
    const views = fs.collection(db, "views");
    const W = fs.where;
    const cnt = (...c) => fs.getCountFromServer(c.length ? fs.query(views, ...c) : views).then((s) => s.data().count);
    const now = new Date();
    const days = Array.from({ length: 14 }, (_, k) => { const d = new Date(now); d.setDate(d.getDate() - (13 - k)); return d; });

    const [total, visitors, today, week, mobile, home, hours, wdays, daily, perLec] = await Promise.all([
      cnt(),
      fs.getCountFromServer(fs.collection(db, "visitors")).then((s) => s.data().count),
      cnt(W("date", "==", localDate(now))),
      cnt(W("date", ">=", localDate(days[7]))),
      cnt(W("device", "==", "mobile")),
      cnt(W("page", "==", "home")),
      Promise.all(Array.from({ length: 24 }, (_, h) => cnt(W("hour", "==", h)))),
      Promise.all(Array.from({ length: 7 }, (_, d) => cnt(W("weekday", "==", d)))),
      Promise.all(days.map((d) => cnt(W("date", "==", localDate(d))))),
      Promise.all(lectures.map((l) => cnt(W("lectureId", "==", l.id)))),
    ]);
    renderStats({ total, visitors, today, week, mobile, home, hours, wdays, daily, perLec, days });
    statsLoaded = true;
    $("#statsUpdated").textContent = "Обновлено в " + now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + ".";
  } catch (e) {
    console.error(e);
    body.innerHTML = errorCard(e);
  } finally {
    statsLoading = false;
    $("#refreshStats").classList.remove("spinning");
  }
}

const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WD_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const argmax = (arr) => arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);

function renderStats(s) {
  const body = $("#statsBody");
  const mobilePct = s.total ? Math.round((s.mobile / s.total) * 100) : 0;
  const peakH = argmax(s.hours);
  const peakD = argmax(s.wdays);
  const wdOrder = [1, 2, 3, 4, 5, 6, 0];
  const top = lectures.map((l, i) => ({ l, v: s.perLec[i] || 0 })).sort((a, b) => b.v - a.v);
  const maxTop = Math.max(1, ...top.map((t) => t.v));

  body.innerHTML = `
    <div class="kpis">
      ${kpi("eye", "Всего просмотров", s.total, "", 0)}
      ${kpi("users", "Уникальных посетителей", s.visitors, "", 1)}
      ${kpi("calendar", "Сегодня", s.today, "", 2)}
      ${kpi("barChart", "За 7 дней", s.week, "", 3)}
      ${kpi("smartphone", "С телефонов", mobilePct, "%", 4)}
    </div>
    <div class="insights">
      ${s.total
        ? `<span class="insight">${icon("clock")}Чаще всего заходят: <b>${pad2(peakH)}:00–${pad2((peakH + 1) % 24)}:00</b></span>
           <span class="insight">${icon("calendar")}Самый активный день: <b>${WD_FULL[peakD]}</b></span>`
        : `<span class="insight">${icon("sparkles")}Пока нет данных — просмотры появятся, когда посетители откроют сайт.</span>`}
    </div>
    <div class="charts">
      <div class="card chart-card wide">
        <div class="chart-head"><h3>Просмотры за 14 дней</h3><span class="muted">по дням</span></div>
        ${bars(s.daily.map((v, i) => ({ v, label: s.days[i].getDate(), title: s.days[i].toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) })))}
      </div>
      <div class="card chart-card">
        <div class="chart-head"><h3>Время суток</h3><span class="muted">когда чаще смотрят</span></div>
        ${bars(s.hours.map((v, h) => ({ v, label: h % 3 === 0 ? h : "", title: `${pad2(h)}:00–${pad2((h + 1) % 24)}:00` })), "hours")}
      </div>
      <div class="card chart-card">
        <div class="chart-head"><h3>Дни недели</h3><span class="muted">за всё время</span></div>
        ${bars(wdOrder.map((d) => ({ v: s.wdays[d], label: WD[d], title: WD_FULL[d] })))}
      </div>
      <div class="card chart-card wide">
        <div class="chart-head"><h3>Популярные лекции</h3><span class="muted">Главная страница: ${fmtNum(s.home)}</span></div>
        ${top.length
          ? `<ol class="toplist">${top.map((t, i) => `
              <li style="--i:${i}">
                <span class="tl-n">${i + 1}</span>
                <div class="tl-body">
                  <div class="tl-row"><span class="tl-title">${esc(t.l.title || "Без названия")}${t.l.published === false ? ' <span class="muted">· черновик</span>' : ""}</span><b>${fmtNum(t.v)}</b></div>
                  <div class="tl-bar"><span style="--w:${((t.v / maxTop) * 100).toFixed(1)}%"></span></div>
                </div>
              </li>`).join("")}</ol>`
          : `<p class="muted">Лекций пока нет.</p>`}
      </div>
    </div>
    <label class="check">
      <input type="checkbox" id="noTrack" ${store.get("lec_no_track") === "1" ? "checked" : ""}>
      <span>Не учитывать мои собственные просмотры с этого устройства</span>
    </label>`;

  $("#noTrack").onchange = (e) => { store.set("lec_no_track", e.target.checked ? "1" : "0"); toast("Настройка сохранена"); };
  countUp($$(".kpi-val", body));
}

function kpi(ico, label, value, suffix, i) {
  return `<div class="card kpi" style="--i:${i}">
    <span class="kpi-ico">${icon(ico)}</span>
    <div><div class="kpi-val" data-val="${value}" data-suffix="${suffix}">0${suffix}</div><div class="kpi-lbl">${label}</div></div>
  </div>`;
}

function bars(data, cls = "") {
  const max = Math.max(1, ...data.map((d) => d.v));
  const peak = Math.max(...data.map((d) => d.v));
  return `<div class="bars ${cls}">${data.map((d, i) => `
    <div class="bar-col${d.v === peak && peak > 0 ? " peak" : ""}" title="${esc(d.title)}: ${d.v}">
      <div class="bar-track"><div class="bar" style="--h:${((d.v / max) * 100).toFixed(1)}%;--i:${i}"><span class="bar-tip">${fmtNum(d.v)}</span></div></div>
      <span class="bar-lbl">${d.label}</span>
    </div>`).join("")}</div>`;
}

function countUp(els) {
  els.forEach((el) => {
    const target = Number(el.dataset.val) || 0;
    const suffix = el.dataset.suffix || "";
    const start = performance.now();
    const dur = 1100;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = fmtNum(Math.round(target * eased)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function statsSkeleton() {
  return `<div class="kpis">${Array.from({ length: 5 }, () => `<div class="card kpi"><div class="sk" style="width:46px;height:46px;border-radius:14px"></div><div style="flex:1"><div class="sk" style="width:60%;height:24px;margin-bottom:8px"></div><div class="sk" style="width:80%;height:12px"></div></div></div>`).join("")}</div>
    <div class="charts"><div class="card chart-card wide"><div class="sk" style="height:220px;border-radius:14px"></div></div></div>`;
}

function errorCard(e) {
  const denied = e?.code === "permission-denied";
  return `<div class="card error-card">
    <div class="empty-ico">${icon("alert")}</div>
    <h3>${denied ? "Нет доступа к данным" : "Не удалось загрузить данные"}</h3>
    <p class="muted">${denied
      ? "Проверьте, что UID вашего аккаунта правильно указан в правилах Firestore и правила опубликованы (README → Шаг 5)."
      : esc(e?.message || "Проверьте подключение к интернету и попробуйте ещё раз.")}</p>
  </div>`;
}

function fsError(e) {
  if (e?.code === "permission-denied") return "Нет прав. Проверьте UID в правилах Firestore (README → Шаг 5)";
  if (e?.code === "unavailable") return "Нет соединения с сервером";
  return e?.message || "Ошибка";
}

/* ======================= ЛЕКЦИИ ======================= */
async function loadLectures() {
  try {
    const snap = await fs.getDocs(fs.collection(db, "lectures"));
    lectures = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
    lecturesLoaded = true;
    renderLectureList();
  } catch (e) {
    console.error(e);
    $("#lecList").innerHTML = errorCard(e);
    throw e;
  }
}

function renderLectureList() {
  $("#lecTotal").textContent = lectures.length;
  const list = $("#lecList");
  if (!lectures.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${icon("fileText")}</div>
        <h3>Лекций пока нет</h3>
        <p class="muted">Создайте первую лекцию или загрузите примеры, чтобы посмотреть, как всё выглядит на сайте.</p>
        <div class="empty-actions">
          <button class="btn-primary sm" data-act="new">${icon("plus")}<span>Создать лекцию</span></button>
          <button class="btn-ghost" data-act="seed">${icon("sparkles")}Загрузить примеры</button>
        </div>
      </div>`;
    return;
  }
  list.innerHTML = lectures.map((l, i) => {
    const pub = l.published !== false;
    const date = fmtDate(l.updatedAt);
    return `
      <div class="lrow" data-id="${esc(l.id)}" style="--i:${i}">
        <span class="lnum">${pad2(i + 1)}</span>
        <div class="linfo">
          <b>${esc(l.title || "Без названия")}</b>
          <small><span class="status ${pub ? "on" : "off"}">${pub ? "Опубликована" : "Черновик"}</span>${date ? `<span>· изменена ${date}</span>` : ""}</small>
        </div>
        <div class="lactions">
          <button class="act" data-act="up" title="Переместить выше" aria-label="Выше" ${i === 0 ? "disabled" : ""}>${icon("chevronUp")}</button>
          <button class="act" data-act="down" title="Переместить ниже" aria-label="Ниже" ${i === lectures.length - 1 ? "disabled" : ""}>${icon("chevronDown")}</button>
          <button class="act" data-act="toggle" title="${pub ? "Скрыть (сделать черновиком)" : "Опубликовать"}" aria-label="Публикация">${icon(pub ? "eye" : "eyeOff")}</button>
          <a class="act" data-act="open" href="./#/lecture/${encodeURIComponent(l.id)}" target="_blank" title="Открыть на сайте" aria-label="Открыть на сайте">${icon("arrowUpRight")}</a>
          <button class="act" data-act="edit" title="Редактировать" aria-label="Редактировать">${icon("edit")}</button>
          <button class="act danger" data-act="delete" title="Удалить" aria-label="Удалить">${icon("trash")}</button>
        </div>
      </div>`;
  }).join("");
}

async function onListClick(e) {
  const btn = e.target.closest("[data-act]");
  const row = e.target.closest(".lrow");
  if (!btn) { if (row) openEditor(lectures.find((l) => l.id === row.dataset.id)); return; }
  const act = btn.dataset.act;
  if (act === "open") return;
  if (act === "new") return openEditor(null);
  if (act === "seed") return seedDemo(btn);
  const i = lectures.findIndex((l) => l.id === row?.dataset.id);
  if (i < 0) return;
  const l = lectures[i];
  if (act === "edit") openEditor(l);
  if (act === "up") move(i, -1);
  if (act === "down") move(i, 1);
  if (act === "toggle") togglePublish(l);
  if (act === "delete") removeLecture(l);
}

async function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= lectures.length) return;
  [lectures[i], lectures[j]] = [lectures[j], lectures[i]];
  const batch = fs.writeBatch(db);
  lectures.forEach((l, k) => {
    if (l.order !== k) { batch.update(fs.doc(db, "lectures", l.id), { order: k }); l.order = k; }
  });
  renderLectureList();
  const row = $$(".lrow")[j];
  row?.classList.add("flash");
  try { await batch.commit(); }
  catch (e) { toast(fsError(e), "alert", "error"); loadLectures().catch(() => {}); }
}

async function togglePublish(l) {
  const published = l.published === false;
  try {
    await fs.updateDoc(fs.doc(db, "lectures", l.id), { published });
    l.published = published;
    renderLectureList();
    toast(published ? "Лекция опубликована" : "Лекция скрыта (черновик)", published ? "eye" : "eyeOff");
  } catch (e) { toast(fsError(e), "alert", "error"); }
}

async function removeLecture(l, fromEditor = false) {
  if (!l) return;
  const ok = await confirmBox({
    title: "Удалить лекцию?",
    text: `«${l.title || "Без названия"}» будет удалена навсегда. Это действие нельзя отменить.`,
    ok: "Удалить",
  });
  if (!ok) return;
  try {
    await fs.deleteDoc(fs.doc(db, "lectures", l.id));
    lectures = lectures.filter((x) => x.id !== l.id);
    if (fromEditor) closeEditor(true);
    renderLectureList();
    toast("Лекция удалена", "trash");
  } catch (e) { toast(fsError(e), "alert", "error"); }
}

async function seedDemo(btn) {
  btn.disabled = true;
  try {
    const batch = fs.writeBatch(db);
    DEMO_LECTURES.forEach((l, k) =>
      batch.set(fs.doc(fs.collection(db, "lectures")), {
        title: l.title, content: l.content.trim(), published: true, order: k,
        createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp(),
      })
    );
    await batch.commit();
    toast("Примеры лекций добавлены", "sparkles");
    await loadLectures();
  } catch (e) { toast(fsError(e), "alert", "error"); btn.disabled = false; }
}

/* ---------- Редактор лекции ---------- */
function openEditor(l) {
  editing = l
    ? { id: l.id, title: l.title || "", published: l.published !== false }
    : { id: null, title: "", published: true };
  $("#lecListView").classList.add("hidden");
  $("#lecEditView").classList.remove("hidden");
  $("#edTitle").value = editing.title;
  $("#edPublished").checked = editing.published;
  editor.html = l?.content || "";
  editor.markClean();
  $("#edDelete").classList.toggle("hidden", !editing.id);
  updateSaveState();
  window.scrollTo(0, 0);
  setTimeout(() => (editing.id ? editor.focus() : $("#edTitle").focus()), 50);
}

async function closeEditor(force = false) {
  if (!force && isDirty() && !(await confirmLeave())) return;
  editing = null;
  $("#lecEditView").classList.add("hidden");
  $("#lecListView").classList.remove("hidden");
  renderLectureList();
  window.scrollTo(0, 0);
}

function isDirty() {
  if (!editing || !editor) return false;
  return editor.dirty || $("#edTitle").value.trim() !== editing.title || $("#edPublished").checked !== editing.published;
}

function updateSaveState() {
  const el = $("#saveState");
  if (!editing) return;
  const dirty = isDirty();
  el.classList.toggle("dirty", dirty);
  el.innerHTML = dirty ? "● Есть несохранённые изменения" : editing.id ? `${icon("check")}Все изменения сохранены` : "Новая лекция";
}

async function saveLecture() {
  if (!editing || saving) return;
  const title = $("#edTitle").value.trim();
  if (!title) { toast("Введите название лекции", "alert", "error"); $("#edTitle").focus(); return; }
  const content = editor.html;
  if (content.length > 900000) { toast("Текст слишком большой (лимит ~900 000 символов). Разделите лекцию на части.", "alert", "error"); return; }

  saving = true;
  $$(".tb-save, #edSaveTop").forEach((b) => b.classList.add("loading"));
  const data = { title, content, published: $("#edPublished").checked, updatedAt: fs.serverTimestamp() };
  try {
    if (editing.id) {
      await fs.updateDoc(fs.doc(db, "lectures", editing.id), data);
    } else {
      data.order = lectures.length ? Math.max(...lectures.map((l) => l.order ?? 0)) + 1 : 0;
      data.createdAt = fs.serverTimestamp();
      const ref = await fs.addDoc(fs.collection(db, "lectures"), data);
      editing.id = ref.id;
      $("#edDelete").classList.remove("hidden");
    }
    editing.title = title;
    editing.published = data.published;
    editor.markClean();
    toast("Лекция сохранена");
    const fresh = { ...data, id: editing.id, updatedAt: new Date() };
    const idx = lectures.findIndex((l) => l.id === editing.id);
    if (idx >= 0) lectures[idx] = { ...lectures[idx], ...fresh };
    else lectures.push(fresh);
  } catch (e) {
    toast(fsError(e), "alert", "error");
  } finally {
    saving = false;
    $$(".tb-save, #edSaveTop").forEach((b) => b.classList.remove("loading"));
    updateSaveState();
  }
}

/* ======================= ГЛАВНАЯ И АВТОР ======================= */
const S_FIELDS = {
  sBadge: "homeBadge", sTitle: "homeTitle", sBtn: "homeButtonText",
  sName: "authorName", sRole: "authorRole", sPhoto: "authorPhoto", sBio: "authorBio", sContacts: "contacts",
};

async function loadSettings() {
  $("#sBtnUrl").textContent = SITE.homeButtonUrl;
  try {
    const snap = await fs.getDoc(fs.doc(db, "settings", "site"));
    const s = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    for (const [id, key] of Object.entries(S_FIELDS)) $("#" + id).value = s[key] ?? "";
    textEditor.html = s.homeText || "";
    textEditor.markClean();
    settingsDirty = false;
    settingsLoaded = true;
    preview();
  } catch (e) { toast(fsError(e), "alert", "error"); }
}

function collectSettings() {
  const s = {};
  for (const [id, key] of Object.entries(S_FIELDS)) s[key] = $("#" + id).value.trim();
  s.homeText = textEditor.html;
  return s;
}
function preview() {
  renderFooter($("#footerPreview"), { ...DEFAULT_SETTINGS, ...collectSettings() });
}

async function saveSettings() {
  const btn = $("#saveSettings");
  btn.classList.add("loading");
  try {
    await fs.setDoc(fs.doc(db, "settings", "site"), { ...collectSettings(), updatedAt: fs.serverTimestamp() }, { merge: true });
    settingsDirty = false;
    textEditor.markClean();
    toast("Сохранено. Изменения уже на сайте");
  } catch (e) { toast(fsError(e), "alert", "error"); }
  finally { btn.classList.remove("loading"); }
}

/* ======================= ОКНО ПОДТВЕРЖДЕНИЯ ======================= */
function confirmBox({ title, text, ok = "Удалить", danger = true }) {
  return new Promise((resolve) => {
    const m = $("#modal");
    const okBtn = $("#mOk");
    const cancel = $("#mCancel");
    $("#mTitle").textContent = title;
    $("#mText").textContent = text;
    okBtn.textContent = ok;
    okBtn.className = danger ? "btn-danger" : "btn-primary sm";
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add("open"));
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    const done = (v) => {
      m.classList.remove("open");
      setTimeout(() => { if (!m.classList.contains("open")) m.hidden = true; }, 260);
      okBtn.onclick = cancel.onclick = m.onclick = null;
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    okBtn.onclick = () => done(true);
    cancel.onclick = () => done(false);
    m.onclick = (e) => { if (e.target === m) done(false); };
    document.addEventListener("keydown", onKey);
    setTimeout(() => cancel.focus(), 60);
  });
}
const confirmLeave = () => confirmBox({
  title: "Есть несохранённые изменения",
  text: "Если уйти сейчас, изменения в лекции пропадут.",
  ok: "Уйти без сохранения",
});

/* ======================= КНОПКИ ======================= */
function bindApp() {
  editor = createEditor($("#edBody"), { placeholder: "Текст лекции…", onChange: updateSaveState, onSave: saveLecture });
  textEditor = createEditor($("#sText"), { placeholder: "Текст на главной странице…", compact: true, onChange: () => { settingsDirty = true; } });

  $$(".tab").forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  $("#themeBtn").onclick = toggleTheme;
  $("#logoutBtn").onclick = async () => {
    if ((isDirty() || settingsDirty) && !(await confirmLeave())) return;
    settingsDirty = false;
    await A.signOut(A.auth);
    toast("Вы вышли из админ-панели", "logout");
  };
  $("#refreshStats").onclick = loadStats;
  $("#newLec").onclick = () => openEditor(null);
  $("#lecList").addEventListener("click", onListClick);
  $("#edBack").onclick = () => closeEditor();
  $("#edSaveTop").onclick = saveLecture;
  $("#edDelete").onclick = () => removeLecture(lectures.find((l) => l.id === editing?.id), true);
  $("#edTitle").addEventListener("input", updateSaveState);
  $("#edTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); editor.focus(); } });
  $("#edPublished").onchange = updateSaveState;
  $("#saveSettings").onclick = saveSettings;
  Object.keys(S_FIELDS).forEach((id) => $("#" + id).addEventListener("input", () => { settingsDirty = true; preview(); }));

  addEventListener("resize", movePill);
  document.fonts?.ready.then(movePill);
  addEventListener("beforeunload", (e) => {
    if (isDirty() || settingsDirty) { e.preventDefault(); e.returnValue = ""; }
  });
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
      if (currentTab === "lectures" && editing) { e.preventDefault(); saveLecture(); }
      else if (currentTab === "settings") { e.preventDefault(); saveSettings(); }
    }
  });
}
