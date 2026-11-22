// Образцы сохранений (путь к 1.0, В1; ADR устава 0004; docs/04-data-model.md, §3): хранилище телефона, записанное
// каждой версией с 0.24.0, читается нынешним кодом, и игрок видит то же, что видел тогда, — настройки, станцию, журнал
// недели, лучшие итоги и журнал сбоев. Незаконченная смена продолжается, если её схема (`SAVE_V`) та же; другая схема —
// смена не продолжается, это записанная потеря (комментарий у `SAVE_V` в src/state/session.ts), остальное — целиком.
//
// Образец пишет tools/test/make-save-fixture.ts в PR, который меняет версию; прежние не пересоздаются: их SHA-256 здесь.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEALED: Record<string, string> = {
  // код тега v0.24.0 — первая сборка, которую ставит владелец (журнала сбоев в ней нет)
  '0.24.0': '231ecf91d94816770e23622a525860a1ad755ac6431c6cb6fc7f0553a6edf63c',
  '0.25.0': 'fa215bd85d718959789e52a70664699e8179a920d253015a8cf97bb837aeb365',
  '0.26.0': '33c5db09f1afc8fef9a91c4a2e72532e3e3855e4d7d9a933a673922a3bd0a753',
  '0.27.0': 'b2e56036f7a964c987371b0d68438e09cd9d0b04cdd863b388736320c69d927b',
  '0.28.0': '3ad91f2484aae33bb17d34fc4eec1f5b760884b73d45c4723e34bcaae10a9a4c',
  '0.29.0': '71936138c1bb57f2bff795b17509fa02779585728d08812c71eddc9d986e2a82',
  '0.30.0': '41322906a96067a0e9e0da0b780b29d05e27da3f68bfb5ce5d8a3bcf644a460f',
};

const DIR = join(import.meta.dir, 'fixtures/saves');
const ROOT = join(import.meta.dir, '../..');
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

interface Seen {
  settings: Record<string, unknown>;
  station: { fund: number; done: string[]; decided: number; extra: number; kits: Record<string, number> };
  weekShifts: string[];
  best: Record<string, unknown>;
  crashlog: number;
  shift: { setup: string; seed: number; commands: number; t: number };
}
interface Fixture { version: string; saveV: number; keys: Record<string, string>; seen: Seen }
interface Read extends Omit<Seen, 'shift'> { saveV: number; saved: string | null; shift: (Seen['shift'] & { over: boolean }) | null }

describe('образцы сохранений', () => {
  test('каждый образец закреплён, и каждый закреплённый лежит на месте', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.map(f => f.replace(/\.json$/, ''))).toEqual(Object.keys(SEALED).sort());
    for (const f of files) {
      const sha = createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex');
      expect(`${f} ${sha}`).toBe(`${f} ${SEALED[f.replace(/\.json$/, '')]}`);
    }
  });

  for (const f of files) {
    test(`${f}: нынешний код видит то же, что видел игрок`, () => {
      const fx = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture;
      expect(fx.version).toBe(f.replace(/\.json$/, ''));
      // свой процесс: модули игры держат хранилище и смену в себе
      const run = Bun.spawnSync(['bun', 'tools/test/read-save.ts', join(DIR, f)], { cwd: ROOT, env: process.env });
      expect(run.stderr.toString()).toBe('');
      expect(run.exitCode).toBe(0);
      const got = JSON.parse(run.stdout.toString()) as Read;

      expect(got.settings).toEqual(fx.seen.settings);
      expect(got.station).toEqual(fx.seen.station);
      expect(got.weekShifts).toEqual(fx.seen.weekShifts);
      expect(got.best).toEqual(fx.seen.best);
      expect(got.crashlog).toBe(fx.seen.crashlog);

      if (fx.saveV === got.saveV) {
        // та же схема — смена продолжается с той же секунды и теми же командами
        expect(got.saved).toBe(fx.seen.shift.setup);
        expect(got.shift).toEqual({ ...fx.seen.shift, over: false });
      } else {
        // другая схема: эта смена по новым правилам переигралась бы в другую — не продолжается, игра не падает
        expect(got.saved).toBeNull();
        expect(got.shift).toBeNull();
      }
    }, 60_000);
  }
});
