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
} as const;

/** Ширина дорог на экране, точки, при подробном масштабе; издалека — тоньше (MapView). */
export const ROAD_PX = [5, 4, 3, 1.8] as const;
export const CASING_PX = 1.5;

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
  back: '#3d6d99',
} as const;

/** Форма вызова — цвет кольца. */
export const FORM_MARK = { emergency: C.kumach, urgent: '#8a5d00' } as const;

