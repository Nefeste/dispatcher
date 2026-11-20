// Фонари ночной карты (срез, часть С6; спецификация, §6: «тёмная карта, фонари вдоль больших улиц»): точки вдоль
// магистралей и улиц второго класса через равный шаг. Чистая функция без Skia — проверяется тестом; пути рисует
// src/ui/map/paths.ts. Единицы — единицы карты (0,5 м). Одно и то же ребро, пройденное в обе стороны, в файле карты
// одно, поэтому двойных рядов нет.
import type { MapData } from './format';

/** Какие классы дорог освещены: 0 — магистрали, 1 — улицы второго класса. */
export const LIT_CLASSES: readonly number[] = [0, 1];
/** Шаг между фонарями, единицы карты: 100 — 50 м. */
export const LAMP_STEP = 100;

/** Точки фонарей: x, y подряд. Шаг меряется вдоль ребра, остаток переходит на следующий отрезок того же ребра. */
export function lampPoints(m: MapData, classes: readonly number[] = LIT_CLASSES, step = LAMP_STEP): Float32Array {
  const out: number[] = [];
  const { shape, cls } = m.edges;
  for (let e = 0; e < cls.length; e++) {
    if (!classes.includes(cls[e])) continue;
    const a = shape.starts[e], b = shape.starts[e + 1];
    let carry = step / 2;
    for (let k = a + 1; k < b; k++) {
      const x0 = shape.pts[(k - 1) * 2], y0 = shape.pts[(k - 1) * 2 + 1];
      const dx = shape.pts[k * 2] - x0, dy = shape.pts[k * 2 + 1] - y0;
      const len = Math.hypot(dx, dy);
      let d = carry;
      for (; d <= len; d += step) out.push(x0 + (dx * d) / len, y0 + (dy * d) / len);
      carry = d - len;
    }
  }
  return Float32Array.from(out);
}
