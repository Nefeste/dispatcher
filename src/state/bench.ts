// «Замер» (спецификация прототипа, §8 и критерий 8; docs/06-testing.md, «Замер»): чистая часть — сводки кадров и
// времён, проверка бюджета §8 и смена для сцены «Пульт» — без React и часов, проверяется тестом
// (tools/test/bench.test.ts). Смену ведёт простой диспетчер «всё экстренно, ближайшую бригаду»: он держит на улицах
// как можно больше машин — самая тяжёлая картинка пульта. Он видит то же, что игрок: вид вызова и пульта, не правду.
import { FAR, search } from '../engine/road/route';
import { advance, apply, type Command, crewOptions, newShift, nextEvent, type Shift, type ShiftCtx, timesAt } from '../engine/shift';
import { callView } from './callView';
import { pultView } from './pultView';

/** Бюджет §8 спецификации прототипа — то, что меряет телефон. */
export const BUDGET = {
  /** кадров в секунду по медиане */
  fps: 60,
  /** кадр дольше этого, мс, — долгий */
  longMs: 25,
  /** долгих кадров — не больше этой доли */
  longShare: 0.01,
  /** поиск пути на район, мс */
  searchMs: 8,
  /** от касания значка до первого кадра карты, мс */
  startMs: 3000,
  /** память JS, байт */
  heapBytes: 150 * 1024 * 1024,
} as const;

export interface FrameSummary {
  n: number;
  /** кадров в секунду по медиане длительности кадра */
  fps: number;
  /** доля кадров дольше `BUDGET.longMs` */
  long: number;
  /** самый долгий кадр, мс */
  worst: number;
}

function sorted(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/** Квантиль по ближайшему рангу: 0,5 — медиана. */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return 0;
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

/** Сводка длительностей кадров, мс. Первый кадр сцены (перестройка экрана) не считается — его отбрасывает экран. */
export function frameSummary(ms: readonly number[]): FrameSummary {
  if (!ms.length) return { n: 0, fps: 0, long: 0, worst: 0 };
  const p50 = quantile(ms, 0.5);
  return { n: ms.length, fps: p50 > 0 ? 1000 / p50 : 0, long: ms.filter(x => x > BUDGET.longMs).length / ms.length, worst: Math.max(...ms) };
}

/** Кадры в бюджете: медиана — не реже 60 к/с (с допуском на дрожание часов кадра), долгих — не больше 1 %. */
export function framesOk(f: FrameSummary): boolean {
  return f.n > 0 && f.fps >= BUDGET.fps * 0.95 && f.long <= BUDGET.longShare;
}

export interface MsSummary {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export function msSummary(ms: readonly number[]): MsSummary {
  return { n: ms.length, p50: quantile(ms, 0.5), p95: quantile(ms, 0.95), max: ms.length ? Math.max(...ms) : 0 };
}

/** Узлы для поиска пути: по зерну, повторяемо — одни и те же на любом телефоне. */
export function searchNodes(nodes: number, n: number, seed = 2026): number[] {
  let x = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // xorshift32
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out.push(x % nodes);
  }
  return out;
}

/** Поиск пути, как при выборе бригады: один обратный поиск от адреса по всему району (crewOptions). `now` — часы.
 *  Первый поиск — разогрев (код ещё не прогрет), он не считается: игрок ищет путь уже посреди смены. */
export function timeSearches(ctx: ShiftCtx, nodes: readonly number[], now: () => number): number[] {
  const times = timesAt(ctx, 0);
  if (nodes.length) search(ctx.road, times, nodes[0], true);
  return nodes.map(v => {
    const t0 = now();
    search(ctx.road, times, v, true);
    return now() - t0;
  });
}

/** Что сделал бы диспетчер сцены сейчас; null — ждать. */
export function benchMove(ctx: ShiftCtx, s: Shift): Command | null {
  if (s.open) {
    const v = callView(ctx, s, s.open);
    if (!v || v.form === null) return { c: 'form', form: 'emergency' };
    const opt = v.options[0];
    return opt ? { c: 'send', call: v.id, crew: opt.crew } : { c: 'hold', call: v.id };
  }
  if (s.rings.length) return { c: 'answer' };
  const p = pultView(ctx, s);
  if (p.report) {
    const h = p.report.hospitals.find(x => x.suggested) ?? p.report.hospitals[0];
    if (h) return { c: 'hospital', call: p.report.call, hospital: h.id };
  }
  for (const w of p.waiting) {
    const opt = crewOptions(ctx, s, w.id).find(o => !o.redirect);
    if (opt) return { c: 'send', call: w.id, crew: opt.crew };
  }
  return null;
}

/** Все ходы диспетчера, какие можно сделать сейчас (не больше `limit`). */
export function benchMoves(ctx: ShiftCtx, s: Shift, limit = 50): number {
  let n = 0;
  for (; n < limit; n++) {
    const cmd = benchMove(ctx, s);
    if (!cmd || apply(ctx, s, cmd)) break;
  }
  return n;
}

/** На каком событии смены диспетчер сцены думал последний раз: число извещений, звонков на линии, открытый разговор. */
const thought = new WeakMap<Shift, string>();
const eventsOf = (s: Shift) => `${s.notices.length}:${s.rings.length}:${s.open ?? ''}`;

/**
 * Шаг сцены «Пульт»: часы смены на `ms` вперёд, и диспетчер думает, только если в смене что-то случилось — звонок,
 * доклад, бригада освободилась (новое извещение), — как игрок. Раньше он думал каждый кадр и каждый кадр искал бригады
 * всем ждущим вызовам: на телефоне владельца это и были 19 к/с потока JS на пульте (0.10.0).
 */
export function benchStep(ctx: ShiftCtx, s: Shift, ms: number): void {
  const think = () => {
    if (thought.get(s) === eventsOf(s)) return;
    benchMoves(ctx, s);
    thought.set(s, eventsOf(s));
  };
  think();
  advance(ctx, s, ms);
  think();
}

/** Смена сцены «Пульт»: зерно и минута, с которой меряем, — в замер на улицах в среднем три машины (тест). */
export const BENCH_SHIFT = { seed: 1, minute: 70 } as const;

/** Смена для сцены «Пульт»: зерно `seed`, сыграна до `minutes` игровой минуты — бригады уже на улицах. */
export function benchShift(ctx: ShiftCtx, seed: number, minutes: number): Shift {
  const s = newShift(ctx, seed);
  const until = minutes * 60_000;
  for (let i = 0; i < 20000 && !s.over && s.t < until; i++) {
    if (benchMoves(ctx, s)) continue;
    const next = nextEvent(ctx, s);
    advance(ctx, s, Math.min(until, next === FAR ? s.t + 60_000 : Math.max(s.t + 1, next)) - s.t);
  }
  return s;
}

/** Сколько бригад сейчас в пути. */
export const onRoad = (s: Shift) => s.crews.filter(c => c.route).length;
