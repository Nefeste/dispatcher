// из shelter: src/ui/kit.tsx @ 396daee — текст, кнопка, карточка на токенах студии (src/ui/theme.ts).
// Изменено (премиум-отделка 22.11.2026; docs/13-art.md, §7): всё — тёмная программа диспетчерской на стекле поверх
// зала (цвета — src/scenes/palette.ts, «горница вечером» брендбука); у кнопки отклик на палец; экран программы с
// фоном зала, заголовком и нижней полосой действий; переключатель, плитка числа.
import React from 'react';
import { ScrollView, type StyleProp, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { tick } from '../audio/feedback';
import { GLASS, UI } from '../scenes/palette';
import { Appear, Press, useEased } from './anim';
import { Backdrop } from './Backdrop';
import { C, G, R, S, TOUCH } from './theme';
import { FONTS } from './fonts';
import { useTextScale } from './textScale';

/**
 * Начертание — отдельный файл шрифта: жирность из стиля превращается в семейство Onest нужной
 * толщины (на Android `fontWeight` у своего шрифта не выбирает файл). Заголовок — Kurale, без жирности.
 */
function face(style: TextStyle | undefined, title: boolean): TextStyle {
  if (title) return { fontFamily: FONTS.title, fontWeight: 'normal' };
  const w = String(style?.fontWeight ?? '400');
  if (w === 'bold' || Number(w) >= 600) return { fontFamily: FONTS.bold, fontWeight: 'normal' };
  if (Number(w) === 500) return { fontFamily: FONTS.medium, fontWeight: 'normal' };
  return { fontFamily: FONTS.body };
}

/** Размер и высота строки — по ступени размера текста (src/ui/textScale.ts). */
function scaled(style: TextStyle, k: number): TextStyle {
  if (k === 1) return {};
  const out: TextStyle = {};
  if (typeof style.fontSize === 'number') out.fontSize = Math.round(style.fontSize * k);
  if (typeof style.lineHeight === 'number') out.lineHeight = Math.round(style.lineHeight * k);
  return out;
}

/** `fixed` — размер не растёт со ступенью текста: логотип. */
export function Txt({ children, style, dim, title, testID, numberOfLines, fixed }: { children: React.ReactNode; style?: StyleProp<TextStyle>; dim?: boolean; title?: boolean; testID?: string; numberOfLines?: number; fixed?: boolean }) {
  const scale = useTextScale();
  const k = fixed ? 1 : scale;
  const own = StyleSheet.flatten(style) as TextStyle | undefined;
  const flat = StyleSheet.flatten([styles.text, dim && styles.dim, title && styles.title, own]) as TextStyle;
  return <Text testID={testID} numberOfLines={numberOfLines} style={[flat, scaled(flat, k), face(own, !!title)]}>{children}</Text>;
}

/** Мелкая подпись раздела с разрядкой: «Главная ошибка», «Вызовы смены». */
export function Overline({ children, color, testID }: { children: string; color?: string; testID?: string }) {
  return <Txt testID={testID} style={[styles.overline, color ? { color } : null]}>{children}</Txt>;
}

export type ButtonKind = 'primary' | 'ghost' | 'onDark' | 'quiet';

/** Кнопка. Главная — кумач, на экране одна (брендбук); остальные — стекло с линией; «тихая» — только текст. */
export function Button({ label, onPress, kind = 'primary', disabled, testID, small }: { label: string; onPress: () => void; kind?: ButtonKind; disabled?: boolean; testID?: string; small?: boolean }) {
  const k = useTextScale();
  const ghost = kind === 'ghost' || kind === 'onDark';
  return (
    <Press
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { tick(); onPress(); }}
      style={[styles.button, small && styles.small, ghost && styles.ghost, kind === 'quiet' && styles.quiet, disabled && styles.disabled]}
      pressedStyle={kind === 'primary' ? styles.primaryDown : styles.ghostDown}>
      <Text style={[styles.buttonText, kind !== 'primary' && styles.ghostText, kind === 'quiet' && styles.quietText, small && styles.smallText, scaled(small ? styles.smallText : styles.buttonText, k)]}>{label}</Text>
    </Press>
  );
}

export function Card({ children, style, onPress, testID, accent }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string; accent?: string }) {
  const edge = accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null;
  if (!onPress) return <View testID={testID} style={[styles.card, edge, style]}>{children}</View>;
  return (
    <Press testID={testID} onPress={() => { tick(); onPress(); }} style={[styles.card, edge, style]} pressedStyle={styles.ghostDown}>
      {children}
    </Press>
  );
}

/** Нажимаемая строка списка на стекле: смена недели, вызов разбора, настройка. */
export function Row({ children, onPress, disabled, style, testID, label, role = 'button', checked }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; testID?: string; label?: string; role?: 'button' | 'switch'; checked?: boolean }) {
  return (
    <Press
      testID={testID}
      disabled={disabled}
      onPress={() => { tick(); onPress(); }}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={role === 'switch' ? { checked: !!checked } : { disabled: !!disabled }}
      style={[styles.card, styles.row, disabled && styles.locked, style]}
      pressedStyle={styles.ghostDown}>
      {children}
    </Press>
  );
}

/** Переключатель: бегунок и слово — цвет не единственный знак (§12 геймдизайна). */
export function Toggle({ on, word }: { on: boolean; word: string }) {
  const t = useEased(on ? 1 : 0, 160);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * 18 }] }));
  return (
    <View style={styles.toggle}>
      <Txt style={on ? styles.toggleOn : styles.toggleOff}>{word}</Txt>
      <View style={[styles.track, on && styles.trackOn]}>
        <Animated.View style={[styles.knob, on && styles.knobOn, knob]} />
      </View>
    </View>
  );
}

/** Плитка числа на итоге: число крупно, подпись под ним. */
export function Stat({ value, label, tone, testID }: { value: string; label: string; tone?: string; testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <Txt style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Txt>
      <Txt dim style={styles.statLabel}>{label}</Txt>
    </View>
  );
}

/** Полоса доли: сколько из скольких. Заполняется плавно; с «Меньше движения» — сразу. */
export function Meter({ share, color = UI.green, height = 6 }: { share: number; color?: string; height?: number }) {
  const t = useEased(Math.min(1, Math.max(0, share)), 700);
  const fill = useAnimatedStyle(() => ({ width: `${t.value * 100}%` }));
  return (
    <View style={[styles.meter, { height, borderRadius: height / 2 }]}>
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color }, fill]} />
    </View>
  );
}

/**
 * Экран программы (заглавный — свой): зал за стеклом, заголовок Kurale, прокрутка, внизу — полоса действий, всегда на
 * виду и под большим пальцем. Части появляются по очереди; с «Меньше движения» — сразу.
 */
export function Screen({ title, lead, overline, children, footer, testID, scrollID }: { title: string; lead?: string; overline?: string; children: React.ReactNode; footer?: React.ReactNode; testID?: string; scrollID?: string }) {
  return (
    <View style={styles.screen} testID={testID}>
      <Backdrop />
      <ScrollView style={styles.flex} contentContainerStyle={styles.screenIn} testID={scrollID}>
        <Appear style={styles.head}>
          {overline ? <Overline color={UI.amber}>{overline}</Overline> : null}
          <Txt title style={styles.screenTitle}>{title}</Txt>
          {lead ? <Txt dim>{lead}</Txt> : null}
        </Appear>
        <Appear delay={90} style={styles.body}>{children}</Appear>
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  text: { color: UI.text, fontSize: S.body, lineHeight: 24 },
  dim: { color: UI.dim, fontSize: S.small, lineHeight: 20 },
  title: { fontSize: S.title, lineHeight: 34 },
  overline: { color: UI.dim, fontSize: 13, lineHeight: 18, letterSpacing: 0.8, fontWeight: '600' },
  button: { minHeight: 52, backgroundColor: C.kumach, borderRadius: R.button, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  small: { minHeight: TOUCH, paddingVertical: 10, paddingHorizontal: 14 },
  ghost: { backgroundColor: GLASS.panel, borderColor: UI.line },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  disabled: { opacity: 0.45 },
  primaryDown: { backgroundColor: '#8f1126' },
  ghostDown: { backgroundColor: GLASS.pressed },
  buttonText: { color: C.kumachInk, fontSize: S.body, lineHeight: 22, fontFamily: FONTS.bold, textAlign: 'center' },
  ghostText: { color: UI.text, fontFamily: FONTS.medium },
  quietText: { color: UI.dim },
  smallText: { fontSize: S.small, lineHeight: 20 },
  card: { backgroundColor: GLASS.panel, borderRadius: R.card, borderWidth: 1, borderColor: UI.line, padding: 14, gap: 6 },
  row: { minHeight: 56 },
  locked: { opacity: 0.62 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: G.s },
  toggleOn: { fontSize: S.small, fontWeight: '600', color: UI.green },
  toggleOff: { fontSize: S.small, color: UI.dim },
  track: { width: 44, height: 26, borderRadius: 13, borderWidth: 1, borderColor: UI.line, backgroundColor: UI.bg, padding: 3 },
  trackOn: { backgroundColor: 'rgba(127,179,163,0.28)', borderColor: UI.green },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: UI.dim },
  knobOn: { backgroundColor: UI.text },
  stat: { flex: 1, minWidth: 96, backgroundColor: GLASS.panel, borderRadius: R.card, borderWidth: 1, borderColor: UI.line, paddingVertical: 12, paddingHorizontal: 12, gap: 2 },
  statValue: { fontSize: S.title, lineHeight: 34, fontWeight: '600' },
  statLabel: { fontSize: 13, lineHeight: 17 },
  meter: { backgroundColor: UI.bg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: UI.line },
  screen: { flex: 1 },
  screenIn: { padding: G.xl - 4, paddingTop: 36, paddingBottom: G.xl, gap: G.l, width: '100%', maxWidth: 560, alignSelf: 'center' },
  head: { gap: G.s },
  body: { gap: G.m },
  screenTitle: { fontSize: S.hero - 2, lineHeight: 42 },
  footer: { paddingHorizontal: G.xl - 4, paddingTop: G.m, paddingBottom: G.l, gap: G.s, borderTopWidth: 1, borderTopColor: UI.line, backgroundColor: GLASS.window, width: '100%', maxWidth: 560, alignSelf: 'center' },
});
