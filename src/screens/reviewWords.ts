// Ошибка разбора словами (src/i18n, T.review): строка и «почему» под ней — без React, чтобы их читали и экраны, и
// проход по словам (tools/sim/why.ts).
import { T } from '../i18n';
import type { MistakeView } from '../state/reviewView';

/** Строка ошибки словами. */
export function mistakeText(v: MistakeView): string {
  const m = v.m;
  switch (m.kind) {
    case 'noDispatch': return T.review.mistake.noDispatch();
    case 'underTriage': return T.review.mistake.underTriage(v.heard);
    case 'missedQuestion': return T.review.mistake.missedQuestion(v.question!.text, v.question!.answer);
    case 'order': return T.review.mistake.order(v.bypassed ?? []);
    case 'hospital': return T.review.mistake.hospital(v.hospital!.chosen, v.hospital!.right);
    case 'crew': return T.review.mistake.crew();
    case 'noSecond': return T.review.mistake.noSecond(v.crewNo ?? 0);
    case 'door': return T.review.mistake.door(v.cost, m.waited);
    case 'address': return T.review.mistake.address(v.cost);
    case 'alone': return T.review.mistake.alone(v.cost);
    case 'taken': return T.review.mistake.taken(v.bypassed ?? []);
    case 'overTriage': return T.review.mistake.overTriage(v.said ?? '');
  }
}

/** Почему это ошибка — правило и что было слышно. */
export function mistakeWhy(v: MistakeView): string {
  const m = v.m;
  return m.kind === 'overTriage' ? T.review.why.overTriage(v.cleared ?? []) : T.review.why[m.kind]();
}

/** Исход вызова словом (срез, С3; §7 геймдизайна): третья ступень — по «Мягкому исходу». */
export function tierWord(tier: 'ok' | 'late' | 'died', soft: boolean): string {
  return tier === 'died' && soft ? T.review.tier.grave : T.review.tier[tier];
}
