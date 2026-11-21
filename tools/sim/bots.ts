// Диспетчеры-правила (docs/02-architecture.md, §8; спецификация прототипа, §4): кто как играет смену. Их зовут
// «виртуальный диспетчер» (tools/sim/shift.ts) и тесты разбора. Бот видит то же, что игрок: вид вызова — что
// сказано, бригады, линию; правду о больном он не читает.
import { free } from '../../src/engine/crews';
import { formByKnown } from '../../src/engine/form';
import { FAR } from '../../src/engine/road/route';
import { advance, apply, asking, callOf, type Command, crewOptions, type Lineup, type Logged, newShift, nextEvent, type Shift, type ShiftCtx } from '../../src/engine/shift';

export interface Bot {
  name: string;
  /** какие вопросы задаёт по порядку */
  questions: readonly string[] | 'all';
  /** форма: по услышанному или всегда экстренная */
  form: 'known' | 'emergency' | 'urgent';
  /** держит порядок 388н, п. 12: неотложному — бригаду, только если экстренные не ждут и свободных больше запаса */
  ordered: boolean;
  /** сколько свободных бригад держать для экстренных, когда решает о неотложном */
  reserve: number;
  /** какую больницу выбирает по докладу: предложенную или последнюю в списке (для тестов разбора) */
  hospital?: 'suggested' | 'last';
}

/** Вопросы «по правилам»: сознание, дыхание, лицо и руки, боль, кожа — то, что открывает угрозу жизни; и как пройти к
 *  больному — подъезд, этаж, код (mos-103; срез, С4: не спросили — бригада может встать у закрытого подъезда). */
export const RULE_QUESTIONS = ['q.conscious', 'q.breathing', 'q.face', 'q.pain_where', 'q.skin', 'q.access'] as const;

export const BOTS: Record<string, Bot> = {
  rules: { name: 'по правилам', questions: RULE_QUESTIONS, form: 'known', ordered: true, reserve: 1 },
  askAll: { name: 'спрашивает всё', questions: 'all', form: 'known', ordered: true, reserve: 1 },
  noQuestions: { name: 'без вопросов', questions: [], form: 'known', ordered: true, reserve: 1 },
  allEmergency: { name: 'всё экстренно', questions: [], form: 'emergency', ordered: true, reserve: 0 },
};

/** На неотложный — общепрофильная бригада (388н, п. 12). */
const general = (s: Shift, crew: string) => s.crews.find(c => c.id === crew)?.kind === 'crew.general';

function freeCount(s: Shift): number {
  return s.crews.filter(free).length;
}

/** Что бот сделал бы сейчас; null — ждать. */
export function botMove(ctx: ShiftCtx, s: Shift, bot: Bot): Command | null {
  // запас бригад нужен, пока могут прийти новые звонки; смена кончилась — держать некого
  const reserve = s.t < ctx.setup.length * 1000 ? bot.reserve : 0;
  if (s.open) {
    const call = callOf(s, s.open)!;
    const list = bot.questions === 'all' ? Object.keys(ctx.db.phone.questions).sort() : bot.questions;
    if (call.form === null) {
      const next = list.find(q => !call.asked.some(a => a.q === q));
      if (next) return { c: 'ask', q: next };
      const form = bot.form === 'known' ? formByKnown(ctx.db, new Map(Object.entries(call.heard))) : bot.form;
      return { c: 'form', form };
    }
    const opts = crewOptions(ctx, s, call.id);
    if (call.form === 'emergency') return opts[0] ? { c: 'send', call: call.id, crew: opts[0].crew } : { c: 'hold', call: call.id };
    const emergencyWaits = s.calls.some(c => c.state === 'wait' && c.form === 'emergency');
    const ok = !bot.ordered || (!emergencyWaits && freeCount(s) > reserve);
    const opt = opts.find(o => !o.redirect && (!bot.ordered || general(s, o.crew)));
    return ok && opt ? { c: 'send', call: call.id, crew: opt.crew } : { c: 'hold', call: call.id };
  }
  if (s.rings.length) return { c: 'answer' };
  // бригада на месте просит (срез, С4): реанимационную — ближайшую свободную, нет — пусть везут сами; у подъезда и не по
  // адресу — перезвонить звонящему; второй пострадавший — свободную общепрофильную, если экстренные не ждут и есть запас
  const ask = s.calls.find(c => asking(c) !== null);
  if (ask) {
    const kind = asking(ask)!;
    const opts = crewOptions(ctx, s, ask.id).filter(o => !o.redirect);
    if (kind === 'resus') {
      const resus = opts.find(o => s.crews.find(c => c.id === o.crew)?.kind === 'crew.resus');
      return resus ? { c: 'second', call: ask.id, crew: resus.crew } : { c: 'second', call: ask.id };
    }
    if (kind !== 'victim') return { c: 'snag', call: ask.id, act: 'phone' };
    const emergencyWaits = s.calls.some(c => c.state === 'wait' && c.form === 'emergency');
    const opt = opts.find(o => general(s, o.crew));
    return opt && !emergencyWaits && freeCount(s) > reserve ? { c: 'snag', call: ask.id, act: 'send', crew: opt.crew } : { c: 'snag', call: ask.id, act: 'wait' };
  }
  const report = s.calls.find(c => c.state === 'report');
  if (report) {
    const hospital = bot.hospital === 'last' ? ctx.city.hospitals[ctx.city.hospitals.length - 1].id : report.suggested!;
    return { c: 'hospital', call: report.id, hospital };
  }
  // ждущие: экстренные — первыми, по времени звонка; неотложные — когда экстренные не ждут и есть запас
  const waiting = s.calls.filter(c => c.state === 'wait').sort((a, b) => (a.form === b.form ? a.ringAt - b.ringAt : a.form === 'emergency' ? -1 : 1));
  for (const w of waiting) {
    if (w.form === 'urgent' && bot.ordered && (waiting.some(x => x.form === 'emergency') || freeCount(s) <= reserve)) continue;
    const opt = crewOptions(ctx, s, w.id).find(o => !o.redirect && (w.form === 'emergency' || !bot.ordered || general(s, o.crew)));
    if (opt) return { c: 'send', call: w.id, crew: opt.crew };
  }
  return null;
}

/** Бот играет смену до конца; журнал — как сохранение игры. */
export function play(ctx: ShiftCtx, seed: number, bot: Bot, lineup?: Lineup): { s: Shift; log: Logged[] } {
  const s = newShift(ctx, seed, lineup);
  const log: Logged[] = [];
  for (let i = 0; i < 20000 && !s.over; i++) {
    const cmd = botMove(ctx, s, bot);
    if (cmd) {
      const t = s.t;
      const why = apply(ctx, s, cmd);
      if (why) throw new Error(`${bot.name}: ${JSON.stringify(cmd)} → ${why}`);
      log.push({ t, cmd });
    } else {
      const next = nextEvent(ctx, s);
      advance(ctx, s, next === FAR ? 60_000 : Math.max(1, next - s.t));
    }
  }
  if (!s.over) throw new Error(`${bot.name}: смена ${seed} не кончилась`);
  return { s, log };
}
