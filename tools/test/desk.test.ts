// Рабочее место (docs/02-architecture.md, §9; docs/13-art.md, «Рабочее место»): модель из Blender сходится со своим
// паспортом, области палитры — те же, что у скрипта, у каждого экрана, который рисует игра, есть место в модели.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESK, LAMP, SCREENS } from '../../src/art/desk.gen';
import { COLORS, GLOWING, REGIONS } from '../../src/art/palette';

const root = join(import.meta.dir, '../..');
const passport = JSON.parse(readFileSync(join(root, 'assets/models/desk.json'), 'utf8'));
const sha = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');

describe('рабочее место', () => {
  test('паспорт: отпечатки и размеры файлов — у файлов в сборке; сделано скриптом Blender закреплённой версии', () => {
    for (const [file, f] of Object.entries(passport.files as Record<string, { sha256: string; bytes: number }>)) {
      expect([file, sha(file)]).toEqual([file, f.sha256]);
      expect([file, readFileSync(join(root, file)).length]).toEqual([file, f.bytes]);
    }
    expect(passport.made.script).toBe('blender/build.py');
    expect(readFileSync(join(root, 'blender/build.py'), 'utf8')).toContain(`VERSION = '${passport.made.blender}'`);
    expect(passport.triangles).toBe(DESK.reg.length as number);
    expect(passport.screens).toEqual(SCREENS.map(s => s.name));
  });

  test('области палитры — те же и в том же порядке, что в скрипте; у каждой есть цвет', () => {
    expect([...REGIONS]).toEqual(passport.regions);
    for (const r of REGIONS) expect(COLORS[r]).toMatch(/^#[0-9a-f]{6}$/i);
    for (const g of GLOWING) expect(g).toBeGreaterThanOrEqual(0);
  });

  test('треугольники: по три вершины, нормаль и область на каждый, затенение в каждой вершине', () => {
    const n = DESK.reg.length;
    expect(DESK.pos.length as number).toBe(n * 9);
    expect(DESK.nrm.length as number).toBe(n * 3);
    expect(DESK.ao.length as number).toBe(n * 3);
    expect(DESK.reg.every(r => r >= 0 && r < REGIONS.length)).toBe(true);
    expect(DESK.ao.every(a => a >= 0 && a <= 255)).toBe(true);
    for (let t = 0; t < n; t++) {
      const [x, y, z] = [DESK.nrm[t * 3], DESK.nrm[t * 3 + 1], DESK.nrm[t * 3 + 2]];
      expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(2e-3);
    }
  });

  test('экраны, которые рисует игра, есть в модели; лампа — над столом', () => {
    const names: string[] = SCREENS.map(s => s.name);
    for (const s of ['mon_call', 'mon_map', 'videowall']) expect(names).toContain(s);
    expect(new Set(names).size).toBe(names.length);
    for (const s of SCREENS) expect(s.w * s.h).toBeGreaterThan(0);
    expect(LAMP[1]).toBeGreaterThan(0.74);
  });
});
