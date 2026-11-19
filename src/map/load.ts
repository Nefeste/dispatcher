// Карта района в игре: модуль сборки (src/map/generated) → MapData, один раз за запуск.
import { fromBase64, type MapData, readMap } from './format';
import { MAP_NN_CENTER } from './generated/nn-center';

const SOURCES: Record<string, string> = { 'nn-center': MAP_NN_CENTER };
const cache = new Map<string, MapData>();

export function loadMap(id: string): MapData {
  const hit = cache.get(id);
  if (hit) return hit;
  const src = SOURCES[id];
  if (!src) throw new Error(`no map ${id}`);
  const m = readMap(fromBase64(src));
  cache.set(id, m);
  return m;
}
