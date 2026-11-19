// Записи «по телефону» (часть П4; docs/04-data-model.md, §1; docs/09-content.md, «Проверки»): phone/findings,
// phone/conditions, questions, callers, reasons → Db.phone. Полосы частот — как в «Анамнезе», в доли 1/10 000; проценты
// записей — тоже. Сообщения об ошибках — по-английски: их видит разработчик.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import type { ContentDb } from '../../src/content/med';
import {
  type CallerKind, type City, type FormKind, type Lines, type Phone, type PhoneCondition, type PhoneFinding, PROFILES, type Profile,
  QUESTION_GROUPS, type Question, type QuestionGroup, type Reason, type Relation, type Where, type Window,
} from '../../src/content/types';
import { findBrand } from './brands';

const ROOT = join(import.meta.dir, '../..');

/** Полосы частот «Анамнеза» (его tools/content/schema.ts, BANDS): доли 1/10 000. Своя — `sure`: свой возраст и адрес
 *  человек знает наверняка, а в медицине «Анамнеза» наверняка не бывает ничего. */
export const BANDS: Record<string, number> = { sure: 10000, always: 9500, usually: 7500, often: 5000, sometimes: 2500, rarely: 800, very_rarely: 200, never: 0 };
const CALLERS = ['self', 'relative', 'neighbour', 'bystander'] as const;
/** Слова шаблонов, кроме `{м|ж}` и `{^м|ж}` (src/engine/talk.ts). */
const TOKENS = new Set(['who', 'Who', 'age', 'years', 'entrance', 'floor', 'code']);

type Raw = Record<string, unknown>;
const read = (p: string): Raw => parse(readFileSync(p, 'utf8')) as Raw;
/** Записи папки; идентификатор — `prefix.имя` или, без префикса, само имя файла (phone/: тот же, что в «Анамнезе»). */
const files = (dir: string, prefix?: string) =>
  existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.yaml')).sort().map(f => [prefix ? `${prefix}.${basename(f, '.yaml')}` : basename(f, '.yaml'), read(join(dir, f))] as const) : [];

/** Ключи источников — из таблиц docs/09-content.md: строка источника начинается с ключа. */
export function sourceKeys(): Set<string> {
  const text = readFileSync(join(ROOT, 'docs/09-content.md'), 'utf8');
  return new Set([...text.matchAll(/^\| `([^`]+)`/gm)].map(m => m[1]));
}
const keyOf = (s: string) => s.split(/[,\s]/)[0];

export function buildPhone(dir: string, med: ContentDb, cities: City[], err: (s: string) => void): Phone {
  const keys = sourceKeys();
  const sources = (id: string, list: unknown) => {
    const xs = Array.isArray(list) ? list.map(String) : [];
    if (!xs.length) err(`${id}: no sources`);
    for (const x of xs) if (!keys.has(keyOf(x))) err(`${id}: unknown source key «${keyOf(x)}» (docs/09-content.md)`);
    return xs;
  };
  const review = (id: string, v: unknown) => {
    if (v !== 'draft' && v !== 'checked') err(`${id}: review must be draft or checked`);
    return v as 'draft' | 'checked';
  };
  const tellOf = (id: string, v: unknown): Record<string, number> => {
    const t = (v ?? {}) as Record<string, string>;
    const out: Record<string, number> = {};
    for (const c of CALLERS) {
      if (!(t[c] in BANDS)) err(`${id}: tell.${c} must be a band (${Object.keys(BANDS).join(', ')})`);
      out[`caller.${c}`] = BANDS[t[c]] ?? 0;
    }
    for (const k of Object.keys(t)) if (!(CALLERS as readonly string[]).includes(k)) err(`${id}: tell.${k} is not a caller`);
    return out;
  };
  const texts: [string, string][] = [];
  const lines = (id: string, v: unknown, what: string): Lines => {
    const l = (v ?? {}) as Raw;
    const out: Lines = { self: (l.self as string[]) ?? [], other: (l.other as string[]) ?? [] };
    if (!Array.isArray(out.self) || !Array.isArray(out.other)) err(`${id}: ${what} must have self and other lists`);
    for (const s of [...out.self, ...out.other]) texts.push([`${id}: ${what}`, s]);
    return out;
  };
  const pct = (id: string, v: unknown, what: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100) err(`${id}: ${what} must be a whole percent 0..100`);
    return n * 100;
  };

  // признаки
  const findings: Record<string, PhoneFinding> = {};
  for (const [id, r] of files(join(dir, 'phone/findings'))) {
    if (!med.findings[id]) err(`phone ${id}: no such finding in content/med`);
    const says = (r.says ?? {}) as Raw;
    const f: PhoneFinding = {
      id, tell: tellOf(id, r.tell), says: { present: lines(id, says.present, 'says.present') },
      estimate: r.estimate === true, sources: sources(id, r.sources), review: review(id, r.review),
      ...(r.threat ? { threat: String(r.threat) } : {}), ...(r.notes ? { notes: String(r.notes) } : {}),
    };
    if (f.threat && !f.threat.startsWith('388n, п. 11')) err(`${id}: threat must cite 388n, п. 11`);
    if (f.threat && !f.sources.includes(f.threat)) err(`${id}: threat must be among sources`);
    if (!f.estimate) err(`${id}: tell shares are an estimate — set estimate: true`);
    if (f.tell['caller.self'] > 0 && !f.says.present.self.length) err(`${id}: self may know it but has no words`);
    if (CALLERS.slice(1).some(c => f.tell[`caller.${c}`] > 0) && !f.says.present.other.length) err(`${id}: others may know it but have no words`);
    findings[id] = f;
  }

  // болезни
  const conditions: Record<string, PhoneCondition> = {};
  const select = new Set((read(join(dir, 'med/select.yaml')).conditions as string[]) ?? []);
  for (const [id, r] of files(join(dir, 'phone/conditions'))) {
    const mc = med.conditions[id];
    if (!mc) err(`phone ${id}: no such condition in content/med`);
    if (!select.has(id)) err(`phone ${id}: not in content/med/select.yaml`);
    const w = r.window as Raw | undefined;
    const window: Window | undefined = w ? { minutes: Number(w.minutes), from: w.from as Window['from'], source: String(w.source ?? ''), ...(w.when ? { when: w.when as Record<string, string[]> } : {}) } : undefined;
    const c: PhoneCondition = {
      id, weight: Number(r.weight), form: r.form as FormKind, hospital: r.hospital as Profile, transport: pct(id, r.transport, 'transport'),
      scene: (r.scene as [number, number]) ?? [0, 0], street: pct(id, r.street, 'street'), onset: (r.onset as [number, number][]) ?? [],
      ...(window ? { window } : {}), estimate: r.estimate === true, sources: sources(id, r.sources), review: review(id, r.review),
      ...(r.notes ? { notes: String(r.notes) } : {}),
    };
    if (!(c.weight > 0) || !Number.isInteger(c.weight)) err(`${id}: weight must be a positive integer`);
    if (c.form !== 'emergency' && c.form !== 'urgent') err(`${id}: form must be emergency or urgent`);
    if (!PROFILES.includes(c.hospital)) err(`${id}: unknown hospital profile ${c.hospital}`);
    for (const city of cities) if (!city.hospitals.some(h => h.profiles.includes(c.hospital))) err(`${id}: no ${c.hospital} hospital in ${city.id}`);
    if (!(c.scene[0] > 0 && c.scene[0] <= c.scene[1])) err(`${id}: scene must be [from, to] minutes`);
    let prev = 0;
    for (const [to, wt] of c.onset) {
      if (!(Number.isInteger(to) && to > prev && Number.isInteger(wt) && wt > 0)) err(`${id}: onset bands must be [to, weight] with to going up`);
      prev = to;
    }
    if (!c.onset.length) err(`${id}: no onset bands`);
    if (!c.estimate) err(`${id}: shares and minutes are an estimate — set estimate: true`);
    if (window) {
      if (!(Number.isInteger(window.minutes) && window.minutes > 0)) err(`${id}: window.minutes must be a positive integer`);
      if (!['onset', 'call', 'crew'].includes(window.from)) err(`${id}: window.from must be onset, call or crew`);
      if (!keys.has(keyOf(window.source))) err(`${id}: window needs a source from docs/09-content.md`);
      for (const [name, vals] of Object.entries(window.when ?? {})) for (const v of vals) if (mc && mc.params?.[name]?.[v] === undefined) err(`${id}: window.when ${name}=${v} is not a parameter of the condition`);
    }
    // говорит ли о болезни хоть что-то по телефону
    if (mc && !mc.findings.some(l => findings[l.f])) err(`${id}: none of its findings has a phone record`);
    conditions[id] = c;
  }
  for (const id of select) if (!conditions[id]) err(`${id}: in content/med/select.yaml but has no phone record`);

  // вопросы
  const questions: Record<string, Question> = {};
  const ranks = new Set<string>();
  for (const [id, r] of files(join(dir, 'questions'), 'q')) {
    const q: Question = {
      id, group: r.group as QuestionGroup, rank: Number(r.rank), text: String(r.text ?? ''), label: String(r.label ?? ''), cost: Number(r.cost), opens: (r.opens as string[]) ?? [],
      ...(r.none ? { none: lines(id, r.none, 'none') } : {}), ...(r.about ? { about: r.about as Question['about'] } : {}),
      tell: tellOf(id, r.tell), ...(r.answer ? { answer: lines(id, r.answer, 'answer') } : {}),
      ...(r.years ? { years: r.years as [string, string, string] } : {}),
      ...(r.bands ? { bands: (r.bands as Raw[]).map(b => ({ to: Number(b.to), words: lines(id, b.words, 'bands') })) } : {}),
      ...(r.place ? { place: Object.fromEntries(Object.entries(r.place as Raw).map(([k, v]) => [k, lines(id, v, `place.${k}`)])) as Record<Where, Lines> } : {}),
    };
    texts.push([`${id}: text`, q.text], [`${id}: label`, q.label]);
    if (!q.label) err(`${id}: no label for the call card`);
    if (!QUESTION_GROUPS.includes(q.group)) err(`${id}: unknown group ${q.group}`);
    if (ranks.has(`${q.group}:${q.rank}`)) err(`${id}: rank ${q.rank} taken in ${q.group}`);
    ranks.add(`${q.group}:${q.rank}`);
    if (!(Number.isInteger(q.cost) && q.cost > 0)) err(`${id}: cost must be positive seconds`);
    if (!q.text) err(`${id}: no text`);
    for (const f of q.opens) if (!findings[f]) err(`${id}: opens ${f}, which has no phone record`);
    if (!q.about) {
      if (!q.opens.length) err(`${id}: opens nothing`);
      if (!q.none) err(`${id}: no words for «none of them»`);
    }
    if (q.about === 'age' && !(q.answer && q.years?.length === 3 && q.bands?.length)) err(`${id}: age needs answer, years and bands`);
    if (q.about === 'onset' && !q.bands?.length) err(`${id}: onset needs bands`);
    if (q.about === 'place' && !(q.place?.home && q.place?.street)) err(`${id}: place needs home and street`);
    if (q.bands) {
      let prev = -Infinity;
      for (const b of q.bands) {
        if (!(b.to > prev)) err(`${id}: bands must go up`);
        prev = b.to;
      }
    }
    questions[id] = q;
  }
  for (const f of Object.keys(findings)) if (!Object.values(questions).some(q => q.opens.includes(f))) err(`${f}: no question opens it`);

  // звонящие
  const callers: Record<string, CallerKind> = {};
  for (const [id, r] of files(join(dir, 'callers'), 'caller')) {
    const k: CallerKind = {
      id, name: String(r.name ?? ''), self: r.self === true, at: (r.at as Where[]) ?? [], weight: Number(r.weight), relations: (r.relations as Relation[]) ?? [],
      cannot: (r.cannot as string[]) ?? [], unsure: (r.unsure as string[]) ?? [], nothing: (r.nothing as string[]) ?? [], again: (r.again as string[]) ?? [],
      estimate: r.estimate === true, sources: sources(id, r.sources), review: review(id, r.review),
    };
    for (const s of [...k.unsure, ...k.nothing, ...k.again]) texts.push([`${id}: words`, s]);
    if (!k.again.length) err(`${id}: needs again words for a repeat call`);
    if (!(CALLERS as readonly string[]).includes(basename(id.replace('caller.', '')))) err(`${id}: unknown caller kind`);
    if (!(k.weight > 0)) err(`${id}: weight must be positive`);
    if (!k.at.length || k.at.some(a => a !== 'home' && a !== 'street')) err(`${id}: at must list home and/or street`);
    if (!k.relations.length) err(`${id}: no relations`);
    for (const rel of k.relations) if (rel.as !== 'm' && rel.as !== 'f') err(`${id}: relation ${rel.caller} needs as: m or f`);
    for (const f of k.cannot) if (!med.findings[f]) err(`${id}: cannot ${f} — no such finding`);
    if (!k.unsure.length || !k.nothing.length) err(`${id}: needs unsure and nothing words`);
    callers[id] = k;
  }
  for (const c of CALLERS) if (!callers[`caller.${c}`]) err(`caller.${c}: missing`);
  // на улице — кто-то может позвонить, дома — тоже
  for (const where of ['home', 'street'] as const) if (!Object.values(callers).some(k => k.at.includes(where) && !k.self)) err(`nobody but the patient calls from ${where}`);

  // поводы
  const reasons: Record<string, Reason> = {};
  const rranks = new Set<number>();
  for (const [id, r] of files(join(dir, 'reasons'), 'reason')) {
    const x: Reason = { id, rank: Number(r.rank), say: pct(id, r.say, 'say'), when: (r.when as string[]) ?? [], words: lines(id, r.words, 'words') };
    if (rranks.has(x.rank)) err(`${id}: rank ${x.rank} taken`);
    rranks.add(x.rank);
    for (const f of x.when) if (!findings[f]) err(`${id}: when ${f}, which has no phone record`);
    if (!x.words.other.length) err(`${id}: no words for others`);
    const self = callers['caller.self'];
    const selfCan = x.when.length === 0 || x.when.some(f => !self?.cannot.includes(f) && (findings[f]?.tell['caller.self'] ?? 0) > 0);
    if (selfCan && !x.words.self.length) err(`${id}: the patient may call with it but has no words`);
    reasons[id] = x;
  }
  const fallback = Object.values(reasons).filter(x => !x.when.length);
  if (fallback.length !== 1) err('reasons: exactly one fallback (empty when) is needed');
  else if (fallback[0].say !== 10000) err(`${fallback[0].id}: the fallback must have say: 100`);

  // у экстренной — вопрос, который открывает её признак угрозы; у неотложной — хоть один вопрос о признаке угрозы
  const threatQ = (f: string) => Object.values(questions).some(q => q.opens.includes(f));
  const threats = Object.values(findings).filter(f => f.threat).map(f => f.id);
  for (const c of Object.values(conditions)) {
    const own = (med.conditions[c.id]?.findings ?? []).map(l => l.f).filter(f => findings[f]?.threat);
    if (c.form === 'emergency' && !own.some(threatQ)) err(`${c.id}: no question opens any of its threat findings`);
    if (!threats.some(threatQ)) err(`${c.id}: no question opens a threat finding`);
  }

  // тексты: шаблоны, ни торговых названий, ни доз, ни латиницы
  for (const [where, s] of texts) {
    for (const m of s.matchAll(/\{([^{}]*)\}/g)) if (!m[1].includes('|') && !TOKENS.has(m[1])) err(`${where}: unknown template {${m[1]}}`);
    if (/[{}]/.test(s.replace(/\{[^{}]*\}/g, ''))) err(`${where}: unbalanced braces in «${s}»`);
    const brand = findBrand(s);
    if (brand) err(`${where}: brand name «${brand}»`);
    if (/\d\s*(мг|мкг|мл|ед\b|таб)/i.test(s)) err(`${where}: looks like a dose: «${s}»`);
    if (/[A-Za-z]/.test(s.replace(/\{[^{}]*\}/g, ''))) err(`${where}: Latin letters in «${s}»`);
  }
  return { findings, conditions, questions, callers, reasons };
}
