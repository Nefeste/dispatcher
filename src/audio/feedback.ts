// Звук и отклик (docs/08-game-design.md, §11; спецификация прототипа, §6): новый звонок — звонок телефона и короткий
// отклик, строка бригады по рации — щелчок. Только на событие; выключается в настройках. Звуки — синтез своим кодом
// (tools/sound/gen.ts). С премиум-отделкой — ещё касание кнопки, снятая трубка, «бригада послана», конец смены, звук
// вставок и фон зала петлёй (setAmbience). Проигрыватель — expo-audio, по одному на звук; отклик — performAndroidHapticsAsync (Android
// View.performHapticFeedback: следует системной настройке «Виброотклик»). Устройство — по образцу nardy:
// src/ui/feedback.ts @ f0ee88a. Ничто здесь не бросает: без звука игра та же.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import type { Settings } from '../state/settings';

export type Cue = 'ring' | 'radio' | 'tap' | 'pickup' | 'send' | 'done' | 'depart' | 'idle' | 'scene';
type Sound = Cue | 'hall';

const FILES: Record<Sound, number> = {
  ring: require('../../assets/audio/ring.wav'),
  radio: require('../../assets/audio/radio.wav'),
  tap: require('../../assets/audio/tap.wav'),
  pickup: require('../../assets/audio/pickup.wav'),
  send: require('../../assets/audio/send.wav'),
  done: require('../../assets/audio/done.wav'),
  depart: require('../../assets/audio/depart.wav'),
  idle: require('../../assets/audio/idle.wav'),
  scene: require('../../assets/audio/scene.wav'),
  hall: require('../../assets/audio/hall.wav'),
};
/** Громкость фона зала: под остальными звуками. */
const HALL_VOLUME = 0.5;

// в браузере — тишина: там игру только проверяют, а звук до первого касания браузер запрещает
const native = Platform.OS !== 'web';
let prefs: Pick<Settings, 'sound' | 'haptics'> = { sound: true, haptics: true };
const players: Partial<Record<Sound, AudioPlayer | null>> = {};
// фон зала должен звучать: идёт смена (пульт или разговор)
let ambient = false;
let moded = false;

export function setFeedback(s: Pick<Settings, 'sound' | 'haptics'>): void {
  prefs = { sound: s.sound, haptics: s.haptics };
  // «Звук» выключили посреди смены — фон смолкает сразу; включили — возвращается
  syncAmbience();
}

function player(c: Sound): AudioPlayer | null {
  if (players[c] !== undefined) return players[c] ?? null;
  try {
    if (!moded) {
      moded = true;
      // игра не перебивает музыку и молчит, когда телефон на беззвучном
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false }).catch(() => {});
    }
    players[c] = createAudioPlayer(FILES[c]);
  } catch {
    players[c] = null;
  }
  return players[c] ?? null;
}

/** Заранее завести проигрыватели: первый звонок смены не должен ждать файла. */
export function preloadSounds(): void {
  if (!native || !prefs.sound) return;
  player('ring');
  player('radio');
  player('tap');
}

/** Фон оперативного отдела (docs/08-game-design.md, §11): тихая петля, пока идёт смена — на пульте и в разговоре.
 *  Не событие и не сигнал: ничего не торопит. Со «Звуком» выключенным молчит. */
export function setAmbience(on: boolean): void {
  ambient = on;
  syncAmbience();
}

function syncAmbience(): void {
  if (!native) return;
  const want = ambient && prefs.sound;
  // нет нужды — проигрыватель не заводим
  if (!want && players.hall === undefined) return;
  const p = player('hall');
  if (!p) return;
  try {
    if (want) {
      p.loop = true;
      p.volume = HALL_VOLUME;
      p.play();
    } else p.pause();
  } catch {
    // звук — не главное
  }
}

/** Отклик на касание кнопки: тихий щелчок клавиши и короткий отклик телефона — каждый по своей настройке. */
export function tick(): void {
  if (!native) return;
  cue('tap');
  if (prefs.haptics && Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap).catch(() => {});
  }
}

export function cue(what: Cue): void {
  if (!native) return;
  if (prefs.sound) {
    const p = player(what);
    try {
      if (p) {
        void p.seekTo(0).catch(() => {});
        p.play();
      }
    } catch {
      // звук — не главное
    }
  }
  if (prefs.haptics && what === 'ring' && Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click).catch(() => {});
  }
}
