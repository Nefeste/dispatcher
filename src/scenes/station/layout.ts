// Раскладка сцены «Станция» (срез, часть С2; ADR 0009) — чистая функция: кадр рабочего места из Blender
// (src/art/station.gen.ts) во всю ширину экрана, прижат к низу; на длинном экране сверху — полоса зала, на коротком
// кадр уходит вверх за край (там окно). Касания предметов и четыре угла листов — в точках экрана.
import { STATION_ART } from '../../art/station.gen';
import type { Quad, Rect } from '../pult/layout';

export type StationItem = 'letter' | 'roster' | 'ledger' | 'bag';
export const ITEMS: readonly StationItem[] = ['letter', 'roster', 'ledger', 'bag'];

/** Местные размеры листов: текст пишется в них, матрица кладёт его в перспективу кадра. */
export const SHEET: Record<StationItem, { w: number; h: number }> = {
  letter: { w: 200, h: 280 },
  roster: { w: 200, h: 260 },
  ledger: { w: 150, h: 85 },
  bag: { w: 100, h: 55 },
};

export interface StationLayout {
  frame: Rect;
  tap: Record<StationItem, Rect>;
  quad: Record<StationItem, Quad>;
}

export function stationLayout(width: number, height: number): StationLayout {
  const k = width / STATION_ART.w;
  const fh = STATION_ART.h * k;
  const frame = { x: 0, y: height - fh, w: width, h: fh };
  const tap = {} as Record<StationItem, Rect>;
  const quad = {} as Record<StationItem, Quad>;
  for (const it of ITEMS) {
    const t = STATION_ART[it].tap;
    tap[it] = { x: t[0] * k, y: frame.y + t[1] * k, w: (t[2] - t[0]) * k, h: (t[3] - t[1]) * k };
    quad[it] = STATION_ART[it].quad.map(p => [p[0] * k, frame.y + p[1] * k] as const);
  }
  return { frame, tap, quad };
}
