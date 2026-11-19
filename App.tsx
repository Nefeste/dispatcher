// Корень: экраны переключаются состоянием, без роутера (docs/02-architecture.md, §2). При запуске — шрифты
// студии и настройки; «Меньше движения» — выбор игрока или система (ADR устава 0023, правило 6).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AboutScreen } from './src/screens/AboutScreen';
import { CallScreen } from './src/screens/CallScreen';
import { EndScreen } from './src/screens/EndScreen';
import { PultScreen } from './src/screens/PultScreen';
import { DeskScreen } from './src/screens/DeskScreen';
import { InsertScreen } from './src/screens/InsertScreen';
import { TitleScreen } from './src/screens/TitleScreen';
import { closeShift, resumeShift, setPace, startShift } from './src/state/session';
import { DEFAULT_SETTINGS, lessMotionOf, type Settings } from './src/state/settings';
import { loadSettings } from './src/state/storage';
import { FONT_FILES } from './src/ui/fonts';
import { setLessMotion } from './src/ui/motion';
import { SCENE } from './src/scenes/palette';
import { C } from './src/ui/theme';

type Screen = 'title' | 'map' | 'call' | 'insert' | 'end' | 'desk' | 'about';

// сценарий в браузере ускоряет часы смены: ?pace=50 (только веб-сборка; на телефоне адресной строки нет)
if (Platform.OS === 'web' && typeof location !== 'undefined') setPace(Number(new URLSearchParams(location.search).get('pace') ?? 1));

export default function App() {
  // шрифты студии лежат в сборке — грузятся мгновенно; не загрузились — игра идёт системным шрифтом
  const [fontsReady, fontsError] = useFonts(FONT_FILES);
  const [screen, setScreen] = useState<Screen>('title');
  // видеовставка «бригада выезжает» — один раз за смену (docs/08-game-design.md, §9)
  const departed = useRef(false);
  const settings = useRef<Settings>({ ...DEFAULT_SETTINGS });

  useEffect(() => {
    let alive = true;
    void Promise.all([loadSettings(), AccessibilityInfo.isReduceMotionEnabled().catch(() => false)]).then(([s, system]) => {
      if (!alive) return;
      settings.current = s;
      setLessMotion(lessMotionOf(s, system));
    });
    return () => { alive = false; };
  }, []);
  const toMap = useCallback(() => setScreen('map'), []);
  const toCall = useCallback(() => setScreen('call'), []);
  const toEnd = useCallback(() => setScreen('end'), []);

  // «Назад» на телефоне — на первый экран; с первого экрана — выход из приложения
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'title') return false;
      // разговор кончается решением (§3): «Назад» его не закрывает
      if (screen === 'call') return true;
      setScreen(screen === 'insert' ? 'map' : 'title');
      return true;
    });
    return () => sub.remove();
  }, [screen]);

  // сцены тёмные: полоса состояния телефона над ними — тоже (ADR 0009)
  const scene = screen !== 'title' && screen !== 'about';
  return (
    <GestureHandlerRootView style={styles.root}>
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, scene && styles.dark]}>
        <StatusBar style={scene ? 'light' : 'dark'} />
        <View style={styles.root}>
          {fontsReady || fontsError ? (
            <>
              {screen === 'title' ? (
                <TitleScreen
                  onStart={() => {
                    departed.current = false;
                    startShift(undefined, settings.current.autopause);
                    setScreen('map');
                  }}
                  onResume={() => {
                    departed.current = true;
                    void resumeShift(settings.current.autopause).then(x => setScreen(x ? 'map' : 'title'));
                  }}
                  onDesk={() => setScreen('desk')}
                  onAbout={() => setScreen('about')}
                />
              ) : null}
              {screen === 'map' ? <PultScreen onBack={() => setScreen('title')} onCall={toCall} onEnd={toEnd} /> : null}
              {screen === 'call' ? (
                <CallScreen
                  onDone={toMap}
                  onSent={() => {
                    // первый выезд смены — видеовставка
                    setScreen(departed.current ? 'map' : 'insert');
                    departed.current = true;
                  }}
                />
              ) : null}
              {screen === 'insert' ? <InsertScreen onDone={toMap} /> : null}
              {screen === 'end' ? <EndScreen onHome={() => { closeShift(); setScreen('title'); }} /> : null}
              {screen === 'desk' ? <DeskScreen onBack={() => setScreen('title')} /> : null}
              {screen === 'about' ? <AboutScreen onBack={() => setScreen('title')} /> : null}
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: C.linen }, dark: { backgroundColor: SCENE.hallTop } });
