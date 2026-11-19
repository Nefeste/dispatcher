// Палитра карты (лист стиля — docs/13-art.md): спокойная светлая карта под токенами студии. Цвет формы вызова
// никогда не единственный знак (docs/08-game-design.md, §11) — метки появятся с вызовами (П5).
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
