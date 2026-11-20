// Масштабы карты (src/ui/map/scale.ts; docs/02-architecture.md, §5): картинка района, которую карта рисует в движении
// (0.10.2), помещается в видеокарту, чётче экрана при районе в окне и рисует дороги той же ширины, что пути, на
// приближениях, где игрок смотрит улицы; карта в движении — картинкой, на месте — путями (MapView.tsx).
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromBase64, readMap } from '../../src/map/format';
import { MAP_NN_CENTER } from '../../src/map/generated/nn-center';
import { pultLayout } from '../../src/scenes/pult/layout';
import { DETAIL, FAR_WIDTH, ROAD_PX } from '../../src/ui/map/palette';
import { BASE_MAX, fitOf, imageSize, imageWidth, roadWidth } from '../../src/ui/map/scale';

const map = readMap(fromBase64(MAP_NN_CENTER));
// телефон владельца (375 × 745 dp, плотность 3,25) и пошире: окно карты пульта и «Замера» (весь экран); плотность — до 3,5
const screens = [{ w: 375, h: 745 }, { w: 412, h: 892 }, { w: 360, h: 740 }];
const windows = screens.flatMap(z => {
  const m = pultLayout(z.w, z.h).map;
  return [z, { w: m.w, h: m.h }];
});

test('картинка района: длинная сторона — BASE_MAX, пропорции района', () => {
  const s = imageSize(map);
  expect(Math.max(s.width, s.height)).toBe(BASE_MAX);
  expect(Math.abs(s.width / s.height - map.width / map.height)).toBeLessThan(0.001);
  // 4 байта на точку: около 46 МБ — одна текстура на всю смену
  expect(s.width * s.height * 4).toBeLessThan(48 * 1024 * 1024);
});

test('картинка не мягче экрана, пока район в окне целиком', () => {
  for (const { w, h } of windows) expect(imageSize(map).k).toBeGreaterThanOrEqual(fitOf(map, w, h) * 3.5 * 1.25);
});

test('ширина дорог на картинке — как у путей от ×FAR_WIDTH·DETAIL до ×DETAIL', () => {
  for (const { w, h } of windows) {
    const fit = fitOf(map, w, h);
    for (const px of ROAD_PX) {
      for (let z = FAR_WIDTH * DETAIL; z <= DETAIL + 1e-9; z += 0.1) expect(roadWidth(z * fit, fit, px)).toBeCloseTo(imageWidth(fit, px), 9);
      // ближе к району пути толще картинки, ближе к улицам — тоньше: на экране — не больше `px`
      expect(roadWidth(fit, fit, px)).toBeGreaterThan(imageWidth(fit, px));
      expect(roadWidth(8 * fit, fit, px) * 8 * fit).toBeCloseTo(px, 9);
    }
  }
});

test('район в окне целиком — без пустых полос', () => {
  for (const { w, h } of windows) {
    const fit = fitOf(map, w, h);
    expect(map.width * fit).toBeGreaterThanOrEqual(w - 1e-9);
    expect(map.height * fit).toBeGreaterThanOrEqual(h - 1e-9);
  }
});

test('карта в движении — картинкой, на месте — путями; картинку строит загрузка', () => {
  const view = readFileSync(join(import.meta.dir, '../../src/ui/map/MapView.tsx'), 'utf8');
  expect(view).toContain('cachedMapImage(map, fit)');
  expect(view).toMatch(/IDLE_MS = \d+/);
  // пальцы и автопилот «Замера» ставят движение
  expect(view.split('motion.set(1)').length - 1).toBeGreaterThanOrEqual(3);
  const loading = readFileSync(join(import.meta.dir, '../../src/screens/LoadingScreen.tsx'), 'utf8');
  expect(loading).toContain('cachedMapImage(map, fitOf(map, box.w, box.h))');
});
