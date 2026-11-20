// Слова разбора на сыгранных сменах (проход по словам главной ошибки, игра владельца 20.11.2026): бот «спросил по
// правилам, решил всё экстренно» играет смены; печатаются строки ошибок с «почему» — для каждого вида ошибки по
// одному примеру и строка «по услышанному» у вызова с болью в спине.
//
//   bun tools/sim/why.ts [смен=5]
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { shiftCtx } from '../../src/engine/shift';
import { T } from '../../src/i18n';
import { loadMap } from '../../src/map/load';
import { mistakeText, mistakeWhy } from '../../src/screens/reviewWords';
import { reviewView } from '../../src/state/reviewView';
import { BOTS, play } from './bots';

const n = Number(process.argv[2] ?? 5);
const ctx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));
const bots = [{ ...BOTS.rules, form: 'emergency' as const, name: 'по правилам, всё экстренно' }, BOTS.noQuestions];
const seen = new Set<string>();
for (const bot of bots) {
  for (let seed = 1; seed <= n; seed++) {
    const { s } = play(ctx, seed, bot);
    const v = reviewView(ctx, s);
    for (const r of v.rows) {
      const d = v.detail(r.id)!;
      for (const m of d.mistakes) {
        if (seen.has(m.m.kind)) continue;
        seen.add(m.m.kind);
        console.log(`[${m.m.kind}] ${d.condition} · ${bot.name}, зерно ${seed}, вызов ${r.no}`);
        console.log(`  ${mistakeText(m)}`);
        console.log(`  ${mistakeWhy(m)}`);
        console.log(`  по услышанному: ${T.review.knownWhy(d.threats, d.cleared)}`);
      }
    }
  }
}
