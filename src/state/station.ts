// Станция на телефоне (срез, часть С2; docs/04-data-model.md, §3): состояние станции недели в хранилище — ключ
// `station`. Итог смены приходит на станцию один раз (повтор экрана итога и «Ещё раз» его не удваивают — повтор
// пройденной смены станцию не меняет, src/engine/station.ts). Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import { KIT } from '../engine/rules';
import type { Shift, ShiftCtx } from '../engine/shift';
import { afterShift, decide as decideStation, type Decision, newStation, reportOf, type Station, type StationRefusal } from '../engine/station';
import { KEYS, readRaw, writeRaw } from './storage';

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

let cache: Station | null = null;
/** последняя запись итога смены: экран станции ждёт её, чтобы не прочитать станцию до итога */
let pending: Promise<unknown> = Promise.resolve();

async function load(): Promise<Station> {
  if (!cache) cache = parseStation(await readRaw(KEYS.station));
  return cache;
}

export async function readStation(): Promise<Station> {
  await pending;
  return load();
}

async function write(st: Station): Promise<void> {
  cache = st;
  await writeRaw(KEYS.station, JSON.stringify(st));
}

// итог одной смены приходит один раз: экран итога может открыться снова (из разбора вызова)
const applied = new Map<string, Promise<Station>>();

/** Итог закрытой смены недели — на станцию: станция получает только `ShiftReport` (числа итога, жалобы, укладки).
 *  Один раз на смену и её зерно; повторно — та же станция. */
export function recordShiftOnce(ctx: ShiftCtx, s: Shift): Promise<Station> {
  const key = `${ctx.setup.id}:${s.seed}`;
  let p = applied.get(key);
  if (!p) {
    const rep = reportOf(ctx, s);
    p = load().then(async st => {
      const next = afterShift(st, rep);
      if (next !== st) await write(next);
      return next;
    });
    applied.set(key, p);
    pending = p;
  }
  return p;
}

/** Решение за рабочим местом: принято — станция записана; нет — почему. */
export async function decideAndSave(d: Decision): Promise<Station | StationRefusal> {
  const next = decideStation(await readStation(), d);
  if (typeof next === 'string') return next;
  await write(next);
  return next;
}
