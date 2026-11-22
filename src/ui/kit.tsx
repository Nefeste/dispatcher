// из shelter: src/ui/kit.tsx @ 396daee — текст, кнопка, карточка на токенах студии (src/ui/theme.ts).
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import { C, R, S } from './theme';
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

export function Txt({ children, style, dim, title, testID }: { children: React.ReactNode; style?: TextStyle; dim?: boolean; title?: boolean; testID?: string }) {
  const k = useTextScale();
  const flat = StyleSheet.flatten([styles.text, dim && styles.dim, title && styles.title, style]) as TextStyle;
  return <Text testID={testID} style={[flat, scaled(flat, k), face(style, !!title)]}>{children}</Text>;
}

export function Button({ label, onPress, kind = 'primary', disabled, testID }: { label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'onDark'; disabled?: boolean; testID?: string }) {
  const k = useTextScale();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, kind === 'ghost' && styles.ghost, kind === 'onDark' && styles.onDark, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, kind === 'ghost' && styles.ghostText, kind === 'onDark' && styles.onDarkText, scaled(styles.buttonText, k)]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style, onPress, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string }) {
  if (!onPress) return <View testID={testID} style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { color: C.ink, fontSize: S.body, lineHeight: 24 },
  dim: { color: C.inkSoft, fontSize: S.small, lineHeight: 20 },
  title: { fontSize: S.title, lineHeight: 34 },
  button: { backgroundColor: C.kumach, borderRadius: R.button, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center' },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  buttonText: { color: C.kumachInk, fontSize: S.body, fontFamily: FONTS.bold, textAlign: 'center' },
  ghostText: { color: C.ink },
  // на тёмной сцене (рабочее место): прозрачная, светлая рамка и текст
  onDark: { backgroundColor: 'rgba(20,26,31,0.55)', borderWidth: 1, borderColor: 'rgba(230,233,228,0.5)' },
  onDarkText: { color: '#e6e9e4' },
  card: { backgroundColor: C.paper, borderRadius: R.card, borderWidth: 1, borderColor: C.line, padding: 14, gap: 6 },
});
