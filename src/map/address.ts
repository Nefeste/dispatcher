// Адрес вызова (игра владельца 22.11.2026: «улица и номер дома нигде не показываются, кроме диалога про подъезд»):
// у каждого узла дорог района — до трёх ближайших домов из OpenStreetMap (tools/map/addr.ts). Вызов стоит на узле;
// какой из этих домов назвал звонящий — по номеру вызова и зерну смены, всегда тот же. Движок адреса не знает: это
// слова звонящего на экране, карта и смена от них не меняются.
import { fnv1a } from '../engine/core/hash';
import { ADDR_NN_CENTER } from './generated/nn-center.addr';

export interface AddrData {
  /** названия улиц для экрана: «ул. Большая Покровская» */
  streets: string[];
  /** по узлу дорог: «улица:дом» через «|», ближайший первым; «~» в начале — ближайший дом дальше 150 м */
  at: string;
}

export interface Address {
  street: string;
  house: string;
  /** ближайший дом дальше 150 м от точки вызова: «около дома» */
  far: boolean;
}

const SOURCES: Record<string, AddrData> = { 'nn-center': ADDR_NN_CENTER };
const parsed = new Map<string, Address[][]>();

function table(mapId: string): Address[][] | null {
  const hit = parsed.get(mapId);
  if (hit) return hit;
  const src = SOURCES[mapId];
  if (!src) return null;
  const out = src.at.split(';').map(cell => {
    const far = cell.startsWith('~');
    return (far ? cell.slice(1) : cell).split('|').filter(Boolean).map(e => {
      const i = e.indexOf(':');
      return { street: src.streets[Number(e.slice(0, i))], house: e.slice(i + 1), far };
    });
  });
  parsed.set(mapId, out);
  return out;
}

/** Дома у узла дорог, ближайший первым; у карты без адресов — пусто. */
export function addressesAt(mapId: string, node: number): Address[] {
  return table(mapId)?.[node] ?? [];
}

/** Адрес вызова: один из домов у его узла, по ключу (зерно смены и номер вызова) — без Math.random: адрес не меняется
 *  при перерисовке и в разборе. */
export function callAddress(mapId: string, node: number, key: string): Address | null {
  const list = addressesAt(mapId, node);
  return list.length ? list[fnv1a(key) % list.length] : null;
}
