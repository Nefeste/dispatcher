// Исход и разбор (часть П6; docs/08-game-design.md, §7; ADR 0005). Две оценки каждого вызова, не смешанные:
// - по известному — верно ли решено по тому, что звонящий сказал к минуте решения, и какой вопрос менял решение, если
//   его не задали; невезение (звонящий не знал) ошибкой не считается;
// - по правде — что было на самом деле, вовремя ли приехала помощь (норма доезда, окно болезни), та ли больница.
// У ошибки — цена в минутах; главная ошибка смены — самая дорогая. Чистый TypeScript: правду читает только разбор
// закрытой смены (ADR 0005), экран смены её не видит.
import type { FormKind } from '../content/types';
import { formByTruth } from './form';
import { FAR, search } from './road/route';
import { NORM_EMERGENCY, NORM_URGENT } from './rules';
import type { CallRec, Shift, ShiftCtx } from './shift';
import { timesAt } from './shift';
import { ask, type Heard } from './talk';

/** Окно болезни: уложились ли и на сколько вышли, мс. */
export interface WindowResult {
  minutes: number;
  from: 'onset' | 'call' | 'crew';
  met: boolean;
  /** на сколько вышли за окно, мс; 0 — уложились */
  over: number;
}

/** Исход по правде. */
export interface Outcome {
  /** форма по правде */
  form: FormKind;
  /** от звонка до прибытия бригады, мс; null — бригада не приезжала */
  wait: number | null;
  /** норма для этой формы, мс */
  norm: number;
  /** на сколько позже нормы, мс; 0 — в норму */
  late: number;
  window: WindowResult | null;
  /** везли: в больницу ли нужного профиля и ближайшая такая */
  hospital: { chosen: string; ok: boolean; right: string | null; transfer: number } | null;
  /** больной умер до приезда бригады (срез, С3; только по записи `fatal` с источником) */
  died: boolean;
  /** бригада на месте просила реанимационную (срез, С4): приехала ли и через сколько от звонка, мс */
  second: { came: number | null } | null;
  /** исход тремя ступенями (§7 геймдизайна): вовремя, с опозданием, не дождался помощи */
  tier: Tier;
}

export type Tier = 'ok' | 'late' | 'died';

export type Mistake =
  /** без выезда, а помощь была нужна */
  | { kind: 'noDispatch' }
  /** неотложная, а по услышанному — угроза жизни */
  | { kind: 'underTriage'; threats: string[] }
  /** не спросили то, что меняло решение, а звонящий знал */
  | { kind: 'missedQuestion'; q: string; f: string }
  /** неотложному дали бригаду, пока экстренные ждали (388н, п. 12) */
  | { kind: 'order'; bypassed: string[] }
  /** везли не в больницу нужного профиля: перевод */
  | { kind: 'hospital'; chosen: string; right: string }
  /** реанимационная бригада на неотложный — занята там, где справилась бы общепрофильная (388н, п. 12) */
  | { kind: 'crew'; crew: string }
  /** бригада на месте просила реанимационную, свободная была, а её не послали (388н, прил. 2, п. 17; срез, С4) */
  | { kind: 'noSecond'; crew: string }
  /** экстренная без услышанной угрозы — бригада ушла раньше, чем нужно было */
  | { kind: 'overTriage' };

export interface CallReview {
  id: string;
  /** форма, которую решил диспетчер (первое решение), и форма по услышанному в ту минуту */
  decided: FormKind | 'none' | null;
  known: FormKind | null;
  /** решение потом поменяли (повторный звонок) */
  changed: FormKind | 'none' | null;
  outcome: Outcome;
  mistakes: { m: Mistake; cost: number }[];
  /** угроза была, но услышать её было нельзя: звонящий не знал — не ошибка */
  unlucky: boolean;
}

export interface Review {
  calls: CallReview[];
  /** главная ошибка: вызов и его ошибка; null — ошибок нет */
  main: { call: string; mistake: number } | null;
}

/** Порядок важности ошибок при равной цене: сперва то, что ближе к жизни. */
const WEIGHT: Record<Mistake['kind'], number> = { noDispatch: 8, underTriage: 7, missedQuestion: 6, noSecond: 5, order: 4, hospital: 3, crew: 2, overTriage: 1 };

/** Что было услышано к моменту `t`: первые слова и ответы на вопросы, заданные раньше. */
export function heardAt(call: CallRec, t: number): Map<string, Heard> {
  const out = new Map<string, Heard>();
  const put = (l: { f: string; heard: Heard }) => {
    if (l.heard !== 'unsure' || !out.has(l.f)) out.set(l.f, l.heard);
  };
  call.first?.learned.forEach(put);
  for (const a of call.asked) if (a.at < t) a.learned.forEach(put);
  return out;
}

/** Исход вызова по правде. */
export function outcomeOf(ctx: ShiftCtx, s: Shift, call: CallRec): Outcome {
  const form = formByTruth(ctx.db, call.truth);
  const norm = form === 'emergency' ? NORM_EMERGENCY : NORM_URGENT;
  const wait = call.arrivedAt === null ? null : call.arrivedAt - call.ringAt;
  const late = wait === null ? (call.form === 'none' ? 0 : Math.max(0, s.t - call.ringAt - norm)) : Math.max(0, wait - norm);
  const pc = ctx.db.phone.conditions[call.truth.condition];
  let hospital: Outcome['hospital'] = null;
  if (call.hospital) {
    const chosen = ctx.city.hospitals.find(h => h.id === call.hospital)!;
    const ok = chosen.profiles.includes(pc.hospital);
    let right: string | null = null, transfer = 0;
    if (!ok) {
      // перевод: от выбранной больницы до ближайшей нужного профиля
      const tree = search(ctx.road, timesAt(ctx, call.hospitalAt ?? s.t), chosen.node);
      const best = ctx.city.hospitals.filter(h => h.profiles.includes(pc.hospital) && tree.dist[h.node] !== FAR).sort((a, b) => tree.dist[a.node] - tree.dist[b.node])[0];
      if (best) {
        right = best.id;
        transfer = tree.dist[best.node];
      }
    }
    hospital = { chosen: chosen.id, ok, right, transfer };
  }
  let window: WindowResult | null = null;
  const w = pc.window;
  const params = call.truth.patient.truth.conditions[0]?.params ?? {};
  if (w && Object.entries(w.when ?? {}).every(([k, vs]) => vs.includes(params[k]))) {
    const start = w.from === 'onset' ? call.ringAt - call.truth.onset * 60_000 : w.from === 'call' ? call.ringAt : call.arrivedAt;
    // окно кончается в больнице нужного профиля; не туда — с переводом
    const end = call.hospitalAt === null ? null : call.hospitalAt + (hospital && !hospital.ok ? hospital.transfer : 0);
    const span = start === null || end === null ? null : end - start;
    const limit = w.minutes * 60_000;
    window = { minutes: w.minutes, from: w.from, met: span !== null && span <= limit, over: span === null ? limit : Math.max(0, span - limit) };
  }
  // нужная бригада — реанимационная, если её просили: не приехала — помощь «меньшая, чем нужно» (§7)
  const second = call.second ? { came: call.second.came === null ? null : call.second.came - call.ringAt } : null;
  const short = second !== null && second.came === null;
  const tier: Tier = call.died ? 'died' : late > 0 || short || (window && !window.met) || (hospital && !hospital.ok) ? 'late' : 'ok';
  return { form, wait, norm, late, window, hospital, died: call.died, second, tier };
}

/** Вопрос, который открыл бы угрозу, если бы его задали до решения, и звонящий знал ответ. */
function missedQuestion(ctx: ShiftCtx, call: CallRec, t: number): { q: string; f: string } | null {
  const heard = heardAt(call, t);
  const asked = new Set(call.asked.filter(a => a.at < t).map(a => a.q));
  const qs = Object.values(ctx.db.phone.questions).filter(q => !asked.has(q.id) && q.opens.some(f => ctx.db.phone.findings[f].threat));
  // дешёвые — первыми: разбор называет тот вопрос, который проще было задать
  qs.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  for (const q of qs) {
    const a = ask(ctx.db, ctx.med, call.truth, q.id, heard, 0);
    const f = a.learned.find(l => l.heard === 'yes' && ctx.db.phone.findings[l.f].threat);
    if (f) return { q: q.id, f: f.f };
  }
  return null;
}

export function reviewCall(ctx: ShiftCtx, s: Shift, call: CallRec): CallReview {
  const outcome = outcomeOf(ctx, s, call);
  const first = call.decisions[0] ?? null;
  const last = call.decisions[call.decisions.length - 1] ?? null;
  const mistakes: { m: Mistake; cost: number }[] = [];
  let unlucky = false;
  const late = Math.ceil(outcome.late / 60_000);
  if (first) {
    if (first.form === 'none') {
      mistakes.push({ m: { kind: 'noDispatch' }, cost: Math.max(late, Math.ceil(outcome.norm / 60_000)) });
    } else if (first.form === 'urgent' && first.known === 'emergency') {
      mistakes.push({ m: { kind: 'underTriage', threats: first.threats }, cost: late });
    } else if (first.form === 'urgent' && outcome.form === 'emergency') {
      // по услышанному угрозы не было, а была: не спросили — ошибка; спросить было нечего — невезение
      const miss = missedQuestion(ctx, call, first.t);
      if (miss) mistakes.push({ m: { kind: 'missedQuestion', ...miss }, cost: late });
      else unlucky = true;
    } else if (first.form === 'emergency' && first.known === 'urgent' && outcome.form === 'urgent') {
      mistakes.push({ m: { kind: 'overTriage' }, cost: 0 });
    }
  }
  if (call.bypassed.length) {
    // цена — сколько опоздали обогнанные экстренные
    const cost = call.bypassed.reduce((a, id) => {
      const other = s.calls.find(c => c.id === id);
      return Math.max(a, other ? Math.ceil(outcomeOf(ctx, s, other).late / 60_000) : 0);
    }, 0);
    mistakes.push({ m: { kind: 'order', bypassed: call.bypassed }, cost });
  }
  if (outcome.hospital && !outcome.hospital.ok && outcome.hospital.right) {
    mistakes.push({ m: { kind: 'hospital', chosen: outcome.hospital.chosen, right: outcome.hospital.right }, cost: Math.ceil(outcome.hospital.transfer / 60_000) });
  }
  // первая бригада вызова: реанимационная, которую попросили на месте, — не ошибка
  const firstId = call.second ? call.second.by : call.crew;
  const crew = firstId ? s.crews.find(c => c.id === firstId) : undefined;
  if (crew && crew.kind === 'crew.resus' && call.form === 'urgent') mistakes.push({ m: { kind: 'crew', crew: crew.id }, cost: 0 });
  // просили реанимационную, свободная была — не послали: цена — сколько бригада везла сама без неё, до больницы
  if (call.second && call.second.answer !== 'sent' && call.second.answer !== null && call.second.free) {
    const cost = call.hospitalAt !== null ? Math.ceil((call.hospitalAt - call.second.at) / 60_000) : 0;
    mistakes.push({ m: { kind: 'noSecond', crew: call.second.by }, cost });
  }
  return {
    id: call.id,
    decided: first?.form ?? null,
    known: first?.known ?? null,
    changed: last && first && last.form !== first.form ? last.form : null,
    outcome,
    mistakes,
    unlucky: unlucky && !mistakes.length,
  };
}

/** Разбор закрытой смены: каждый вызов и главная ошибка — самая дорогая в минутах. */
export function review(ctx: ShiftCtx, s: Shift): Review {
  const calls = s.calls.filter(c => c.answeredAt !== null).map(c => reviewCall(ctx, s, c));
  let main: Review['main'] = null;
  let best = -1;
  calls.forEach(c =>
    c.mistakes.forEach((x, i) => {
      const score = x.cost * 10 + WEIGHT[x.m.kind];
      if (score > best) {
        best = score;
        main = { call: c.id, mistake: i };
      }
    }),
  );
  return { calls, main };
}
