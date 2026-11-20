// Масштабы карты без Skia и React (docs/02-architecture.md, §5): сколько точек экрана на единицу карты, когда район в
// окне целиком; ширина дороги на экране при приближении; размер картинки района, которую карта рисует в движении
// (0.10.2). Проверяется тестом (tools/test/mapscale.test.ts).
import type { MapData } from '../../map/format';
import { DETAIL, FAR_WIDTH } from './palette';

/** Точек экрана (dp) на единицу карты, когда район заполняет окно `width × height` целиком, без пустых полос. */
export function fitOf(m: Pick<MapData, 'width' | 'height'>, width: number, height: number): number {
  return Math.max(width / m.width, height / m.height);
}

/**
 * Ширина линии в единицах карты при приближении `zoom` (точек экрана на единицу карты): на экране — `px` с приближения
 * ×`DETAIL`, ближе к «район в окне» — тоньше в той же доле, но не тоньше `FAR_WIDTH` от `px`.
 */
export function roadWidth(zoom: number, fit: number, px: number): number {
  'worklet';
  const k = Math.min(1, Math.max(FAR_WIDTH, zoom / (fit * DETAIL)));
  return (px * k) / zoom;
}

/** Ширина линии на картинке района, в единицах карты: та, что у `roadWidth` от ×`FAR_WIDTH · DETAIL` до ×`DETAIL`,
 *  где она в единицах карты одна. Ближе к району картинка рисует дороги тоньше путей, ближе к улицам — толще. */
export function imageWidth(fit: number, px: number): number {
  return px / (DETAIL * fit);
}

/** Самая длинная сторона картинки района, точек: текстура такого размера помещается в видеокарту любого телефона. */
export const BASE_MAX = 4096;

/** Размер картинки района, точек, и точек картинки на единицу карты: самая длинная сторона — `BASE_MAX`. */
export function imageSize(m: Pick<MapData, 'width' | 'height'>): { width: number; height: number; k: number } {
  const k = BASE_MAX / Math.max(m.width, m.height);
  return { width: Math.round(m.width * k), height: Math.round(m.height * k), k };
}
