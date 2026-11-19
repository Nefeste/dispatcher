// Карта района (часть П2): пока смены нет (П5), карту можно открыть с первого экрана — посмотреть район, сдвинуть и
// приблизить. С частью П5 этот экран станет экраном смены.
import React, { useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { loadMap } from '../map/load';
import { Button, Txt } from '../ui/kit';
import { MapView } from '../ui/map/MapView';

export function MapScreen({ onBack }: { onBack: () => void }) {
  const map = useMemo(() => loadMap('nn-center'), []);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
  };
  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Txt style={styles.title}>{T.map.title}</Txt>
        <Button label={T.common.back} kind="ghost" onPress={onBack} testID="map-back" />
      </View>
      <View style={styles.map} onLayout={onLayout}>
        {size ? <MapView map={map} width={size.w} height={size.h} testID="map-view" /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  title: { flex: 1, fontWeight: '600' },
  map: { flex: 1 },
});
