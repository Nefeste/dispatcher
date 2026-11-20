// Слои карты как пути Skia — собираются один раз при загрузке, жесты двигают только матрицу (docs/02-architecture.md, §5).
// Строятся через PathBuilder: методы изменения SkPath в Skia 2.6.2 устарели.
import { FillType, type SkPath, type SkPathBuilder, Skia } from '@shopify/react-native-skia';
import { type MapData, type Polylines, ROAD_CLASSES } from '../../map/format';

export interface MapPaths {
  water: SkPath;
  green: SkPath;
  rail: SkPath;
  /** по классу дороги: 0 — магистрали … 3 — местные */
  roads: SkPath[];
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
  return { water: water.detach(), green: green.detach(), rail: rail.detach(), roads: roads.map(r => r.detach()) };
}
