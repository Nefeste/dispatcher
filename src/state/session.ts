// Сессия смены (часть П5; docs/02-architecture.md, §2–§3): живая смена на телефоне — движок (src/engine/shift.ts),
// часы с выбранной скоростью, автопауза, сохранение. Экраны подписываются на номер изменения и читают виды
// (src/state/callView.ts, src/state/pultView.ts), а не правду о больном (ADR 0005).
//
// Сохранение — зерно и команды с их временем, плюс где стояли часы (docs/04-data-model.md, §3): закрыли игру — смена
// продолжается с той же секунды, на паузе.
import { useSyncExternalStore } from 'react';
import { DB } from '../content/generated/db';
import { MED } from '../content/generated/med';
import { type Command, type Logged, type Notice, newShift, type Refusal, replay, type Shift, type ShiftCtx, shiftCtx, advance as advanceShift, apply } from '../engine/shift';
import { loadMap } from '../map/load';
import { KEYS, readRaw, writeRaw } from './storage';

/** ×1 — игровая минута за 2,5 с настоящего времени (docs/08-game-design.md, §9): в 24 раза быстрее. */
export const SPEED_X1 = 24;
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
/** Смена прототипа (docs/specs/2026-11-prototype.md, §3, шаг 7). */
export const SHIFT_ID = 'shift.proto';
/** Версия формата сохранения: изменился смысл — новая версия и шаг миграции (docs/04-data-model.md, §3). */
const SAVE_V = 1;

export interface Session {
  ctx: ShiftCtx;
  s: Shift;
  log: Logged[];
  speed: Speed;
  /** сколько извещений смены уже рассмотрела автопауза */
  looked: number;
  autopause: boolean;
  /** на какую скорость вернуться, когда всё, ради чего встала автопауза, решено; null — паузы-автомата нет */
  resume: Speed | null;
  /** номер изменения: растёт с каждым шагом, экран перерисовывается по нему */
  v: number;
}

let ctxCache: ShiftCtx | null = null;
function ctxOf(): ShiftCtx {
  if (!ctxCache) ctxCache = shiftCtx(DB, MED, SHIFT_ID, loadMap(DB.cities[DB.shifts[SHIFT_ID].city].map));
  return ctxCache;
}

let cur: Session | null = null;
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version += 1;
  if (cur) cur.v = version;
  subs.forEach(f => f());
};

export function session(): Session | null {
  return cur;
}

/** Подписка экрана: перерисовка на каждое изменение сессии. */
export function useSession(): Session | null {
  useSyncExternalStore(
    f => {
      subs.add(f);
      return () => { subs.delete(f); };
    },
    () => version,
    () => version,
  );
  return cur;
}

/** Новая смена. Зерно — от часов телефона: случайность смены живёт в состоянии, движок её не берёт сам. */
export function startShift(seed = (Date.now() ^ 0x5bd1e995) >>> 0, autopause = true): Session {
  const ctx = ctxOf();
  cur = { ctx, s: newShift(ctx, seed), log: [], speed: 1, looked: 0, autopause, resume: null, v: 0 };
  void save();
  emit();
  return cur;
}

/** Есть ли сохранённая незаконченная смена. */
export async function hasSaved(): Promise<boolean> {
  const raw = await readRaw(KEYS.current);
  return Boolean(raw && parseSave(raw));
}

interface Save {
  v: number;
  setup: string;
  seed: number;
  t: number;
  log: Logged[];
}

function parseSave(raw: string): Save | null {
  try {
    const x = JSON.parse(raw) as Save;
    return x.v === SAVE_V && x.setup === SHIFT_ID && Number.isInteger(x.seed) && Array.isArray(x.log) ? x : null;
  } catch {
    return null;
  }
}

/** Продолжить сохранённую смену: переиграть команды и довести часы до той же секунды; на паузе. */
export async function resumeShift(autopause = true): Promise<Session | null> {
  const raw = await readRaw(KEYS.current);
  const sv = raw ? parseSave(raw) : null;
  if (!sv) return null;
  const ctx = ctxOf();
  const s = replay(ctx, sv.seed, sv.log);
  if (sv.t > s.t) advanceShift(ctx, s, sv.t - s.t);
  cur = { ctx, s, log: sv.log, speed: 0, looked: s.notices.length, autopause, resume: null, v: 0 };
  emit();
  return cur;
}

let lastSave = 0;
async function save(): Promise<void> {
  if (!cur) return;
  lastSave = Date.now();
  const sv: Save = { v: SAVE_V, setup: cur.ctx.setup.id, seed: cur.s.seed, t: cur.s.t, log: cur.log };
  await writeRaw(KEYS.current, cur.s.over ? null : JSON.stringify(sv));
}

/** Закончить: сохранение больше не нужно. */
export function closeShift(): void {
  cur = null;
  void writeRaw(KEYS.current, null);
  emit();
}

/** Новые извещения: автопауза на звонке, докладе и повторном звонке (ADR 0003; настройка «автопауза»). */
function look(x: Session, fresh: readonly Notice[]): void {
  if (!x.autopause) return;
  const stop = fresh.some(n => n.kind === 'ring' || n.kind === 'repeat' || (n.kind === 'report' && x.s.calls.find(c => c.id === n.call)?.state === 'report'));
  if (!stop) return;
  if (x.speed !== 0) x.resume = x.speed;
  x.speed = 0;
}

/** Ничего не ждёт диспетчера: ни разговора, ни звонка на линии, ни доклада. */
const settled = (s: Shift) => !s.open && !s.rings.length && !s.calls.some(c => c.state === 'report');

function after(x: Session, rev: number): void {
  const fresh = x.s.notices.slice(x.looked);
  x.looked = x.s.notices.length;
  if (fresh.length) look(x, fresh);
  if (x.s.rev !== rev || fresh.length) emit();
}

/** Кадр: сдвинуть часы на `realMs` настоящего времени со скоростью смены. Будит экран, когда в смене что-то
 *  случилось или сменилась игровая минута. */
export function tick(realMs: number): void {
  const x = cur;
  if (!x || x.speed === 0 || x.s.open || x.s.over) return;
  const rev = x.s.rev;
  const minute = Math.floor(x.s.t / 60_000);
  advanceShift(x.ctx, x.s, Math.round(realMs * SPEED_X1 * x.speed * pace));
  const changed = Math.floor(x.s.t / 60_000) !== minute;
  if (changed && Date.now() - lastSave > 5000) void save();
  after(x, changed ? -1 : rev);
}

/** Команда диспетчера: принята — в журнал сохранения. */
export function command(cmd: Command): Refusal | null {
  const x = cur;
  if (!x) return 'over';
  const t = x.s.t;
  const rev = x.s.rev;
  const why = apply(x.ctx, x.s, cmd);
  if (why) return why;
  x.log.push({ t, cmd });
  void save();
  after(x, rev);
  // автопауза держит мир, пока звонок и доклад не решены; решены — часы идут дальше с прежней скоростью
  if (x.resume !== null && x.speed === 0 && settled(x.s)) {
    x.speed = x.resume;
    x.resume = null;
  }
  emit();
  return null;
}

export function setSpeed(speed: Speed): void {
  if (!cur) return;
  cur.speed = speed;
  cur.resume = null;
  emit();
}

export function togglePause(): void {
  if (!cur) return;
  setSpeed(cur.speed === 0 ? (cur.resume ?? 1) : 0);
}

/** Для сценария в браузере: во сколько раз быстрее ×1 идут часы (`?pace=` веб-сборки). На телефоне — 1. */
let pace = 1;
export function setPace(k: number): void {
  pace = k > 0 ? k : 1;
}

/** Следующая скорость по касанию: пауза → ×1 → ×2 → ×4 → ×1. */
export function nextSpeed(): void {
  if (!cur) return;
  if (cur.speed === 0) return togglePause();
  const i = SPEEDS.indexOf(cur.speed);
  setSpeed(SPEEDS[i + 1 < SPEEDS.length ? i + 1 : 1]);
}
