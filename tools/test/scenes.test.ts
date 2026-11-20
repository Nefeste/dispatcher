// Сцены (ADR 0009; docs/02-architecture.md, §10): кадры из Blender сходятся со своими паспортами, раскладка пульта и
// разговора помещается на экраны телефонов, касания не наезжают друг на друга, вопросы и решение — в нижней половине,
// текст ложится на экранчики в перспективе кадра.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PULT } from '../../src/art/pult.gen';
import { callLayout } from '../../src/scenes/call/layout';
import { applyMatrix, pultLayout, quadMatrix, type Rect } from '../../src/scenes/pult/layout';

const root = join(import.meta.dir, '../..');
const sha = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
const json = (rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
/** телефоны в портрете: малый, обычный, длинный */
const PHONES = [[360, 640], [412, 915], [393, 852], [360, 800]] as const;

const inside = (r: Rect, w: number, h: number) => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('паспорта кадров', () => {
  test('пульт: отпечатки файлов, скрипт и версия Blender', () => {
    const p = json('assets/scenes/pult.json');
    for (const [file, f] of Object.entries(p.files as Record<string, { sha256: string; bytes: number }>)) {
      expect([file, sha(file)]).toEqual([file, f.sha256]);
    }
    expect(readFileSync(join(root, p.made.script), 'utf8')).toContain(`VERSION = '${p.made.blender}'`);
    expect([PULT.w, PULT.h]).toEqual(p.made.size);
  });

  test('звонящие: отпечатки картинок; люди — Rocketbox закреплённой ревизии под MIT', () => {
    const p = json('assets/scenes/callers.json');
    const src = json('tools/people/sources.json');
    expect(p.rocketbox.commit).toBe(src.commit);
    expect(readFileSync(join(root, 'assets/licenses/rocketbox-LICENSE.md'), 'utf8')).toContain('MIT License');
    for (const c of Object.values(p.callers as Record<string, { file: string; sha256: string; avatar: string }>)) {
      expect([c.file, sha(c.file)]).toEqual([c.file, c.sha256]);
      expect(Object.keys(src.files)).toContain(`Assets/Avatars/${c.avatar}`);
    }
  });
});

describe('видеовставки', () => {
  test('ролик и кадр вместо него сходятся с паспортом; ролик — H.264, не больше 6 МБ все вместе', () => {
    const p = json('assets/scenes/inserts.json');
    let total = 0;
    for (const [file, f] of Object.entries(p.files as Record<string, { sha256: string; bytes: number }>)) {
      expect([file, sha(file)]).toEqual([file, f.sha256]);
      if (file.endsWith('.mp4')) total += f.bytes;
    }
    expect(total).toBeLessThanOrEqual(6 * 1024 * 1024);
    // две вставки (§5): «начало смены» и «бригада выезжает», каждая — 4–8 с (docs/08-game-design.md, §11)
    expect(Object.keys(p.made).sort()).toEqual(['depart', 'start']);
    for (const [kind, m] of Object.entries(p.made as Record<string, { codec: string; frames: number; fps: number }>)) {
      expect(Object.keys(p.files)).toContain(`assets/scenes/insert-${kind}.mp4`);
      expect(Object.keys(p.files)).toContain(`assets/scenes/insert-${kind}.jpg`);
      expect(m.codec).toContain('H.264');
      expect(m.frames / m.fps).toBeGreaterThanOrEqual(4);
      expect(m.frames / m.fps).toBeLessThanOrEqual(8);
    }
  });
});

describe('пульт', () => {
  test('места предметов — внутри кадра стола', () => {
    for (const r of [PULT.phone.tap, PULT.radio.tap]) {
      expect(r[0]).toBeGreaterThanOrEqual(0);
      expect(r[1]).toBeGreaterThanOrEqual(0);
      expect(r[2]).toBeLessThanOrEqual(PULT.w);
      expect(r[3]).toBeLessThanOrEqual(PULT.h);
    }
  });

  for (const [w, h] of PHONES) {
    test(`${w} × ${h}: карта, строка программы, вызовы и стол — на экране, касания не наезжают`, () => {
      const L = pultLayout(w, h);
      for (const r of [L.bar, L.map, L.waiting, L.desk, L.phone.tap, L.radio.tap]) expect(inside(r, w, h)).toBe(true);
      expect(L.map.h).toBeGreaterThan(h * 0.4);
      expect(overlap(L.phone.tap, L.radio.tap)).toBe(false);
      expect(L.bar.y + L.bar.h).toBeLessThanOrEqual(L.map.y + 0.5);
      expect(L.map.y + L.map.h).toBeLessThanOrEqual(L.waiting.y + 0.5);
      // телефон и рация — ниже монитора, на столе
      expect(L.phone.tap.y).toBeGreaterThan(L.monitor.y + L.monitor.h - 1);
    });
  }

  test('матрица экранчика переводит углы прямоугольника в углы четырёхугольника', () => {
    for (const quad of [PULT.phone.lcd, PULT.radio.lcd, [[0, 0], [10, 0], [10, 5], [0, 5]] as const]) {
      const m = quadMatrix(200, 56, quad);
      const corners = [[0, 0], [200, 0], [200, 56], [0, 56]] as const;
      corners.forEach(([x, y], i) => {
        const [px, py] = applyMatrix(m, x, y);
        expect(Math.abs(px - quad[i][0])).toBeLessThan(1e-6);
        expect(Math.abs(py - quad[i][1])).toBeLessThan(1e-6);
      });
    }
  });
});

describe('разговор', () => {
  for (const [w, h] of PHONES) {
    test(`${w} × ${h}: вопросы и решение — в нижней половине, на экране, не наезжают`, () => {
      const L = callLayout(w, h);
      const taps = [...L.questions, ...L.forms];
      for (const r of taps) {
        expect(inside(r, w, h)).toBe(true);
        expect(r.y).toBeGreaterThan(h / 2);
        expect(r.h).toBeGreaterThanOrEqual(44);
      }
      for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) expect(overlap(taps[i], taps[j])).toBe(false);
      expect(L.picture.h).toBeGreaterThan(h * 0.3);
    });
  }
});
