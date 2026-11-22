// Долгий прогон (путь к 1.0, В1; tools/sim/soak.ts): три недели и три «Свободные смены» в одном процессе через сессию и
// хранилище телефона — смены кончаются, движок не отказывает боту, куча не растёт больше порога, строки хранилища
// короткие, журнал сбоев пуст. Свой процесс: прогон ставит хранилище в памяти. Полный отчёт — `--write`, 20 недель.
import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('три недели подряд в одном процессе: смены кончаются, память и хранилище не растут', () => {
  const run = Bun.spawnSync(['bun', 'tools/sim/soak.ts', '3'], { cwd: join(import.meta.dir, '../..'), env: process.env });
  const out = run.stdout.toString();
  expect(run.stderr.toString()).toBe('');
  expect(out).toContain('Итог: **держит**');
  expect(out).toContain('отказов движка — 0');
  expect(run.exitCode).toBe(0);
}, 120_000);
