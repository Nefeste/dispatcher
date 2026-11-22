// из votchina: src/ui/ErrorBoundary.tsx @ 83b344d — граница ошибок (путь к 1.0, часть В1): упавший экран заменяется
// честным «Что-то пошло не так» с «Сообщить об ошибке», а не пустым экраном; ошибка — в журнал сбоев. Стоит вокруг
// экранов внутри корня, с ключом экрана: идущая смена живёт выше (src/state/session.ts) и сохранена — с заглавного её
// можно продолжить. Изменено: свои кнопки и слова, отчёт — экран «Сообщить об ошибке».
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { T } from '../i18n';
import { logError } from '../state/crashlog';
import { SCENE } from '../scenes/palette';
import { Button, Txt } from './kit';

interface Props { children: React.ReactNode; onHome: () => void; onReport: () => void }

export class ErrorBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  /** Сама сбрасывается: упал заглавный экран — экран не меняется, и ключ границу не пересоздаст. */
  private home = () => {
    this.setState({ failed: false });
    this.props.onHome();
  };

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const where = (info.componentStack ?? '').split('\n').filter(Boolean).slice(0, 4).map(s => s.trim()).join(' < ');
    logError('render', error, where);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const W = T.crash;
    return (
      <ScrollView style={styles.back} contentContainerStyle={styles.root} testID="crash-screen">
        <Txt title>{W.title}</Txt>
        <Txt>{W.text}</Txt>
        <Button label={T.about.report} onPress={this.props.onReport} testID="crash-report" />
        <Button label={W.home} kind="ghost" onPress={this.home} testID="crash-home" />
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  // без картинки зала и без движения: экран сбоя не должен упасть сам
  back: { flex: 1, backgroundColor: SCENE.hallTop },
  root: { padding: 24, paddingTop: 48, gap: 12 },
});
