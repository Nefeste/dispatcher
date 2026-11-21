// Журнал недели (срез, часть С8; спецификация, §3, шаг 9; docs/04-data-model.md, §3): что сыграно на этой станции — по
// смене недели одна строка, когда её итог принят станцией (первый раз; повтор пройденной смены станцию не меняет, и
// журнал тоже). Строка — три числа итога и рёбра карты, по которым ехали бригады: битовая маска, шестнадцатеричной
// строкой (на карте района 3072 ребра — 768 знаков на смену). Из журнала — экран «Итог недели» и снимок недели с
// путями всех смен. Правды о больных нет: пути бригад и числа итога видны и в смене. Без React: проверяется тестом.
import type { Shift, ShiftCtx } from '../engine/shift';
import { totals } from '../engine/totals';
import type { ShiftReport } from '../engine/station';

export interface WeekEntry {
  shift: string;
  emergency: number;
  inNorm: number;
  deaths: number;
  /** рёбра, по которым ехали бригады смены: бит ребра `e` — бит `e % 4` знака `e >> 2` */
  paths: string;
}

export interface WeekLog {
  /** карта, по рёбрам которой записаны пути: другая карта — пути не рисуются */
  map: string;
  edges: number;
  shifts: WeekEntry[];
}

export function newWeekLog(map: string, edges: number): WeekLog {
  return { map, edges, shifts: [] };
}

/** Рёбра, по которым ехали бригады смены, — маской. */
export function pathsOf(ctx: ShiftCtx, s: Shift): string {
  const n = ctx.map.edges.a.length;
  const bits = new Uint8Array(Math.ceil(n / 4));
  for (const t of s.trail) for (const e of t.edges) if (e < n) bits[e >> 2] |= 1 << (e & 3);
  let out = '';
  for (const b of bits) out += b.toString(16);
  return out;
}

/** Номера рёбер из маски, по возрастанию. */
export function edgesOf(paths: string, edges: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < paths.length; i++) {
    const b = parseInt(paths[i], 16);
    if (!b) continue;
    for (let k = 0; k < 4; k++) if (b & (1 << k) && i * 4 + k < edges) out.push(i * 4 + k);
  }
  return out;
}

/** Строка журнала закрытой смены — из того же итога, что пришёл на станцию, и путей бригад. */
export function entryOf(ctx: ShiftCtx, s: Shift, rep: ShiftReport): WeekEntry {
  const t = totals(ctx, s);
  return { shift: rep.shift, emergency: t.emergency, inNorm: t.inNorm, deaths: rep.deaths, paths: pathsOf(ctx, s) };
}

/** Смена в журнал; та, что уже есть, — не меняется (как станция). Карта другая — журнал с этой смены. */
export function addEntry(log: WeekLog, map: string, edges: number, e: WeekEntry): WeekLog {
  const base = log.map === map && log.edges === edges ? log : newWeekLog(map, edges);
  if (base.shifts.some(x => x.shift === e.shift)) return base;
  return { ...base, shifts: [...base.shifts, e] };
}

/** Прочитать журнал из строки хранилища: не та форма — пустой журнал. */
export function parseWeekLog(raw: string | null): WeekLog {
  try {
    const x = raw ? (JSON.parse(raw) as Partial<WeekLog>) : null;
    if (!x || typeof x.map !== 'string' || !Number.isInteger(x.edges) || !Array.isArray(x.shifts)) return newWeekLog('', 0);
    const num = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
    const shifts = x.shifts
      .filter(e => e && typeof e.shift === 'string')
      .map(e => ({
        shift: e.shift, emergency: num(e.emergency), inNorm: num(e.inNorm), deaths: num(e.deaths),
        paths: typeof e.paths === 'string' && /^[0-9a-f]*$/.test(e.paths) ? e.paths : '',
      }));
    return { map: x.map, edges: x.edges!, shifts };
  } catch {
    return newWeekLog('', 0);
  }
}
