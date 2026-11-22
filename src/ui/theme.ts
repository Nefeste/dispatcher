// из gornitsa: brand/tokens.css @ 1836829 — не править здесь (светлая тема; тёмная — с ночными сменами).
// Цвета названы нитями вышивки: лён и бумага — ткань, чернила — текст, кумач и ель — нити.
// Свои цвета карты игры (вода, дороги, метки вызовов) — в листе стиля, docs/13-art.md, с частью П2.
export const C = {
  linen: '#ecede6',
  paper: '#f7f7f2',
  ink: '#1a1b1e',
  inkSoft: '#4b4f4c',
  line: '#cfd1c6',
  cell: '#d9dbd1',
  kumach: '#b3162f',
  kumachInk: '#ffffff',
  spruce: '#1f3c34',
  flax: '#a8904f',
} as const;

export const R = { button: 6, card: 10, pill: 999 } as const;

/** Шкала текста бренда в точках (1rem = 16). */
export const S = { small: 14, body: 17, lead: 21, title: 28, hero: 36 } as const;

// --- своё у игры (docs/13-art.md, §7), не из брендбука: шаг отступов и размеры программы на мониторе
/** Отступы — шаг 4: между строками, внутри карточки, между блоками, поля экрана. */
export const G = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;
/** Наименьшая цель касания (брендбук, «Интерфейс»: 48 dp). */
export const TOUCH = 48;
