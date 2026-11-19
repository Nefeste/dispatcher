// Файл карты района (docs/02-architecture.md, §5; ADR 0004): заголовок и массивы целых чисел. Сообщения об
// ошибках — по-английски: их видит разработчик, а не игрок (строки для игрока — только в src/i18n). Пишет его
// tools/map/build.ts, читает это же — и в игре, и в тестах. Чистый TypeScript, без Expo и React.
//
// Координаты — целые «полуметры» (0,5 м) от северо-западного угла района: x — на восток, y — на юг.
// Граф дорог: узлы — перекрёстки и концы, рёбра — участки улиц между ними, длина — в сантиметрах.
// Форма ребра (точки между концами) — для рисования улиц и движения бригады по ним.

export const MAP_MAGIC = 0x4d505344; // «DSPM» в порядке little-endian
export const MAP_VERSION = 1;
/** сантиметров в одной единице координат */
export const UNIT_CM = 50;

/** Классы дорог: 0 — магистрали, 1 — улицы второго класса, 2 — третьего, 3 — местные. */
export const ROAD_CLASSES = 4;

export interface Polylines {
  /** начало каждой линии в `pts` (в точках), последняя — длина `pts`/2 */
  starts: Uint32Array;
  /** x, y по очереди */
  pts: Uint16Array;
}

export interface MapData {
  id: string;
  /** размер района в единицах (0,5 м) */
  width: number;
  height: number;
  nodes: { x: Uint16Array; y: Uint16Array };
  edges: {
    a: Uint32Array;
    b: Uint32Array;
    /** длина в сантиметрах */
    len: Uint32Array;
    cls: Uint8Array;
    /** 0 — в обе стороны, 1 — только от a к b */
    oneway: Uint8Array;
    /** форма ребра: точки от a до b включительно */
    shape: Polylines;
  };
  /** вода и зелень — кольца многоугольников (заливка «чёт-нечет»); железные дороги — линии */
  water: Polylines;
  green: Polylines;
  rail: Polylines;
}

type Section = [name: string, kind: 'u8' | 'u16' | 'u32', data: Uint8Array | Uint16Array | Uint32Array];

function sections(m: MapData): Section[] {
  const s: Section[] = [
    ['nodes.x', 'u16', m.nodes.x], ['nodes.y', 'u16', m.nodes.y],
    ['edges.a', 'u32', m.edges.a], ['edges.b', 'u32', m.edges.b], ['edges.len', 'u32', m.edges.len],
    ['edges.cls', 'u8', m.edges.cls], ['edges.oneway', 'u8', m.edges.oneway],
    ['edges.shape.starts', 'u32', m.edges.shape.starts], ['edges.shape.pts', 'u16', m.edges.shape.pts],
  ];
  for (const k of ['water', 'green', 'rail'] as const) s.push([`${k}.starts`, 'u32', m[k].starts], [`${k}.pts`, 'u16', m[k].pts]);
  return s;
}

const ascii = (s: string) => Array.from(s, c => {
  const code = c.charCodeAt(0);
  if (code > 126) throw new Error(`map header must be ASCII: ${s}`);
  return code;
});

/** Заголовок — строка ASCII: `id;width;height;name:kind:offset:count,...` (без JSON — Hermes без TextDecoder). */
export function writeMap(m: MapData): Uint8Array {
  const list = sections(m);
  const align = (n: number) => (n + 3) & ~3;
  // смещения считаются от начала области данных
  let off = 0;
  const parts = list.map(([name, kind, data]) => {
    const p = { name, kind, off, count: data.length, bytes: data.byteLength };
    off = align(off + data.byteLength);
    return p;
  });
  const head = ascii(`${m.id};${m.width};${m.height};${parts.map(p => `${p.name}:${p.kind}:${p.off}:${p.count}`).join(',')}`);
  const dataStart = align(12 + head.length);
  const out = new Uint8Array(dataStart + off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAP_MAGIC, true);
  dv.setUint32(4, MAP_VERSION, true);
  dv.setUint32(8, head.length, true);
  out.set(head, 12);
  list.forEach(([, , data], i) => out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), dataStart + parts[i].off));
  return out;
}

/** Байты файла → карта. Массивы — виды на тот же буфер, без копий (буфер должен начинаться с выровненного адреса). */
export function readMap(bytes: Uint8Array): MapData {
  const buf = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== MAP_MAGIC) throw new Error('not a map file');
  const version = dv.getUint32(4, true);
  if (version !== MAP_VERSION) throw new Error(`map file version ${version}, expected ${MAP_VERSION}`);
  const headLen = dv.getUint32(8, true);
  let head = '';
  for (let i = 0; i < headLen; i++) head += String.fromCharCode(buf[12 + i]);
  const [id, w, h, list] = head.split(';');
  const dataStart = buf.byteOffset + ((12 + headLen + 3) & ~3);
  const sec = new Map<string, Uint8Array | Uint16Array | Uint32Array>();
  for (const item of list.split(',')) {
    const [name, kind, off, count] = item.split(':');
    const at = dataStart + Number(off);
    const n = Number(count);
    sec.set(name, kind === 'u8' ? new Uint8Array(buf.buffer, at, n) : kind === 'u16' ? new Uint16Array(buf.buffer, at, n) : new Uint32Array(buf.buffer, at, n));
  }
  const get = <T>(name: string) => {
    const v = sec.get(name);
    if (!v) throw new Error(`map file has no section ${name}`);
    return v as T;
  };
  const lines = (k: string): Polylines => ({ starts: get<Uint32Array>(`${k}.starts`), pts: get<Uint16Array>(`${k}.pts`) });
  return {
    id,
    width: Number(w),
    height: Number(h),
    nodes: { x: get('nodes.x'), y: get('nodes.y') },
    edges: {
      a: get('edges.a'), b: get('edges.b'), len: get('edges.len'), cls: get('edges.cls'), oneway: get('edges.oneway'),
      shape: lines('edges.shape'),
    },
    water: lines('water'),
    green: lines('green'),
    rail: lines('rail'),
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 → байты: свой разбор, без `atob` и `Buffer` — одинаково в Hermes, браузере и Bun. */
export function fromBase64(s: string): Uint8Array {
  const look = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) look[B64.charCodeAt(i)] = i;
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61) len--;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = look[s.charCodeAt(i)], b = look[s.charCodeAt(i + 1)];
    const c = i + 2 < len ? look[s.charCodeAt(i + 2)] : 0, d = i + 3 < len ? look[s.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
