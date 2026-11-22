// Две недели в одном хранилище (путь к 1.0, В2а; tools/test/weeks.test.ts): у каждой недели своя станция и свой журнал.
// Вторая неделя — из записей первой (своих записей до #47 нет): те же смены, неделя `week.test`. Свой процесс:
// хранилище в памяти (phone.ts), модули игры держат станцию в себе.
import { memoryPhone, settle } from './phone';

const rows = memoryPhone();
const { DB } = await import('../../src/content/generated/db');
const { MED } = await import('../../src/content/generated/med');
const { shiftCtx } = await import('../../src/engine/shift');
const { lineupOf } = await import('../../src/engine/station');
const { loadMap } = await import('../../src/map/load');
const { keysOf, readStation, readWeekLog, recordShiftOnce, resetWeek } = await import('../../src/state/station');
const { weekShifts } = await import('../../src/state/week');
const { BOTS, play } = await import('../sim/bots');

const first = weekShifts();
const map = loadMap(DB.cities[first[0].city].map);
const second = (n: number) => {
  const setup = { ...first[n], id: `shift.test-${n + 1}`, week: { ...first[n].week!, of: 'week.test' } };
  return { ...shiftCtx(DB, MED, first[n].id, map), setup };
};

// первая неделя — смена 1; вторая — смены 1 и 2
const a = shiftCtx(DB, MED, first[0].id, map);
await recordShiftOnce(a, play(a, 11, BOTS.rules).s);
const b1 = second(0);
await recordShiftOnce(b1, play(b1, 21, BOTS.rules, lineupOf(await readStation('week.test'))).s);
const b2 = second(1);
await recordShiftOnce(b2, play(b2, 22, BOTS.rules, lineupOf(await readStation('week.test'))).s);
await settle();

const view = async (week: string) => {
  const st = await readStation(week);
  const log = await readWeekLog(week);
  return { done: st.done, fund: st.fund, log: log.shifts.map(e => e.shift) };
};
const before = { first: await view('week.first'), test: await view('week.test') };
await resetWeek('week.test');
await settle();
const after = { first: await view('week.first'), test: await view('week.test') };

console.log(JSON.stringify({
  keys: { first: keysOf('week.first'), test: keysOf('week.test') },
  rows: [...rows.keys()].sort(),
  before, after,
}));
process.exit(0);
