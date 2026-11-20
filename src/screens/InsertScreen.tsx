// Видеовставка как экран (ADR 0009; спецификация прототипа, §5): «начало смены» — после загрузки новой смены,
// «бригада выезжает» — после первого решения смены; каждая — один раз за смену, потом — пульт.
import React from 'react';
import { InsertView } from '../scenes/insert/InsertView';

export type InsertKind = 'start' | 'depart';

const INSERTS: Record<InsertKind, { video: number; still: number; seconds: number }> = {
  start: { video: require('../../assets/scenes/insert-start.mp4'), still: require('../../assets/scenes/insert-start.jpg'), seconds: 4 },
  depart: { video: require('../../assets/scenes/insert-depart.mp4'), still: require('../../assets/scenes/insert-depart.jpg'), seconds: 5 },
};

export function InsertScreen({ kind, onDone }: { kind: InsertKind; onDone: () => void }) {
  const x = INSERTS[kind];
  // ключ — вид вставки: новый проигрыватель на каждый ролик
  return <InsertView key={kind} video={x.video} still={x.still} seconds={x.seconds} onDone={onDone} />;
}
