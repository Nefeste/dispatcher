// Ночь (срез, часть С6; спецификация, §6): фонари вдоль больших улиц — через равный шаг, только на освещённых
// классах; ночь на карте — с 22 до 4, сумерки до и после; ночные смены «по правилам» держат пороги прототипа (§4).
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { shiftCtx } from '../../src/engine/shift';
import { totals } from '../../src/engine/totals';
import { LAMP_STEP, LIT_CLASSES, lampPoints } from '../../src/map/lamps';
import { loadMap } from '../../src/map/load';
import { duskOf, nightOf } from '../../src/ui/map/palette';
import { BOTS, play } from '../sim/bots';

const map = loadMap(DB.cities['city.proto'].map);

describe('ночь', () => {
  test('фонари: только вдоль магистралей и улиц второго класса, через шаг; на карте района — сотни', () => {
    const pts = lampPoints(map);
    expect(pts.length % 2).toBe(0);
    expect(pts.length / 2).toBeGreaterThan(300);
    // длина освещённых улиц — из рёбер (сантиметры), фонарей — около одной на шаг
    let cm = 0;
    for (let e = 0; e < map.edges.cls.length; e++) if (LIT_CLASSES.includes(map.edges.cls[e])) cm += map.edges.len[e];
    const expected = cm / 100 / (LAMP_STEP / 2);
    expect(pts.length / 2).toBeGreaterThan(expected * 0.8);
    expect(pts.length / 2).toBeLessThan(expected * 1.2);
    for (let i = 0; i < pts.length; i += 2) {
      expect(pts[i] >= 0 && pts[i] <= map.width && pts[i + 1] >= 0 && pts[i + 1] <= map.height).toBe(true);
    }
    // без освещённых классов — ни одного
    expect(lampPoints(map, []).length).toBe(0);
  });

  test('ночь на карте: днём нет, с 22 до 4 — полная, сумерки между; вечер — раньше ночи', () => {
    const at = (h: number) => nightOf(h * 3600);
    expect([at(12), at(19), at(21), at(23), at(2), at(5), at(6.5)]).toEqual([0, 0, 0.5, 1, 1, 0.5, 0]);
    for (let h = 0; h < 24; h += 0.5) expect(duskOf(h * 3600)).toBeGreaterThanOrEqual(nightOf(h * 3600));
  });

  test('ночные смены держат пороги прототипа: «по правилам» не меньше 85 % экстренных в норму, «без вопросов» хуже на 20 п. п.', () => {
    for (const id of ['shift.week-4', 'shift.week-7']) {
      const ctx = shiftCtx(DB, MED, id, map);
      const share = (bot: string) => {
        let e = 0, n = 0;
        for (let seed = 1; seed <= 12; seed++) {
          const t = totals(ctx, play(ctx, seed, BOTS[bot]).s);
          e += t.emergency;
          n += t.inNorm;
        }
        return (100 * n) / e;
      };
      const rules = share('rules');
      expect(rules).toBeGreaterThanOrEqual(85);
      expect(rules - share('noQuestions')).toBeGreaterThanOrEqual(20);
    }
  });
});
