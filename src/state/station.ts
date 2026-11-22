// Станция на телефоне (срез, часть С2; docs/04-data-model.md, §3): состояние станции недели в хранилище — у каждой
// недели своя (путь к 1.0, В2а; у первой — ключ `station`). Итог смены приходит на станцию один раз (повтор экрана итога и «Ещё раз» его не удваивают — повтор
// пройденной смены станцию не меняет, src/engine/station.ts). Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import { KIT } from '../engine/rules';
import type { Shift, ShiftCtx } from '../engine/shift';
import { afterShift, decide as decideStation, type Decision, newStation, reportOf, type Station, type StationRefusal } from '../engine/station';
import { KEYS, readRaw, weekKey, writeRaw } from './storage';
import { firstWeek, weekOfShift } from './week';
import { addEntry, entryOf, newWeekLog, parseWeekLog, type WeekLog } from './weekLog';

/** Прочитать станцию из строки хранилища: не та форма — станция с начала недели. */
export function parseStation(raw: string | null): Station {
  try {
    const x = raw ? (JSON.parse(raw) as Partial<Station>) : null;
    if (!x || typeof x.fund !== 'number' || !Number.isFinite(x.fund) || !Array.isArray(x.extra) || !Array.isArray(x.done) || !Array.isArray(x.journal)) return newStation();
    const bases = new Set(Object.values(DB.cities).flatMap(c => c.bases.map(b => b.id)));
    const extra = x.extra.filter(c => c && typeof c.id === 'string' && c.kind === 'crew.general' && bases.has(c.base));
    const kits: Record<string, number> = {};
    for (const [id, n] of Object.entries(x.kits ?? {})) if (Number.isInteger(n) && n >= 0 && n < KIT) kits[id] = n;
    const done = x.done.filter(id => typeof id === 'string' && Boolean(DB.shifts[id]));
    const trained = Array.isArray(x.trained) ? x.trained.filter((id): id is string => typeof id === 'string') : [];
    return {
      fund: Math.round(x.fund), extra, trained, kits, journal: x.journal, letter: x.letter ?? null, done,
      decided: Number.isInteger(x.decided) ? Math.max(0, x.decided!) : 0,
    };
  } catch {
    return newStation();
  }
}

/** Ключи станции и журнала недели (путь к 1.0, В2а): у первой недели — прежние (`station`, `week`), у следующих — с
 *  именем недели; так сохранения 0.24.0 и 0.25.0 читаются как были. */
export function keysOf(week: string): { station: string; log: string } {
  if (week === firstWeek()) return { station: KEYS.station, log: KEYS.week };
  const name = week.replace(/^week\./, '');
  return { station: weekKey('station', name), log: weekKey('week', name) };
}

const cache = new Map<string, Station>();
/** последняя запись итога смены: экран станции ждёт её, чтобы не прочитать станцию до итога */
let pending: Promise<unknown> = Promise.resolve();

async function load(week: string): Promise<Station> {
  let st = cache.get(week);
  if (!st) cache.set(week, (st = parseStation(await readRaw(keysOf(week).station))));
  return st;
}

/** Станция недели; без недели — первой. */
export async function readStation(week: string = firstWeek()): Promise<Station> {
  await pending;
  return load(week);
}

async function write(week: string, st: Station): Promise<void> {
  cache.set(week, st);
  await writeRaw(keysOf(week).station, JSON.stringify(st));
}

// итог одной смены приходит один раз: экран итога может открыться снова (из разбора вызова)
const applied = new Map<string, Promise<Station>>();

/** Итог закрытой смены недели — на станцию её недели: станция получает только `ShiftReport` (числа итога, жалобы,
 *  укладки). Один раз на смену и её зерно; повторно — та же станция. Смена не из недели станцию не трогает. */
export function recordShiftOnce(ctx: ShiftCtx, s: Shift): Promise<Station> {
  const week = ctx.setup.week?.of ?? firstWeek();
  const key = `${ctx.setup.id}:${s.seed}`;
  let p = applied.get(key);
  if (!p) {
    const rep = reportOf(ctx, s);
    p = load(week).then(async st => {
      if (!ctx.setup.week) return st;
      const next = afterShift(st, rep);
      if (next !== st) {
        await write(week, next);
        // та же смена — в журнал недели, с путями бригад: из него итог и снимок недели (срез, С8)
        const log = addEntry(await readWeekLog(week), ctx.map.id, ctx.map.edges.a.length, entryOf(ctx, s, rep));
        await writeRaw(keysOf(week).log, JSON.stringify(log));
      }
      return next;
    });
    applied.set(key, p);
    pending = p;
  }
  return p;
}

/** Решение за рабочим местом: принято — станция записана; нет — почему. */
export async function decideAndSave(d: Decision, week: string = firstWeek()): Promise<Station | StationRefusal> {
  const next = decideStation(await readStation(week), d);
  if (typeof next === 'string') return next;
  await write(week, next);
  return next;
}

/** Журнал недели этой станции (src/state/weekLog.ts). */
export async function readWeekLog(week: string = firstWeek()): Promise<WeekLog> {
  return parseWeekLog(await readRaw(keysOf(week).log));
}

/** «Неделя заново» (спецификация среза, §3, шаг 10): новая станция этой недели — фонд, свои бригады, укладки, письма —
 *  и пустой журнал недели; лучшие итоги смен остаются (§7 геймдизайна: «лучший итог смены хранится»), другие недели —
 *  тоже. Незаконченная смена этой недели забыта: её бригады и укладки — со старой станции. */
export async function resetWeek(week: string = firstWeek()): Promise<void> {
  await pending;
  for (const k of [...applied.keys()]) if (weekOfShift(k.slice(0, k.lastIndexOf(':'))) === week) applied.delete(k);
  await write(week, newStation());
  await writeRaw(keysOf(week).log, JSON.stringify(newWeekLog('', 0)));
  const saved = await readRaw(KEYS.current);
  try {
    const setup = saved ? (JSON.parse(saved) as { setup?: string }).setup : null;
    if (setup && weekOfShift(setup) === week) await writeRaw(KEYS.current, null);
  } catch {
    // сохранение не читается — его и так не продолжить
  }
}
