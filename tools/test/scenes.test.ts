// Сцены (ADR 0009; docs/02-architecture.md, §10): кадры из Blender сходятся со своими паспортами, раскладка пульта и
// разговора помещается на экраны телефонов, касания не наезжают друг на друга, вопросы и решение — в нижней половине,
// текст ложится на экранчики в перспективе кадра.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PULT } from '../../src/art/pult.gen';
import { STATION_ART } from '../../src/art/station.gen';
import { callLayout, pictureRect } from '../../src/scenes/call/layout';
import { ITEMS, stationLayout } from '../../src/scenes/station/layout';
import { TEXT_SCALES } from '../../src/ui/textScale';
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
    // срез, С7: шесть человек, каждый — дома и на улице; сцена «Разговор» знает каждую картинку
    const ids = Object.keys(p.callers).sort();
    expect(ids.filter(k => !k.endsWith('-street'))).toEqual(['daughter', 'grandma', 'grandpa', 'man', 'teen', 'young']);
    for (const k of ids.filter(x => !x.endsWith('-street'))) expect(ids).toContain(`${k}-street`);
    const scene = readFileSync(join(root, 'src/scenes/call/CallScene.tsx'), 'utf8');
    for (const k of ids) expect(scene).toContain(`assets/scenes/caller-${k}.jpg`);
  });

  test('звонящий по возрасту больного (срез, С7): у пожилых супругов — пожилые, подросток — только за родителя средних лет', () => {
    for (const k of Object.values(DB.phone.callers)) {
      for (const r of k.relations) {
        const pics = typeof r.picture === 'string' ? [r.picture] : Object.values(r.picture ?? {});
        if (pics.some(x => x === 'grandma' || x === 'grandpa') && (r.caller === 'жена' || r.caller === 'муж' || r.caller === 'сам')) expect(r.age![0]).toBeGreaterThanOrEqual(65);
        if (pics.includes('teen')) expect([r.caller, r.age![0] >= 30, r.age![1] <= 50]).toEqual(['сын', true, true]);
        if (pics.includes('young') && (r.caller === 'жена' || r.caller === 'сам')) expect(r.age![1]).toBeLessThan(40);
      }
    }
  });
});

describe('станция (срез, С2)', () => {
  test('кадр: отпечатки файлов, скрипт и версия Blender', () => {
    const p = json('assets/scenes/station.json');
    for (const [file, f] of Object.entries(p.files as Record<string, { sha256: string; bytes: number }>)) {
      expect([file, sha(file)]).toEqual([file, f.sha256]);
    }
    expect(readFileSync(join(root, p.made.script), 'utf8')).toContain(`VERSION = '${p.made.blender}'`);
    expect([STATION_ART.w, STATION_ART.h]).toEqual(p.made.size);
  });

  test('предметы — внутри кадра, листы — внутри своих предметов', () => {
    for (const it of ITEMS) {
      const [x0, y0, x1, y1] = STATION_ART[it].tap;
      expect(x0 >= 0 && y0 >= 0 && x1 <= STATION_ART.w && y1 <= STATION_ART.h && x1 > x0 && y1 > y0).toBe(true);
      for (const [x, y] of STATION_ART[it].quad) expect(x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1).toBe(true);
    }
  });

  for (const [w, h] of PHONES) {
    test(`${w} × ${h}: четыре предмета на экране, касания не наезжают и не меньше 44 точек`, () => {
      const L = stationLayout(w, h - 180);
      const taps = ITEMS.map(it => L.tap[it]);
      for (const t of taps) {
        expect(inside(t, w, h - 180)).toBe(true);
        expect(Math.min(t.w, t.h)).toBeGreaterThanOrEqual(44);
      }
      for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) expect(overlap(taps[i], taps[j])).toBe(false);
    });
  }
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
    // вставки смены (§9 геймдизайна): «начало смены» и «бригада выезжает» — 4–8 с; на месте вызова (срез, С4):
    // «у подъезда», «на остановке», «в квартире» — 3–5 с (спецификация среза, §4)
    expect(Object.keys(p.made).sort()).toEqual(['depart', 'door', 'flat', 'start', 'stop']);
    for (const [kind, m] of Object.entries(p.made as Record<string, { codec: string; frames: number; fps: number }>)) {
      expect(Object.keys(p.files)).toContain(`assets/scenes/insert-${kind}.mp4`);
      expect(Object.keys(p.files)).toContain(`assets/scenes/insert-${kind}.jpg`);
      expect(m.codec).toContain('H.264');
      const [lo, hi] = kind === 'depart' || kind === 'start' ? [4, 8] : [3, 5];
      expect(m.frames / m.fps).toBeGreaterThanOrEqual(lo);
      expect(m.frames / m.fps).toBeLessThanOrEqual(hi);
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

  // размер текста (§12 геймдизайна; срез, С8б): крупнее — строка программы и полоса вызовов выше, карта ниже, но есть
  for (const [w, h] of PHONES) for (const s of TEXT_SCALES.slice(1)) {
    test(`${w} × ${h}, текст ×${s}: строка программы и вызовы выше, карта остаётся не меньше трети экрана`, () => {
      const L = pultLayout(w, h, s), N = pultLayout(w, h);
      for (const r of [L.bar, L.map, L.waiting]) expect(inside(r, w, h)).toBe(true);
      expect(L.bar.h).toBeGreaterThan(N.bar.h);
      expect(L.waiting.h).toBeGreaterThan(N.waiting.h);
      expect(L.map.h).toBeGreaterThan(h * 0.33);
      expect(L.bar.y + L.bar.h).toBeLessThanOrEqual(L.map.y + 0.5);
      expect(L.map.y + L.map.h).toBeLessThanOrEqual(L.waiting.y + 0.5);
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
  // картинка звонящего закрывает окно целиком, по ширине — посередине, по высоте — от верха кадра: лишнее срезается
  // снизу, и голова подростка в низком окне цела (отделка кадров, 0.24.0)
  for (const [w, h] of PHONES) for (const s of TEXT_SCALES) {
    test(`${w} × ${h}, текст ×${s}: картинка звонящего — от верха кадра, окно закрыто`, () => {
      const box = callLayout(w, h, s).picture;
      const r = pictureRect(box);
      expect(r.y).toBe(box.y);
      expect(r.x).toBeLessThanOrEqual(box.x + 0.01);
      expect(r.x + r.w).toBeGreaterThanOrEqual(box.x + box.w - 0.01);
      expect(r.y + r.h).toBeGreaterThanOrEqual(box.y + box.h - 0.01);
      expect(Math.abs(r.w / r.h - 1080 / 960)).toBeLessThan(1e-9);
      expect(Math.abs((r.x - box.x) + (r.x + r.w - box.x - box.w))).toBeLessThan(1e-6);
    });
  }
  // крупный текст: касания выше и не наезжают, решение — в нижней половине, в карточке — хотя бы повод и ответ
  for (const [w, h] of PHONES) for (const s of TEXT_SCALES.slice(1)) {
    test(`${w} × ${h}, текст ×${s}: касания выше, не наезжают, решение внизу, карточка не пустая`, () => {
      const L = callLayout(w, h, s);
      const taps = [...L.questions, ...L.forms, L.tabs];
      for (const r of taps) {
        expect(inside(r, w, h)).toBe(true);
        expect(r.h).toBeGreaterThanOrEqual(Math.round(44 * s));
      }
      for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) expect(overlap(taps[i], taps[j])).toBe(false);
      for (const r of L.forms) expect(r.y).toBeGreaterThan(h / 2);
      expect(L.rows).toBeGreaterThanOrEqual(2);
      expect(L.fieldStep).toBeGreaterThanOrEqual(Math.round(22 * s));
    });
  }
});
