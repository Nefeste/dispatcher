// Сессия смены (часть П5; docs/02-architecture.md, §2–§3): живая смена на телефоне — движок (src/engine/shift.ts),
// часы с выбранной скоростью, автопауза, сохранение. Экраны подписываются на номер изменения и читают виды
// (src/state/callView.ts, src/state/pultView.ts), а не правду о больном (ADR 0005).
//
// Сохранение — зерно и команды с их временем, плюс где стояли часы (docs/04-data-model.md, §3): закрыли игру — смена
// продолжается с той же секунды, на паузе.
import { useSyncExternalStore } from 'react';
import { DB } from '../content/generated/db';
import { MED } from '../content/generated/med';
import { type Command, type Lineup, type Logged, NO_LINEUP, type Notice, newShift, nextEvent, type Refusal, replay, type Shift, type ShiftCtx, shiftCtx, timesAt, advance as advanceShift, apply } from '../engine/shift';
import { loadMap } from '../map/load';
import type { IntroNote } from './stationView';
import { KEYS, readRaw, writeRaw } from './storage';

/** ×1 — игровая минута за 2,5 с настоящего времени (docs/08-game-design.md, §9): в 24 раза быстрее. */
export const SPEED_X1 = 24;
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
/** Смена прототипа (docs/specs/2026-11-prototype.md, §3, шаг 7): её берёт «Замер». Смены игры — «Первая неделя»
 *  (content/shifts/week-*.yaml, срез, часть С1). */
export const PROTO_SHIFT = 'shift.proto';
/** Первая смена недели — с неё начинают. */
export const FIRST_SHIFT = 'shift.week-1';
/** Версия формата сохранения: изменился смысл — новая версия и шаг миграции (docs/04-data-model.md, §3).
 *  2 — 0.13.0: укладки и бригады станции меняют жизнь смены, у первой смены другие номера бригад; команды смены 0.12.0
 *  переигрались бы в другую смену — такая смена не продолжается (шага миграции нет: переиграть её по старым правилам
 *  нечем).
 *  3 — 0.14.0: смерть до приезда бригады (больного не везут) и повторный звонок после отказа меняют жизнь смены.
 *  4 — 0.15.0: просьба бригады о реанимационной и обученные станцией бригады меняют жизнь смены.
 *  5 — 0.16.0: у ночной смены 4 другой поток звонков.
 *  6 — 0.17.0: просьбы бригады на месте не про медицину (подъезд, адрес, второй пострадавший) меняют жизнь смены. */
const SAVE_V = 6;

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
  /** ввод новой смены ещё на экране: часы стоят, пока игрок его не закрыл */
  intro: boolean;
  /** письмо старшего врача о тяжёлой ошибке прошлой смены — на вводе (срез, С3) */
  note: IntroNote | null;
  /** сколько настоящего времени идёт смена, мс: «время игры» в итоге (§5) */
  played: number;
  /** номер изменения: растёт с каждым шагом, экран перерисовывается по нему */
  v: number;
}

/** Всё, что за смену не меняется: база, карта, дороги, город — по одному на смену; карта — одна на файл карты. */
const ctxCache = new Map<string, ShiftCtx>();
const mapCache = new Map<string, ShiftCtx['map']>();
function mapOf(shiftId: string): ShiftCtx['map'] {
  const id = DB.cities[DB.shifts[shiftId].city].map;
  let m = mapCache.get(id);
  if (!m) mapCache.set(id, (m = loadMap(id)));
  return m;
}
function ctxOf(shiftId: string): ShiftCtx {
  let c = ctxCache.get(shiftId);
  if (!c) ctxCache.set(shiftId, (c = shiftCtx(DB, MED, shiftId, mapOf(shiftId))));
  return c;
}
/** Смена прототипа — для «Замера». */
export function shiftContext(): ShiftCtx {
  return ctxOf(PROTO_SHIFT);
}

export type LoadStep = 'map' | 'roads' | 'paths' | 'medicine';
export const LOAD_STEPS: readonly LoadStep[] = ['map', 'roads', 'paths', 'medicine'];

/**
 * Загрузка с настоящим ходом (спецификация прототипа, §3, шаг 2): файл карты, граф дорог и время рёбер, пути Skia,
 * медицина — по шагу за кадр; `onStep` — какой шаг начался. Уже загружено — сразу. `paths` строит экран (Skia).
 */
export async function prepare(shiftId: string, onStep: (step: LoadStep, i: number) => void, buildPaths: (map: ShiftCtx['map']) => void): Promise<void> {
  const frame = () => new Promise<void>(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
  onStep('map', 0);
  await frame();
  const map = mapOf(shiftId);
  onStep('roads', 1);
  await frame();
  const ctx = ctxOf(shiftId);
  timesAt(ctx, 0);
  onStep('paths', 2);
  await frame();
  buildPaths(map);
  onStep('medicine', 3);
  await frame();
  // первый больной смены — чтобы его рождение не пришлось на первый кадр пульта
  newShift(ctx, 1);
  await frame();
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

/** Новая смена `shiftId` с тем, что дала станция. Зерно — от часов телефона: случайность смены живёт в состоянии,
 *  движок её не берёт сам. */
export function startShift(shiftId: string, seed = fixedSeed ?? (Date.now() ^ 0x5bd1e995) >>> 0, autopause = true, lineup: Lineup = NO_LINEUP, note: IntroNote | null = null): Session {
  const ctx = ctxOf(shiftId);
  cur = { ctx, s: newShift(ctx, seed, lineup), log: [], speed: 0, looked: 0, autopause, resume: null, intro: true, note, played: 0, v: 0 };
  lastTouch = Date.now();
  void save();
  emit();
  return cur;
}

/** Есть ли сохранённая незаконченная смена. */
export async function hasSaved(): Promise<boolean> {
  return (await savedShift()) !== null;
}

/** Какая смена сохранена незаконченной; нет — null. */
export async function savedShift(): Promise<string | null> {
  const raw = await readRaw(KEYS.current);
  return (raw && parseSave(raw)?.setup) || null;
}

interface Save {
  v: number;
  setup: string;
  seed: number;
  t: number;
  log: Logged[];
  /** время игры, мс */
  played?: number;
  /** что дала станция (срез, С2); нет — бригады записи с полными укладками */
  lineup?: Lineup;
}

/** Состав из сохранения: только знакомые виды и подстанции; не та форма — без станции. */
function lineupFrom(x: unknown): Lineup {
  const l = x as Partial<Lineup> | undefined;
  if (!l || !Array.isArray(l.extra) || typeof l.kits !== 'object' || !l.kits) return NO_LINEUP;
  const trained = Array.isArray(l.trained) ? l.trained.filter((id): id is string => typeof id === 'string') : [];
  const bases = new Set(Object.values(DB.cities).flatMap(c => c.bases.map(b => b.id)));
  const extra = l.extra.filter(c => c && typeof c.id === 'string' && Boolean(DB.crews[c.kind]) && bases.has(c.base));
  const kits: Record<string, number> = {};
  for (const [id, n] of Object.entries(l.kits)) if (Number.isInteger(n)) kits[id] = n as number;
  return { extra, kits, trained };
}

function parseSave(raw: string): Save | null {
  try {
    const x = JSON.parse(raw) as Save;
    return x.v === SAVE_V && Boolean(DB.shifts[x.setup]) && Number.isInteger(x.seed) && Array.isArray(x.log) ? x : null;
  } catch {
    return null;
  }
}

/** Продолжить сохранённую смену: переиграть команды и довести часы до той же секунды; на паузе. */
export async function resumeShift(autopause = true): Promise<Session | null> {
  const raw = await readRaw(KEYS.current);
  const sv = raw ? parseSave(raw) : null;
  if (!sv) return null;
  const ctx = ctxOf(sv.setup);
  const s = replay(ctx, sv.seed, sv.log, lineupFrom(sv.lineup));
  if (sv.t > s.t) advanceShift(ctx, s, sv.t - s.t);
  cur = { ctx, s, log: sv.log, speed: 0, looked: s.notices.length, autopause, resume: null, intro: false, note: null, played: sv.played ?? 0, v: 0 };
  lastTouch = Date.now();
  emit();
  return cur;
}

let lastSave = 0;
async function save(): Promise<void> {
  if (!cur) return;
  lastSave = Date.now();
  const sv: Save = { v: SAVE_V, setup: cur.ctx.setup.id, seed: cur.s.seed, t: cur.s.t, log: cur.log, played: cur.played, lineup: cur.s.lineup };
  await writeRaw(KEYS.current, cur.s.over ? null : JSON.stringify(sv));
}

/** Время игры: настоящее время между касаниями смены; перерыв дольше `GAP` (игру свернули) не считается. */
const GAP = 5000;
let lastTouch = 0;
function touch(x: Session): void {
  const now = Date.now();
  if (!x.s.over) x.played += Math.min(GAP, Math.max(0, now - lastTouch));
  lastTouch = now;
}

/** «Мягкий исход» (срез, С3): какими словами говорить о третьей ступени исхода — рация, итог, разбор. Слова, не смена:
 *  движок о настройке не знает. */
let soft = false;
export function setSoftOutcome(on: boolean): void {
  soft = on;
  emit();
}
export const softOutcome = (): boolean => soft;

/** Настройка «Автопауза» поменялась — идущая смена слушается сразу. */
export function setAutopause(on: boolean): void {
  if (cur) cur.autopause = on;
}

/** Закрыть ввод новой смены: часы пошли. */
export function dismissIntro(): void {
  if (!cur) return;
  cur.intro = false;
  cur.speed = 1;
  emit();
}

/** Закончить: сохранение больше не нужно. */
export function closeShift(): void {
  cur = null;
  void writeRaw(KEYS.current, null);
  emit();
}

/** Отклик на извещения: звонок телефона, щелчок рации (src/audio/feedback.ts подставляет App). */
type CueFn = (what: 'ring' | 'radio') => void;
let cueFn: CueFn = () => {};
export function setCue(f: CueFn): void {
  cueFn = f;
}
const RADIO: readonly Notice['kind'][] = ['scene', 'ask', 'door', 'address', 'victim', 'report', 'auto', 'free', 'restock', 'base', 'recall'];
/** Просьбы бригады на месте — мир встаёт по автопаузе, пока ждут ответа. */
const ASKS: readonly Notice['kind'][] = ['ask', 'door', 'address', 'victim'];

/** Новые извещения: звук и автопауза на звонке, докладе и повторном звонке (ADR 0003; настройка «автопауза»). */
function look(x: Session, fresh: readonly Notice[]): void {
  if (fresh.some(n => n.kind === 'ring' || n.kind === 'repeat')) cueFn('ring');
  else if (fresh.some(n => RADIO.includes(n.kind))) cueFn('radio');
  if (!x.autopause) return;
  const stop = fresh.some(n => n.kind === 'ring' || n.kind === 'repeat' || (n.kind === 'report' && x.s.calls.find(c => c.id === n.call)?.state === 'report') || (ASKS.includes(n.kind) && x.s.calls.find(c => c.id === n.call)?.state === 'ask'));
  if (!stop) return;
  if (x.speed !== 0) x.resume = x.speed;
  x.speed = 0;
}

/** Ничего не ждёт диспетчера: ни разговора, ни звонка на линии, ни доклада. */
const settled = (s: Shift) => !s.open && !s.rings.length && !s.calls.some(c => c.state === 'report' || c.state === 'ask');

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
  if (x) touch(x);
  if (!x || x.speed === 0 || x.s.open || x.s.over) return;
  const rev = x.s.rev;
  const minute = Math.floor(x.s.t / 60_000);
  // с автопаузой — от события к событию: мир встаёт ровно на звонке, просьбе или докладе, а не после целого кадра (на
  // ×4 кадр — до 24 игровых секунд; у сценария в браузере, часы которого ускорены, — минуты, и просьба успевала решиться
  // сама, не встав)
  let left = Math.round(realMs * SPEED_X1 * x.speed * pace);
  while (left > 0 && (x.speed as number) !== 0 && !x.s.open && !x.s.over) {
    const step = x.autopause ? Math.min(left, Math.max(1, nextEvent(x.ctx, x.s) - x.s.t)) : left;
    advanceShift(x.ctx, x.s, step);
    left -= step;
    const fresh = x.s.notices.slice(x.looked);
    x.looked = x.s.notices.length;
    if (fresh.length) look(x, fresh);
  }
  const changed = Math.floor(x.s.t / 60_000) !== minute;
  if (changed && Date.now() - lastSave > 5000) void save();
  // доклад ждёт ответа (автопауза выключена): его отсчёт в секундах — на экране, перерисовать раз в четверть секунды
  const now = Date.now();
  const countdown = now - lastCountdown >= COUNTDOWN_MS && x.s.calls.some(c => c.state === 'report' || c.state === 'ask');
  if (countdown) lastCountdown = now;
  // извещения этого кадра уже прочитаны в шагах выше — будить экран, если смена менялась
  if (x.s.rev !== rev || changed || countdown) emit();
}

/** Отсчёт доклада на экране — не чаще раза в `COUNTDOWN_MS` настоящего времени. */
const COUNTDOWN_MS = 250;
let lastCountdown = 0;

/** Команда диспетчера: принята — в журнал сохранения. */
export function command(cmd: Command): Refusal | null {
  const x = cur;
  if (!x) return 'over';
  touch(x);
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

/** Для сценария в браузере: зерно каждой новой смены (`?seed=` веб-сборки) — смена с тем же потоком звонков и теми же
 *  просьбами бригад на месте. На телефоне — нет: зерно от часов. */
let fixedSeed: number | null = null;
export function setSeed(k: number): void {
  fixedSeed = Number.isInteger(k) && k > 0 ? k >>> 0 : null;
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
