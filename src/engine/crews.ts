// Бригады (docs/02-architecture.md, §3; docs/08-game-design.md, §5): машина состояний и путь по улицам с целыми
// временами. Положение между узлами в состояние не пишется — экран считает его по пути (road/pos.ts).
// Чистый TypeScript: время — целые миллисекунды от начала смены, без часов и случайности. Когда что наступает —
// решает смена (src/engine/shift.ts); здесь — сами переходы.
//
// Состояния: на подстанции → едет на вызов → на месте → везёт в больницу → в больнице → возвращается → на
// подстанции. Бригада, которая возвращается, уже свободна: её можно послать с дороги, она поедет от того места, где
// она сейчас. Бригаду, которая едет на неотложный вызов, можно развернуть на экстренный (§5, «Снять бригаду»).
// Укладка (срез, часть С2; docs/08-game-design.md, §15; 388н, прил. 5, пп. 3.26, 5.31): запас на несколько вызовов,
// каждый вызов, где бригада работала на месте, тратит один. Пустая укладка — бригада после вызова едет на подстанцию
// пополнять, а не на следующий вызов: пока едет и пополняет, она не свободна.
import type { Road } from './road/graph';
import { arrival, passed, type Route, routeOf } from './road/pos';
import { FAR, search } from './road/route';
import { KIT, RESTOCK } from './rules';

export type CrewState = 'base' | 'drive' | 'scene' | 'transport' | 'hospital' | 'back' | 'restock';

export interface Crew {
  id: string;
  kind: string;
  /** узел подстанции */
  base: number;
  state: CrewState;
  /** где стоит, если не едет: узел; едет — куда */
  at: number;
  route: Route | null;
  /** на месте, в больнице и пополняя укладку — до какого момента, мс */
  until: number;
  /** вызов, на котором бригада, или пусто */
  call: string | null;
  /** сколько вызовов ещё хватит укладки; 0 — пустая, бригада едет пополнять */
  kit: number;
  /** укладка полная — на столько вызовов; нет — `KIT` (расширенная укладка станции, §15) */
  cap?: number;
  /** пополнение на подстанции, мс; нет — `RESTOCK` (склад на подстанции, §15) */
  restockMs?: number;
}

/** Полная укладка бригады. */
export const capOf = (c: Pick<Crew, 'cap'>): number => c.cap ?? KIT;

/** Бригада на подстанции в начале смены; укладка — сколько вызовов в ней осталось (станция знает это с прошлой
 *  смены). Пустая — смена начинается с пополнения. */
export function crewAtBase(id: string, kind: string, base: number, kit = KIT, cap = KIT, restockMs = RESTOCK): Crew {
  const c: Crew = { id, kind, base, state: 'base', at: base, route: null, until: 0, call: null, kit: Math.max(0, Math.min(cap, Math.floor(kit))) };
  // поля станции — только когда они не обычные: смена без закупок та же, что была (золотые смены)
  if (cap !== KIT) c.cap = cap;
  if (restockMs !== RESTOCK) c.restockMs = restockMs;
  return atBase(c, 0);
}

/** Свободна ли бригада для нового вызова: на подстанции или возвращается — и укладка не пустая. */
export function free(c: Crew): boolean {
  return (c.state === 'base' || c.state === 'back') && c.kit > 0;
}

/** Отработала на месте: укладка стала на вызов меньше. */
export function used(c: Crew): Crew {
  return { ...c, kit: Math.max(0, c.kit - 1) };
}

/** Узел, откуда бригада поедет сейчас: последний пройденный на пути или где стоит. */
export function nodeNow(c: Crew, t: number): number {
  return c.route ? c.route.nodes[passed(c.route, t)] : c.at;
}

/**
 * Время доезда каждой бригады до узла вызова, мс, — один обратный поиск от адреса (docs/02-architecture.md, §5).
 * Кого считать — решает `can` (по умолчанию свободные); остальные и те, что не доедут, — FAR.
 */
export function etas(road: Road, times: Uint32Array, crews: readonly Crew[], to: number, t: number, can: (c: Crew) => boolean = free): number[] {
  const back = search(road, times, to, true);
  return crews.map(c => (can(c) ? back.dist[nodeNow(c, t)] : FAR));
}

/** Послать бригаду на вызов в узле `to` в момент `t`: от того места, где она сейчас. null — не доехать. */
export function send(road: Road, times: Uint32Array, c: Crew, call: string, to: number, t: number): Crew | null {
  const r = routeOf(road, times, nodeNow(c, t), to, t);
  if (!r) return null;
  return { ...c, state: 'drive', route: r, call, at: to, until: 0 };
}

/** Доехала до вызова — на месте до `until`. */
export function onScene(c: Crew, until: number): Crew {
  return { ...c, state: 'scene', at: c.route ? c.route.nodes[c.route.nodes.length - 1] : c.at, route: null, until };
}

/** Везёт в больницу в узле `to`. null — не доехать. */
export function toHospital(road: Road, times: Uint32Array, c: Crew, to: number, t: number): Crew | null {
  const r = routeOf(road, times, c.at, to, t);
  if (!r) return null;
  return { ...c, state: 'transport', route: r, at: to, until: 0 };
}

/** Довезла — в больнице до `until`. */
export function atHospital(c: Crew, until: number): Crew {
  return { ...c, state: 'hospital', at: c.route ? c.route.nodes[c.route.nodes.length - 1] : c.at, route: null, until };
}

/** Освободилась — домой на подстанцию; уже там — на подстанции. */
export function home(road: Road, times: Uint32Array, c: Crew, t: number): Crew {
  const from = nodeNow(c, t);
  const r = from === c.base ? null : routeOf(road, times, from, c.base, t);
  return r ? { ...c, state: 'back', route: r, at: c.base, call: null, until: 0 } : atBase({ ...c, call: null }, t);
}

/** Доехала до подстанции в момент `t`: укладка пустая — пополняет до `t + RESTOCK`, иначе на подстанции. */
export function atBase(c: Crew, t: number): Crew {
  if (c.kit <= 0) return { ...c, state: 'restock', at: c.base, route: null, until: t + (c.restockMs ?? RESTOCK) };
  return { ...c, state: 'base', at: c.base, route: null, until: 0 };
}

/** Пополнила укладку — на подстанции, полная. */
export function restocked(c: Crew): Crew {
  return { ...c, state: 'base', at: c.base, route: null, until: 0, kit: capOf(c) };
}

/** Когда у бригады следующее событие, мс: конец пути или конец стоянки; нет — FAR. */
export function crewNext(c: Crew): number {
  if (c.route && (c.state === 'drive' || c.state === 'transport' || c.state === 'back')) return arrival(c.route);
  if (c.state === 'scene' || c.state === 'hospital' || c.state === 'restock') return c.until;
  return FAR;
}

/** Множитель скорости часа суток, % (content/roads.yaml): последний шаг, что начался не позже часа. */
export function hourPct(hours: readonly { from: number; pct: number }[], secOfDay: number): number {
  const h = Math.floor(secOfDay / 3600) % 24;
  let pct = hours[0].pct;
  for (const x of hours) if (x.from <= h) pct = x.pct;
  return pct;
}
