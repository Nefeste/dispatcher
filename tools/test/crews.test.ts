// Бригады и их путь по улицам (части П3, П5; docs/02-architecture.md, §3 и §5): путь — настоящие рёбра графа с
// растущим временем; место на пути непрерывно и совпадает с узлами в их моменты; полный круг бригады — подстанция,
// вызов, на месте, больница, обратно; время доезда из одного обратного поиска совпадает с прямым путём каждой бригады.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { atBase, atHospital, crewAtBase, crewNext, etas, free, home, hourPct, nodeNow, onScene, restocked, send, toHospital, used } from '../../src/engine/crews';
import { KIT, RESTOCK } from '../../src/engine/rules';
import { edgeTimes, roadOf } from '../../src/engine/road/graph';
import { arrival, passed, pointAt, routeOf } from '../../src/engine/road/pos';
import { FAR } from '../../src/engine/road/route';
import { loadMap } from '../../src/map/load';
import { slots } from '../../src/scenes/pult/slots';

const city = DB.cities['city.proto'];
const map = loadMap(city.map);
const road = roadOf(map);
const times = edgeTimes(road, DB.roads.kmh, hourPct(DB.roads.hours, DB.shifts['shift.proto'].start));
const north = city.bases[0].node, south = city.bases[1].node;
const hosp = city.hospitals[0].node;

describe('путь', () => {
  const r = routeOf(road, times, north, hosp, 5000)!;

  test('рёбра пути — настоящие рёбра между соседними узлами, время растёт', () => {
    expect(r).not.toBeNull();
    expect(r.nodes[0]).toBe(north);
    expect(r.nodes[r.nodes.length - 1]).toBe(hosp);
    for (let i = 0; i < r.edges.length; i++) {
      const e = r.edges[i];
      const ends = [map.edges.a[e], map.edges.b[e]];
      expect(ends).toContain(r.nodes[i]);
      expect(ends).toContain(r.nodes[i + 1]);
      if (map.edges.oneway[e]) expect(map.edges.a[e]).toBe(r.nodes[i]);
      expect(r.at[i + 1] - r.at[i]).toBe(times[e]);
    }
    expect(arrival(r)).toBe(5000 + r.at[r.at.length - 1]);
  });

  test('пройденный узел — как перебором', () => {
    for (let k = 0; k <= 200; k++) {
      const t = 5000 + Math.floor((r.at[r.at.length - 1] * k) / 200);
      let want = 0;
      for (let i = 0; i < r.at.length; i++) if (r.at[i] <= t - 5000) want = i;
      expect(passed(r, t)).toBe(want);
    }
    expect(passed(r, 0)).toBe(0);
  });

  test('место на пути: в узлах — сами узлы, между ними — без скачков', () => {
    const [x0, y0] = pointAt(map, r, 5000);
    expect([x0, y0]).toEqual([map.nodes.x[north], map.nodes.y[north]]);
    const [x1, y1] = pointAt(map, r, arrival(r) + 1000);
    expect([x1, y1]).toEqual([map.nodes.x[hosp], map.nodes.y[hosp]]);
    for (let i = 1; i < r.nodes.length - 1; i += 7) {
      const [x, y] = pointAt(map, r, 5000 + r.at[i]);
      expect(Math.hypot(x - map.nodes.x[r.nodes[i]], y - map.nodes.y[r.nodes[i]])).toBeLessThan(1.5);
    }
    // шаг 1 секунда: машина не прыгает дальше, чем проедет на самой быстрой дороге (60 км/ч ≈ 17 м/с = 34 единицы)
    let [px, py] = pointAt(map, r, 5000);
    for (let t = 5000; t <= arrival(r); t += 1000) {
      const [x, y] = pointAt(map, r, t);
      expect(Math.hypot(x - px, y - py)).toBeLessThan(40);
      px = x; py = y;
    }
  });
});

describe('бригада', () => {
  const SCENE = 15 * 60 * 1000;

  test('круг: подстанция → едет → на месте → везёт → в больнице → возвращается → подстанция', () => {
    let c = crewAtBase('crew.4', 'crew.general', south);
    expect(free(c)).toBe(true);
    c = send(road, times, c, 'call.41', north, 0)!;
    expect(c.state).toBe('drive');
    expect(free(c)).toBe(false);
    const there = crewNext(c);
    expect(there).toBe(arrival(c.route!));
    c = onScene(c, there + SCENE);
    expect(c.state).toBe('scene');
    expect(c.at).toBe(north);
    expect(crewNext(c)).toBe(there + SCENE);
    c = toHospital(road, times, c, hosp, there + SCENE)!;
    expect(c.state).toBe('transport');
    expect(c.route!.nodes[0]).toBe(north);
    const inHosp = crewNext(c);
    c = atHospital(c, inHosp + SCENE);
    expect([c.state, c.at]).toEqual(['hospital', hosp]);
    c = home(road, times, c, inHosp + SCENE);
    expect(c.state).toBe('back');
    expect(c.call).toBeNull();
    expect(free(c)).toBe(true);
    c = atBase(c, crewNext(c));
    expect([c.state, c.at]).toEqual(['base', south]);
    expect(crewNext(c)).toBe(0xffffffff);
  });

  test('укладка: вызов тратит одну; пустая — не свободна, на подстанции пополняет 20 минут, потом полная (С2)', () => {
    let c = crewAtBase('crew.4', 'crew.general', south, 1);
    expect([c.kit, free(c)]).toEqual([1, true]);
    c = send(road, times, c, 'call.1', hosp, 0)!;
    c = used(onScene(c, crewNext(c) + SCENE));
    expect(c.kit).toBe(0);
    c = home(road, times, c, c.until);
    expect(c.state).toBe('back');
    expect(free(c)).toBe(false);
    const at = crewNext(c);
    c = atBase(c, at);
    expect([c.state, c.until, free(c)]).toEqual(['restock', at + RESTOCK, false]);
    expect(crewNext(c)).toBe(at + RESTOCK);
    c = restocked(c);
    expect([c.state, c.kit, free(c)]).toEqual(['base', KIT, true]);
    // пустая с прошлой смены — смена начинается с пополнения
    const empty = crewAtBase('crew.1', 'crew.general', north, 0);
    expect([empty.state, empty.until, free(empty)]).toEqual(['restock', RESTOCK, false]);
  });

  test('с дороги домой бригаду посылают от того места, где она сейчас', () => {
    let c = crewAtBase('crew.1', 'crew.general', north);
    c = send(road, times, c, 'call.1', hosp, 0)!;
    c = home(road, times, onScene(c, crewNext(c)), crewNext(c));
    expect(c.state).toBe('back');
    const t = c.route!.start + Math.floor(c.route!.at[c.route!.at.length - 1] / 2);
    const from = nodeNow(c, t);
    const again = send(road, times, c, 'call.2', south, t)!;
    expect(again.route!.nodes[0]).toBe(from);
    expect(again.route!.start).toBe(t);
  });

  test('время доезда одним обратным поиском — как прямой путь каждой свободной бригады; занятая — не едет', () => {
    const crews = DB.shifts['shift.proto'].crews.map(s => crewAtBase(s.id, s.kind, city.bases.find(b => b.id === s.base)!.node));
    crews[2] = send(road, times, crews[2], 'call.x', hosp, 0)!;
    expect(free(crews[2])).toBe(false);
    const to = city.hospitals[1].node;
    const eta = etas(road, times, crews, to, 1000);
    crews.forEach((c, i) => {
      if (!free(c)) return expect(eta[i]).toBe(FAR);
      const r = routeOf(road, times, nodeNow(c, 1000), to, 1000)!;
      expect(eta[i]).toBe(r.at[r.at.length - 1]);
    });
  });

  test('множитель часа: вечером медленнее, ночью быстрее', () => {
    expect(hourPct(DB.roads.hours, 17 * 3600 + 30 * 60)).toBe(75);
    expect(hourPct(DB.roads.hours, 2 * 3600)).toBe(120);
    expect(hourPct(DB.roads.hours, 23 * 3600 + 59 * 60)).toBe(120);
  });

  test('знаки бригад в одном месте не ложатся друг на друга', () => {
    const crews = DB.shifts['shift.proto'].crews.map(c => crewAtBase(c.id, c.kind, city.bases.find(b => b.id === c.base)!.node));
    const off = slots(crews);
    // машины (0.31.0) — 32 точки в ширину с обводкой: соседи в одном месте не ближе 34 точек по горизонтали
    for (let i = 0; i < crews.length; i++) for (let j = i + 1; j < crews.length; j++) if (crews[i].at === crews[j].at) expect(Math.abs(off[i][0] - off[j][0])).toBeGreaterThanOrEqual(34);
  });
});
