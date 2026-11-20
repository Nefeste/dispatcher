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
import { CallReviewScreen } from './src/screens/CallReviewScreen';
import { LoadingScreen } from './src/screens/LoadingScreen';
import { WeekScreen } from './src/screens/WeekScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ReviewScreen } from './src/screens/ReviewScreen';
import { PultScreen } from './src/screens/PultScreen';
import { BenchScreen } from './src/screens/BenchScreen';
import { DeskScreen } from './src/screens/DeskScreen';
import { type InsertKind, InsertScreen } from './src/screens/InsertScreen';
import { TitleScreen } from './src/screens/TitleScreen';
import { cue, preloadSounds, setFeedback } from './src/audio/feedback';
import { mark } from './src/state/marks';
import { hideSplash, keepSplash } from './src/state/splash';
import { closeShift, resumeShift, setCue, setPace, startShift, FIRST_SHIFT, savedShift } from './src/state/session';
import { DEFAULT_SETTINGS, lessMotionOf, type Settings } from './src/state/settings';
import { loadSettings } from './src/state/storage';
import { FONT_FILES } from './src/ui/fonts';
import { setLessMotion } from './src/ui/motion';
import { SCENE } from './src/scenes/palette';
import { C } from './src/ui/theme';

type Screen = 'title' | 'week' | 'loading' | 'map' | 'call' | 'insert' | 'end' | 'callReview' | 'desk' | 'bench' | 'settings' | 'about';

keepSplash();
setCue(cue);
// сценарий в браузере ускоряет часы смены: ?pace=50, и «Замер» — короткий: ?bench=quick (только веб-сборка; на
// телефоне адресной строки нет)
const query = Platform.OS === 'web' && typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
if (query) setPace(Number(query.get('pace') ?? 1));
const quickBench = query?.get('bench') === 'quick';

export default function App() {
  // шрифты студии лежат в сборке — грузятся мгновенно; не загрузились — игра идёт системным шрифтом
  const [fontsReady, fontsError] = useFonts(FONT_FILES);
  const [screen, setScreen] = useState<Screen>('title');
  // какой вызов открыт в разборе
  const [reviewed, setReviewed] = useState<string | null>(null);
  // видеовставки — по одному разу за смену (docs/08-game-design.md, §9): «начало смены» после загрузки новой смены,
  // «бригада выезжает» после первого решения
  const departed = useRef(false);
  const [insert, setInsert] = useState<InsertKind>('depart');
  const settings = useRef<Settings>({ ...DEFAULT_SETTINGS });
  // «Меньше движения» системы — для настроек: не выбрано игроком — как в телефоне
  const systemMotion = useRef(false);
  // что показать в настройках: снимок на момент открытия
  const [settingsOpen, setSettingsOpen] = useState<{ s: Settings; system: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadSettings(), AccessibilityInfo.isReduceMotionEnabled().catch(() => false)]).then(([s, system]) => {
      if (!alive) return;
      settings.current = s;
      systemMotion.current = system;
      setLessMotion(lessMotionOf(s, system));
      setFeedback(s);
      preloadSounds();
    });
    return () => { alive = false; };
  }, []);
  // заставка уходит на первом кадре заглавного экрана, когда шрифты готовы (src/state/splash.ts)
  const fontsDone = fontsReady || fontsError !== null;
  useEffect(() => {
    if (!fontsDone) return;
    const id = requestAnimationFrame(hideSplash);
    return () => cancelAnimationFrame(id);
  }, [fontsDone]);
  const toMap = useCallback(() => setScreen('map'), []);
  // загрузка кончилась: продолжить сохранённую смену или начать новую
  const resuming = useRef(false);
  // какую смену недели грузить (выбор смены или сохранённая)
  const [picked, setPicked] = useState(FIRST_SHIFT);
  const onLoaded = useCallback(() => {
    if (resuming.current) {
      resuming.current = false;
      departed.current = true;
      void resumeShift(settings.current.autopause).then(x => setScreen(x ? 'map' : 'title'));
      return;
    }
    departed.current = false;
    mark('loaded');
    startShift(picked, undefined, settings.current.autopause);
    setInsert('start');
    setScreen('insert');
  }, [picked]);
  const toCall = useCallback(() => setScreen('call'), []);
  const toEnd = useCallback(() => setScreen('end'), []);

  // «Назад» на телефоне — на первый экран; с первого экрана — выход из приложения
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'title') return false;
      // разговор кончается решением (§3): «Назад» его не закрывает
      if (screen === 'call') return true;
      setScreen(screen === 'insert' ? 'map' : screen === 'callReview' ? 'end' : 'title');
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
                  onStart={() => setScreen('week')}
                  onResume={() => {
                    void savedShift().then(id => {
                      if (!id) return;
                      setPicked(id);
                      resuming.current = true;
                      setScreen('loading');
                    });
                  }}
                  onDesk={() => setScreen('desk')}
                  onBench={() => setScreen('bench')}
                  onSettings={() => {
                    setSettingsOpen({ s: settings.current, system: systemMotion.current });
                    setScreen('settings');
                  }}
                  onAbout={() => setScreen('about')}
                />
              ) : null}
              {screen === 'week' ? (
                <WeekScreen
                  onPick={id => {
                    mark('startTap');
                    setPicked(id);
                    setScreen('loading');
                  }}
                  onBack={() => setScreen('title')}
                />
              ) : null}
              {screen === 'loading' ? <LoadingScreen shiftId={picked} onReady={onLoaded} /> : null}
              {screen === 'map' ? <PultScreen onBack={() => setScreen('title')} onCall={toCall} onEnd={toEnd} /> : null}
              {screen === 'call' ? (
                <CallScreen
                  onDone={toMap}
                  onSent={() => {
                    // первый выезд смены — видеовставка
                    if (departed.current) setScreen('map');
                    else {
                      setInsert('depart');
                      setScreen('insert');
                    }
                    departed.current = true;
                  }}
                />
              ) : null}
              {screen === 'insert' ? (
                <InsertScreen
                  kind={insert}
                  onDone={() => {
                    // «Замер»: пульт после вставки «начало смены» — конец загрузки смены
                    if (insert === 'start') mark('insertDone');
                    toMap();
                  }}
                />
              ) : null}
              {screen === 'end' ? (
                <ReviewScreen
                  onCall={id => { setReviewed(id); setScreen('callReview'); }}
                  onAgain={() => {
                    // «Ещё раз» — та же смена с новым зерном (§3, шаг 10)
                    closeShift();
                    setScreen('loading');
                  }}
                  onHome={() => { closeShift(); setScreen('week'); }}
                />
              ) : null}
              {screen === 'callReview' && reviewed ? <CallReviewScreen id={reviewed} onBack={() => setScreen('end')} /> : null}
              {screen === 'desk' ? <DeskScreen onBack={() => setScreen('title')} /> : null}
              {screen === 'bench' ? <BenchScreen quick={quickBench} onBack={() => setScreen('title')} /> : null}
              {screen === 'about' ? <AboutScreen onBack={() => setScreen('title')} /> : null}
              {screen === 'settings' && settingsOpen ? (
                <SettingsScreen settings={settingsOpen.s} system={settingsOpen.system} onChange={x => { settings.current = x; }} onBack={() => setScreen('title')} />
              ) : null}
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: C.linen }, dark: { backgroundColor: SCENE.hallTop } });
