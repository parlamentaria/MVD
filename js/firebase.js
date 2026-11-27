/* Подключение к Firebase. Этот файл менять не нужно. */
import { firebaseConfig } from "./config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

export const isConfigured = Boolean(
  firebaseConfig.apiKey &&
    !/ВСТАВЬТЕ|YOUR_/i.test(firebaseConfig.apiKey) &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "your-project"
);

export let app = null;
export let db = null;
export let fs = null; // функции Firestore (collection, getDocs, ...)
export let initError = null;

if (isConfigured) {
  try {
    const [appMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    app = appMod.initializeApp(firebaseConfig);
    db = fsMod.getFirestore(app);
    fs = fsMod;
  } catch (e) {
    initError = e;
    console.error("Не удалось подключить Firebase:", e);
  }
}

/** Модуль авторизации грузим только в админ-панели */
export async function loadAuth() {
  const m = await import(`${SDK}/firebase-auth.js`);
  return { ...m, auth: m.getAuth(app) };
}
