// Вид вызова (ADR 0005; docs/02-architecture.md, §2): то, что экран разговора знает о вызове, — только сказанное
// звонящим и решения диспетчера. Правды о больном здесь нет: ни болезни, ни признаков, которых не назвали. Так же
// устроен src/state/caseView.ts «Анамнеза».
import { QUESTION_GROUPS, type FormKind, type QuestionGroup } from '../content/types';
import { fnv1a } from '../engine/core/hash';
import { AGAIN, CLINIC_ARRIVE, CLINIC_HOURS } from '../engine/rules';
import { type CallRec, crewOf, crewOptions, type Shift, type ShiftCtx, clinicOpen } from '../engine/shift';
import { mayDecide } from '../engine/form';
import { type Heard, render } from '../engine/talk';

export interface QuestionView {
  id: string;
  text: string;
  /** цена, игровые секунды: переспросить дешевле */
  cost: number;
  asked: boolean;
  /** может решить форму — по услышанному (docs/specs/2026-11-call-flow.md, §5) */
  hint: boolean;
}

export interface CardRow {
  label: string;
  value: string;
  /** у ответа о признаках: «нет», «есть» или «не знает» — для значка */
  heard?: Heard;
}

export interface CrewChoice {
  crew: string;
  no: number;
  kind: string;
  /** доезд, игровых минут, с округлением вверх */
  minutes: number;
  /** развернуть с неотложного */
  redirect: boolean;
}

export interface CallView {
  id: string;
  no: number;
  /** кто звонит: «дочь», «сам», «прохожий» */
  who: string;
  /** картинка звонящего; нет — тёмная сцена (картинки остальных — с частью П8) */
  picture: string | null;
  self: boolean;
  /** повторный звонок: бригады всё нет */
  repeat: boolean;
  /** что звонящий сказал последним */
  said: string;
  rows: CardRow[];
  /** на линии в этом разговоре, игровых секунд */
  seconds: number;
  groups: { id: QuestionGroup; questions: QuestionView[] }[];
  form: FormKind | 'none' | null;
  /** после решения — кого послать */
  options: CrewChoice[];
  /** неотложный можно передать в поликлинику: она открыта (срез, С5) */
  pass: boolean;
  /** неотложный, а поликлиника в этой смене есть, но закрыта: сказать, с какого часа (игра владельца 22.11.2026) */
  passClosed: boolean;
  /** что диспетчер сказал последним — строкой над словами звонящего (как по телефону): принял звонок, перезвонил
   *  сам или задал вопрос (текст вопроса) */
  me: { kind: 'answer' | 'dial' } | { kind: 'asked'; text: string };
  /** разговор открыт перезвоном диспетчера, вопросов ещё не было: звонящий ответил на звонок */
  dialed: boolean;
  /** врач поликлиники на дом: через сколько минут приезжает и часы приёма вызовов (§4 геймдизайна) */
  clinicMin: readonly [number, number];
  clinicHours: readonly [number, number];
  /** звонит врач поликлиники, которой передали вызов: с чем вернулся вызов; null — звонит сам звонящий */
  clinic: 'emergency' | 'urgent' | null;
}

export const callNo = (id: string) => Number(id.split('.')[1]);

/** Картинка звонящего — по его слову и полу; с улицы — тот же человек на вечерней улице (`<картинка>-street`). */
function pictureOf(call: CallRec): string | null {
  const p = call.truth.relation.picture;
  const pic = (typeof p === 'string' ? p : p?.[call.truth.callerSex]) ?? null;
  if (!pic) return null;
  return call.truth.where === 'street' ? `${pic}-street` : pic;
}
export const crewNo = (id: string) => Number(id.split('.')[1]);

/** Слова повторного звонка — вариант по зерну звонка и номеру повтора. */
function againWords(ctx: ShiftCtx, call: CallRec): string {
  // звонят после отказа в выезде (срез, С3) — свои слова: «вы не поехали, ему хуже»
  const refused = call.decisions[call.decisions.length - 1]?.form === 'none';
  const xs = refused ? ctx.db.phone.callers[call.truth.caller].refused : ctx.db.phone.callers[call.truth.caller].again;
  return render(call.truth, xs[fnv1a(`${call.truth.seed}:again:${call.repeats}`) % xs.length]);
}

export function callView(ctx: ShiftCtx, s: Shift, id: string): CallView | null {
  const call = s.calls.find(c => c.id === id);
  if (!call || !call.first) return null;
  const db = ctx.db;
  const kind = db.phone.callers[call.truth.caller];
  const repeat = call.repeats > 0;
  const sinceOpen = call.asked.filter(a => a.at >= (call.openedAt ?? 0));
  // разговор открыл диспетчер — перезвонил ждущему (игра владельца 22.11.2026)
  const dialed = call.dialedAt !== undefined && call.dialedAt === call.openedAt;
  const said = sinceOpen.length ? sinceOpen[sinceOpen.length - 1].words : repeat ? againWords(ctx, call) : call.first.words;
  // карточка: повод, затем ответы по порядку; переспросили — ответ заменяет прежний
  const rows: CardRow[] = [{ label: '', value: call.first.words }];
  const byQ = new Map<string, CardRow>();
  for (const a of call.asked) {
    const q = db.phone.questions[a.q];
    const heards = q.opens.map(f => call.heard[f]).filter(Boolean);
    const heard: Heard | undefined = heards.includes('yes') ? 'yes' : heards.length && heards.every(h => h === 'no') ? 'no' : heards.includes('unsure') ? 'unsure' : undefined;
    byQ.delete(a.q);
    byQ.set(a.q, { label: q.label, value: a.words, ...(heard ? { heard } : {}) });
  }
  rows.push(...byQ.values());
  // подсказка «может решить форму» — только по услышанному: что сказали «да», о чём ещё не спрашивали
  const hints = mayDecide(db, ctx.med, new Map(Object.entries(call.heard)), new Set(call.asked.map(a => a.q)));
  const groups = QUESTION_GROUPS.map(g => ({
    id: g,
    questions: Object.values(db.phone.questions)
      .filter(q => q.group === g)
      .sort((a, b) => a.rank - b.rank)
      .map(q => {
        const asked = call.asked.some(a => a.q === q.id);
        return { id: q.id, text: render(call.truth, q.text), cost: asked ? AGAIN / 1000 : q.cost, asked, hint: hints.has(q.id) };
      }),
  }));
  const options =
    call.form === 'emergency' || call.form === 'urgent'
      ? crewOptions(ctx, s, call.id).map(o => ({
          crew: o.crew,
          no: crewNo(o.crew),
          kind: db.crews[crewOf(s, o.crew)!.kind].name,
          minutes: Math.ceil(o.eta / 60_000),
          redirect: o.redirect,
        }))
      : [];
  return {
    id: call.id, no: callNo(call.id), who: call.truth.relation.caller, picture: pictureOf(call), self: kind.self, repeat, said, rows,
    seconds: Math.floor((s.t - (call.openedAt ?? s.t)) / 1000), groups, form: call.form, options,
    pass: call.form === 'urgent' && clinicOpen(ctx, s) && !call.clinic,
    passClosed: call.form === 'urgent' && ctx.setup.clinic && !clinicOpen(ctx, s) && !call.clinic,
    me: sinceOpen.length ? { kind: 'asked', text: db.phone.questions[sinceOpen[sinceOpen.length - 1].q].text } : dialed ? { kind: 'dial' } : { kind: 'answer' },
    dialed: dialed && !sinceOpen.length,
    clinicMin: [CLINIC_ARRIVE[0] / 60_000, CLINIC_ARRIVE[1] / 60_000],
    clinicHours: [CLINIC_HOURS[0] / 3600, CLINIC_HOURS[1] / 3600],
    // разговор открыт по звонку из поликлиники: вызов вернулся, и после её приезда звонящий не перезванивал
    clinic: call.clinic?.back && (call.openedAt ?? 0) >= call.clinic.arrive && !sinceOpen.length ? call.clinic.back : null,
  };
}
