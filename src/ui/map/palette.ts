// Палитра карты (лист стиля — docs/13-art.md): спокойная светлая карта под токенами студии. Цвет формы вызова
// никогда не единственный знак (docs/08-game-design.md, §11): у бригады — ещё номер и форма знака (свободна —
// круг, занята — квадрат), у экстренного вызова — двойное кольцо. Белые надписи на знаках — не меньше 3:1.
import { C } from '../theme';

export const MAP = {
  land: C.linen,
  water: '#b9cdd5',
  green: '#d4dcc6',
  rail: '#a3a69c',
  casing: '#c8cabd',
  road: ['#ffffff', '#ffffff', '#fcfcf8', '#f6f6f1'] as const,
  /** вечер: синяя дымка поверх карты, самое тёмное — ночью; знаки — над ней */
  night: '#0d1b30',
  nightMax: 0.3,
} as const;

/**
 * Сколько вечера в этот час суток, 0…1 (спецификация прототипа, §6: «к 19:00 — вечер»): днём (7–15) — 0, с 15 до 19
 * темнеет, ночью — 1, с 5 до 7 светает.
 */
export function duskOf(secOfDay: number): number {
  const h = (secOfDay / 3600) % 24;
  if (h >= 7 && h < 15) return 0;
  if (h >= 15 && h < 19) return (h - 15) / 4;
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
  return 1;
}

/** Ширина дорог на экране, точки, при подробном масштабе; издалека — тоньше (MapView). */
export const ROAD_PX = [5, 4, 3, 1.8] as const;
export const CASING_PX = 1.5;
/** Во сколько раз приблизить от «район на экране», чтобы дороги рисовались полной шириной `ROAD_PX`; ближе к району —
 *  тоньше в той же доле, но не тоньше `FAR_WIDTH` полной. */
export const DETAIL = 4;
export const FAR_WIDTH = 0.35;

/** Знаки на карте (src/ui/map/Marks.tsx). */
export const MARK = {
  halo: '#ffffff',
  label: '#ffffff',
  base: '#22343f',
  hospital: '#2a5d8f',
} as const;

/** Состояние бригады — цвет знака; слово — в списке бригад. */
export const CREW = {
  base: '#2f7d5b',
  drive: '#8a5d00',
  scene: C.kumach,
  transport: '#6b3d8c',
  hospital: '#2a5d8f',
  back: '#3d6d99',
} as const;

/** Вызов, форму которого ещё не решили, — серое кольцо. */
export const UNDECIDED = '#5d6468';

/** Форма вызова — цвет кольца. */
export const FORM_MARK = { emergency: C.kumach, urgent: '#8a5d00' } as const;

