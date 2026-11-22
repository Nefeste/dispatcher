// Форма вызова (часть П4; docs/08-game-design.md, §4; 388н, пп. 11 и 13): экстренная — при признаке угрозы жизни из
// перечня п. 11, иначе неотложная (п. 13 «а»: «без явных признаков угрозы жизни»). Две оценки, как в разборе
// (ADR 0005): по известному — по тому, что звонящий сказал «да»; по правде — по болезни и признакам больного.
import type { ContentDb } from '../content/med';
import type { Db, FormKind } from '../content/types';
import type { CallTruth } from './callers';
import { has } from './callers';
import type { Heard } from './talk';

/** Признаки угрозы жизни, о которых звонящий сказал «да». */
export function threatsHeard(db: Db, heard: ReadonlyMap<string, Heard>): string[] {
  return [...heard].filter(([f, h]) => h === 'yes' && db.phone.findings[f]?.threat).map(([f]) => f);
}

/** Какая форма верна по услышанному. */
export function formByKnown(db: Db, heard: ReadonlyMap<string, Heard>): FormKind {
  return threatsHeard(db, heard).length ? 'emergency' : 'urgent';
}

/** Какая форма верна по правде: экстренная болезнь или признак угрозы у больного — от любой причины. */
export function formByTruth(db: Db, call: CallTruth): FormKind {
  if (db.phone.conditions[call.condition].form === 'emergency') return 'emergency';
  return Object.values(db.phone.findings).some(f => f.threat && has(call, f.id)) ? 'emergency' : 'urgent';
}

/**
 * Какие вопросы могут решить форму (игра владельца 22.11.2026: «не очень понятно что спрашивать»;
 * docs/specs/2026-11-call-flow.md, §5) — только по услышанному, без правды о больном. Болезни, с которыми согласно всё,
 * о чём сказали «да»; их признаки угрозы жизни, о которых ещё не спрашивали; вопросы, что их открывают. Угроза уже
 * прозвучала — форма решена, подсказывать нечего.
 */
export function mayDecide(db: Db, med: ContentDb, heard: ReadonlyMap<string, Heard>, asked: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  if (threatsHeard(db, heard).length) return out;
  const yes = [...heard].filter(([, h]) => h === 'yes').map(([f]) => f);
  const all = Object.keys(db.phone.conditions);
  const fits = all.filter(c => yes.every(f => med.conditions[c]?.findings.some(l => l.f === f)));
  const threats = new Set((fits.length ? fits : all).flatMap(c => med.conditions[c]?.findings.map(l => l.f) ?? []).filter(f => db.phone.findings[f]?.threat && !heard.has(f)));
  for (const q of Object.values(db.phone.questions)) if (!asked.has(q.id) && q.opens.some(f => threats.has(f))) out.add(q.id);
  return out;
}
