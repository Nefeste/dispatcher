// Звуки смены — синтез своим кодом (спецификация прототипа, §7; docs/08-game-design.md, §11): звонок телефона на
// столе и щелчок рации на строку бригады. Спокойные: звонок — мягкая трель, а не сирена. Детерминированно — одни и
// те же байты при каждой сборке; тест сверяет их с файлами в assets/audio (tools/test/sound.test.ts).
// Запись WAV — из nardy: tools/sound/synth.ts @ f0ee88a (`wav`, ГПСЧ mulberry32).
//
// С премиум-отделкой (22.11.2026) — ещё касание кнопки, снятая трубка, «бригада послана», конец смены, мотор и
// далёкая сирена вставки «бригада выезжает», мотор у адреса, прибор в квартире и фон оперативного отдела петлёй.
//
//   bun tools/sound/gen.ts     # пишет assets/audio/*.wav
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RATE = 22050;
export type SoundId = 'ring' | 'radio' | 'tap' | 'pickup' | 'send' | 'done' | 'depart' | 'idle' | 'scene' | 'hall';
export const SOUND_IDS: SoundId[] = ['ring', 'radio', 'tap', 'pickup', 'send', 'done', 'depart', 'idle', 'scene', 'hall'];
/** Пик громкости: звонок — громче, рация — тише и короче; касание и фон зала — едва слышны. */
export const PEAK: Record<SoundId, number> = { ring: 0.6, radio: 0.45, tap: 0.16, pickup: 0.3, send: 0.32, done: 0.38, depart: 0.4, idle: 0.3, scene: 0.26, hall: 0.2 };
/** Наибольшая длина, с (tools/test/sound.test.ts). Фон зала — петля: конец сходится с началом. */
export const MAX_SECONDS: Record<SoundId, number> = { ring: 1.5, radio: 0.2, tap: 0.06, pickup: 0.3, send: 0.4, done: 1.8, depart: 4.6, idle: 3.1, scene: 3.1, hall: 8.01 };

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

/** Шум с полосой: низкие срезает `hp`, высокие — `lp` (доли 0…1 однополюсных фильтров). */
function band(rnd: () => number, n: number, lp: number, hp: number): Float32Array {
  const out = new Float32Array(n);
  let a = 0, b = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    a += lp * (rnd() * 2 - 1 - a);
    b = hp * (b + a - prev);
    prev = a;
    out[i] = b;
  }
  return out;
}

/** Касание кнопки: клавиша клавиатуры — короткий глухой щелчок. */
function tap(): Float32Array {
  const len = 0.05;
  const out = new Float32Array(Math.floor(len * RATE));
  const n = band(rng(11), out.length, 0.5, 0.8);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] = (n[i] * 0.8 + 0.5 * Math.sin(2 * Math.PI * 320 * t)) * Math.exp(-t / 0.008) * env(t, len, 0.001);
  }
  return out;
}

/** Трубку сняли: два щелчка рычага и глухой стук корпуса. */
function pickup(): Float32Array {
  const len = 0.26;
  const out = new Float32Array(Math.floor(len * RATE));
  const n = band(rng(5), out.length, 0.6, 0.85);
  for (const [at, gain, decay] of [[0.01, 1, 0.006], [0.085, 0.7, 0.008]] as const) {
    for (let i = 0; i < 0.06 * RATE; i++) {
      const t = i / RATE;
      const k = Math.floor(at * RATE) + i;
      out[k] += gain * (n[k] + 0.6 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t / decay);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] *= env(i / RATE, len, 0.002);
  return out;
}

/** Мягкая нота: основной тон, тихая октава, затухание. */
function note(out: Float32Array, at: number, f: number, len: number, gain: number): void {
  for (let i = 0; i < len * RATE; i++) {
    const t = i / RATE;
    const k = Math.floor(at * RATE) + i;
    if (k >= out.length) break;
    out[k] += gain * (Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t / (len * 0.32)) * env(t, len, 0.008);
  }
}

/** Бригада послана: две ноты вверх — программа приняла решение. */
function send(): Float32Array {
  const out = new Float32Array(Math.floor(0.36 * RATE));
  note(out, 0.0, 587.33, 0.2, 1);
  note(out, 0.11, 783.99, 0.25, 0.9);
  return out;
}

/** Смена окончена: три спокойные ноты вниз-вверх, долго гаснут. */
function done(): Float32Array {
  const out = new Float32Array(Math.floor(1.7 * RATE));
  note(out, 0.0, 440.0, 0.9, 0.9);
  note(out, 0.22, 554.37, 0.9, 0.8);
  note(out, 0.44, 659.25, 1.25, 1);
  return out;
}

/** Мотор машины: низкий тон с гармониками и шумом выхлопа; `rev` — как растут обороты за время звука. */
function engine(out: Float32Array, len: number, f0: number, rev: number, seed: number, fade: number): void {
  const n = band(rng(seed), out.length, 0.08, 0.98);
  let ph = 0;
  for (let i = 0; i < len * RATE && i < out.length; i++) {
    const t = i / RATE;
    const f = f0 * (1 + rev * Math.min(1, t / (len * 0.6)));
    ph += (2 * Math.PI * f) / RATE;
    const tone = Math.sin(ph) + 0.5 * Math.sin(2 * ph + 0.4) + 0.25 * Math.sin(3 * ph + 1.1);
    // неровность холостого хода
    const wob = 1 + 0.12 * Math.sin(2 * Math.PI * 7 * t);
    out[i] += (0.6 * tone * wob + 2.2 * n[i]) * env(t, len, 0.25) * (1 - fade * (t / len));
  }
}

/** Бригада выезжает: мотор набирает обороты и уходит, вдали — сирена: два тона плавно, тихо и без резких верхов. */
function depart(): Float32Array {
  const len = 4.5;
  const out = new Float32Array(Math.floor(len * RATE));
  engine(out, len, 52, 0.7, 21, 0.75);
  let ph = 0, lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    // «вау»: тон плавно ходит между 650 и 900 Гц раз в 1,3 с
    const f = 775 + 125 * Math.sin((2 * Math.PI * t) / 1.3);
    ph += (2 * Math.PI * f) / RATE;
    // вдали: тихо, начинается через секунду и уходит
    const far = Math.min(1, Math.max(0, (t - 0.8) / 1.2)) * Math.min(1, (len - t) / 1.4);
    lp += 0.12 * (Math.sin(ph) + 0.3 * Math.sin(2 * ph) - lp);
    out[i] += 0.55 * lp * far;
  }
  return out;
}

/** Машина у адреса: мотор на холостом ходу. */
function idle(): Float32Array {
  const len = 3.0;
  const out = new Float32Array(Math.floor(len * RATE));
  engine(out, len, 44, 0.0, 22, 0.2);
  return out;
}

/** В квартире: укладка бригады у порога — прибор коротко пищит три раза и тихо набирает заряд. Только фон: помощь не
 *  показываем (ADR 0007). */
function scene(): Float32Array {
  const len = 3.0;
  const out = new Float32Array(Math.floor(len * RATE));
  for (const at of [0.2, 1.05, 1.9]) {
    const beep = 0.09;
    for (let i = 0; i < beep * RATE; i++) {
      const t = i / RATE;
      out[Math.floor(at * RATE) + i] += 0.8 * Math.sin(2 * Math.PI * 960 * t) * env(t, beep, 0.01);
    }
  }
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    if (t < 0.5 || t > 2.7) continue;
    const k = (t - 0.5) / 2.2;
    ph += (2 * Math.PI * (500 + 1500 * k * k)) / RATE;
    out[i] += 0.12 * Math.sin(ph) * env(t - 0.5, 2.2, 0.3);
  }
  return out;
}

/** Фон оперативного отдела — петля 8 с: вентиляция, гул сети, редкие клавиши и далёкий звонок у соседнего пульта.
 *  Всё, что звучит тоном, укладывается в петлю целым числом периодов; шум к концу переходит в своё начало. */
function hall(): Float32Array {
  const len = 8;
  const N = len * RATE;
  const out = new Float32Array(N);
  // вентиляция: шум с полосой, длиннее петли на секунду — хвост вплавлен в начало
  const tail = RATE;
  const air = band(rng(31), N + tail, 0.05, 0.995);
  for (let i = 0; i < N; i++) {
    const k = i < tail ? i / tail : 1;
    out[i] = 5.5 * (air[i] * k + (i < tail ? air[N + i] * (1 - k) : 0)) * (1 + 0.15 * Math.sin((2 * Math.PI * i) / N));
  }
  for (let i = 0; i < N; i++) {
    const t = i / RATE;
    out[i] += 0.1 * Math.sin(2 * Math.PI * 50 * t) + 0.05 * Math.sin(2 * Math.PI * 100 * t + 0.7) + 0.02 * Math.sin(2 * Math.PI * 150 * t + 1.9);
  }
  // клавиши соседей: редкие глухие щелчки пачками
  const rnd = rng(47);
  const key = band(rng(48), Math.floor(0.03 * RATE), 0.35, 0.8);
  for (const at of [0.9, 2.6, 3.1, 5.4, 6.2]) {
    const count = 3 + Math.floor(rnd() * 5);
    let t0 = at;
    for (let c = 0; c < count; c++) {
      const gain = 0.35 + 0.3 * rnd();
      const k0 = Math.floor(t0 * RATE);
      for (let i = 0; i < key.length && k0 + i < N; i++) out[k0 + i] += gain * key[i] * Math.exp(-i / (0.006 * RATE));
      t0 += 0.09 + 0.12 * rnd();
    }
  }
  // далёкий звонок у соседнего пульта — одна тихая трель, приглушённая
  let lp = 0, ph = 0;
  const at = 4.1, trill = 0.4;
  for (let i = 0; i < trill * RATE; i++) {
    const t = i / RATE;
    ph += (2 * Math.PI * (Math.floor(t * 32) % 2 === 0 ? 880 : 1100)) / RATE;
    lp += 0.1 * (Math.sin(ph) * env(t, trill, 0.03) - lp);
    out[Math.floor(at * RATE) + i] += 0.22 * lp;
  }
  return out;
}

const SYNTH: Record<SoundId, () => Float32Array> = { ring, radio, tap, pickup, send, done, depart, idle, scene, hall };

export function synth(id: SoundId): Float32Array {
  return SYNTH[id]();
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
