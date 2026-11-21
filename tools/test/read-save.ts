// Чтение образца сохранений нынешним кодом (путь к 1.0, В1; tools/test/saves.test.ts): хранилище телефона из образца —
// в память, потом то, что игра показала бы игроку при запуске: настройки, станция, журнал недели, лучшие итоги, журнал
// сбоев и сохранённая смена. Свой процесс на каждый образец: модули игры держат хранилище и смену в себе.
//
//   bun tools/test/read-save.ts tools/test/fixtures/saves/0.25.0.json   → JSON в stdout
import { readFileSync } from 'node:fs';
import { memoryPhone } from './phone';

const file = process.argv[2];
if (!file) throw new Error('путь к образцу');
const fx = JSON.parse(readFileSync(file, 'utf8')) as { keys: Record<string, string> };
memoryPhone(fx.keys);

const { readCrashlog } = await import('../../src/state/crashlog');
const { readBest } = await import('../../src/state/progress');
const { SAVE_V, resumeShift, savedShift } = await import('../../src/state/session');
const { readStation, readWeekLog } = await import('../../src/state/station');
const { loadSettings } = await import('../../src/state/storage');

const settings = await loadSettings();
const station = await readStation();
const week = await readWeekLog();
const best = await readBest();
const crashlog = await readCrashlog();
const saved = await savedShift();
const x = await resumeShift(true);

console.log(JSON.stringify({
  saveV: SAVE_V,
  settings,
  station: { fund: station.fund, done: station.done, decided: station.decided, extra: station.extra.length, kits: station.kits },
  weekShifts: week.shifts.map(e => e.shift),
  best,
  crashlog: crashlog?.length ?? -1,
  saved,
  shift: x ? { setup: x.ctx.setup.id, seed: x.s.seed, commands: x.log.length, t: x.s.t, over: x.s.over } : null,
}));
process.exit(0);
