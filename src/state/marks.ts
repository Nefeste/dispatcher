// Отметки времени запуска и загрузки для «Замера» (спецификация прототипа, §8: «от касания значка до первого кадра
// карты»). Экраны ставят отметки на своём первом кадре; часы — `performance.now()`, той же шкалы, что начало процесса у
// React Native (`performance.rnStartupTiming.startTime`). В веб-сборке начала процесса нет — только загрузка смены.
export type Mark = 'title' | 'startTap' | 'loaded' | 'insertDone' | 'pult';

const at: Partial<Record<Mark, number>> = {};
/** Ждём первого кадра пульта после вставки «начало смены»: пульт открывается и после каждого разговора. */
let awaitPult = false;

/** Отметить момент; `once` — только первый раз за запуск (заглавный экран — один раз, после холодного старта).
 *  `pult` берётся только первый после `insertDone`. */
export function mark(name: Mark, once = false): void {
  if (once && at[name] !== undefined) return;
  if (name === 'pult') {
    if (!awaitPult) return;
    awaitPult = false;
  }
  if (name === 'insertDone') awaitPult = true;
  at[name] = performance.now();
}

export function marks(): Partial<Record<Mark, number>> {
  return { ...at };
}

/** Начало процесса приложения по часам `performance.now()`; нет — `null` (веб, старая архитектура). */
export function processStart(): number | null {
  try {
    const p = performance as Performance & { rnStartupTiming?: { startTime?: number | null } };
    const t = p.rnStartupTiming?.startTime;
    return typeof t === 'number' && t > 0 && t < performance.now() ? t : null;
  } catch {
    return null;
  }
}

/** Память JS, байт: занятая куча Hermes (`performance.memory`); нет — `null`. */
export function jsHeap(): number | null {
  try {
    const m = (performance as Performance & { memory?: { usedJSHeapSize?: number | null } }).memory;
    const v = m?.usedJSHeapSize;
    return typeof v === 'number' && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Время запуска и загрузки, мс: от начала процесса до заглавного экрана, от «Начать смену» до готовности, от конца
 *  вставки до первого кадра пульта. Чего нет — `null`. */
export interface StartTimes {
  cold: number | null;
  load: number | null;
  pult: number | null;
}

export function startTimes(m: Partial<Record<Mark, number>>, start: number | null): StartTimes {
  const d = (a?: number, b?: number | null) => (a !== undefined && b !== undefined && b !== null && a >= b ? a - b : null);
  return { cold: d(m.title, start), load: d(m.loaded, m.startTap), pult: d(m.pult, m.insertDone) };
}
