// Цвета рабочего места (docs/13-art.md, «Рабочее место»): одна таблица для сцены. Номер области — в desk.gen.ts
// (blender/build.py, REGIONS — тот же порядок). Цвет грани = цвет области × затенение вершины × свет сцены. Акцент —
// кумач брендбука, ель — кружка; остальное — спокойные серые зала вечером.
import { C } from '../ui/theme';

export const REGIONS = ['floor', 'wall', 'partition', 'desk', 'edge', 'metal', 'plastic', 'dark', 'key', 'chair', 'accent',
  'paper', 'mug', 'lamp', 'glass', 'pad', 'glow'] as const;

/** Области, что светятся сами (светильники потолка): рисуются без света сцены. */
export const GLOWING = new Set<number>([REGIONS.indexOf('glow')]);

export const COLORS: Record<(typeof REGIONS)[number], string> = {
  floor: '#3f4749',
  wall: '#c3c8c1',
  partition: '#5d7566',
  desk: '#d9d3c5',
  edge: '#8f8b82',
  metal: '#a9afb1',
  plastic: '#2c3034',
  dark: '#1e2125',
  key: '#3b4046',
  chair: '#2f3d46',
  accent: C.kumach,
  paper: C.paper,
  mug: C.spruce,
  lamp: '#e8e6df',
  glass: '#4d6977',
  pad: '#262b2f',
  glow: '#f3f1ea',
};

/** Цвет области — линейный RGB 0…1 (sRGB → линейный). Из probe-3d: src/art/palette.ts @ 57b1e33. */
export function linear(hex: string): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return out;
}
