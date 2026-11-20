// Звуки смены — синтез своим кодом (спецификация прототипа, §7; docs/08-game-design.md, §11): звонок телефона на
// столе и щелчок рации на строку бригады. Спокойные: звонок — мягкая трель, а не сирена. Детерминированно — одни и
// те же байты при каждой сборке; тест сверяет их с файлами в assets/audio (tools/test/sound.test.ts).
// Запись WAV — из nardy: tools/sound/synth.ts @ f0ee88a (`wav`, ГПСЧ mulberry32).
//
//   bun tools/sound/gen.ts     # пишет assets/audio/*.wav
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RATE = 22050;
export type SoundId = 'ring' | 'radio';
export const SOUND_IDS: SoundId[] = ['ring', 'radio'];
/** Пик громкости: звонок — громче, рация — тише и короче. */
export const PEAK: Record<SoundId, number> = { ring: 0.6, radio: 0.45 };

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Огибающая: плавные вход и выход `edge` с, чтобы не щёлкало. */
const env = (t: number, len: number, edge: number) => Math.min(1, t / edge, (len - t) / edge);

/** Звонок: две трели по 0,45 с — тон 880 и 1100 Гц сменяются 16 раз в секунду, как у телефона на столе. */
function ring(): Float32Array {
  const out = new Float32Array(Math.floor(1.25 * RATE));
  let lp = 0;
  for (const start of [0.05, 0.7]) {
    const len = 0.45;
    let ph = 0;
    for (let i = 0; i < len * RATE; i++) {
      const t = i / RATE;
      const f = Math.floor(t * 32) % 2 === 0 ? 880 : 1100;
      ph += (2 * Math.PI * f) / RATE;
      // мягкий тон: основной и тихая вторая гармоника
      const s = Math.sin(ph) + 0.18 * Math.sin(2 * ph);
      const k = Math.floor(start * RATE) + i;
      out[k] += s * env(t, len, 0.012);
    }
  }
  // сгладить однополюсным фильтром: без резких верхов
  for (let i = 0; i < out.length; i++) {
    lp += 0.55 * (out[i] - lp);
    out[i] = lp;
  }
  return out;
}

/** Рация: шипение открытого канала (40 мс полосой) и короткий сигнал конца передачи. */
function radio(): Float32Array {
  const out = new Float32Array(Math.floor(0.16 * RATE));
  const rnd = rng(3);
  let lp = 0, hp = 0, prev = 0;
  const noise = 0.045;
  for (let i = 0; i < noise * RATE; i++) {
    const t = i / RATE;
    const n = rnd() * 2 - 1;
    lp += 0.35 * (n - lp);
    hp = 0.9 * (hp + lp - prev);
    prev = lp;
    out[i] = 0.9 * hp * env(t, noise, 0.003) * Math.exp(-t / 0.03);
  }
  const beep = 0.05, at = 0.07;
  for (let i = 0; i < beep * RATE; i++) {
    const t = i / RATE;
    out[Math.floor(at * RATE) + i] += 0.55 * Math.sin(2 * Math.PI * 1750 * t) * env(t, beep, 0.006);
  }
  return out;
}

export function synth(id: SoundId): Float32Array {
  return id === 'ring' ? ring() : radio();
}

/** 16-битный моно WAV; пик приводится к `peak`. */
export function wav(samples: Float32Array, peak: number): Uint8Array {
  let max = 0;
  for (const x of samples) max = Math.max(max, Math.abs(x));
  const k = max > 0 ? peak / max : 0;
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + 2 * i, Math.round(Math.max(-1, Math.min(1, samples[i] * k)) * 32767), true);
  return new Uint8Array(buf);
}

export const fileOf = (id: SoundId) => join(import.meta.dir, '../../assets/audio', `${id}.wav`);

if (import.meta.main) {
  for (const id of SOUND_IDS) {
    const bytes = wav(synth(id), PEAK[id]);
    writeFileSync(fileOf(id), bytes);
    console.log(`${id}.wav: ${bytes.length} байт, ${((bytes.length - 44) / 2 / RATE).toFixed(2)} с`);
  }
}
