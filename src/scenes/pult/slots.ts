// Знаки бригад на карте пульта (часть П3) — чистая функция, без React: где поставить знак рядом с соседями.
import type { Crew } from '../../engine/crews';

/** Сдвиг знаков бригад, что стоят в одном узле: рядом над ним, а не друг на друге. Едущие — без сдвига. */
export function slots(crews: readonly Crew[]): [number, number][] {
  const groups = new Map<number, number[]>();
  crews.forEach((c, i) => {
    if (c.route) return;
    groups.set(c.at, [...(groups.get(c.at) ?? []), i]);
  });
  const out: [number, number][] = crews.map(() => [0, 0]);
  for (const ids of groups.values()) {
    ids.forEach((i, k) => {
      out[i] = [(k - (ids.length - 1) / 2) * 26, crews[i].state === 'base' ? -26 : 0];
    });
  }
  return out;
}
