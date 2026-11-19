// Сцена «Пульт» как экран (ADR 0009; часть П3): живая карта района на мониторе, на ней — подстанции, больницы, вызовы
// и бригады, которые едут по улицам; телефон и рация на столе. Часы пробной смены идут сами (src/state/proto.ts):
// касание часов — пауза, касание скорости — ×1, ×2, ×4. Телефон принимает эталонный звонок.
import React, { useEffect, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { pointAt } from '../engine/road/pos';
import { T } from '../i18n';
import { CrewLayer } from '../scenes/pult/CrewLayer';
import { PultScene } from '../scenes/pult/PultScene';
import { type Proto, protoState, SHIFT_START, SPEEDS, setSpeed, tick, togglePause, useProto } from '../state/proto';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';

/** Где бригады сейчас — точки карты по очереди x, y: едущая — на пути, стоящая — в узле. */
function positions(p: Proto): number[] {
  const out: number[] = [];
  for (const c of p.crews) {
    if (c.route) {
      const [x, y] = pointAt(p.map, c.route, p.t);
      out.push(x, y);
    } else {
      out.push(p.map.nodes.x[c.at], p.map.nodes.y[c.at]);
    }
  }
  return out;
}

export function PultScreen({ onBack, onCall }: { onBack: () => void; onCall: () => void }) {
  const proto = useProto();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const pos = useSharedValue<number[]>(positions(protoState()));
  // часы смены: каждый кадр — настоящее время со скоростью смены; место бригад — в общее значение для карты
  useEffect(() => {
    let raf = 0;
    let last = Date.now();
    const frame = () => {
      const now = Date.now();
      tick(Math.min(250, now - last));
      last = now;
      pos.set(positions(protoState()));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [pos]);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
  };
  const waiting = proto.calls.filter(c => !c.crew).map(c => ({ id: c.id, kind: c.form, minutes: Math.floor((proto.t - c.at) / 60000) }));
  const nextSpeed = () => {
    if (proto.speed === 0) return togglePause();
    const i = SPEEDS.indexOf(proto.speed);
    setSpeed(SPEEDS[i + 1 < SPEEDS.length ? i + 1 : 1]);
  };
  return (
    <View style={styles.root} onLayout={onLayout}>
      {size ? (
        <PultScene
          width={size.w}
          height={size.h}
          map={proto.map}
          clock={SHIFT_START + Math.floor(proto.t / 1000)}
          speed={proto.speed}
          line={proto.line}
          waiting={waiting}
          radio={proto.radio}
          overlay={zoom => <CrewLayer proto={proto} pos={pos} zoom={zoom} />}
          onPhone={onCall}
          onRadio={() => {}}
          onClock={togglePause}
          onSpeed={nextSpeed}
        />
      ) : null}
      <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" testID="map-back">
        <Txt style={styles.backText}>{T.common.back}</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101315' },
  back: { position: 'absolute', left: 8, bottom: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(20,26,31,0.7)' },
  backText: { color: '#e6e9e4', fontSize: 13, fontFamily: FONTS.medium },
});
