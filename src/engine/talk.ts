// Разговор (часть П4; docs/08-game-design.md, §3; ADR 0002, 0003): первые слова звонящего и ответы на вопросы — из
// правды больного и того, что звонящий знает. Звонящий не врёт: знает — говорит как есть, не знает — «не знаю», и
// признак отмечен неуверенным. Слова — из записей content/ (шаблоны `{м|ж}`, `{^м|ж}`, `{who}`…); вариант выбирается
// по зерну звонка, поэтому один звонок говорит одинаково. Цену вопроса в игровых секундах считает смена (П5).
import type { ContentDb } from '../content/med';
import type { Db, Lines, Question } from '../content/types';
import type { CallTruth } from './callers';
import { has } from './callers';
import { fnv1a } from './core/hash';

export type Heard = 'yes' | 'no' | 'unsure';

export interface Learned {
  f: string;
  heard: Heard;
}

export interface Answer {
  words: string;
  /** что узнал диспетчер о признаках этого ответа */
  learned: Learned[];
  /** возраст: число и точно ли (не знает точно — «на вид», границы полосы) */
  age?: { value: number; exact: boolean; range?: [number, number] };
  /** минут от начала: полоса ответа; null — звонящий не знает */
  onset?: [number, number] | null;
}

const pick = <T>(xs: readonly T[], key: string): T => xs[fnv1a(key) % xs.length];

/** Слово «кто он звонящему»: «отец», «соседка», «мужчина». */
export function whoOf(call: CallTruth): string {
  return call.relation.patient[call.patient.sex] ?? '';
}

/** Число и слово лет: 1 год, 2 года, 5 лет, 21 год, 11 лет. */
export function yearsWord(n: number, words: readonly [string, string, string]): string {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return words[0];
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return words[1];
  return words[2];
}

/** Подставить в шаблон пол, «кто он» и числа. */
export function render(call: CallTruth, template: string, extra: Record<string, string | number> = {}): string {
  const who = whoOf(call);
  const vars: Record<string, string> = { who, Who: who.charAt(0).toUpperCase() + who.slice(1), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) };
  return template
    .replace(/\{([^{}]*)\}/g, (_, t: string) => {
      if (t.includes('|')) {
        const caller = t.startsWith('^');
        const [m, f] = (caller ? t.slice(1) : t).split('|');
        return (caller ? call.callerSex : call.patient.sex) === 'm' ? m : f;
      }
      return vars[t] ?? '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const side = (call: CallTruth, db: Db) => (db.phone.callers[call.caller].self ? 'self' : 'other');

function say(db: Db, call: CallTruth, lines: Lines, key: string, extra?: Record<string, string | number>): string {
  const xs = lines[side(call, db)];
  return xs.length ? render(call, pick(xs, `${call.seed}:${key}`), extra) : '';
}

function unsure(db: Db, call: CallTruth, key: string): string {
  return render(call, pick(db.phone.callers[call.caller].unsure, `${call.seed}:unsure:${key}`));
}

/** Что признак «есть» — по словам звонящего, двумя строками самое большее. */
function present(db: Db, call: CallTruth, fs: string[], key: string): string {
  return fs.slice(0, 2).map(f => say(db, call, db.phone.findings[f].says.present, `${key}:${f}`)).join('. ');
}

/**
 * Первые слова: повод — первый по порядку, чей признак у больного есть и звонящий о нём знает. Начнёт ли он с него —
 * доля `say` повода; не начнёт — скажет смутное «плохо», и признак откроет только вопрос. Сначала — поводы основной
 * болезни: с давней спины не начинает тот, у кого жар и кашель (игра владельца 22.11.2026); фоновая болезнь даёт повод,
 * только если основная не даёт ни одного.
 */
export function firstWords(db: Db, call: CallTruth): { reason: string; words: string; learned: Learned[] } {
  const byRank = Object.values(db.phone.reasons).sort((a, b) => a.rank - b.rank);
  const self = db.phone.callers[call.caller].self;
  const fallback = byRank.find(r => !r.when.length);
  if (!fallback) throw new Error('firstWords: no fallback reason');
  const vague = { reason: fallback.id, words: say(db, call, fallback.words, `first:${fallback.id}`), learned: [] };
  if (call.first === 'vague') return vague;
  const main = (f: string) => call.patient.truth.findings.some(x => x.f === f && x.cause === call.condition);
  const ofMain = (r: (typeof byRank)[number]) => r.when.some(f => main(f) && call.knows[f]);
  const reasons = [...byRank.filter(ofMain), ...byRank.filter(r => !ofMain(r))];
  for (const r of reasons) {
    const known = r.when.filter(f => has(call, f) && call.knows[f]);
    if (!r.when.length || !known.length || (self && !r.words.self.length)) continue;
    if (call.first !== 'clear' && fnv1a(`${call.seed}:say:${r.id}`) % 10000 >= r.say) return vague;
    return { reason: r.id, words: say(db, call, r.words, `first:${r.id}`), learned: known.map(f => ({ f, heard: 'yes' as const })) };
  }
  return vague;
}

/** О чём человек скажет первым: признаки основной болезни, потом — по заметности для больного «Анамнеза». */
function bySalience(med: ContentDb, call: CallTruth, fs: string[]): string[] {
  const main = (f: string) => (call.patient.truth.findings.some(x => x.f === f && x.cause === call.condition) ? 1 : 0);
  return [...fs].sort((a, b) => main(b) - main(a) || (med.findings[b]?.salience ?? 0) - (med.findings[a]?.salience ?? 0) || a.localeCompare(b));
}

/**
 * Ответ на вопрос. `heard` — что уже сказано в этом разговоре: повтор «что ещё?» называет только новое. `n` — какой по
 * счёту раз задан вопрос: слова другие, но знает звонящий то же самое.
 */
export function ask(db: Db, med: ContentDb, call: CallTruth, qid: string, heard: ReadonlyMap<string, Heard> = new Map(), n = 0): Answer {
  const q: Question | undefined = db.phone.questions[qid];
  if (!q) throw new Error(`ask: unknown question ${qid}`);
  const key = `${qid}:${n}`;
  if (q.about === 'age') {
    const age = call.patient.age;
    if (call.knows[qid]) return { words: say(db, call, q.answer!, key, { age, years: yearsWord(age, q.years!) }), learned: [], age: { value: age, exact: true } };
    const i = q.bands!.findIndex(b => age <= b.to);
    const band = q.bands![i];
    const lo = i > 0 ? q.bands![i - 1].to + 1 : 18;
    return { words: say(db, call, band.words, key), learned: [], age: { value: age, exact: false, range: [lo, band.to] } };
  }
  if (q.about === 'onset') {
    if (!call.knows[qid]) return { words: unsure(db, call, key), learned: [], onset: null };
    const i = q.bands!.findIndex(b => call.onset <= b.to);
    const lo = i > 0 ? q.bands![i - 1].to + 1 : 0;
    return { words: say(db, call, q.bands![i].words, key), learned: [], onset: [lo, q.bands![i].to] };
  }
  if (q.about === 'place') return { words: say(db, call, q.place![call.where], key, call.door), learned: [] };
  if (q.about === 'more') {
    const fresh = bySalience(med, call, Object.keys(db.phone.findings).filter(f => has(call, f) && call.knows[f] && heard.get(f) !== 'yes'));
    if (!fresh.length) return { words: render(call, pick(db.phone.callers[call.caller].nothing, `${call.seed}:${key}`)), learned: [] };
    const two = fresh.slice(0, 2);
    return { words: present(db, call, two, key), learned: two.map(f => ({ f, heard: 'yes' })) };
  }
  // знает, о чём вопрос, — отвечает как есть; не знает — называет только то, что заметил сам, иначе «не знаю»
  const topic = call.knows[qid];
  const named = q.opens.filter(f => has(call, f) && (topic || call.knows[f]));
  if (named.length) return { words: present(db, call, named, key), learned: named.slice(0, 2).map(f => ({ f, heard: 'yes' })) };
  if (topic) return { words: say(db, call, q.none!, key), learned: q.opens.map(f => ({ f, heard: 'no' })) };
  return { words: unsure(db, call, key), learned: q.opens.map(f => ({ f, heard: 'unsure' })) };
}
