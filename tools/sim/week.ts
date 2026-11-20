// «Виртуальный диспетчер» недели (срез, docs/specs/2026-11-vertical-slice.md, §4; части С1–С3).
// - Каждая смена «Первой недели» по отдельности — тем же ботам, что смена прототипа (tools/sim/shift.ts), по N зёрен:
//   смена проходится и по силам «по правилам» (С1).
// - Неделя целиком со станцией (С2): семь смен подряд, итог каждой идёт на станцию, станция решает по своему правилу
//   («без решений» или «лучшие» — укладки и бригады, пока хватает фонда), следующая смена выходит с её бригадами и
//   укладками. Порог «станция не решает смену»: «по правилам» без решений — не хуже чем на 10 п. п. экстренных в норму,
//   чем с лучшими; «без вопросов» с лучшими решениями — хуже «по правилам» без них. Ставки (С3): смертей до приезда
//   бригады у «по правилам» — не больше одной за неделю, у «без вопросов» — хотя бы втрое больше.
//
//   bun tools/sim/week.ts [смен=30] [недель=100] [--bots rules,noQuestions] [--write]   # --write — отчёт в docs/reports/
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { shiftCtx, type ShiftCtx } from '../../src/engine/shift';
import { afterShift, canDecide, decide, type Decision, lineupOf, newStation, reportOf, type Station } from '../../src/engine/station';
import { loadMap } from '../../src/map/load';
import { BOTS, play } from './bots';
import { pct, simulate } from './shift';

export const WEEK = Object.values(DB.shifts).filter(s => s.week).sort((a, b) => a.week!.n - b.week!.n);

/** Как станция решает в перерыве. */
export type Policy = 'none' | 'best';

/** Лучшие решения: пополнить укладки, потом — новые бригады на подстанцию, где в следующей смене бригад меньше. */
export function policyMoves(st: Station, next: string | null, policy: Policy): Decision[] {
  if (policy === 'none' || !next) return [];
  const out: Decision[] = [];
  let x = st;
  const tryDo = (d: Decision) => {
    if (canDecide(x, d)) return false;
    const y = decide(x, d);
    if (typeof y === 'string') return false;
    x = y;
    out.push(d);
    return true;
  };
  tryDo({ d: 'kits' });
  const setup = DB.shifts[next];
  for (;;) {
    const count = (b: string) => setup.crews.filter(c => c.base === b).length + x.extra.filter(c => c.base === b).length;
    const base = count('base.north') <= count('base.south') ? 'base.north' : 'base.south';
    if (!tryDo({ d: 'crew', base })) break;
  }
  return out;
}

export interface WeekRow {
  bot: string;
  policy: Policy;
  weeks: number;
  emergency: number;
  inNorm: number;
  /** фонд в конце недели, тыс. — среднее */
  fund: number;
  /** бригад станции к седьмой смене — среднее */
  extra: number;
  /** решений за неделю — среднее */
  decisions: number;
  /** писем с благодарностью и жалоб за неделю — среднее */
  thanks: number;
  complaints: number;
  /** смертей до приезда бригады и служебных проверок за неделю — среднее (срез, С3) */
  deaths: number;
  inquiries: number;
}

const ctxs = new Map<string, ShiftCtx>();
const ctxOf = (id: string) => {
  let c = ctxs.get(id);
  if (!c) ctxs.set(id, (c = shiftCtx(DB, MED, id, loadMap(DB.cities[DB.shifts[id].city].map))));
  return c;
};

/** Одна неделя бота с правилом станции: зёрна смен — от номера недели. */
export function runWeek(w: number, bot: string, policy: Policy): { st: Station; emergency: number; inNorm: number; decisions: number; deaths: number } {
  let st = newStation();
  let emergency = 0, inNorm = 0, decisions = 0, deaths = 0;
  WEEK.forEach((sh, i) => {
    const ctx = ctxOf(sh.id);
    const { s } = play(ctx, w * 100 + i + 1, BOTS[bot], lineupOf(st));
    const rep = reportOf(ctx, s);
    emergency += rep.emergency;
    inNorm += rep.inNorm;
    deaths += rep.deaths;
    st = afterShift(st, rep);
    for (const d of policyMoves(st, WEEK[i + 1]?.id ?? null, policy)) {
      const y = decide(st, d);
      if (typeof y !== 'string') {
        st = y;
        decisions++;
      }
    }
  });
  return { st, emergency, inNorm, decisions, deaths };
}

export function weekRuns(weeks: number, bots: readonly string[]): WeekRow[] {
  const rows: WeekRow[] = [];
  for (const bot of bots) {
    for (const policy of ['none', 'best'] as const) {
      const r: WeekRow = { bot, policy, weeks, emergency: 0, inNorm: 0, fund: 0, extra: 0, decisions: 0, thanks: 0, complaints: 0, deaths: 0, inquiries: 0 };
      for (let w = 1; w <= weeks; w++) {
        const x = runWeek(w, bot, policy);
        r.emergency += x.emergency;
        r.inNorm += x.inNorm;
        r.fund += x.st.fund / 1000;
        r.extra += x.st.extra.length;
        r.decisions += x.decisions;
        r.thanks += x.st.journal.filter(e => e.kind === 'thanks').length;
        r.complaints += x.st.journal.filter(e => e.kind === 'complaint').length;
        r.deaths += x.deaths;
        r.inquiries += x.st.journal.filter(e => e.kind === 'inquiry').length;
      }
      for (const k of ['fund', 'extra', 'decisions', 'thanks', 'complaints', 'deaths', 'inquiries'] as const) r[k] /= weeks;
      rows.push(r);
    }
  }
  return rows;
}

const share = (r: { emergency: number; inNorm: number }) => (r.emergency ? (100 * r.inNorm) / r.emergency : 0);

export function weekRunsReport(rows: readonly WeekRow[]): string {
  const name = (r: WeekRow) => `${BOTS[r.bot].name}, ${r.policy === 'none' ? 'без решений станции' : 'лучшие решения'}`;
  const out = ['| Диспетчер и станция | Экстренных в норму за неделю | Смертей до приезда | Проверок | Решений | Бригад станции | Благодарностей | Жалоб | Фонд в конце |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) out.push(`| ${name(r)} | ${share(r).toFixed(1)} % (${r.inNorm} из ${r.emergency}) | ${r.deaths.toFixed(2)} | ${r.inquiries.toFixed(2)} | ${r.decisions.toFixed(1)} | ${r.extra.toFixed(1)} | ${r.thanks.toFixed(1)} | ${r.complaints.toFixed(1)} | ${r.fund.toFixed(0)} тыс. |`);
  return out.join('\n');
}

/** Пороги «станция не решает смену» (спецификация среза, §4). */
export function weekVerdict(rows: readonly WeekRow[]): string[] {
  const get = (bot: string, p: Policy) => rows.find(r => r.bot === bot && r.policy === p);
  const out: string[] = [];
  const rn = get('rules', 'none'), rb = get('rules', 'best'), nb = get('noQuestions', 'best');
  if (rn && rb) {
    const d = share(rb) - share(rn);
    out.push(`- «по правилам» с лучшими решениями лучше, чем без решений, на ${d.toFixed(1)} п. п. — порог не больше 10: ${d <= 10 ? 'да' : 'нет'}`);
  }
  if (rn && nb) out.push(`- «без вопросов» с лучшими решениями ${share(nb).toFixed(1)} % против «по правилам» без решений ${share(rn).toFixed(1)} % — хуже: ${share(nb) < share(rn) ? 'да' : 'нет'}`);
  // ставки ощутимы (срез, С3): «по правилам» — не больше одной смерти за неделю (и без решений станции, и с ними),
  // «без вопросов» — хотя бы втрое больше при тех же решениях станции. Сравнение — при лучших решениях: без них «по
  // правилам» теряет больных из-за нехватки бригад, а не из-за разговора (решение агента, спецификация среза, §12)
  if (rn) out.push(`- «по правилам» без решений: ${rn.deaths.toFixed(2)} смерти до приезда бригады за неделю — порог не больше 1: ${rn.deaths <= 1 ? 'да' : 'нет'}`);
  if (rb) out.push(`- «по правилам» с лучшими решениями: ${rb.deaths.toFixed(2)} — порог не больше 1: ${rb.deaths <= 1 ? 'да' : 'нет'}`);
  if (rb && nb) {
    const k = rb.deaths ? nb.deaths / rb.deaths : Infinity;
    out.push(`- «без вопросов» с лучшими решениями: ${nb.deaths.toFixed(2)} — в ${Number.isFinite(k) ? k.toFixed(1) : '∞'} раза больше — порог хотя бы втрое: ${nb.deaths > 0 && k >= 3 ? 'да' : 'нет'}`);
  }
  const nn = get('noQuestions', 'none');
  if (rn && nn) out.push(`- без решений станции: «без вопросов» ${nn.deaths.toFixed(2)}, «по правилам» ${rn.deaths.toFixed(2)} — в ${rn.deaths ? (nn.deaths / rn.deaths).toFixed(1) : '∞'} раза (для сведения)`);
  return out;
}

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
  const nums = args.filter(a => /^\d+$/.test(a)).map(Number);
  const n = nums[0] ?? 30;
  const weeks = nums[1] ?? 100;
  const bi = args.indexOf('--bots');
  const bots = bi >= 0 ? args[bi + 1].split(',') : ['rules', 'noQuestions'];
  const t0 = Date.now();
  const text = weekReport(n, bots);
  console.log(text);
  const runs = weekRuns(weeks, bots);
  const week = weekRunsReport(runs);
  const verdict = weekVerdict(runs);
  console.log(`\n${week}\n\n${verdict.join('\n')}\n\n${Math.round((Date.now() - t0) / 1000)} с`);
  if (args.includes('--write')) {
    const out = join(import.meta.dir, '../../docs/reports/virtual-dispatcher-week.md');
    writeFileSync(out, `# «Виртуальный диспетчер» недели

\`bun tools/sim/week.ts ${n} ${weeks} --write\`.

## Каждая смена по отдельности

Каждая смена «Первой недели» — ${n} зёрен на бота, с бригадами записи и полными укладками. Срез, часть С1: смены
проходятся, «по правилам» — сколько экстренных в норму.

${text}

## Неделя со станцией

${weeks} недель на бота и правило станции (срез, часть С2): семь смен подряд, итог каждой — на станцию, следующая смена
выходит с её бригадами и укладками. «Лучшие решения» — пополнить укладки, потом новые общепрофильные бригады, пока
хватает фонда и места в гараже (\`policyMoves\`); «без решений» — станция только копит фонд, укладки переходят
неполными.

${week}

${verdict.join('\n')}
`);
    console.log('→', out);
  }
}
