// Рабочее место на экране: expo-gl (WebGL 2 поверх OpenGL ES) и обычный Three.js WebGLRenderer — как вариант «WebGL»
// пробы 3D (probe-3d: src/scenes/gl/GLScene.tsx @ 57b1e33). Экраны мониторов рисует Skia после загрузки шрифта.
// Палец двигает взгляд: влево-вправо до 30°, вверх-вниз до 12°.
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import * as THREE from 'three';
import { loadMap } from '../../map/load';
import { onestFace } from './font';
import { buildDesk } from './scene';
import { SCREENS } from '../../art/desk.gen';
import { callScreen, genericScreen, mapScreen, wallScreen } from './screens';

const YAW = 30;
const PITCH = 12;

export function DeskView({ onFps, onReady, onError }: { onFps: (fps: number) => void; onReady: () => void; onError: (e: string) => void }) {
  // взгляд — общие значения Reanimated: жест меняет их на потоке интерфейса, цикл кадров читает
  const yaw = useSharedValue(0);
  const pitch = useSharedValue(0);
  const start = useSharedValue([0, 0]);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const pan = Gesture.Pan()
    .onStart(() => {
      'worklet';
      start.set([yaw.get(), pitch.get()]);
    })
    .onUpdate(e => {
      'worklet';
      const s0 = start.get();
      yaw.set(Math.max(-YAW, Math.min(YAW, s0[0] - e.translationX * 0.12)));
      pitch.set(Math.max(-PITCH, Math.min(PITCH, s0[1] + e.translationY * 0.08)));
    });

  const create = (gl: ExpoWebGLRenderingContext) => {
    try {
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      // Three.js ждёт холст: у expo-gl его нет — хватает размеров и пустых обработчиков
      const canvas = { width: w, height: h, clientWidth: w, clientHeight: h, style: {}, addEventListener() {}, removeEventListener() {}, getContext: () => gl } as unknown as HTMLCanvasElement;
      const renderer = new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext, antialias: true });
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      const desk = buildDesk();
      desk.setAspect(w / h);
      let alive = true;
      void onestFace().then(face => {
        if (!alive) return;
        const map = loadMap('nn-center');
        desk.setScreen('mon_call', callScreen(face, 1024, 580));
        desk.setScreen('mon_map', mapScreen(map, face, 1024, 580));
        desk.setScreen('videowall', wallScreen(map, face, 1536, 656));
        // соседи: программа без слов
        SCREENS.forEach((s, i) => { if (s.name.startsWith('nb')) desk.setScreen(s.name, genericScreen(256, 148, i)); });
        onReady();
      }).catch(e => onError(String((e as Error)?.message ?? e)));
      let frames = 0;
      let last = Date.now();
      let raf = 0;
      const tick = () => {
        if (!alive) return;
        desk.look(yaw.get(), pitch.get());
        renderer.render(desk.scene, desk.camera);
        gl.endFrameEXP();
        frames++;
        const now = Date.now();
        if (now - last >= 1000) {
          onFps(Math.round((frames * 1000) / (now - last)));
          frames = 0;
          last = now;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      stop.current = () => {
        alive = false;
        cancelAnimationFrame(raf);
        desk.dispose();
        renderer.dispose();
      };
    } catch (e) {
      onError(String((e as Error)?.message ?? e));
    }
  };

  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={create} testID="desk-gl" />
      </View>
    </GestureDetector>
  );
}
