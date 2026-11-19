// Корень: экраны переключаются состоянием, без роутера (docs/02-architecture.md, §2). При запуске — шрифты
// студии и настройки; «Меньше движения» — выбор игрока или система (ADR устава 0023, правило 6).
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AboutScreen } from './src/screens/AboutScreen';
import { CallScreen } from './src/screens/CallScreen';
import { PultScreen } from './src/screens/PultScreen';
import { DeskScreen } from './src/screens/DeskScreen';
import { InsertScreen } from './src/screens/InsertScreen';
import { TitleScreen } from './src/screens/TitleScreen';
import { lessMotionOf } from './src/state/settings';
import { loadSettings } from './src/state/storage';
import { FONT_FILES } from './src/ui/fonts';
import { setLessMotion } from './src/ui/motion';
import { SCENE } from './src/scenes/palette';
import { decide, exampleCallNode, noDispatch } from './src/state/proto';
import { C } from './src/ui/theme';

type Screen = 'title' | 'map' | 'call' | 'insert' | 'desk' | 'about';

export default function App() {
  // шрифты студии лежат в сборке — грузятся мгновенно; не загрузились — игра идёт системным шрифтом
  const [fontsReady, fontsError] = useFonts(FONT_FILES);
  const [screen, setScreen] = useState<Screen>('title');
  // видеовставка «бригада выезжает» — один раз за смену (docs/08-game-design.md, §9)
  const departed = useRef(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadSettings(), AccessibilityInfo.isReduceMotionEnabled().catch(() => false)]).then(([s, system]) => {
      if (alive) setLessMotion(lessMotionOf(s, system));
    });
    return () => { alive = false; };
  }, []);

  // «Назад» на телефоне — на первый экран; с первого экрана — выход из приложения
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'title') return false;
      setScreen(screen === 'call' || screen === 'insert' ? 'map' : 'title');
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
              {screen === 'title' ? <TitleScreen onMap={() => setScreen('map')} onDesk={() => setScreen('desk')} onAbout={() => setScreen('about')} /> : null}
              {screen === 'map' ? <PultScreen onBack={() => setScreen('title')} onCall={() => setScreen('call')} /> : null}
              {screen === 'call' ? (
                <CallScreen
                  onBack={() => setScreen('map')}
                  onDecide={(kind, seconds) => {
                    if (kind === 'none') {
                      noDispatch(seconds);
                      return setScreen('map');
                    }
                    // на вызов едет ближайшая свободная бригада; первый выезд смены — видеовставка
                    const sent = decide('call.41', exampleCallNode(), kind, seconds);
                    setScreen(sent !== null && !departed.current ? 'insert' : 'map');
                    departed.current = true;
                  }}
                />
              ) : null}
              {screen === 'insert' ? <InsertScreen onDone={() => setScreen('map')} /> : null}
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
