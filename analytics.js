/* Подсчёт просмотров. Каждый просмотр — маленькая запись в коллекции "views".
   Один и тот же человек в рамках одной сессии засчитывается 1 раз на страницу. */
import { db, fs } from "./firebase.js";
import { store } from "./ui.js";

const pad = (n) => String(n).padStart(2, "0");
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function trackView(page, lectureId = "") {
  if (!db || navigator.webdriver) return;
  if (store.get("lec_no_track") === "1") return; // просмотры администратора не считаем

  const key = `lec_v_${page}_${lectureId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {}

  const now = new Date();
  const mobile = matchMedia("(max-width: 768px)").matches || /Mobi|Android|iPhone/i.test(navigator.userAgent);

  fs.addDoc(fs.collection(db, "views"), {
    page,
    lectureId: String(lectureId).slice(0, 100),
    hour: now.getHours(),
    weekday: now.getDay(),
    date: localDate(now),
    device: mobile ? "mobile" : "desktop",
    ts: fs.serverTimestamp(),
  }).catch((e) => console.warn("Просмотр не записан:", e.code || e));

  // Уникальный посетитель (анонимный случайный id в браузере)
  if (!store.get("lec_vid")) {
    const vid = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
    store.set("lec_vid", vid);
    fs.setDoc(fs.doc(db, "visitors", vid), { ts: fs.serverTimestamp() }).catch(() => {});
  }
}
