// Золотая смена (спецификация прототипа, критерий 2; docs/02-architecture.md, §8): записанная смена — зерно и
// команды — переигрывается в тот же отпечаток состояния и разбора. Отпечатки меняются, только когда меняется то, что
// случается в смене: тогда пересоберите образец (`bun tools/test/golden.ts --write`) и скажите в описании PR, что
// поменялось в жизни смены.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { fingerprint } from '../../src/engine/core/hash';
import { review } from '../../src/engine/review';
import { type Logged, type Shift, shiftCtx } from '../../src/engine/shift';
import { loadMap } from '../../src/map/load';
import { BOTS, play } from '../sim/bots';

export const GOLDEN = join(import.meta.dir, 'fixtures/golden-shift.json');
export const ctx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));

export interface Golden {
  bot: string;
  seed: number;
  t: number;
  log: Logged[];
  state: string;
  review: string;
}

/** Отпечаток смены без счётчика перерисовок: он считает шаги часов, а не то, что случилось. */
export const printState = (s: Shift) => fingerprint({ ...s, rev: 0 });
export const printReview = (s: Shift) => fingerprint(review(ctx, s));

if (import.meta.main && process.argv.includes('--write')) {
  const runs: Golden[] = (['rules', 'noQuestions'] as const).map((bot, i) => {
    const seed = 11 + i;
    const { s, log } = play(ctx, seed, BOTS[bot]);
    return { bot, seed, t: s.t, log, state: printState(s), review: printReview(s) };
  });
  writeFileSync(GOLDEN, JSON.stringify(runs) + '\n');
  console.log(`золотые смены: ${runs.map(r => `${r.bot} — ${r.log.length} команд, ${r.state}/${r.review}`).join('; ')}`);
}
