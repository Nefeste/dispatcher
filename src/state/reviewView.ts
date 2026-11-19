// Вид разбора закрытой смены (часть П6; docs/08-game-design.md, §7; ADR 0005). Здесь — и только здесь — правда о
// больном открывается: что было на самом деле. Разбор не смешивает две оценки: по известному (что сказал звонящий к
// минуте решения) и по правде (что было и вовремя ли помощь). Слова — src/i18n (T.review); здесь — данные.
import { MED } from '../content/generated/med';
import type { FormKind } from '../content/types';
import { type CallReview, heardAt, type Mistake, review } from '../engine/review';
import type { CallRec, Shift, ShiftCtx } from '../engine/shift';
import { ask, render } from '../engine/talk';
import { type Totals, totals } from '../engine/totals';
import { callNo, crewNo } from './callView';

export interface ReviewRow {
  id: string;
  no: number;
  /** часы звонка, секунды от полуночи */
  clock: number;
  /** первые слова звонящего */
  first: string;
  decided: FormKind | 'none' | null;
  /** форма по правде */
  real: FormKind;
  /** опоздание против нормы, минуты; 0 — в норму; null — бригады не было */
  late: number | null;
  transfer: boolean;
  mistakes: number;
  unlucky: boolean;
}

export interface MistakeView {
  m: Mistake;
  cost: number;
  /** номера вызовов вместо идентификаторов, имена больниц, слова вопроса и признака — для строки */
  bypassed?: number[];
  hospital?: { chosen: string; right: string };
  /** вопрос, который стоило задать, и что звонящий ответил бы */
  question?: { text: string; answer: string };
  /** что сказал звонящий об угрозе — его слова */
  heard?: string;
}

export interface CallDetail {
  row: ReviewRow;
  who: string;
  self: boolean;
  lines: { q: string | null; words: string; clock: number }[];
  /** решение и форма по услышанному в ту минуту; поменяли — на что */
  decided: FormKind | 'none' | null;
  known: FormKind | null;
  changed: FormKind | 'none' | null;
  crew: number | null;
  hospital: string | null;
  /** что было на самом деле: болезнь, пол и возраст */
  condition: string;
  sex: 'm' | 'f';
  age: number;
  wait: number | null;
  normMin: number;
  window: CallReview['outcome']['window'];
  mistakes: MistakeView[];
  unlucky: boolean;
}

export interface ReviewView {
  totals: Totals;
  rows: ReviewRow[];
  main: { row: ReviewRow; mistake: MistakeView } | null;
  detail: (id: string) => CallDetail | null;
}

/** Слова, которыми звонящий сказал о признаке: ответ на вопрос или первые слова. */
function saidAbout(call: CallRec, f: string): string {
  const a = call.asked.find(x => x.learned.some(l => l.f === f && l.heard === 'yes'));
  return a ? a.words : (call.first?.words ?? '');
}

export function reviewView(ctx: ShiftCtx, s: Shift): ReviewView {
  const r = review(ctx, s);
  const clockOf = (ms: number) => ctx.setup.start + Math.floor(ms / 1000);
  const byId = new Map(r.calls.map(c => [c.id, c]));
  const call = (id: string) => s.calls.find(c => c.id === id)!;
  const rowOf = (c: CallReview): ReviewRow => {
    const x = call(c.id);
    return {
      id: c.id, no: callNo(c.id), clock: clockOf(x.ringAt), first: x.first?.words ?? '', decided: c.decided, real: c.outcome.form,
      late: c.outcome.wait === null ? null : Math.ceil(c.outcome.late / 60_000), transfer: Boolean(c.outcome.hospital && !c.outcome.hospital.ok),
      mistakes: c.mistakes.length, unlucky: c.unlucky,
    };
  };
  const hospitalName = (id: string) => ctx.city.hospitals.find(h => h.id === id)?.name ?? id;
  const mistakeOf = (c: CallReview, i: number): MistakeView => {
    const { m, cost } = c.mistakes[i];
    const x = call(c.id);
    const v: MistakeView = { m, cost };
    if (m.kind === 'order') v.bypassed = m.bypassed.map(callNo);
    if (m.kind === 'hospital') v.hospital = { chosen: hospitalName(m.chosen), right: hospitalName(m.right) };
    if (m.kind === 'underTriage' && m.threats.length) v.heard = saidAbout(x, m.threats[0]);
    if (m.kind === 'missedQuestion') {
      const t = x.decisions[0]?.t ?? x.ringAt;
      v.question = { text: render(x.truth, ctx.db.phone.questions[m.q].text), answer: ask(ctx.db, ctx.med, x.truth, m.q, heardAt(x, t), 0).words };
    }
    return v;
  };
  const rows = r.calls.map(rowOf);
  const main = r.main ? { row: rowOf(byId.get(r.main.call)!), mistake: mistakeOf(byId.get(r.main.call)!, r.main.mistake) } : null;
  const detail = (id: string): CallDetail | null => {
    const c = byId.get(id);
    if (!c) return null;
    const x = call(id);
    const lines = [
      ...(x.first ? [{ q: null, words: x.first.words, clock: clockOf(x.answeredAt ?? x.ringAt) }] : []),
      ...x.asked.map(a => ({ q: render(x.truth, ctx.db.phone.questions[a.q].text), words: a.words, clock: clockOf(a.at) })),
    ];
    const name = MED.conditions[x.truth.condition].name.ru;
    return {
      row: rowOf(c), who: x.truth.relation.caller, self: ctx.db.phone.callers[x.truth.caller].self, lines, decided: c.decided, known: c.known, changed: c.changed,
      crew: x.crew ? crewNo(x.crew) : null, hospital: x.hospital ? hospitalName(x.hospital) : null,
      condition: name, sex: x.truth.patient.sex, age: x.truth.patient.age,
      wait: c.outcome.wait === null ? null : Math.ceil(c.outcome.wait / 60_000), normMin: Math.round(c.outcome.norm / 60_000), window: c.outcome.window,
      mistakes: c.mistakes.map((_, i) => mistakeOf(c, i)), unlucky: c.unlucky,
    };
  };
  return { totals: totals(ctx, s), rows, main, detail };
}
