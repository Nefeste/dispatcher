// Звук и отклик (docs/08-game-design.md, §11; спецификация прототипа, §6): новый звонок — звонок телефона и короткий
// отклик, строка бригады по рации — щелчок. Только на событие; выключается в настройках. Звуки — синтез своим кодом
// (tools/sound/gen.ts). Проигрыватель — expo-audio, по одному на звук; отклик — performAndroidHapticsAsync (Android
// View.performHapticFeedback: следует системной настройке «Виброотклик»). Устройство — по образцу nardy:
// src/ui/feedback.ts @ f0ee88a. Ничто здесь не бросает: без звука игра та же.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import type { Settings } from '../state/settings';

export type Cue = 'ring' | 'radio';

const FILES: Record<Cue, number> = {
  ring: require('../../assets/audio/ring.wav'),
  radio: require('../../assets/audio/radio.wav'),
};

// в браузере — тишина: там игру только проверяют, а звук до первого касания браузер запрещает
const native = Platform.OS !== 'web';
let prefs: Pick<Settings, 'sound' | 'haptics'> = { sound: true, haptics: true };
const players: Partial<Record<Cue, AudioPlayer | null>> = {};
let moded = false;

export function setFeedback(s: Pick<Settings, 'sound' | 'haptics'>): void {
  prefs = { sound: s.sound, haptics: s.haptics };
}

function player(c: Cue): AudioPlayer | null {
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
