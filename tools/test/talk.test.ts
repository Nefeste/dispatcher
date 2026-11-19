// Звонок и разговор (часть П4; docs/08-game-design.md, §3; ADR 0002, 0005): звонящий не врёт — «есть» только у
// того, что есть, «нет» только у того, чего нет; не может позвонить тот, кто не может; ответы и первые слова —
// одни и те же при том же зерне; форма по услышанному никогда не строже, чем по правде.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { has, newCall } from '../../src/engine/callers';
import { formByKnown, formByTruth } from '../../src/engine/form';
import { ask, firstWords, type Heard, render, yearsWord } from '../../src/engine/talk';

const N = 600;
const calls = Array.from({ length: N }, (_, i) => newCall(DB, MED, 1000 + i * 7919, { season: 'autumn' }));
const QS = Object.keys(DB.phone.questions);

describe('звонок', () => {
  test('то же зерно — тот же звонок', () => {
    expect(newCall(DB, MED, 1000, { season: 'autumn' })).toEqual(calls[0]);
  });

  test('каждая из 12 болезней звонит; доли — по весам записей', () => {
    const n: Record<string, number> = {};
    for (const c of calls) n[c.condition] = (n[c.condition] ?? 0) + 1;
    const total = Object.values(DB.phone.conditions).reduce((a, c) => a + c.weight, 0);
    for (const [id, c] of Object.entries(DB.phone.conditions)) {
      expect(n[id] ?? 0).toBeGreaterThan(0);
      expect(Math.abs((n[id] ?? 0) / N - c.weight / total)).toBeLessThan(0.05);
    }
  });

  test('кто звонит: сам — только если может, прохожий — на улице, сосед — дома', () => {
    for (const c of calls) {
      const kind = DB.phone.callers[c.caller];
      expect(kind.at).toContain(c.where);
      if (kind.self) for (const f of kind.cannot) expect(has(c, f)).toBe(false);
      if (kind.self) expect(c.callerSex).toBe(c.patient.sex);
    }
    const kinds = new Set(calls.map(c => c.caller));
    expect([...kinds].sort()).toEqual(Object.keys(DB.phone.callers).sort());
  });

  test('заданные болезнь и звонящий — такие и есть', () => {
    const c = newCall(DB, MED, 5, { season: 'autumn', condition: 'cond.femoral_neck_fracture', caller: 'caller.relative', where: 'home' });
    expect(c.condition).toBe('cond.femoral_neck_fracture');
    expect(c.caller).toBe('caller.relative');
    expect(c.patient.age).toBeGreaterThanOrEqual(60);
  });
});

describe('разговор', () => {
  test('звонящий не врёт: первые слова и все вопросы', () => {
    for (const c of calls) {
      const fw = firstWords(DB, c);
      expect(fw.words.length).toBeGreaterThan(0);
      for (const l of fw.learned) expect(has(c, l.f)).toBe(true);
      const heard = new Map<string, Heard>(fw.learned.map(l => [l.f, l.heard]));
      for (const q of QS) {
        const a = ask(DB, MED, c, q, heard);
        expect(a.words.length, `${c.condition} ${q}`).toBeGreaterThan(0);
        expect(a.words).not.toMatch(/[{}]/);
        for (const l of a.learned) {
          if (l.heard === 'yes') expect(has(c, l.f)).toBe(true);
          if (l.heard === 'no') expect(has(c, l.f)).toBe(false);
          heard.set(l.f, l.heard);
        }
        if (a.age?.exact) expect(a.age.value).toBe(c.patient.age);
        if (a.age && !a.age.exact) expect(c.patient.age).toBeGreaterThanOrEqual(a.age.range![0]);
        if (a.onset) expect(c.onset >= a.onset[0] && c.onset <= a.onset[1]).toBe(true);
      }
      // по услышанному экстренная — значит, и по правде: признаки угрозы называют только те, что есть
      if (formByKnown(DB, heard) === 'emergency') expect(formByTruth(DB, c)).toBe('emergency');
    }
  });

  test('тот же вопрос в том же звонке — те же слова; повтор «что ещё?» не называет сказанное', () => {
    for (const c of calls.slice(0, 100)) {
      for (const q of QS) expect(ask(DB, MED, c, q)).toEqual(ask(DB, MED, c, q));
      const first = ask(DB, MED, c, 'q.more');
      const heard = new Map<string, Heard>(first.learned.map(l => [l.f, l.heard]));
      const again = ask(DB, MED, c, 'q.more', heard, 1);
      for (const l of again.learned) expect(first.learned.some(x => x.f === l.f)).toBe(false);
    }
  });

  test('экстренные болезни по правде — экстренные; угрозу чаще открывают вопросы, а не первые слова', () => {
    let urgent = 0, first = 0, asked = 0;
    for (const c of calls) {
      if (DB.phone.conditions[c.condition].form === 'emergency') expect(formByTruth(DB, c)).toBe('emergency');
      if (formByTruth(DB, c) !== 'emergency') continue;
      urgent++;
      const fw = firstWords(DB, c);
      const heard = new Map<string, Heard>(fw.learned.map(l => [l.f, l.heard]));
      if (formByKnown(DB, heard) === 'emergency') first++;
      for (const q of QS) for (const l of ask(DB, MED, c, q, heard).learned) heard.set(l.f, l.heard);
      if (formByKnown(DB, heard) === 'emergency') asked++;
    }
    // второй вопрос прототипа (спецификация, §1): решают ли вопросы. Из первых слов угрозу слышно меньше чем в 70 %
    // экстренных звонков, после всех вопросов — не меньше чем в 90 %; остальное — звонящий не знал (невезение, ADR 0005)
    expect(first / urgent).toBeLessThan(0.7);
    expect(asked / urgent).toBeGreaterThanOrEqual(0.9);
  });

  test('слова шаблонов: пол, кто он, число лет', () => {
    const c = calls.find(x => !DB.phone.callers[x.caller].self)!;
    const word = c.relation.patient[c.patient.sex]!;
    expect(render(c, '{Who} упал{|а}')).toBe(`${word[0].toUpperCase()}${word.slice(1)} упал${c.patient.sex === 'm' ? '' : 'а'}`);
    const y: [string, string, string] = ['год', 'года', 'лет'];
    expect([1, 2, 5, 11, 12, 21, 22, 25, 101, 111].map(n => yearsWord(n, y))).toEqual(['год', 'года', 'лет', 'лет', 'лет', 'год', 'года', 'лет', 'год', 'лет']);
  });
});
