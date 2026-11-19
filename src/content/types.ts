// Типы содержания (docs/04-data-model.md, §1): что собирает tools/content/build.ts из content/ в
// src/content/generated/db.ts (не в git). Чистый TypeScript.

/** Дороги: скорость по классу, км/ч, и множитель часа суток, % («оценка»). */
export interface Roads {
  estimate: boolean;
  kmh: number[];
  hours: { from: number; pct: number }[];
}

/** Вид бригады; класс машины — по 388н, прил. 2. */
export interface CrewKind {
  id: string;
  name: string;
  class: 'A' | 'B' | 'C';
  sources: string[];
  review: 'draft' | 'checked';
}

/** Место на карте: точка записи и узел дорог, к которому её привязала сборка. */
export interface Place {
  id: string;
  name: string;
  at: [number, number];
  node: number;
}

export interface Hospital extends Place {
  profiles: string[];
}

export interface City {
  id: string;
  map: string;
  bases: Place[];
  hospitals: Hospital[];
}

export interface ShiftCrew {
  id: string;
  kind: string;
  base: string;
}

export interface ShiftSetup {
  id: string;
  city: string;
  /** начало, секунды от полуночи */
  start: number;
  /** длина, секунды */
  length: number;
  crews: ShiftCrew[];
}

export interface Db {
  roads: Roads;
  crews: Record<string, CrewKind>;
  cities: Record<string, City>;
  shifts: Record<string, ShiftSetup>;
}
