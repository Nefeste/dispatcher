// Размер текста — три ступени (docs/08-game-design.md, §12; срез, часть С8б): обычный, крупнее, крупный. Обычный текст
// (src/ui/kit.tsx) растёт и переносится сам; сцены на Skia берут шрифт крупнее и перестраивают строки мониторов и
// карточек; карта — нет. Значение ставит корень (App.tsx) из настроек; экраны читают его хуком.
import { useSyncExternalStore } from 'react';

/** Множитель размера шрифта по ступени: 1, 1,15, 1,3 — как в «Больнице» (`TEXT_SCALES`). */
export const TEXT_SCALES = [1, 1.15, 1.3] as const;
export type TextSize = 0 | 1 | 2;

let size: TextSize = 0;
const subs = new Set<() => void>();

export function setTextSize(value: TextSize): void {
  if (value === size) return;
  size = value;
  subs.forEach(f => f());
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}

const get = () => size;

/** Ступень размера текста. */
export function useTextSize(): TextSize {
  return useSyncExternalStore(subscribe, get, get);
}

/** Множитель шрифта для экрана: перерисовывает экран, когда ступень сменилась. */
export function useTextScale(): number {
  return TEXT_SCALES[useTextSize()];
}

/** Множитель вне React (снимки, раскладки, которым его передали). */
export function textScale(): number {
  return TEXT_SCALES[size];
}
