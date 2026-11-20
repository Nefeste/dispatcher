// Слои карты как пути Skia — собираются один раз при загрузке, жесты двигают только матрицу (docs/02-architecture.md, §5).
// Строятся через PathBuilder: методы изменения SkPath в Skia 2.6.2 устарели.
import { drawAsImageFromPicture, FillType, PaintStyle, type SkImage, type SkPath, type SkPathBuilder, Skia, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';
import { type MapData, type Polylines, ROAD_CLASSES } from '../../map/format';
import { CASING_PX, MAP, ROAD_PX } from './palette';
import { imageSize, imageWidth } from './scale';

export interface MapPaths {
  water: SkPath;
  green: SkPath;
  rail: SkPath;
  /** по классу дороги: 0 — магистрали … 3 — местные */
  roads: SkPath[];
  /** Те же дороги и железная дорога кусками по сетке района (`TILES`): Skia не обводит кусок, который целиком за
   *  краем экрана, — при приближении рисуется только видимое (замер на телефоне владельца, 0.10.1). Пустых нет. */
  tiles: { roads: SkPath[][]; rail: SkPath[] };
}

/** Сетка кусков: столбцов и строк. Район — около 6 × 9 км, кусок — около километра. */
export const TILES = { cols: 6, rows: 9 } as const;

/** Номер куска сетки, в который попадает точка карты. */
export function tileOf(m: MapData, x: number, y: number): number {
  const c = Math.min(TILES.cols - 1, Math.max(0, Math.floor((x / m.width) * TILES.cols)));
  const r = Math.min(TILES.rows - 1, Math.max(0, Math.floor((y / m.height) * TILES.rows)));
  return r * TILES.cols + c;
}

/** Кусок ломаной `i` — по середине её первой и последней точки. */
function lineTile(m: MapData, l: Polylines, i: number): number {
  const a = l.starts[i], b = l.starts[i + 1] - 1;
  return tileOf(m, (l.pts[a * 2] + l.pts[b * 2]) / 2, (l.pts[a * 2 + 1] + l.pts[b * 2 + 1]) / 2);
}

function addLines(p: SkPathBuilder, l: Polylines, from: number, to: number, close: boolean) {
  for (let i = from; i < to; i++) {
    const a = l.starts[i], b = l.starts[i + 1];
    if (b - a < 2) continue;
    p.moveTo(l.pts[a * 2], l.pts[a * 2 + 1]);
    for (let k = a + 1; k < b; k++) p.lineTo(l.pts[k * 2], l.pts[k * 2 + 1]);
    if (close) p.close();
  }
}

/** Пути карты — один раз на файл карты: их строит загрузка, а окно карты берёт готовые. */
const cache = new WeakMap<MapData, MapPaths>();
export function cachedMapPaths(m: MapData): MapPaths {
  let p = cache.get(m);
  if (!p) cache.set(m, (p = mapPaths(m)));
  return p;
}

export function mapPaths(m: MapData): MapPaths {
  const water = Skia.PathBuilder.Make();
  addLines(water, m.water, 0, m.water.starts.length - 1, true);
  water.setFillType(FillType.EvenOdd);
  const green = Skia.PathBuilder.Make();
  addLines(green, m.green, 0, m.green.starts.length - 1, true);
  green.setFillType(FillType.EvenOdd);
  const rail = Skia.PathBuilder.Make();
  addLines(rail, m.rail, 0, m.rail.starts.length - 1, false);
  const roads = Array.from({ length: ROAD_CLASSES }, () => Skia.PathBuilder.Make());
  const { shape, cls } = m.edges;
  for (let e = 0; e < cls.length; e++) addLines(roads[cls[e]], shape, e, e + 1, false);
  // куски: по классу дороги и куску сетки; пустые не нужны
  const n = TILES.cols * TILES.rows;
  const roadTiles = Array.from({ length: ROAD_CLASSES }, () => new Map<number, SkPathBuilder>());
  const piece = (map: Map<number, SkPathBuilder>, t: number) => {
    let b = map.get(t);
    if (!b) map.set(t, (b = Skia.PathBuilder.Make()));
    return b;
  };
  for (let e = 0; e < cls.length; e++) if (shape.starts[e + 1] - shape.starts[e] >= 2) addLines(piece(roadTiles[cls[e]], lineTile(m, shape, e)), shape, e, e + 1, false);
  const railTiles = new Map<number, SkPathBuilder>();
  for (let i = 0; i < m.rail.starts.length - 1; i++) if (m.rail.starts[i + 1] - m.rail.starts[i] >= 2) addLines(piece(railTiles, lineTile(m, m.rail, i)), m.rail, i, i + 1, false);
  const ordered = (map: Map<number, SkPathBuilder>) => Array.from({ length: n }, (_, t) => map.get(t)).filter((b): b is SkPathBuilder => !!b).map(b => b.detach());
  return {
    water: water.detach(), green: green.detach(), rail: rail.detach(), roads: roads.map(r => r.detach()),
    tiles: { roads: roadTiles.map(ordered), rail: ordered(railTiles) },
  };
}

/**
 * Картинка района целиком (0.10.2, по второму замеру на телефоне владельца): земля, зелень, вода, железная дорога и
 * дороги — один растр; его рисует карта, пока камера движется, вместо сотен путей, а встала — снова пути (MapView).
 * `fit` — как у окна карты (`fitOf`); ширина дорог — `imageWidth`.
 */
export function mapImage(m: MapData, paths: MapPaths, fit: number): SkImage | null {
  const { width, height, k } = imageSize(m);
  const unit = (px: number) => imageWidth(fit, px);
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
  c.scale(k, k);
  const fill = (color: string) => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(Skia.Color(color));
    return p;
  };
  const stroke = (color: string, w: number) => {
    const p = fill(color);
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(w);
    p.setStrokeCap(StrokeCap.Round);
    p.setStrokeJoin(StrokeJoin.Round);
    return p;
  };
  // порядок — как у путей в MapView.tsx
  c.drawRect(Skia.XYWHRect(0, 0, m.width, m.height), fill(MAP.land));
  c.drawPath(paths.green, fill(MAP.green));
  c.drawPath(paths.water, fill(MAP.water));
  c.drawPath(paths.rail, stroke(MAP.rail, unit(1.2)));
  c.drawPath(paths.roads[3], stroke(MAP.road[3], unit(ROAD_PX[3])));
  for (const cls of [2, 1, 0]) c.drawPath(paths.roads[cls], stroke(MAP.casing, unit(ROAD_PX[cls] + CASING_PX * 2)));
  for (const cls of [2, 1, 0]) c.drawPath(paths.roads[cls], stroke(MAP.road[cls], unit(ROAD_PX[cls])));
  const picture = rec.finishRecordingAsPicture();
  rec.dispose();
  return drawAsImageFromPicture(picture, { width, height });
}

/** Картинки района — на файл карты и `fit` окна: окно карты пульта и окно «Замера» — по своей. Старые не закрываются
 *  явно (их может ещё держать открытое окно карты) — их память отдаёт сборщик. */
const images = new WeakMap<MapData, Map<string, SkImage | null>>();
const KEEP = 2;
export function cachedMapImage(m: MapData, fit: number): SkImage | null {
  const key = fit.toFixed(9);
  let byFit = images.get(m);
  if (!byFit) images.set(m, (byFit = new Map()));
  if (byFit.has(key)) return byFit.get(key) ?? null;
  let made: SkImage | null = null;
  try {
    made = mapImage(m, cachedMapPaths(m), fit);
  } catch {
    // нет поверхности для картинки — карта рисуется путями и в движении
  }
  byFit.set(key, made);
  while (byFit.size > KEEP) byFit.delete(byFit.keys().next().value as string);
  return made;
}
