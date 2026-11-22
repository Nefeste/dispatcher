// Сцена «Разговор» как экран (ADR 0009; часть П5): открытый вызов смены (src/state/session.ts). Вопрос — команда
// смены, часы сдвигаются на его цену (ADR 0003); решение — форма вызова; потом — кого послать или оставить ждать.
// Первый выезд смены — видеовставка (onSent).
import React, { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { CallScene } from '../scenes/call/CallScene';
import { SCENE } from '../scenes/palette';
import { callView } from '../state/callView';
import { command, tick, useSession } from '../state/session';
import { callHint } from '../state/tutorial';
import { T } from '../i18n';
import { textScale } from '../ui/textScale';
import { HintBar } from '../scenes/hint';
import { callLayout } from '../scenes/call/layout';
import { Dialog, type DialogSpec } from '../ui/dialog';

export function CallScreen({ onDone, onSent }: { onDone: () => void; onSent: () => void }) {
  const x = useSession();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // «Без выезда» закрывает вызов — с подтверждением (игра владельца 22.11.2026: вернуться было нельзя)
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
  };
  const view = x?.s.open ? callView(x.ctx, x.s, x.s.open) : null;
  const hint = x?.s.open ? callHint(x.ctx, x.s, x.s.open) : null;
  // время игры идёт и в разговоре: часы смены стоят, а настоящие — нет
  useEffect(() => {
    const id = setInterval(() => tick(0), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.root} onLayout={onLayout}>
      {size && view ? (
        <CallScene
          key={view.id}
          width={size.w}
          height={size.h}
          view={view}
          onAsk={q => command({ c: 'ask', q })}
          onForm={kind => {
            if (kind === 'none') {
              setDialog({
                title: T.call.noneAsk,
                text: T.call.noneText,
                actions: [{ label: T.call.noneYes, onPress: () => { if (!command({ c: 'form', form: 'none' })) onDone(); } }],
                cancel: T.call.noneNo,
              });
              return;
            }
            command({ c: 'form', form: kind });
          }}
          onSend={crew => {
            if (!command({ c: 'send', call: view.id, crew })) onSent();
          }}
          onHold={() => {
            if (!command({ c: 'hold', call: view.id })) onDone();
          }}
          onPass={() => {
            if (!command({ c: 'pass', call: view.id })) onDone();
          }}
        />
      ) : null}
      <Dialog spec={dialog} onClose={() => setDialog(null)} />
      {size && hint ? <HintBar text={T.tutorial[hint]} top={callLayout(size.w, size.h, textScale()).tabs.y - 70} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: SCENE.hallTop } });
