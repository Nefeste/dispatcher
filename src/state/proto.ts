// Пробная смена (часть П3): часы смены, бригады на подстанциях, посылка ближайшей свободной бригады на вызов из
// эталонного разговора. С частью П5 её место займёт сессия смены (src/state/session.ts): движок смены, команды,
// сохранение. Здесь — только то, чтобы бригады ехали по улицам: состояния — из src/engine/crews.ts, место на пути —
// из src/engine/road/pos.ts.
import { useSyncExternalStore } from 'react';
import { DB } from '../content/generated/db';
import type { City } from '../content/types';
import { type Crew, crewAtBase, etas, free, hourPct, send, step } from '../engine/crews';
import { edgeTimes, roadOf, type Road } from '../engine/road/graph';
import { FAR } from '../engine/road/route';
import type { MapData } from '../map/format';
import { loadMap } from '../map/load';

/** ×1 — игровая минута за 2,5 с настоящего времени (docs/08-game-design.md, §9): в 24 раза быстрее. */
export const SPEED_X1 = 24;
export const SPEEDS = [0, 1, 2, 4] as const;
/** Время на месте по умолчанию (§9: 15–30 игровых минут); у болезни будет своё — с частью П4. */
export const ON_SCENE = 20 * 60 * 1000;

const SHIFT = DB.shifts['shift.proto'];
/** Начало пробной смены, секунды от полуночи. */
export const SHIFT_START = SHIFT.start;
/** Адрес эталонного звонка (ул. Большая Покровская) и вызова, что уже ждёт, — точки карты; привязываются к ближайшему узлу. */
const EXAMPLE_CALL_AT = [8200, 13800] as const;
const EXAMPLE_WAITING_AT = [4600, 7400] as const;

function nearestNode(m: MapData, at: readonly [number, number]): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < m.nodes.x.length; i++) {
    const d = (m.nodes.x[i] - at[0]) ** 2 + (m.nodes.y[i] - at[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function exampleCallNode(): number {
  return nearestNode(state.map, EXAMPLE_CALL_AT);
}

export interface ProtoCall {
  id: string;
  node: number;
  form: 'emergency' | 'urgent';
  /** когда поступил, мс от начала смены */
  at: number;
  crew: string | null;
}

export interface Proto {
  city: City;
  map: MapData;
  road: Road;
  times: Uint32Array;
  /** мс от начала смены */
  t: number;
  speed: (typeof SPEEDS)[number];
  crews: Crew[];
  calls: ProtoCall[];
  /** звонков на линии */
  line: number;
  /** последняя строка рации: номер бригады и что с ней */
  radio: { crew: number; what: 'scene' | 'base' } | null;
}

function initial(): Proto {
  const city = DB.cities[SHIFT.city];
  const map = loadMap(city.map);
  const road = roadOf(map);
  const times = edgeTimes(road, DB.roads.kmh, hourPct(DB.roads.hours, SHIFT.start));
  const node = (id: string) => city.bases.find(b => b.id === id)!.node;
  const crews = SHIFT.crews.map(c => crewAtBase(c.id, c.kind, node(c.base)));
  // пример для кадра: два вызова ждут бригаду, два звонка на линии
  const calls: ProtoCall[] = [{ id: 'call.38', node: nearestNode(map, EXAMPLE_WAITING_AT), form: 'urgent', at: 0, crew: null }];
  return { city, map, road, times, t: 0, speed: 1, crews, calls, line: 2, radio: null };
}

let state = initial();
let minute = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function protoState(): Proto {
  return state;
}

export function useProto(): Proto {
  return useSyncExternalStore(
    f => {
      subs.add(f);
      return () => { subs.delete(f); };
    },
    () => state,
    () => state,
  );
}

/** Номер бригады из её идентификатора: crew.4 → 4. */
export const crewNumber = (c: Crew) => Number(c.id.split('.')[1]);

/** Сдвинуть часы смены на `realMs` настоящего времени со скоростью смены; подписчиков будить раз в игровую минуту. */
export function tick(realMs: number): void {
  if (state.speed === 0) return;
  const t = state.t + Math.round(realMs * SPEED_X1 * state.speed);
  advanceTo(t);
}

function advanceTo(t: number): void {
  let radio = state.radio;
  let changed = false;
  const crews = state.crews.map(c => {
    const x = step(state.road, state.times, c, t, ON_SCENE);
    if (x.state !== c.state) {
      changed = true;
      if (x.state === 'scene') radio = { crew: crewNumber(x), what: 'scene' };
      if (x.state === 'base') radio = { crew: crewNumber(x), what: 'base' };
    }
    return x;
  });
  const m = Math.floor(t / 60000);
  state = { ...state, t, crews, radio };
  if (changed || m !== minute) {
    minute = m;
    emit();
  }
}

export function togglePause(): void {
  state = { ...state, speed: state.speed === 0 ? 1 : 0 };
  emit();
}

export function setSpeed(speed: Proto['speed']): void {
  state = { ...state, speed };
  emit();
}

/**
 * Разговор закончен решением: часы смены сдвигаются на время разговора (ADR 0003), на экстренный вызов едет
 * ближайшая свободная бригада (388н, п. 10), на неотложный — тоже, пока экстренных нет (п. 12; в П5 — по очереди).
 * Возвращает номер посланной бригады или null, если свободных нет.
 */
export function decide(id: string, node: number, form: ProtoCall['form'], talkSeconds: number): number | null {
  const at = state.t;
  advanceTo(state.t + talkSeconds * 1000);
  const eta = etas(state.road, state.times, state.crews, node, state.t);
  let best = -1;
  eta.forEach((d, i) => {
    if (d !== FAR && free(state.crews[i]) && (best < 0 || d < eta[best])) best = i;
  });
  const call: ProtoCall = { id, node, form, at, crew: null };
  if (best < 0) {
    state = { ...state, calls: [...state.calls, call], line: Math.max(0, state.line - 1) };
    emit();
    return null;
  }
  const crew = send(state.road, state.times, state.crews[best], id, node, state.t)!;
  const crews = state.crews.slice();
  crews[best] = crew;
  state = { ...state, crews, calls: [...state.calls, { ...call, crew: crew.id }], line: Math.max(0, state.line - 1) };
  emit();
  return crewNumber(crew);
}

/** Звонок без выезда: линия короче, часы — на время разговора. */
export function noDispatch(talkSeconds: number): void {
  advanceTo(state.t + talkSeconds * 1000);
  state = { ...state, line: Math.max(0, state.line - 1) };
  emit();
}

/** Для сценария в браузере и тестов: начать пробную смену заново. */
export function resetProto(): void {
  state = initial();
  minute = 0;
  emit();
}
