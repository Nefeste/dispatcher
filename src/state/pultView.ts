// Вид пульта (часть П5; docs/08-game-design.md, §2, §5): часы, линия, вызовы, ждущие бригаду, строка рации и доклад
// бригады с выбором больницы. Доклад — то, что бригада увидела на месте (её подозрение), а не правда движка: правду
// о признаках экран не получает (ADR 0005).
import { MED } from '../content/generated/med';
import type { FormKind, Profile } from '../content/types';
import { FAR, search } from '../engine/road/route';
import { crewOptions, type NoticeKind, type Shift, type ShiftCtx, timesAt } from '../engine/shift';
import { callNo, crewNo } from './callView';

export interface WaitingView {
  id: string;
  no: number;
  form: FormKind;
  /** ждёт бригаду, игровых минут — от звонка */
  minutes: number;
  repeats: number;
}

export interface RadioView {
  crew: number;
  /** `died` — доклад: больной умер до приезда бригады (срез, С3); слова «Мягкого исхода» выбирает экран */
  what: Extract<NoticeKind, 'scene' | 'ask' | 'report' | 'auto' | 'free' | 'restock' | 'base' | 'recall'> | 'died';
  /** у доклада: везут или помощь на месте */
  transport: boolean;
}

export interface HospitalChoice {
  id: string;
  name: string;
  profiles: Profile[];
  /** от места вызова, игровых минут */
  minutes: number;
  suggested: boolean;
}

export interface ReportView {
  call: string;
  no: number;
  crew: number;
  /** подозрение бригады — название болезни со строчной буквы */
  diagnosis: string;
  hospitals: HospitalChoice[];
  /** сколько осталось до того, как бригада повезёт в предложенную, игровых секунд */
  left: number;
}

/** Бригада на месте просит реанимационную (срез, С4): кого можно послать и сколько ещё ждёт ответа. */
export interface AskView {
  call: string;
  no: number;
  crew: number;
  /** реанимационные, которых можно послать, — по времени доезда */
  crews: { id: string; no: number; minutes: number }[];
  /** сколько ещё ждёт ответа, игровых секунд */
  left: number;
}

export interface PultView {
  /** секунды от полуночи */
  clock: number;
  /** звонков на линии; есть ли среди них повторные или перезвонившие */
  line: number;
  again: boolean;
  waiting: WaitingView[];
  radio: RadioView | null;
  report: ReportView | null;
  ask: AskView | null;
  /** звонков после конца смены не будет */
  closing: boolean;
  over: boolean;
}

const RADIO: readonly NoticeKind[] = ['scene', 'ask', 'report', 'auto', 'free', 'restock', 'base', 'recall'];

export function pultView(ctx: ShiftCtx, s: Shift): PultView {
  const waiting = s.calls
    .filter(c => c.state === 'wait' && (c.form === 'emergency' || c.form === 'urgent'))
    .map(c => ({ id: c.id, no: callNo(c.id), form: c.form as FormKind, minutes: Math.floor((s.t - c.ringAt) / 60_000), repeats: c.repeats }))
    .sort((a, b) => (a.form === b.form ? b.minutes - a.minutes : a.form === 'emergency' ? -1 : 1));
  let radio: RadioView | null = null;
  for (let i = s.notices.length - 1; i >= 0; i--) {
    const n = s.notices[i];
    if (!RADIO.includes(n.kind) || !n.crew) continue;
    const call = n.call ? s.calls.find(c => c.id === n.call) : undefined;
    radio = { crew: crewNo(n.crew), what: n.kind === 'report' && call?.died ? 'died' : (n.kind as RadioView['what']), transport: Boolean(call?.transport) };
    break;
  }
  const r = s.calls.find(c => c.state === 'report');
  let report: ReportView | null = null;
  if (r) {
    const tree = search(ctx.road, timesAt(ctx, s.t), r.node);
    const name = MED.conditions[r.truth.condition].name.ru;
    const crew = s.crews.find(c => c.id === r.crew)!;
    report = {
      call: r.id, no: callNo(r.id), crew: crewNo(r.crew!), diagnosis: name.charAt(0).toLowerCase() + name.slice(1),
      hospitals: ctx.city.hospitals
        .map(h => ({ id: h.id, name: h.name, profiles: h.profiles, minutes: tree.dist[h.node] === FAR ? 0 : Math.ceil(tree.dist[h.node] / 60_000), suggested: h.id === r.suggested }))
        .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.minutes - b.minutes),
      left: Math.max(0, Math.ceil((crew.until - s.t) / 1000)),
    };
  }
  const a = s.calls.find(c => c.state === 'ask' && c.second);
  const ask: AskView | null = a
    ? {
        call: a.id, no: callNo(a.id), crew: crewNo(a.second!.by),
        crews: crewOptions(ctx, s, a.id)
          .filter(o => !o.redirect && s.crews.find(c => c.id === o.crew)?.kind === 'crew.resus')
          .map(o => ({ id: o.crew, no: crewNo(o.crew), minutes: Math.ceil(o.eta / 60_000) })),
        left: Math.max(0, Math.ceil((a.second!.until - s.t) / 1000)),
      }
    : null;
  return {
    clock: ctx.setup.start + Math.floor(s.t / 1000), line: s.rings.length, again: s.rings.some(x => x.repeat || x.again), waiting, radio, report, ask,
    closing: s.t >= ctx.setup.length * 1000, over: s.over,
  };
}
