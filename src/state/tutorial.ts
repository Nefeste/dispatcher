// Учебные звонки (спецификация прототипа, §3, шаги 3–6): подсказки по шагам — что сделать сейчас. Только для
// учебных звонков смены (`script` записи смены): первый — «отец не отвечает» (спросить, как дышит, — экстренная —
// ближайшая бригада), второй — сам больной с температурой (неотложная; бригада — когда освободится), третий —
// прохожий, который не знает болезней (что спросить, чтобы решить). Слова — src/i18n (T.tutorial); здесь — какой шаг.
import type { Shift, ShiftCtx } from '../engine/shift';
import { callNo } from './callView';

export type Hint =
  | 'ring' | 'clock' | 'report'
  | 'askBreathing' | 'formEmergency' | 'sendNearest'
  | 'askSafe' | 'formUrgent' | 'sendUrgent'
  | 'askConscious' | 'formKnown';

/** Какой это учебный звонок смены: 0, 1, 2…; не учебный — null. */
export function lessonOf(ctx: ShiftCtx, id: string): number | null {
  const k = callNo(id) - 1;
  return k < ctx.setup.script.length ? k : null;
}

/** Подсказка в разговоре. */
export function callHint(ctx: ShiftCtx, s: Shift, id: string): Hint | null {
  const k = lessonOf(ctx, id);
  const call = s.calls.find(c => c.id === id);
  if (k === null || !call) return null;
  const asked = (q: string) => call.asked.some(a => a.q === q);
  const decided = call.form !== null;
  if (k === 0) return !asked('q.breathing') ? 'askBreathing' : !decided ? 'formEmergency' : 'sendNearest';
  if (k === 1) return !asked('q.breathing') && !asked('q.conscious') ? 'askSafe' : !decided ? 'formUrgent' : 'sendUrgent';
  if (k === 2) return !asked('q.conscious') && !asked('q.answers') ? 'askConscious' : !decided ? 'formKnown' : 'sendNearest';
  return null;
}

/** Подсказка на пульте: учебный звонок на линии, доклад по учебному вызову, первая бригада уехала. */
export function pultHint(ctx: ShiftCtx, s: Shift): Hint | null {
  if (s.rings.some(r => !r.repeat && lessonOf(ctx, r.call) !== null)) return 'ring';
  if (s.calls.some(c => c.state === 'report' && lessonOf(ctx, c.id) !== null)) return 'report';
  if (s.calls.length === 1 && s.calls[0].sentAt !== null) return 'clock';
  return null;
}
