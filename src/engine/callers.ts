// Звонок (часть П4; docs/02-architecture.md, §3; docs/08-game-design.md, §3): кто болен — больной «Анамнеза»
// (src/engine/med/generate.ts), где он, кто звонит и что этот звонящий знает. Это правда вызова: экран её не видит,
// ему — то, что сказано (ADR 0005). Всё случайное — из зерна звонка и его именованных веток: тот же звонок с теми же
// вопросами говорит те же слова.
import type { ContentDb, Season } from '../content/med';
import type { CallerKind, Db, Relation, Where } from '../content/types';
import { Rng } from './core/rng';
import { typicalPatient } from './med/generate';
import type { Patient, Sex } from './med/types';

export interface CallTruth {
  seed: number;
  /** основная болезнь — запись «Анамнеза» и запись «по телефону» с тем же идентификатором */
  condition: string;
  patient: Patient;
  where: Where;
  /** вид звонящего: caller.self, caller.relative… */
  caller: string;
  relation: Relation;
  /** пол звонящего; у самого больного — его пол */
  callerSex: Sex;
  /** минут от начала болезни до звонка */
  onset: number;
  /** заметил ли звонящий признак сам (скажет о нём без вопроса) и знает ли то, о чём вопрос, — бросок один на звонок */
  knows: Record<string, boolean>;
  /** как пройти: подъезд, этаж, код домофона — только дома */
  door: { entrance: number; floor: number; code: number };
  /** первые слова учебного звонка: сразу о главном или смутно; нет — как у всех */
  first?: 'clear' | 'vague';
}

/** Есть ли у больного признак — по правде. */
export const has = (call: CallTruth, f: string) => call.patient.truth.findings.some(x => x.f === f);

function fits(r: Relation, p: Patient): boolean {
  return (!r.sex || r.sex === p.sex) && (!r.age || (p.age >= r.age[0] && p.age <= r.age[1])) && Boolean(r.patient[p.sex]);
}

/** Кто может позвонить об этом больном из этого места: тот, кто там бывает, и не сам, если больной не может. */
export function callersFor(db: Db, p: Patient, where: Where): CallerKind[] {
  return Object.values(db.phone.callers)
    .filter(k => k.at.includes(where) && k.relations.some(r => fits(r, p)))
    .filter(k => !k.cannot.some(f => p.truth.findings.some(x => x.f === f)));
}

/** Минут до звонка: полоса по весу, внутри — ровно. */
function onsetOf(bands: [number, number][], rng: Rng): number {
  const i = rng.fork('band').weighted(bands.map((_, k) => k), k => bands[k][1]);
  const lo = i === 0 ? 1 : bands[i - 1][0] + 1;
  return rng.fork('in').range(lo, bands[i][0]);
}

export interface CallOptions {
  season: Season;
  /** задать болезнь (учебные звонки, тесты); нет — по весам записей «по телефону» */
  condition?: string;
  /** задать звонящего (учебные звонки); не может так позвонить — по весам */
  caller?: string;
  where?: Where;
  /** скрытые параметры болезни (учебные звонки) */
  params?: Record<string, string>;
  /** первые слова учебного звонка: сразу о главном или смутно */
  first?: 'clear' | 'vague';
}

export function newCall(db: Db, med: ContentDb, seed: number, opts: CallOptions): CallTruth {
  const root = Rng.seeded(seed);
  const conds = Object.keys(db.phone.conditions).sort();
  const condition = opts.condition ?? root.fork('condition').weighted(conds, id => db.phone.conditions[id].weight);
  const pc = db.phone.conditions[condition];
  if (!pc || !med.conditions[condition]) throw new Error(`newCall: unknown condition ${condition}`);
  // больной, у которого эта болезнь обычна по возрасту, полу и болезням (typicalPatient «Анамнеза»)
  const seeds = root.fork('patient');
  const pool = Array.from({ length: 16 }, () => seeds.u32());
  const patient = typicalPatient(med, k => pool[k], { primary: condition, department: med.conditions[condition].department, season: opts.season, ...(opts.params ? { params: opts.params } : {}) });
  const where: Where = opts.where ?? (root.fork('where').chance(pc.street) ? 'street' : 'home');
  let kinds = callersFor(db, patient, where);
  // на улице без сознания — позвонит прохожий; дома — кто-то из своих: хоть кто-то найдётся всегда
  if (!kinds.length) kinds = Object.values(db.phone.callers).filter(k => !k.self && k.at.includes(where));
  const wanted = opts.caller ? kinds.find(k => k.id === opts.caller) : undefined;
  const kind = wanted ?? root.fork('caller').weighted(kinds, k => k.weight);
  const rels = kind.relations.filter(r => fits(r, patient));
  const relation = rels.length ? rels[root.fork('relation').int(rels.length)] : kind.relations[0];
  const callerSex: Sex = kind.self ? patient.sex : relation.as;
  const onset = onsetOf(pc.onset, root.fork('onset'));
  const knows: Record<string, boolean> = {};
  const k = root.fork('knows');
  for (const f of Object.keys(db.phone.findings).sort()) knows[f] = k.fork(f).chance(db.phone.findings[f].tell[kind.id] ?? 0);
  for (const q of Object.keys(db.phone.questions).sort()) knows[q] = k.fork(q).chance(db.phone.questions[q].tell[kind.id] ?? 0);
  // учебный звонок «сразу о главном»: звонящий видит то, что делает основная болезнь (если вообще может видеть)
  if (opts.first === 'clear') {
    for (const x of patient.truth.findings) {
      const pf = db.phone.findings[x.f];
      if (x.cause === condition && pf && (pf.tell[kind.id] ?? 0) > 0) knows[x.f] = true;
    }
  }
  const d = root.fork('door');
  const door = { entrance: d.range(1, 6), floor: d.range(1, 9), code: d.range(10, 99) };
  return { seed, condition, patient, where, caller: kind.id, relation, callerSex, onset, knows, door, ...(opts.first ? { first: opts.first } : {}) };
}
