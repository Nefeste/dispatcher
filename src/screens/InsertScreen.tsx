// Видеовставка как экран (ADR 0009): «бригада выезжает» — после первого решения смены. Пока смены нет (П5), её
// показывает решение в эталонном разговоре, потом — снова пульт.
import React from 'react';
import { InsertView } from '../scenes/insert/InsertView';

const DEPART = { video: require('../../assets/scenes/insert-depart.mp4'), still: require('../../assets/scenes/insert-depart.jpg'), seconds: 5 };

export function InsertScreen({ onDone }: { onDone: () => void }) {
  return <InsertView video={DEPART.video} still={DEPART.still} seconds={DEPART.seconds} onDone={onDone} />;
}
