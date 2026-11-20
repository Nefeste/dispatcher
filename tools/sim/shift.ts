// «Виртуальный диспетчер» (спецификация прототипа, §4; docs/02-architecture.md, §8): диспетчеры-правила играют сотню
// смен с разными зёрнами, отчёт — доля экстренных с доездом в норму, ожидание неотложных, сколько звонков, когда
// кончается смена, ошибки разбора. Пороги §4: «по правилам» — не меньше 85 % экстренных в норму; «без вопросов» и
// «всё экстренно» — хуже хотя бы на 20 п. п. Отчёт — в описание PR, который меняет числа баланса.
//
//   bun tools/sim/shift.ts [смен=100] [--bots rules,noQuestions] [--write]   # --write — отчёт в docs/reports/
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { review } from '../../src/engine/review';
import { shiftCtx } from '../../src/engine/shift';
import { totals } from '../../src/engine/totals';
import { loadMap } from '../../src/map/load';
import { BOTS, play } from './bots';

export interface SimRow {
  bot: string;
  name: string;
  shifts: number;
  /** экстренных по правде и сколько из них — в норму */
  emergency: number;
  inNorm: number;
  /** медиана медиан ожидания неотложных, минуты */
  urgentMedian: number;
  calls: number;
  /** когда кончается смена, минут от начала — среднее */
  end: number;
  mistakes: Record<string, number>;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

export function simulate(n: number, bots: readonly string[], from = 1, shiftId = 'shift.proto'): SimRow[] {
  const ctx = shiftCtx(DB, MED, shiftId, loadMap(DB.cities[DB.shifts[shiftId].city].map));
  return bots.map(id => {
    const bot = BOTS[id];
    const row: SimRow = { bot: id, name: bot.name, shifts: n, emergency: 0, inNorm: 0, urgentMedian: 0, calls: 0, end: 0, mistakes: {} };
    const urgent: number[] = [];
    for (let seed = from; seed < from + n; seed++) {
      const { s } = play(ctx, seed, bot);
      const t = totals(ctx, s);
      row.emergency += t.emergency;
      row.inNorm += t.inNorm;
      row.calls += t.accepted;
      row.end += s.t / 60_000;
      if (t.urgentMedian !== null) urgent.push(t.urgentMedian / 60_000);
      for (const c of review(ctx, s).calls) for (const m of c.mistakes) row.mistakes[m.m.kind] = (row.mistakes[m.m.kind] ?? 0) + 1;
    }
    row.calls /= n;
    row.end /= n;
    row.urgentMedian = median(urgent);
    return row;
  });
}

export const pct = (r: SimRow) => (r.emergency ? (100 * r.inNorm) / r.emergency : 0);

export function report(rows: readonly SimRow[]): string {
  const head = '| Диспетчер | Экстренных в норму | Неотложные ждут, медиана | Звонков за смену | Смена кончается | Ошибок разбора за смену |';
  const lines = rows.map(r => {
    const m = Object.entries(r.mistakes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / r.shifts).toFixed(1)}`).join(', ');
    return `| ${r.name} | ${pct(r).toFixed(1)} % (${r.inNorm} из ${r.emergency}) | ${r.urgentMedian.toFixed(0)} мин | ${r.calls.toFixed(1)} | ${r.end.toFixed(0)}-я минута | ${m || '—'} |`;
  });
  return [head, '|---|---|---|---|---|---|', ...lines].join('\n');
}

/** Пороги §4 спецификации. */
export function verdict(rows: readonly SimRow[]): string[] {
  const by = Object.fromEntries(rows.map(r => [r.bot, r]));
  const out: string[] = [];
  if (by.rules) out.push(`«по правилам» ${pct(by.rules).toFixed(1)} % — порог 85 %: ${pct(by.rules) >= 85 ? 'да' : 'нет'}`);
  for (const k of ['noQuestions', 'allEmergency']) {
    if (!by.rules || !by[k]) continue;
    const gap = pct(by.rules) - pct(by[k]);
    out.push(`«${by[k].name}» хуже на ${gap.toFixed(1)} п. п. — порог 20: ${gap >= 20 ? 'да' : 'нет'}`);
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const n = Number(args.find(a => /^\d+$/.test(a)) ?? 100);
  const bi = args.indexOf('--bots');
  const bots = bi >= 0 ? args[bi + 1].split(',') : Object.keys(BOTS);
  const t0 = performance.now();
  const rows = simulate(n, bots);
  console.log(report(rows));
  console.log('');
  for (const v of verdict(rows)) console.log(`- ${v}`);
  console.log(`\n${n} смен на диспетчера, ${((performance.now() - t0) / 1000).toFixed(0)} с`);
  if (args.includes('--write')) {
    const setup = DB.shifts['shift.proto'];
    const crews = setup.crews.map(c => c.kind).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});
    const text = [
      '# «Виртуальный диспетчер»: отчёт',
      '',
      'Сделано `bun tools/sim/shift.ts ' + n + ' --write` — руками не править. Пороги — спецификация прототипа, §4;',
      'как играют диспетчеры-правила — `tools/sim/bots.ts`; что считает разбор — `src/engine/review.ts`.',
      '',
      `Смена: ${setup.id}, ${setup.length / 3600} ч с ${Math.floor(setup.start / 3600)}:00; бригады: ${Object.entries(crews).map(([k, v]) => `${k} × ${v}`).join(', ')}; поток — content/flow.yaml.`,
      `Зёрна 1…${n}.`,
      '',
      report(rows),
      '',
      ...verdict(rows).map(v => `- ${v}`),
      '',
    ].join('\n');
    writeFileSync(join(import.meta.dir, '../../docs/reports/virtual-dispatcher.md'), text);
  }
}
