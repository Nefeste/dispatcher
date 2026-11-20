// Нативная заставка (expo-splash-screen, плагин в app.json; картинка — tools/art/icon.ts; устав, docs/05-rules.md:
// «Заставка при запуске — два фона»). Заставка держится, пока не готовы шрифты студии и не нарисован первый кадр
// заглавного экрана, — чтобы под ней не мелькнул пустой фон. Не дольше SPLASH_MAX_MS: что бы ни случилось, заставка
// не повиснет. Устройство — как в «Нардах» (nardy: src/state/splash.ts @ 3ab05ab). В вебе заставки нет, вызовы
// ничего не делают.
import * as SplashScreen from 'expo-splash-screen';

export const SPLASH_MAX_MS = 4000;
let hidden = false;

/** Из App.tsx при загрузке модуля: заставка не уходит сама, когда появляется первый кадр. */
export function keepSplash(): void {
  SplashScreen.preventAutoHideAsync().catch(() => {});
  setTimeout(hideSplash, SPLASH_MAX_MS);
}

/** Заставка уходит; второй вызов ничего не делает. */
export function hideSplash(): void {
  if (hidden) return;
  hidden = true;
  SplashScreen.hideAsync().catch(() => {});
}
