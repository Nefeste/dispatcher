// Видеовставка как экран (ADR 0009; спецификация прототипа, §5): «начало смены» — после загрузки новой смены,
// «бригада выезжает» — после первого решения смены; каждая — один раз за смену, потом — пульт. Вставки на месте вызова
// пульт показывает поверх себя (src/screens/PultScreen.tsx).
import React from 'react';
import { InsertView } from '../scenes/insert/InsertView';

export type InsertKind = 'start' | 'depart' | 'door' | 'flat' | 'stop';

/** Вставки: две смены (начало, первый выезд) и три на месте вызова — по касанию бригады на месте (срез, С4). */
export const INSERTS: Record<InsertKind, { video: number; still: number; seconds: number }> = {
  start: { video: require('../../assets/scenes/insert-start.mp4'), still: require('../../assets/scenes/insert-start.jpg'), seconds: 4 },
  depart: { video: require('../../assets/scenes/insert-depart.mp4'), still: require('../../assets/scenes/insert-depart.jpg'), seconds: 5 },
  door: { video: require('../../assets/scenes/insert-door.mp4'), still: require('../../assets/scenes/insert-door.jpg'), seconds: 3 },
  flat: { video: require('../../assets/scenes/insert-flat.mp4'), still: require('../../assets/scenes/insert-flat.jpg'), seconds: 3 },
  stop: { video: require('../../assets/scenes/insert-stop.mp4'), still: require('../../assets/scenes/insert-stop.jpg'), seconds: 3 },
};

export function InsertScreen({ kind, onDone }: { kind: InsertKind; onDone: () => void }) {
  const x = INSERTS[kind];
  // ключ — вид вставки: новый проигрыватель на каждый ролик
  return <InsertView key={kind} video={x.video} still={x.still} seconds={x.seconds} onDone={onDone} />;
}
