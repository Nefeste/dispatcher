// Видеовставка (ADR 0009; docs/08-game-design.md, §9 и §11): короткий ролик из Blender (blender/insert.py) на весь
// экран, без звука и без кнопок проигрывателя. Касание пропускает ролик. При «Меньше движения» — один кадр вместо
// ролика. Ролик не проигрался (нет кодека, ошибка) — тоже кадр: вставка никогда не держит игрока.
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { T } from '../../i18n';
import { FONTS } from '../../ui/fonts';
import { Txt } from '../../ui/kit';
import { useLessMotion } from '../../ui/motion';
import { SCENE } from '../palette';

/** Сколько ждать конца ролика сверх его длины, мс; кадр вместо ролика держится столько же. */
const GRACE = 1500;

export function InsertView({ video, still, seconds, onDone }: { video: number; still: number; seconds: number; onDone: () => void }) {
  const less = useLessMotion();
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  const player = useVideoPlayer(less ? null : video, p => {
    p.muted = true;
    p.loop = false;
    p.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    const sub = player.addListener('playToEnd', finish);
    return () => sub.remove();
  });
  useEffect(() => {
    const t = setTimeout(finish, (less ? 0 : seconds * 1000) + GRACE);
    return () => clearTimeout(t);
  });
  const failed = status === 'error';
  return (
    <Pressable style={styles.root} onPress={finish} accessibilityRole="button" accessibilityLabel={T.insert.skip} testID="insert">
      {less || failed ? (
        <Image source={still} style={StyleSheet.absoluteFill} resizeMode="cover" testID="insert-still" />
      ) : (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} testID="insert-video" />
        </View>
      )}
      <Txt style={styles.skip}>{T.insert.skip}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCENE.hallTop },
  skip: { position: 'absolute', bottom: 16, alignSelf: 'center', color: 'rgba(230,233,228,0.75)', fontSize: 13, fontFamily: FONTS.body },
});
