// Бригады (docs/02-architecture.md, §3; docs/08-game-design.md, §5): машина состояний и путь по улицам с целыми
// временами. Положение между узлами в состояние не пишется — экран считает его по пути (road/pos.ts).
// Чистый TypeScript: время — целые миллисекунды от начала смены, без часов и случайности.
//
// Состояния: на подстанции → едет на вызов → на месте → возвращается → на подстанции. Везёт в больницу и в
// больнице — с частью П5 (доклад и выбор больницы). Бригада, которая возвращается, уже свободна: её можно послать с
// дороги, она поедет от того места, где она сейчас.
import type { Road } from './road/graph';
import { arrival, passed, type Route, routeOf } from './road/pos';
import { FAR, search } from './road/route';

export type CrewState = 'base' | 'drive' | 'scene' | 'back';

export interface Crew {
  id: string;
  kind: string;
  /** узел подстанции */
  base: number;
  state: CrewState;
  /** где стоит, если не едет: узел */
  at: number;
  route: Route | null;
  /** до какого момента на месте, мс */
  until: number;
  /** вызов, на котором бригада, или пусто */
  call: string | null;
}

export function crewAtBase(id: string, kind: string, base: number): Crew {
  return { id, kind, base, state: 'base', at: base, route: null, until: 0, call: null };
}

/** Свободна ли бригада для нового вызова: на подстанции или возвращается. */
export function free(c: Crew): boolean {
  return c.state === 'base' || c.state === 'back';
}

/** Узел, откуда бригада поедет сейчас: последний пройденный на пути или где стоит. */
export function nodeNow(c: Crew, t: number): number {
  return c.route ? c.route.nodes[passed(c.route, t)] : c.at;
}

/**
 * Время доезда каждой свободной бригады до узла вызова, мс, — один обратный поиск от адреса
 * (docs/02-architecture.md, §5). Занятая или та, что не доедет, — FAR.
 */
export function etas(road: Road, times: Uint32Array, crews: readonly Crew[], to: number, t: number): number[] {
  const back = search(road, times, to, true);
  return crews.map(c => (free(c) ? back.dist[nodeNow(c, t)] : FAR));
}

/** Послать бригаду на вызов в узле `to` в момент `t`. Возвращает новую бригаду или null, если не доехать. */
export function send(road: Road, times: Uint32Array, c: Crew, call: string, to: number, t: number): Crew | null {
  if (!free(c)) return null;
  const r = routeOf(road, times, nodeNow(c, t), to, t);
  if (!r) return null;
  return { ...c, state: 'drive', route: r, call, at: to, until: 0 };
}

/**
 * Довести бригаду до момента `t`: приехала — на месте `scene` мс, отработала — домой на подстанцию, доехала —
 * на подстанции. Переходы считаются по порядку, сколько бы времени ни прошло.
 */
export function step(road: Road, times: Uint32Array, c: Crew, t: number, scene: number): Crew {
  let x = c;
  for (;;) {
    if (x.state === 'drive' && x.route && t >= arrival(x.route)) {
      x = { ...x, state: 'scene', at: x.route.nodes[x.route.nodes.length - 1], until: arrival(x.route) + scene, route: null };
    } else if (x.state === 'scene' && t >= x.until) {
      const r = routeOf(road, times, x.at, x.base, x.until);
      x = r ? { ...x, state: 'back', route: r, call: null } : { ...x, state: 'base', at: x.base, call: null };
    } else if (x.state === 'back' && x.route && t >= arrival(x.route)) {
      x = { ...x, state: 'base', at: x.base, route: null };
    } else {
      return x;
    }
  }
}

/** Множитель скорости часа суток, % (content/roads.yaml): последний шаг, что начался не позже часа. */
export function hourPct(hours: readonly { from: number; pct: number }[], secOfDay: number): number {
  const h = Math.floor(secOfDay / 3600) % 24;
  let pct = hours[0].pct;
  for (const x of hours) if (x.from <= h) pct = x.pct;
  return pct;
}
