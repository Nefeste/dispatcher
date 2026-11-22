// Адрес вызова (игра владельца 22.11.2026; tools/map/addr.ts, src/map/address.ts): улица и дом из OpenStreetMap у
// точки вызова. Сборка повторяет файл байт в байт (если выгрузка рядом), у каждого узла района есть дом, адрес вызова —
// всегда тот же и один на всех экранах, карта дорог и жизнь смены от адресов не меняются.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { advance, apply, nextEvent, newShift, shiftCtx } from '../../src/engine/shift';
import { addressesAt, callAddress } from '../../src/map/address';
import { loadMap } from '../../src/map/load';
import { addressOf, callView } from '../../src/state/callView';
import { crewCard } from '../../src/state/crewView';
import { T } from '../../src/i18n';
import { weekShifts } from '../../src/state/week';
import { buildAddr, houseLabel, streetLabel, streetOf } from '../map/addr';
import { area } from '../map/areas';

const root = join(import.meta.dir, '../..');
const map = loadMap('nn-center');

describe('слова адреса', () => {
  test('тип улицы — вперёд и сокращённо; без типа — как есть', () => {
    expect(streetLabel('Большая Покровская улица')).toBe('ул. Большая Покровская');
    expect(streetLabel('улица Минина')).toBe('ул. Минина');
    expect(streetLabel('Проспект Гагарина')).toBe('просп. Гагарина');
    expect(streetLabel('площадь Минина и Пожарского')).toBe('пл. Минина и Пожарского');
    expect(streetLabel('Нижне-Волжская набережная')).toBe('наб. Нижне-Волжская');
    expect(streetLabel('Похвалинский съезд')).toBe('Похвалинский съезд');
    expect(streetLabel('улица')).toBe('улица');
  });

  test('ошибки разметки OSM: скобки тега, точка в конце, латиница', () => {
    expect(streetOf('addr:street=[Большая Печёрская улица]')).toBe('ул. Большая Печёрская');
    expect(streetOf('Молитовский затон 2-я линия.')).toBe('Молитовский затон 2-я линия');
    expect(streetOf('Кузнечиха д.')).toBe('Кузнечиха д.');
    expect(streetOf('Alexeevskaya ul.')).toBeNull();
    expect(houseLabel(' 12  к1 ')).toBe('12к1');
    expect(houseLabel('5/2')).toBe('5/2');
    expect(houseLabel('3;4')).toBeNull();
  });

  test('адрес словами: дом, «у дома» на улице, «около дома» далеко', () => {
    const a = { street: 'ул. Минина', house: '3А' };
    expect(T.call.address({ ...a, outside: false, far: false })).toBe('ул. Минина, 3А');
    expect(T.call.address({ ...a, outside: true, far: false })).toBe('ул. Минина, у дома 3А');
    expect(T.call.address({ ...a, outside: false, far: true })).toBe('ул. Минина, около дома 3А');
  });
});

describe('адреса района', () => {
  const passport = JSON.parse(readFileSync(join(root, 'assets/map/nn-center.addr.json'), 'utf8'));
  const text = readFileSync(join(root, 'src/map/generated/nn-center.addr.ts'), 'utf8');

  test('паспорт: ODbL, запрос, отпечаток файла', () => {
    expect(passport.licence).toBe('ODbL-1.0');
    expect(passport.source.query).toContain('addr:housenumber');
    expect(passport.output.sha256).toBe(createHash('sha256').update(text).digest('hex'));
  });

  test('у каждого узла дорог — хотя бы один дом; далеко (> 150 м) — меньше 2 % узлов', () => {
    let far = 0;
    for (let v = 0; v < map.nodes.x.length; v++) {
      const list = addressesAt('nn-center', v);
      expect(list.length).toBeGreaterThan(0);
      expect(list.length).toBeLessThanOrEqual(3);
      if (list[0].far) far++;
    }
    expect(far / map.nodes.x.length).toBeLessThan(0.02);
  });

  const src = join(root, 'map-src/nn-center.addr.osm.json');
  test.skipIf(!existsSync(src))('сборка из выгрузки повторяет файл байт в байт (если выгрузка есть)', () => {
    const raw = readFileSync(src, 'utf8');
    expect(createHash('sha256').update(raw).digest('hex')).toBe(passport.source.sha256);
    expect(buildAddr(area('nn-center'), raw, map).text).toBe(text);
  });
});

describe('адрес вызова', () => {
  test('тот же ключ — тот же дом; разные вызовы — разные дома у одного узла', () => {
    const v = [...Array(map.nodes.x.length).keys()].find(i => addressesAt('nn-center', i).length === 3)!;
    expect(callAddress('nn-center', v, '7:call.1')).toEqual(callAddress('nn-center', v, '7:call.1'));
    const houses = new Set(Array.from({ length: 30 }, (_, i) => callAddress('nn-center', v, `7:call.${i}`)!.house));
    expect(houses.size).toBeGreaterThan(1);
    expect(callAddress('no-such-map', 0, 'x')).toBeNull();
  });

  test('карточка вызова, бригада и окно ждущего — один адрес; на улице — «у дома»', () => {
    const ctx = shiftCtx(DB, MED, weekShifts()[1].id, map);
    const s = newShift(ctx, 5);
    for (let k = 0; k < 6; k++) {
      advance(ctx, s, nextEvent(ctx, s));
      if (!s.rings.length) continue;
      expect(apply(ctx, s, { c: 'answer' })).toBeNull();
      const call = s.calls.find(c => c.id === s.open)!;
      const v = callView(ctx, s, call.id)!;
      expect(v.address).not.toBeNull();
      expect(v.address).toEqual(addressOf(ctx, s, call));
      expect(v.address!.outside).toBe(call.truth.where === 'street');
      apply(ctx, s, { c: 'form', form: 'emergency' });
      const crew = v.options[0]?.crew ?? callView(ctx, s, call.id)!.options[0]?.crew;
      if (crew && !apply(ctx, s, { c: 'send', call: call.id, crew })) {
        expect(crewCard(ctx, s, crew)!.call!.address).toEqual(v.address);
      } else apply(ctx, s, { c: 'hold', call: call.id });
    }
  });
});
