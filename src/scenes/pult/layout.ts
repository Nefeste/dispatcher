// Раскладка сцены «Пульт» (ADR 0009; docs/08-game-design.md, §10) — чистые функции, без React: где на экране монитор,
// окно карты, строка программы, вызовы, ждущие бригаду, и кадр края стола из Blender (src/art/pult.gen.ts).
// Сцена держится за ширину экрана: кадр стола — во всю ширину внизу, монитор — над ним до верха.
import { PULT } from '../../art/pult.gen';

export interface Rect { x: number; y: number; w: number; h: number }
export type Quad = readonly (readonly [number, number])[];

/** Толщины рамки монитора и полос программы, точки экрана (dp). */
export const BEZEL = { top: 12, bottom: 18 } as const;
export const BAR = 38;
export const WAITING = 66;
/** Сверху над монитором — полоса зала. */
export const HALL = 8;
/** Низ монитора — над подставкой: доля высоты кадра стола от его верха. */
const MONITOR_FOOT = 0.09;

export interface PultLayout {
  /** точек экрана на пиксель кадра стола */
  k: number;
  desk: Rect;
  monitor: Rect;
  screen: Rect;
  bar: Rect;
  map: Rect;
  waiting: Rect;
  phone: { tap: Rect; lcd: Quad; lamp: [number, number, number] };
  radio: { tap: Rect; lcd: Quad };
}

function scaleRect(r: readonly number[], k: number, dy: number): Rect {
  return { x: r[0] * k, y: dy + r[1] * k, w: (r[2] - r[0]) * k, h: (r[3] - r[1]) * k };
}

function scaleQuad(q: readonly (readonly number[])[], k: number, dy: number): Quad {
  return q.map(p => [p[0] * k, dy + p[1] * k] as const);
}

export function pultLayout(width: number, height: number): PultLayout {
  const k = width / PULT.w;
  const dh = PULT.h * k;
  const desk = { x: 0, y: height - dh, w: width, h: dh };
  // стороны монитора — за краями экрана: смотрим близко, видна середина экрана монитора
  const top = HALL;
  const bottom = desk.y + dh * MONITOR_FOOT;
  const monitor = { x: -24, y: top, w: width + 48, h: bottom - top };
  const screen = { x: 0, y: top + BEZEL.top, w: width, h: bottom - top - BEZEL.top - BEZEL.bottom };
  const bar = { x: 0, y: screen.y, w: width, h: BAR };
  const waiting = { x: 0, y: screen.y + screen.h - WAITING, w: width, h: WAITING };
  const map = { x: 0, y: bar.y + bar.h, w: width, h: waiting.y - bar.y - bar.h };
  const p = PULT.phone;
  return {
    k,
    desk,
    monitor,
    screen,
    bar,
    map,
    waiting,
    phone: { tap: scaleRect(p.tap, k, desk.y), lcd: scaleQuad(p.lcd, k, desk.y), lamp: [p.lamp[0] * k, desk.y + p.lamp[1] * k, p.lamp[2] * k] },
    radio: { tap: scaleRect(PULT.radio.tap, k, desk.y), lcd: scaleQuad(PULT.radio.lcd, k, desk.y) },
  };
}

/**
 * Матрица 3 × 3 Skia (построчно, с перспективой), которая переводит прямоугольник (0, 0, w, h) в четырёхугольник
 * `q` — углы по часовой от левого верхнего. Так текст ложится на экранчик телефона в перспективе кадра.
 * Квадрат в четырёхугольник — по Хекберту (Heckbert, «Fundamentals of Texture Mapping», 1989, §2.2.3).
 */
export function quadMatrix(w: number, h: number, q: Quad): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, i: number;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0;
    d = y1 - y0; e = y2 - y1; f = y0;
    g = 0; i = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const det = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / det;
    i = (dx1 * sy - sx * dy1) / det;
    a = x1 - x0 + g * x1; b = x3 - x0 + i * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + i * y3; f = y0;
  }
  // сначала (x, y) → (x / w, y / h), потом квадрат в четырёхугольник
  return [a / w, b / h, c, d / w, e / h, f, g / w, i / h, 1];
}

/** Куда матрица переводит точку — для проверки. */
export function applyMatrix(m: readonly number[], x: number, y: number): [number, number] {
  const z = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z];
}
