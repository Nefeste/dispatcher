// из shelter: src/ui/motion.ts @ 396daee — «Меньше движения» (ADR устава 0023, правило 6): карта без плавных
// переходов. Значение ставит корень (App.tsx) из настроек игрока или системы; экраны читают его хуком.
import { useSyncExternalStore } from 'react';

let less = false;
const subs = new Set<() => void>();

export function setLessMotion(value: boolean): void {
  if (value === less) return;
  less = value;
  subs.forEach(f => f());
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}

const get = () => less;

export function useLessMotion(): boolean {
  return useSyncExternalStore(subscribe, get, get);
}
