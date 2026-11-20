// «Виртуальный диспетчер» недели (срез, docs/specs/2026-11-vertical-slice.md, §4; часть С1): каждая смена «Первой
// недели» — тем же ботам, что смена прототипа (tools/sim/shift.ts), по N зёрен. Пороги среза по ставкам и станции
// добавят части С2 и С3; здесь — что каждая смена проходится и где она по силам «по правилам».
//
//   bun tools/sim/week.ts [смен=30] [--bots rules,noQuestions] [--write]   # --write — отчёт в docs/reports/
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB } from '../../src/content/generated/db';
import { pct, simulate } from './shift';

export const WEEK = Object.values(DB.shifts).filter(s => s.week).sort((a, b) => a.week!.n - b.week!.n);

export function weekReport(n: number, bots: readonly string[]): string {
  const rows: string[] = ['| Смена | Диспетчер | Экстренных в норму | Неотложные ждут, медиана | Звонков | Смена кончается |', '|---|---|---|---|---|---|'];
  for (const sh of WEEK) {
    for (const r of simulate(n, bots, 1, sh.id)) {
      rows.push(`| ${sh.week!.n}. ${sh.week!.day} | ${r.name} | ${pct(r).toFixed(1)} % (${r.inNorm} из ${r.emergency}) | ${r.urgentMedian.toFixed(0)} мин | ${r.calls.toFixed(1)} | ${r.end.toFixed(0)}-я минута |`);
    }
  }
  return rows.join('\n');
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const n = Number(args.find(a => /^\d+$/.test(a)) ?? 30);
  const bi = args.indexOf('--bots');
  const bots = bi >= 0 ? args[bi + 1].split(',') : ['rules', 'noQuestions'];
  const text = weekReport(n, bots);
  console.log(text);
  if (args.includes('--write')) {
    const out = join(import.meta.dir, '../../docs/reports/virtual-dispatcher-week.md');
    writeFileSync(out, `# «Виртуальный диспетчер» недели\n\nКаждая смена «Первой недели» — ${n} зёрен на бота (\`bun tools/sim/week.ts ${n} --write\`). Срез, часть С1: смены проходятся, «по правилам» — сколько экстренных в норму.\n\n${text}\n`);
    console.log('→', out);
  }
}
