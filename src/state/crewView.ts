// Карточка бригады на пульте (игра владельца 20.11.2026, #22 и #26, вариант 1: «невозможно нажать на приехавшие на
// место бригады»): касание знака на карте — кто это, чем занята, какой вызов, когда освободится. Только то, что знает
// пульт: вид бригады, её путь и сроки; что бригада нашла у больного, — в её докладе, не здесь (ADR 0005).
import { pointAt, arrival } from '../engine/road/pos';
import type { FormKind } from '../content/types';
import type { CrewState } from '../engine/crews';
import { FAR } from '../engine/road/route';
import type { Shift, ShiftCtx } from '../engine/shift';
import { callNo, crewNo } from './callView';

export interface CrewCard {
  id: string;
  no: number;
  /** вид бригады словом из базы */
  kind: string;
  state: CrewState;
  /** вызов, на котором бригада: номер и форма */
  call: { no: number; form: FormKind | 'none' | null } | null;
  /** больница, куда везёт или где стоит */
  hospital: string | null;
  /** сколько ещё до конца этого шага — доедет, закончит на месте, сдаст больного; игровых минут, вверх; null — не знает */
  minutes: number | null;
  /** на сколько вызовов осталось укладки (срез, С2) */
  kit: number;
  /** бригада на месте вызова — где: у подъезда, в квартире, на улице; вставка по касанию (срез, С4). Место — из адреса,
   *  который звонящий назвал: дом или улица */
  place: OnScene | null;
}

export type OnScene = 'door' | 'flat' | 'stop';

/** Где бригада сейчас — точка карты: едущая — на пути, стоящая — в узле. */
export function crewPoint(ctx: ShiftCtx, s: Shift, i: number): [number, number] {
  const c = s.crews[i];
  if (c.route) return pointAt(ctx.map, c.route, s.t);
  return [ctx.map.nodes.x[c.at], ctx.map.nodes.y[c.at]];
}

/** Бригада у точки карты (`x`, `y`) не дальше `radius` единиц карты — ближайшая; нет — null. */
export function crewAt(ctx: ShiftCtx, s: Shift, x: number, y: number, radius: number): string | null {
  let best: string | null = null;
  let bestD = radius * radius;
  s.crews.forEach((c, i) => {
    const [cx, cy] = crewPoint(ctx, s, i);
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = c.id;
    }
  });
  return best;
}

export function crewCard(ctx: ShiftCtx, s: Shift, id: string): CrewCard | null {
  const c = s.crews.find(x => x.id === id);
  if (!c) return null;
  const call = c.call ? s.calls.find(x => x.id === c.call) : undefined;
  // ждёт ответа диспетчера или у закрытого подъезда — когда кончит, не знает
  const end = c.route ? arrival(c.route) : (c.state === 'scene' || c.state === 'hospital' || c.state === 'restock') && c.until < FAR ? c.until : 0;
  const place: OnScene | null = c.state !== 'scene' || !call ? null : call.truth.where === 'street' ? 'stop' : call.inAt === null ? 'door' : 'flat';
  const hospital = call?.hospital && (c.state === 'transport' || c.state === 'hospital') ? (ctx.city.hospitals.find(h => h.id === call.hospital)?.name ?? null) : null;
  return {
    id: c.id,
    no: crewNo(c.id),
    kind: ctx.db.crews[c.kind].name,
    state: c.state,
    call: call ? { no: callNo(call.id), form: call.form } : null,
    hospital,
    minutes: end > s.t ? Math.ceil((end - s.t) / 60_000) : null,
    kit: c.kit,
    place,
  };
}
