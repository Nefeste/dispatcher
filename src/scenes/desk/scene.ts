// Сцена рабочего места на Three.js (docs/13-art.md, «Рабочее место»; ADR 0024 устава — 3D на телефоне через expo-gl):
// модель из Blender (src/art/desk.gen.ts) с затенением в вершинах, свет зала вечером и лампы на столе, экраны —
// плоскости с картинками Skia (screens.ts), светятся сами. Камера — глаза диспетчера в кресле; поворот взгляда — look().
// По образцу probe-3d: src/scenes/gl/scene.ts и src/scenes/hall.ts @ 57b1e33.
import * as THREE from 'three';
import { DESK, LAMP, SCREENS } from '../../art/desk.gen';
import { COLORS, GLOWING, REGIONS, linear } from '../../art/palette';
import type { Pixels } from './screens';

const rad = (d: number) => (d * Math.PI) / 180;

/** Глаза диспетчера и куда он смотрит, метры. */
export const EYE = [0, 1.44, 1.5] as const;
export const TARGET = [0, 1.16, -0.36] as const;

export interface DeskScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  tris: number;
  setAspect(a: number): void;
  /** поворот взгляда от исходного, градусы */
  look(yaw: number, pitch: number): void;
  setScreen(name: string, px: Pixels): void;
  dispose(): void;
}

/** Треугольники модели одной группы: освещаемые или светящиеся сами (`glow`, без затенения). */
function deskGeometry(glow: boolean) {
  const all = DESK.reg.length;
  const pick: number[] = [];
  for (let t = 0; t < all; t++) if (GLOWING.has(DESK.reg[t]) === glow) pick.push(t);
  const tris = pick.length;
  const pos = new Float32Array(tris * 9);
  const nrm = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9);
  const lin = REGIONS.map(r => linear(COLORS[r]));
  pick.forEach((t, i) => {
    const c = lin[DESK.reg[t]];
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k, o = (i * 3 + k) * 3;
      for (let j = 0; j < 3; j++) {
        pos[o + j] = DESK.pos[v * 3 + j];
        nrm[o + j] = DESK.nrm[t * 3 + j];
      }
      const ao = glow ? 1 : (DESK.ao[v] / 255) ** 2.2;
      col[o] = c[0] * ao;
      col[o + 1] = c[1] * ao;
      col[o + 2] = c[2] * ao;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { geo, tris };
}

export function buildDesk(): DeskScene {
  const disposables: { dispose(): void }[] = [];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1f272c');
  // зал вечером: рассеянный холодный свет сверху, тёплая лампа на столе
  // снизу — отражённый от пола и столов свет, иначе потолок чёрный
  scene.add(new THREE.HemisphereLight(0xc8d4de, 0x6b6358, 1.1));
  const top = new THREE.DirectionalLight(0xe6edf2, 0.9);
  top.position.set(-1.5, 4, 2.5);
  scene.add(top);
  const lamp = new THREE.PointLight(0xffd59a, 2.4, 2.4, 1.4);
  lamp.position.set(LAMP[0], LAMP[1], LAMP[2]);
  scene.add(lamp);

  const lit = deskGeometry(false), glow = deskGeometry(true);
  const litMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  scene.add(new THREE.Mesh(lit.geo, litMat), new THREE.Mesh(glow.geo, glowMat));
  disposables.push(lit.geo, litMat, glow.geo, glowMat);

  // экраны: плоскости над рамками мониторов; картинка Skia идёт строками сверху вниз — переворачиваем v
  const screens = new Map<string, THREE.Mesh>();
  for (const s of SCREENS) {
    const g = new THREE.PlaneGeometry(s.w, s.h);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const m = new THREE.MeshBasicMaterial({ color: 0x15191d });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = rad(s.yaw);
    mesh.rotation.x = rad(s.pitch);
    scene.add(mesh);
    screens.set(s.name, mesh);
    disposables.push(g, m);
  }

  const camera = new THREE.PerspectiveCamera(72, 9 / 19.5, 0.05, 30);
  camera.position.set(EYE[0], EYE[1], EYE[2]);
  const dx = TARGET[0] - EYE[0], dy = TARGET[1] - EYE[1], dz = TARGET[2] - EYE[2];
  const baseYaw = Math.atan2(dx, -dz);
  const basePitch = Math.atan2(dy, Math.hypot(dx, dz));
  const look = (yaw: number, pitch: number) => {
    const y = baseYaw + rad(yaw), p = basePitch + rad(pitch);
    camera.lookAt(EYE[0] + Math.sin(y) * Math.cos(p), EYE[1] + Math.sin(p), EYE[2] - Math.cos(y) * Math.cos(p));
  };
  look(0, 0);

  return {
    scene,
    camera,
    tris: lit.tris + glow.tris,
    setAspect(ratio) {
      camera.aspect = ratio;
      camera.updateProjectionMatrix();
    },
    look,
    setScreen(name, px) {
      const mesh = screens.get(name);
      if (!mesh) return;
      const tex = new THREE.DataTexture(px.rgba, px.w, px.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      const old = mesh.material as THREE.MeshBasicMaterial;
      old.map?.dispose();
      old.map = tex;
      old.color.set(0xffffff);
      old.toneMapped = false;
      old.needsUpdate = true;
      disposables.push(tex);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
