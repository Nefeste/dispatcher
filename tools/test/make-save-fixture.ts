// Образец сохранений версии (путь к 1.0, В1; docs/05-process.md, «Версии»; tools/test/saves.test.ts): хранилище
// телефона, записанное кодом этой версии, и то, что эта версия показывала игроку (`seen`). Схема — как у «Нард» и
// «Козыря» (durak: tools/test/make-save-fixture.ts @ ce28e06), ключи — «Диспетчера»:
//   - первая смена недели сыграна до конца ботом «по правилам» — станция, журнал недели и лучший итог;
//   - решение на станции, если оно возможно;
//   - вторая смена идёт: двадцать команд через сессию, сохранение — как его пишет игра;
//   - настройки не по умолчанию и одна запись журнала сбоев (журнал — с 0.25.0; в коде 0.24.0 его нет — записей ноль).
//
// Образец 0.24.0 записан кодом тега `v0.24.0` этим же файлом и `phone.ts`, положенными в его рабочую копию.
//
//   bun tools/test/make-save-fixture.ts 0.24.0             → tools/test/fixtures/saves/0.24.0.json и строка для SEALED
//   bun tools/test/make-save-fixture.ts 0.24.0 --out /tmp  → туда же, не трогая образцы
//
// Только в релизном PR версии и только для новой версии: прежние образцы не пересоздаются (их SHA-256 закреплён).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryPhone, settle } from './phone';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('версия: X.Y.Z');
const outAt = process.argv.indexOf('--out');
const dir = outAt > 0 ? process.argv[outAt + 1] : join(import.meta.dir, 'fixtures/saves');
const file = join(dir, `${version}.json`);
if (outAt < 0 && existsSync(file)) throw new Error(`${file} уже есть: образцы не пересоздаются`);

const rows = memoryPhone();
// модули игры — после телефона: хранилище читается при первом обращении
const { DB } = await import('../../src/content/generated/db');
const { MED } = await import('../../src/content/generated/med');
const { shiftCtx } = await import('../../src/engine/shift');
const { lineupOf } = await import('../../src/engine/station');
const { totals } = await import('../../src/engine/totals');
const { loadMap } = await import('../../src/map/load');
// журнал сбоев — с 0.25.0
const crash = await import('../../src/state/crashlog').catch(() => null);
const { recordBest, readBest } = await import('../../src/state/progress');
const session = await import('../../src/state/session');
const { decideAndSave, readStation, readWeekLog, recordShiftOnce } = await import('../../src/state/station');
const { saveSettings } = await import('../../src/state/storage');
const { weekShifts } = await import('../../src/state/week');
const { BOTS, botMove, play } = await import('../sim/bots');

const week = weekShifts();
const map = loadMap(DB.cities[week[0].city].map);

// настройки — не по умолчанию: каждое поле видно в образце
const settings = { autopause: true, sound: false, haptics: true, softOutcome: true, textSize: 1 as const, lessMotion: true };
await saveSettings(settings);

// первая смена — до конца, итог на станцию и в лучшие
const ctx1 = shiftCtx(DB, MED, week[0].id, map);
const { s: s1 } = play(ctx1, 101, BOTS.rules);
await recordShiftOnce(ctx1, s1);
const t1 = totals(ctx1, s1);
await recordBest(week[0].id, { emergency: t1.emergency, inNorm: t1.inNorm, urgentMedian: t1.urgentMedian, accepted: t1.accepted });
// решение на станции — какое возможно: укладки, иначе ничего
await decideAndSave({ d: 'kits' });

// журнал сбоев — одна запись
if (crash) {
  crash.logError('error', new Error('образец сохранений: запись журнала'), 'make-save-fixture');
  await crash.crashlogWritten();
}

// вторая смена идёт: команды через сессию, как у игрока; сохранение пишет сама игра после каждой команды
const st = await readStation();
session.startShift(week[1].id, 202, true, lineupOf(st), null);
session.dismissIntro();
session.setPace(20);
session.setSpeed(4);
for (let i = 0; i < 200_000; i++) {
  const x = session.session()!;
  if (x.log.length >= 20 || x.s.over) break;
  const cmd = botMove(x.ctx, x.s, BOTS.rules);
  if (cmd) {
    if (session.command(cmd)) break;
  } else {
    if (x.speed === 0) session.setSpeed(4);
    session.tick(1000);
  }
}
await settle();
const x = session.session()!;

const keys = Object.fromEntries([...rows].sort(([a], [b]) => a.localeCompare(b)));
const station = await readStation();
const seen = {
  settings,
  station: { fund: station.fund, done: station.done, decided: station.decided, extra: station.extra.length, kits: station.kits },
  weekShifts: (await readWeekLog()).shifts.map(e => e.shift),
  best: await readBest(),
  crashlog: crash ? (await crash.readCrashlog())?.length ?? 0 : 0,
  shift: { setup: x.ctx.setup.id, seed: x.s.seed, commands: x.log.length, t: JSON.parse(keys['dispatcher.shift.current.v1']).t as number },
};
const out = JSON.stringify({ version, saveV: JSON.parse(keys['dispatcher.shift.current.v1']).v as number, keys, seen }, null, 1) + '\n';
mkdirSync(dir, { recursive: true });
writeFileSync(file, out);
console.log(`${file}\n  '${version}': '${createHash('sha256').update(out).digest('hex')}',`);
process.exit(0);
