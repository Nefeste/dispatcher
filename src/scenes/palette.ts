// Цвета сцен (ADR 0009; docs/13-art.md): программа диспетчерской на мониторах — тёмная тема, как вечером; рамки,
// зал, перегородка. Цвета предметов из Blender — в src/art/palette.ts, токены студии — в src/ui/theme.ts.
import { COLORS } from '../art/palette';
import { C } from '../ui/theme';

/** Программа диспетчерской на мониторе. */
export const UI = {
  bg: '#141a1f',
  panel: '#1d252c',
  line: '#2c3842',
  text: '#e6e9e4',
  dim: '#93a0a6',
  red: '#e5566a',
  green: '#7fb3a3',
  amber: '#d2bd84',
  blue: '#7ea6c9',
} as const;

/** Стекло программы (docs/13-art.md, §7): окна и панели поверх зала и карты — полупрозрачные, с тонкой линией. */
export const GLASS = {
  /** окно поверх картинки зала */
  window: 'rgba(20,26,31,0.88)',
  /** строка и карточка внутри окна или прямо на фоне */
  panel: 'rgba(29,37,44,0.86)',
  /** под пальцем */
  pressed: 'rgba(44,56,66,0.95)',
  /** светлая кромка стекла сверху */
  edge: 'rgba(230,233,228,0.10)',
  /** затемнение под окном поверх сцены */
  scrim: 'rgba(8,11,13,0.55)',
} as const;

/** Форма вызова: цвет и буква — цвет никогда не единственный знак (docs/08-game-design.md, §11). */
export const FORM = { emergency: UI.red, urgent: UI.amber } as const;

export const SCENE = {
  hallTop: '#0e1215',
  hallBottom: '#1a2024',
  partition: COLORS.partition,
  partitionShade: '#28342d',
  bezel: '#14171a',
  bezelEdge: '#2a2f34',
  led: '#8fd3a8',
  underDesk: '#101315',
  lamp: C.kumach,
  lcdPhone: '#a9c7b1',
  lcdPhoneInk: '#13261a',
  lcdRadio: '#e0b45a',
  lcdRadioInk: '#2a1a05',
} as const;
