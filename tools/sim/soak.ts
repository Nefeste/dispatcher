// Долгий прогон (путь к 1.0, В1; спецификация 1.0, §4: «Память — ≤ 150 МБ JS после двух недель игры»). Один процесс,
// как одно открытое приложение: неделя за неделей через тот же код, что у телефона, — сессия смены с автопаузой и
// сохранением после каждой команды, итог на станцию и в журнал недели, лучший итог, решения станции, «Неделя заново»;
// после каждой недели — ещё «Свободная смена». Хранилище — в памяти (tools/test/phone.ts), диспетчер — бот «по правилам».
// После каждой недели — куча JS после сборки мусора и длина строк хранилища: растёт ли что-нибудь от недели к неделе.
//
// Числа кучи — Bun (JavaScriptCore), не Hermes телефона: важен рост, а не сами мегабайты; на телефоне — «Замер».
//
//   bun tools/sim/soak.ts [недель=4] [--write]   → docs/reports/soak.md
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryPhone, settle } from '../test/phone';

const weeks = Number(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a)) ?? 4);
const write = process.argv.includes('--write');
const rows = memoryPhone();

const { lineupOf } = await import('../../src/engine/station');
const { totals } = await import('../../src/engine/totals');
const { readCrashlog } = await import('../../src/state/crashlog');
const { freeId } = await import('../../src/state/free');
const { recordBestOnce } = await import('../../src/state/progress');
const session = await import('../../src/state/session');
const { decideAndSave, readStation, recordShiftOnce, resetWeek } = await import('../../src/state/station');
const { introNote } = await import('../../src/state/stationView');
const { weekShifts } = await import('../../src/state/week');
const { BOTS, botMove } = await import('./bots');
const { policyMoves } = await import('./week');

const MB = 1024 * 1024;
/** Рост кучи от конца первой недели до конца последней — не больше (МБ). */
const GROWTH_MAX = 8;
/** Строка хранилища — не длиннее: окно чтения строки AsyncStorage на Android — 2 МБ, берём вчетверо меньше. */
const ROW_MAX = 512 * 1024;

const week = weekShifts();
let seed = 7001;
let shifts = 0;
let commands = 0;
let refusals = 0;

/** Одна смена до конца — как у игрока: ввод закрыт, ×4, на автопаузе — снова ход; конец — итог, лучший, закрыть. */
async function playShift(id: string, week: boolean): Promise<void> {
  const st = await readStation();
  session.startShift(id, seed++, true, week ? lineupOf(st) : undefined, week ? introNote(st, id) : null);
  session.dismissIntro();
  session.setSpeed(4);
  for (let i = 0; i < 2_000_000; i++) {
    const x = session.session()!;
    if (x.s.over) break;
    const cmd = botMove(x.ctx, x.s, BOTS.rules);
    if (cmd) {
      commands++;
      if (session.command(cmd)) refusals++;
    } else {
      if (x.speed === 0) session.setSpeed(4);
      session.tick(1000);
    }
  }
  const x = session.session()!;
  if (!x.s.over) throw new Error(`${id}: смена не кончилась`);
  if (week) await recordShiftOnce(x.ctx, x.s);
  const t = totals(x.ctx, x.s);
  await recordBestOnce(`${id}:${x.s.seed}`, id, { emergency: t.emergency, inNorm: t.inNorm, urgentMedian: t.urgentMedian, accepted: t.accepted });
  session.closeShift();
  await settle();
  shifts++;
}

interface Row { week: number; heap: number; rss: number; rows: Record<string, number>; ms: number }
const out: Row[] = [];
const started = performance.now();
session.setPace(20);
for (let w = 1; w <= weeks; w++) {
  const t0 = performance.now();
  if (w > 1) await resetWeek();
  for (let i = 0; i < week.length; i++) {
    await playShift(week[i].id, true);
    // решения станции — лучшие, как у «виртуального диспетчера» недели
    for (const d of policyMoves(await readStation(), week[i + 1]?.id ?? null, 'best')) await decideAndSave(d);
  }
  await playShift(freeId({ hour: 8 + w % 12, hours: 2, general: 3 + w % 4, resus: w % 2 }), false);
  Bun.gc(true);
  const m = process.memoryUsage();
  out.push({ week: w, heap: m.heapUsed / MB, rss: m.rss / MB, rows: Object.fromEntries([...rows].map(([k, v]) => [k, v.length])), ms: performance.now() - t0 });
  console.log(`неделя ${w}: куча ${(m.heapUsed / MB).toFixed(1)} МБ, rss ${(m.rss / MB).toFixed(0)} МБ, ${((performance.now() - t0) / 1000).toFixed(1)} с`);
}

const growth = out[out.length - 1].heap - out[0].heap;
const longest = Math.max(...out.flatMap(r => Object.values(r.rows)));
const crash = (await readCrashlog())?.length ?? -1;
const keys = [...new Set(out.flatMap(r => Object.keys(r.rows)))].sort();
const ok = growth <= GROWTH_MAX && longest <= ROW_MAX && crash === 0 && !rows.has('dispatcher.shift.current.v1');

const md = [
  '# Долгий прогон',
  '',
  `Путь к 1.0, часть В1 (\`tools/sim/soak.ts\`, ${weeks} нед.). Один процесс, как одно открытое приложение: каждая неделя —`,
  'семь смен «Первой недели» ботом «по правилам» через сессию смены (автопауза, сохранение после команды), итог на',
  'станцию и в журнал недели, лучшие решения станции, потом «Свободная смена» на 2 часа и «Неделя заново». Куча — Bun',
  '(JavaScriptCore) после сборки мусора: важен рост от недели к неделе, мегабайты телефона — в «Замере».',
  '',
  `Смен — ${shifts}, команд — ${commands}, отказов движка — ${refusals}; всего ${((performance.now() - started) / 1000).toFixed(0)} с.`,
  '',
  '| Неделя | Куча, МБ | RSS, МБ | ' + keys.map(k => `\`${k.replace(/^dispatcher\.|\.v1$/g, '')}\`, знаков`).join(' | ') + ' |',
  '|---|---|---|' + keys.map(() => '---').join('|') + '|',
  ...out.map(r => `| ${r.week} | ${r.heap.toFixed(1)} | ${r.rss.toFixed(0)} | ${keys.map(k => r.rows[k] ?? '—').join(' | ')} |`),
  '',
  `- Рост кучи с конца недели 1 до конца недели ${weeks}: **${growth.toFixed(1)} МБ** (порог ${GROWTH_MAX}).`,
  `- Самая длинная строка хранилища: **${(longest / 1024).toFixed(1)} КБ** (порог ${ROW_MAX / 1024} КБ; окно чтения строки на Android — 2 МБ).`,
  `- Журнал сбоев: **${crash}** записей; незаконченной смены в хранилище ${rows.has('dispatcher.shift.current.v1') ? '**осталась**' : 'нет'}.`,
  `- Итог: **${ok ? 'держит' : 'не держит'}**.`,
  '',
].join('\n');
if (write) writeFileSync(join(import.meta.dir, '../../docs/reports/soak.md'), md);
console.log(md);
process.exit(ok ? 0 : 1);
