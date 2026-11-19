// Районы смен (ADR 0004; docs/08-game-design.md, §6): рамка в градусах — юг, запад, север, восток. Район около
// 6 × 9 км помещается на экране телефона в портрете (ADR 0006). Город — решение владельца 18.11.2026 (#1).
export interface Area {
  id: string;
  /** для паспорта и журнала */
  name: string;
  /** юг, запад, север, восток */
  bbox: [number, number, number, number];
}

export const AREAS: Area[] = [
  {
    id: 'nn-center',
    name: 'Нижний Новгород: Нагорная часть у Стрелки и Канавино за Окой',
    bbox: [56.275, 43.93, 56.355, 44.03],
  },
];

export function area(id: string): Area {
  const a = AREAS.find(x => x.id === id);
  if (!a) throw new Error(`нет района ${id}; есть: ${AREAS.map(x => x.id).join(', ')}`);
  return a;
}

/** Зеркало Overpass, которое отвечает из сессий студии (основной overpass-api.de — нет), и запрос района. */
export const OVERPASS = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

export function overpassQuery(a: Area): string {
  const b = a.bbox.join(',');
  return [
    '[out:json][timeout:180];',
    '(',
    `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${b});`,
    `way["natural"="water"](${b});`,
    `way["waterway"="riverbank"](${b});`,
    `relation["natural"="water"](${b});`,
    `way["railway"="rail"](${b});`,
    `way["leisure"="park"](${b});`,
    `way["landuse"="forest"](${b});`,
    `nwr["amenity"="hospital"](${b});`,
    `nwr["emergency"="ambulance_station"](${b});`,
    ');',
    'out body geom;',
  ].join('');
}
