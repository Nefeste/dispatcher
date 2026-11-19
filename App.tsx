// Корень: экраны переключаются состоянием, без роутера (docs/02-architecture.md, §2). При запуске — шрифты
// студии и настройки; «Меньше движения» — выбор игрока или система (ADR устава 0023, правило 6).
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, BackHandler, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AboutScreen } from './src/screens/AboutScreen';
import { TitleScreen } from './src/screens/TitleScreen';
import { lessMotionOf } from './src/state/settings';
import { loadSettings } from './src/state/storage';
import { FONT_FILES } from './src/ui/fonts';
import { setLessMotion } from './src/ui/motion';
import { C } from './src/ui/theme';

type Screen = 'title' | 'about';

export default function App() {
  // шрифты студии лежат в сборке — грузятся мгновенно; не загрузились — игра идёт системным шрифтом
  const [fontsReady, fontsError] = useFonts(FONT_FILES);
  const [screen, setScreen] = useState<Screen>('title');

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
      setScreen('title');
      return true;
    });
    return () => sub.remove();
  }, [screen]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <View style={styles.root}>
          {fontsReady || fontsError ? (
            <>
              {screen === 'title' ? <TitleScreen onAbout={() => setScreen('about')} /> : null}
              {screen === 'about' ? <AboutScreen onBack={() => setScreen('title')} /> : null}
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: C.linen } });
