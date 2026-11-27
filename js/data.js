/* Загрузка лекций и настроек (из Firebase или демо-данных) */
import { db, fs } from "./firebase.js";
import { DEFAULT_SETTINGS } from "./config.js";
import { DEMO_LECTURES } from "./demo.js";

export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/** Опубликованные лекции — для посетителей сайта */
export async function fetchPublicLectures() {
  if (!db) return DEMO_LECTURES.map((l, i) => ({ ...l, order: i, published: true }));
  const q = fs.query(fs.collection(db, "lectures"), fs.where("published", "==", true));
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
}

/** Тексты главной страницы и информация об авторе */
export async function fetchSettings() {
  if (!db) return { ...DEFAULT_SETTINGS };
  try {
    const snap = await fs.getDoc(fs.doc(db, "settings", "site"));
    return { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
  } catch (e) {
    console.warn("Настройки не загружены:", e);
    return { ...DEFAULT_SETTINGS };
  }
}
