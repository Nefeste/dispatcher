// из votchina: src/ui/dialog.tsx @ ec856e0 — окно подтверждения в стиле игры (Alert из React Native —
// системный диалог, а в веб-сборке он не делает ничего). Изменено: тема — токены студии (src/ui/theme.ts),
// кнопки — src/ui/kit.tsx, вид кнопки «danger» и «secondary» — как «primary».
import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../i18n';
import { Button, Txt } from './kit';
import { C, R } from './theme';

export interface DialogAction { label: string; kind?: 'primary' | 'ghost'; onPress?: () => void }
export interface DialogSpec {
  title: string;
  text?: string;
  actions: DialogAction[];
  /** последняя кнопка во всю ширину, обычно «Отмена» */
  cancel?: string;
  /** закрыт самим игроком — любой кнопкой или касанием мимо */
  onDismiss?: () => void;
}

export function Dialog({ spec, onClose }: { spec: DialogSpec | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  if (!spec) return null;
  const close = () => { spec.onDismiss?.(); onClose(); };
  const run = (a: DialogAction) => { close(); a.onPress?.(); };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.box, { marginBottom: insets.bottom }]}>
          <Txt title style={styles.title}>{spec.title}</Txt>
          {spec.text ? <Txt dim>{spec.text}</Txt> : null}
          <View style={styles.actions}>
            {spec.actions.map(a => (
              <Button key={a.label} label={a.label} kind={a.kind ?? 'primary'} onPress={() => run(a)} />
            ))}
            <Button label={spec.cancel ?? T.common.cancel} kind="ghost" onPress={close} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  center: { flex: 1, justifyContent: 'center', padding: 22 },
  // на широком экране окно не растягивается во всю ширину монитора
  box: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: R.card, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, padding: 18, gap: 8, elevation: 6 },
  title: { fontSize: 21, lineHeight: 28 },
  actions: { gap: 8, marginTop: 8 },
});
