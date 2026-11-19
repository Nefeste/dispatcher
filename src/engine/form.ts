// Форма вызова (часть П4; docs/08-game-design.md, §4; 388н, пп. 11 и 13): экстренная — при признаке угрозы жизни из
// перечня п. 11, иначе неотложная (п. 13 «а»: «без явных признаков угрозы жизни»). Две оценки, как в разборе
// (ADR 0005): по известному — по тому, что звонящий сказал «да»; по правде — по болезни и признакам больного.
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
