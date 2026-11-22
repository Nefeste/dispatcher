# из probe-3d: blender/build.py @ 57b1e33 — части-коробки и цилиндры, затенение (AO) Cycles в цвет вершин, выгрузка
# треугольников в TS. Изменено: сцена — рабочее место диспетчера скорой (docs/13-art.md, «Эталонные кадры»); коробки и
# цилиндры можно поворачивать; экраны мониторов — не сетка, а описание (место, размер, поворот) для Three.js, который
# кладёт на них изображения, нарисованные Skia (src/scenes/desk/).
#
# Запуск: python blender/build.py (Blender как модуль Python: pip install bpy==4.5.15, Python 3.11)
# Пишет:
# - assets/models/desk.glb — модель как есть, для просмотра;
# - src/art/desk.gen.ts — треугольники в осях игры (позиции, нормаль грани, область палитры, затенение вершин),
#   экраны (SCREENS) и место лампы (LAMP).
#
# Оси. В игре x — вправо, y — вверх, z — к зрителю (диспетчер сидит в +z и смотрит в −z). В Blender вверх — Z; точка
# игры (x, y, z) в Blender — (x, −z, y). Метры. Повторяемость: случайности нет, запекание — в один поток с закреплённым
# зерном, числа округлены до 1e-4 и 1/255.
import hashlib
import json
import math
import os
import sys

import bpy
import bmesh

VERSION = '4.5.15'
if bpy.app.version_string.split(' ')[0] != VERSION:
    sys.exit(f'нужен Blender {VERSION}, а это {bpy.app.version_string}')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Области палитры — тот же порядок, что REGIONS в src/art/palette.ts
REGIONS = ['floor', 'wall', 'partition', 'desk', 'edge', 'metal', 'plastic', 'dark', 'key', 'chair', 'accent',
           'paper', 'mug', 'lamp', 'glass', 'pad', 'glow']

AO_DISTANCE = 0.6
# 256 проходов: при 64 в тенях под предметами был виден шум — пятна на столе
AO_SAMPLES = 256
AO_FLOOR = 0.35

DESK_TOP = 0.74


def g2b(x, y, z):
    return (x, -z, y)


def b2g(v):
    return (v[0], v[2], -v[1])


def rot(p, yaw=0.0, pitch=0.0, roll=0.0):
    """Поворот точки (в осях игры): сначала наклон вокруг x (pitch > 0 — верх к зрителю, нормаль экрана вниз),
    потом крен вокруг z, потом поворот вокруг y (yaw > 0 — против часовой сверху)."""
    x, y, z = p
    a = math.radians(pitch)
    y, z = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
    c = math.radians(roll)
    x, y = x * math.cos(c) - y * math.sin(c), x * math.sin(c) + y * math.cos(c)
    b = math.radians(yaw)
    x, z = x * math.cos(b) + z * math.sin(b), -x * math.sin(b) + z * math.cos(b)
    return (x, y, z)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.seed = 0
    scene.cycles.use_denoising = False
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 1
    world = bpy.data.worlds.new('world')
    scene.world = world
    return scene


PARTS = []
SCREENS = []


def part(name, region, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for r in REGIONS:
        ob.data.materials.append(bpy.data.materials.get(r) or bpy.data.materials.new(r))
    for p in ob.data.polygons:
        p.material_index = REGIONS.index(region)
    PARTS.append(ob)
    return ob


def box(name, region, w, h, d, x, y, z, grid=0.25, yaw=0.0, pitch=0.0, roll=0.0):
    """Коробка: размеры по осям игры, низ на y, середина в x, z; повороты — вокруг середины коробки; грани поделены
    сеткой — затенению есть где лечь."""
    bm = bmesh.new()
    nx, ny, nz = (max(1, math.ceil(s / grid)) for s in (w, h, d))
    sides = [
        ((1, 0, 0), (0, 1, 0), (0, 0, 1), h, d, w, ny, nz),
        ((-1, 0, 0), (0, 1, 0), (0, 0, -1), h, d, w, ny, nz),
        ((0, 1, 0), (1, 0, 0), (0, 0, -1), w, d, h, nx, nz),
        ((0, -1, 0), (1, 0, 0), (0, 0, 1), w, d, h, nx, nz),
        ((0, 0, 1), (1, 0, 0), (0, 1, 0), w, h, d, nx, ny),
        ((0, 0, -1), (-1, 0, 0), (0, 1, 0), w, h, d, nx, ny),
    ]
    cx, cy, cz = x, y + h / 2, z
    for n, a, b, sa, sb, depth, na, nb in sides:
        verts = []
        for i in range(na + 1):
            row = []
            for j in range(nb + 1):
                u = -sa / 2 + sa * i / na
                v = -sb / 2 + sb * j / nb
                p = rot([n[k] * depth / 2 + a[k] * u + b[k] * v for k in range(3)], yaw, pitch, roll)
                row.append(bm.verts.new(g2b(cx + p[0], cy + p[1], cz + p[2])))
            verts.append(row)
        rn = rot(n, yaw, pitch, roll)
        for i in range(na):
            for j in range(nb):
                f = bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]))
                f.normal_update()
                fn = b2g(f.normal)
                if fn[0] * rn[0] + fn[1] * rn[1] + fn[2] * rn[2] < 0:
                    f.normal_flip()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return part(name, region, bm)


def cylinder(name, region, r, h, x, y, z, sides=12, r2=None, axis='y'):
    """Цилиндр (или усечённый конус до r2): ось y — низ на y; ось x или z — середина в (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r, radius2=r if r2 is None else r2, depth=h)
    for v in bm.verts:
        bx, by, bz = v.co  # ось конуса — z Blender
        if axis == 'y':
            v.co = g2b(x + bx, y + h / 2 + bz, z - by)
        elif axis == 'x':
            v.co = g2b(x + bz, y + bx, z - by)
        else:
            v.co = g2b(x + bx, y + by, z + bz)
    return part(name, region, bm)


def blob(name, region, rx, ry, rz, x, y, z, yaw=0.0, segments=10, rings=6):
    """Сплюснутый шар (мышь, чашки гарнитуры): полуоси по осям игры, середина в (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    for v in bm.verts:
        bx, by, bz = v.co
        p = rot((bx * rx, bz * ry, -by * rz), yaw)
        v.co = g2b(x + p[0], y + p[1], z + p[2])
    return part(name, region, bm)


def monitor(name, w, h, x, y, z, yaw=0.0, pitch=0.0):
    """Монитор: рамка, задняя крышка, экран — описание для Three.js (SCREENS)."""
    box(f'{name}_frame', 'plastic', w + 0.02, h + 0.02, 0.022, x, y - (h + 0.02) / 2, z, grid=0.12, yaw=yaw, pitch=pitch)
    back = rot((0, 0, -0.03), yaw, pitch)
    box(f'{name}_back', 'dark', w * 0.45, h * 0.5, 0.035, x + back[0], y - h * 0.25 + back[1], z + back[2], grid=0.12,
        yaw=yaw, pitch=pitch)
    front = rot((0, 0, 0.0115), yaw, pitch)
    SCREENS.append({'name': name, 'x': x + front[0], 'y': y + front[1], 'z': z + front[2], 'w': w, 'h': h,
                    'yaw': yaw, 'pitch': pitch})


def room():
    box('floor', 'floor', 8.0, 0.02, 9.0, 0, -0.02, -1.0, grid=0.5)
    box('wall_far', 'wall', 8.0, 3.2, 0.2, 0, 0, -5.1, grid=0.5)
    box('wall_left', 'wall', 0.2, 3.2, 9.0, -3.6, 0, -1.0, grid=0.5)
    box('wall_right', 'wall', 0.2, 3.2, 9.0, 3.6, 0, -1.0, grid=0.5)
    # потолок со светильниками-панелями
    box('ceiling', 'wall', 8.0, 0.05, 9.0, 0, 3.2, -1.0, grid=0.5)
    for i, (x, z) in enumerate(((-1.6, -3.4), (1.6, -3.4), (-1.6, -1.0), (1.6, -1.0), (0.0, 1.3))):
        box(f'ceiling_light{i}', 'glow', 1.2, 0.02, 0.6, x, 3.18, z, grid=0.3)
    for i, (x, z) in enumerate(((-1.6, -3.4), (1.6, -3.4), (-1.6, -1.0), (1.6, -1.0), (0.0, 1.3))):
        # рамка светильника
        box(f'ceiling_frame{i}', 'metal', 1.26, 0.012, 0.66, x, 3.188, z, grid=0.7)
    # плинтус вдоль стен, дверь зала в правой стене, доска объявлений слева — для обстановки, без источника
    box('skirt_far', 'edge', 7.0, 0.08, 0.02, 0, 0, -4.99, grid=1.0)
    box('skirt_left', 'edge', 0.02, 0.08, 8.6, -3.49, 0, -1.0, grid=1.0)
    box('skirt_right', 'edge', 0.02, 0.08, 8.6, 3.49, 0, -1.0, grid=1.0)
    box('door', 'edge', 0.04, 2.05, 0.9, 3.49, 0, -2.6, grid=0.5)
    box('door_frame_top', 'metal', 0.05, 0.06, 1.02, 3.485, 2.05, -2.6)
    for k, dz in enumerate((-0.48, 0.48)):
        box(f'door_frame{k}', 'metal', 0.05, 2.05, 0.06, 3.485, 0, -2.6 + dz, grid=0.7)
    box('door_handle', 'metal', 0.05, 0.02, 0.12, 3.45, 1.02, -2.28)
    box('board_frame', 'metal', 0.03, 0.92, 1.42, -3.49, 1.1, 0.3, grid=0.5)
    box('board', 'paper', 0.035, 0.84, 1.34, -3.487, 1.14, 0.3, grid=0.3)
    # МФУ на тумбе у левой стены — одно на пять диспетчеров (388н, прил. 8, п. 8; docs/13-art.md, «Рабочее место»)
    box('mfp_cabinet', 'edge', 0.9, 0.72, 0.5, -3.1, 0, -1.6, grid=0.3)
    box('mfp_body', 'lamp', 0.5, 0.42, 0.44, -3.1, 0.72, -1.6, grid=0.15)
    box('mfp_lid', 'plastic', 0.5, 0.06, 0.44, -3.1, 1.14, -1.6, grid=0.15)
    box('mfp_tray', 'paper', 0.3, 0.012, 0.22, -3.1, 0.9, -1.36, grid=0.1)
    # видеостена на дальней стене: рамка, экраны — описание для Three.js
    box('videowall_frame', 'dark', 4.3, 1.95, 0.08, 0, 0.95, -4.97, grid=0.4)
    SCREENS.append({'name': 'videowall', 'x': 0.0, 'y': 1.925, 'z': -4.925, 'w': 4.1, 'h': 1.75, 'yaw': 0.0, 'pitch': 0.0})
    # часы на дальней стене
    cylinder('clock', 'plastic', 0.2, 0.04, -2.7, 2.35, -4.98, sides=24, axis='z')
    cylinder('clock_face', 'paper', 0.17, 0.045, -2.7, 2.35, -4.97, sides=24, axis='z')
    box('clock_hand_h', 'dark', 0.012, 0.09, 0.01, -2.7, 2.35, -4.94)
    box('clock_hand_m', 'dark', 0.12, 0.01, 0.01, -2.65, 2.345, -4.94)


def neighbour(i, x, z, yaw):
    """Соседний стол за перегородкой: столешница, два монитора, кресло."""
    box(f'nb{i}_top', 'desk', 1.6, 0.03, 0.75, x, DESK_TOP - 0.03, z, yaw=yaw)
    for s in (-1, 1):
        p = rot((s * 0.76, 0, 0), yaw)
        box(f'nb{i}_side{s}', 'edge', 0.03, DESK_TOP - 0.03, 0.7, x + p[0], 0, z + p[2], yaw=yaw)
    for k, dx in enumerate((-0.28, 0.28)):
        p = rot((dx, 0, -0.22), yaw)
        monitor(f'nb{i}_mon{k}', 0.5, 0.29, x + p[0], 1.27, z + p[2], yaw=yaw - dx * 40)
    p = rot((0, 0, 0.55), yaw)
    box(f'nb{i}_chair', 'chair', 0.48, 0.5, 0.07, x + p[0], 0.55, z + p[2], yaw=yaw, pitch=-6)
    box(f'nb{i}_seat', 'chair', 0.48, 0.07, 0.46, x + p[0], 0.45, z + p[2] - 0.22, yaw=yaw)
    q = rot((0, 0, 0.33), yaw)
    cylinder(f'nb{i}_post', 'metal', 0.03, 0.41, x + q[0], 0.04, z + q[2], sides=8)
    k = rot((0, 0, 0.12), yaw)
    box(f'nb{i}_kbd', 'dark', 0.44, 0.016, 0.15, x + k[0], DESK_TOP, z + k[2], yaw=yaw)


def desk():
    # столешница и боковины
    # сетка столешницы мелкая: затенению под предметами есть где лечь
    box('desk_top', 'desk', 1.9, 0.03, 0.85, 0, DESK_TOP - 0.03, -0.08, grid=0.12)
    box('desk_edge', 'edge', 1.9, 0.03, 0.012, 0, DESK_TOP - 0.03, 0.35)
    for s in (-1, 1):
        box(f'desk_side{s}', 'edge', 0.03, DESK_TOP - 0.03, 0.8, s * 0.935, 0, -0.08)
    box('desk_modesty', 'edge', 1.84, 0.42, 0.02, 0, 0.28, -0.48)
    # под столом: системный блок слева, тумба с ящиками справа (388н, прил. 8, пп. 1, 12)
    box('pc_tower', 'plastic', 0.19, 0.43, 0.42, -0.62, 0.02, -0.18, grid=0.1)
    box('pc_front', 'dark', 0.17, 0.4, 0.004, -0.62, 0.035, 0.032, grid=0.1)
    cylinder('pc_led', 'accent', 0.006, 0.006, -0.62, 0.4, 0.035, sides=8, axis='z')
    box('pedestal', 'desk', 0.42, 0.6, 0.55, 0.64, 0.02, -0.12, grid=0.15)
    for k in range(3):
        box(f'pedestal_handle{k}', 'metal', 0.12, 0.012, 0.012, 0.64, 0.17 + k * 0.19, 0.155)
    # низкая перегородка перед столом — за ней зал
    box('partition', 'partition', 2.1, 1.28, 0.05, 0, 0, -0.62, grid=0.2)
    box('partition_rail', 'metal', 2.1, 0.03, 0.06, 0, 1.28, -0.62)
    # стойка на два монитора
    cylinder('mon_post', 'metal', 0.022, 0.56, 0, DESK_TOP, -0.44, sides=12)
    box('mon_clamp', 'metal', 0.08, 0.04, 0.1, 0, DESK_TOP, -0.44)
    box('mon_arm', 'metal', 0.66, 0.025, 0.03, 0, 1.12, -0.42)
    # два монитора, как на местах Московской станции: слева — опросник и карточка вызова, справа — карта с бригадами
    # («Московская медицина», 03.2024; docs/13-art.md, «Рабочее место»)
    monitor('mon_call', 0.53, 0.30, -0.285, 1.22, -0.33, yaw=16)
    monitor('mon_map', 0.53, 0.30, 0.285, 1.22, -0.33, yaw=-16)


def devices():
    # клавиатура и мышь
    box('kbd', 'dark', 0.44, 0.016, 0.15, 0, DESK_TOP, 0.07, grid=0.1, pitch=-3)
    for r in range(5):
        for c in range(15):
            if r == 4 and 4 <= c <= 9:
                continue
            box(f'key{r}_{c}', 'key', 0.022, 0.008, 0.022, -0.196 + c * 0.028, DESK_TOP + 0.014 + r * 0.0012,
                0.012 + r * 0.028, grid=0.05)
    # пробел — одна длинная клавиша в ближнем ряду
    box('key_space', 'key', 0.162, 0.008, 0.022, -0.196 + 6.5 * 0.028, DESK_TOP + 0.014 + 4 * 0.0012, 0.012 + 4 * 0.028, grid=0.2)
    box('pad', 'pad', 0.26, 0.003, 0.21, 0.36, DESK_TOP, 0.08, grid=0.07)
    blob('mouse', 'dark', 0.031, 0.019, 0.052, 0.36, DESK_TOP + 0.014, 0.08)
    cylinder('mouse_wheel', 'key', 0.006, 0.007, 0.36, DESK_TOP + 0.031, 0.06, sides=8, axis='x')
    # телефон слева: корпус, экранчик, кнопки, трубка, огонёк линии
    box('phone_base', 'plastic', 0.21, 0.05, 0.19, -0.66, DESK_TOP, -0.06, grid=0.06, pitch=12)
    box('phone_display', 'glass', 0.1, 0.004, 0.05, -0.64, DESK_TOP + 0.06, -0.1, grid=0.05, pitch=12)
    for r in range(4):
        for c in range(3):
            box(f'phone_key{r}_{c}', 'key', 0.016, 0.006, 0.014, -0.67 + c * 0.022, DESK_TOP + 0.052 - r * 0.004,
                -0.04 + r * 0.02, grid=0.05, pitch=12)
    box('phone_handset', 'dark', 0.05, 0.035, 0.21, -0.79, DESK_TOP + 0.03, -0.06, grid=0.06)
    box('phone_led', 'accent', 0.012, 0.006, 0.012, -0.585, DESK_TOP + 0.063, -0.12, grid=0.05, pitch=12)
    # рация справа: базовая станция, ручки, экранчик, антенна, тангента
    box('radio_base', 'dark', 0.25, 0.075, 0.19, 0.66, DESK_TOP, -0.14, grid=0.06)
    box('radio_display', 'glass', 0.09, 0.03, 0.004, 0.62, DESK_TOP + 0.03, -0.044, grid=0.05)
    for k, dx in enumerate((0.72, 0.76)):
        cylinder(f'radio_knob{k}', 'metal', 0.012, 0.02, dx, DESK_TOP + 0.045, -0.035, sides=10, axis='z')
    cylinder('radio_antenna', 'dark', 0.006, 0.28, 0.76, DESK_TOP + 0.075, -0.2, sides=8)
    box('radio_mic', 'plastic', 0.055, 0.09, 0.035, 0.57, DESK_TOP, 0.0, grid=0.05, pitch=-10)
    # селектор (громкоговорящая связь, 388н, прил. 8, п. 5): вид в источниках не описан — условный микрофон на стойке
    box('sel_base', 'dark', 0.11, 0.03, 0.13, 0.42, DESK_TOP, -0.2, grid=0.05)
    cylinder('sel_neck', 'metal', 0.006, 0.2, 0.42, DESK_TOP + 0.03, -0.22, sides=8)
    box('sel_head', 'dark', 0.022, 0.022, 0.06, 0.42, DESK_TOP + 0.22, -0.2, grid=0.05, pitch=-30)
    box('sel_key', 'accent', 0.03, 0.006, 0.02, 0.42, DESK_TOP + 0.03, -0.165, grid=0.05)
    # гарнитура на подставке
    cylinder('hs_stand_base', 'dark', 0.05, 0.012, -0.42, DESK_TOP, 0.02, sides=16)
    cylinder('hs_stand_pole', 'metal', 0.008, 0.2, -0.42, DESK_TOP + 0.012, 0.02, sides=8)
    for k in range(9):
        a = math.radians(-80 + k * 20)
        box(f'hs_band{k}', 'dark', 0.03, 0.012, 0.022, -0.42 + 0.075 * math.sin(a), DESK_TOP + 0.2 + 0.075 * math.cos(a),
            0.02, grid=0.05, roll=-math.degrees(a))
    for s in (-1, 1):
        cylinder(f'hs_cup{s}', 'chair', 0.035, 0.025, -0.42 + s * 0.085, DESK_TOP + 0.17, 0.02, sides=14, axis='x')
        cylinder(f'hs_pad{s}', 'dark', 0.03, 0.012, -0.42 + s * 0.068, DESK_TOP + 0.17, 0.02, sides=14, axis='x')
    box('hs_mic', 'dark', 0.008, 0.008, 0.12, -0.34, DESK_TOP + 0.15, 0.07, grid=0.05, yaw=-25)
    # лампа справа сзади
    cylinder('lamp_base', 'lamp', 0.07, 0.02, 0.8, DESK_TOP, -0.36, sides=16)
    box('lamp_arm1', 'lamp', 0.015, 0.34, 0.015, 0.8, DESK_TOP + 0.02, -0.36, pitch=18)
    box('lamp_arm2', 'lamp', 0.015, 0.015, 0.26, 0.8, DESK_TOP + 0.34, -0.28, pitch=-12)
    cylinder('lamp_head', 'lamp', 0.075, 0.1, 0.8, DESK_TOP + 0.24, -0.16, sides=16, r2=0.03)
    # лампа горит: светлый диск под абажуром
    cylinder('lamp_bulb', 'glow', 0.06, 0.004, 0.8, DESK_TOP + 0.236, -0.16, sides=16)
    # кружка, блокнот, ручка
    cylinder('mug', 'mug', 0.04, 0.1, 0.52, DESK_TOP, 0.17, sides=16)
    for k, (dy, dx, w) in enumerate(((0.068, 0.048, 0.03), (0.03, 0.062, 0.012), (0.018, 0.048, 0.03))):
        box(f'mug_handle{k}', 'mug', w, 0.012 if k != 1 else 0.05, 0.012, 0.52 + dx, DESK_TOP + dy, 0.17, grid=0.05)
    cylinder('mug_tea', 'dark', 0.034, 0.002, 0.52, DESK_TOP + 0.099, 0.17, sides=16)
    box('notepad', 'paper', 0.15, 0.008, 0.21, -0.22, DESK_TOP, 0.2, grid=0.08, yaw=8)
    cylinder('pen', 'accent', 0.004, 0.14, -0.13, DESK_TOP + 0.012, 0.2, sides=8, axis='x')
    # листки-напоминания у телефона
    box('sticky0', 'paper', 0.07, 0.002, 0.07, -0.52, DESK_TOP, 0.16, yaw=-8)
    box('sticky1', 'lamp', 0.07, 0.002, 0.07, -0.6, DESK_TOP, 0.2, yaw=12)
    # кресло диспетчера откатили вправо — место ждёт игрока; в кадре оно, только если оглядеться
    box('chair_back', 'chair', 0.5, 0.56, 0.07, 0.73, 0.56, 1.16, grid=0.12, yaw=-30, pitch=-8)
    box('chair_seat', 'chair', 0.5, 0.08, 0.48, 0.85, 0.44, 0.95, grid=0.12, yaw=-30)
    cylinder('chair_post', 'metal', 0.03, 0.4, 0.85, 0.04, 0.95, sides=10)
    # подлокотники и подголовник
    for k, sx in enumerate((-1, 1)):
        a = rot((sx * 0.27, 0, 0), yaw=-30)
        box(f'chair_arm{k}', 'dark', 0.05, 0.03, 0.3, 0.85 + a[0], 0.66, 0.95 + a[2], yaw=-30)
        box(f'chair_arm_post{k}', 'metal', 0.025, 0.16, 0.025, 0.85 + a[0], 0.5, 0.95 + a[2], yaw=-30)
    box('chair_head', 'chair', 0.3, 0.16, 0.06, 0.7, 1.16, 1.22, yaw=-30, pitch=-8)
    for k in range(5):
        a = math.radians(72 * k + 10)
        box(f'chair_leg{k}', 'dark', 0.04, 0.035, 0.3, 0.85 + 0.15 * math.sin(a), 0.03, 0.95 + 0.15 * math.cos(a),
            yaw=math.degrees(a))


def bake_ao():
    scene = bpy.context.scene
    scene.cycles.samples = AO_SAMPLES
    scene.world.light_settings.distance = AO_DISTANCE
    bpy.ops.object.select_all(action='DESELECT')
    for ob in PARTS:
        attr = ob.data.color_attributes.new('ao', 'BYTE_COLOR', 'CORNER')
        ob.data.color_attributes.active_color = attr
        ob.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    scene.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.bake(type='AO')
    for ob in PARTS:
        for c in ob.data.color_attributes['ao'].data:
            v = AO_FLOOR + (1 - AO_FLOOR) * c.color[0]
            c.color = (v, v, v, 1.0)


def triangles():
    pos, nrm, reg, ao = [], [], [], []
    for ob in PARTS:
        me = ob.data
        me.calc_loop_triangles()
        col = me.color_attributes['ao'].data
        mw = ob.matrix_world
        for tri in me.loop_triangles:
            vs = [b2g(mw @ me.vertices[i].co) for i in tri.vertices]
            ax, ay, az = (vs[1][k] - vs[0][k] for k in range(3))
            bx, by, bz = (vs[2][k] - vs[0][k] for k in range(3))
            n = (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
            ln = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1
            for v in vs:
                pos.extend(v)
            nrm.extend(c / ln for c in n)
            reg.append(tri.material_index)
            for li in tri.loops:
                ao.append(round(col[li].color[0] * 255))
    return pos, nrm, reg, ao


def fmt(xs):
    out = []
    for x in xs:
        s = ('%.4f' % round(x, 4)).rstrip('0').rstrip('.')
        out.append('0' if s in ('-0', '') else s)
    return ','.join(out)


def main():
    reset()
    room()
    desk()
    devices()
    for i, (x, z, yaw) in enumerate(((-1.95, -2.4, 12), (1.95, -2.4, -12), (-1.1, -3.7, 0), (1.1, -3.7, 0))):
        neighbour(i, x, z, yaw)
    bake_ao()
    pos, nrm, reg, ao = triangles()
    os.makedirs(os.path.join(ROOT, 'assets', 'models'), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT, 'assets', 'models', 'desk.glb'), export_format='GLB',
                              use_selection=True, export_yup=True, export_vertex_color='ACTIVE', export_extras=False)
    screens = ',\n'.join(
        '    { name: %r, x: %s, y: %s, z: %s, w: %s, h: %s, yaw: %s, pitch: %s }' % (
            s['name'], fmt([s['x']]), fmt([s['y']]), fmt([s['z']]), fmt([s['w']]), fmt([s['h']]), fmt([s['yaw']]),
            fmt([s['pitch']]))
        for s in SCREENS).replace('"', "'")
    lines = [
        '// Сделано blender/build.py (Blender ' + VERSION + ') — руками не править. Рабочее место диспетчера в осях игры',
        '// (метры, y — вверх, диспетчер смотрит в −z): треугольники — позиции по три вершины; нормаль и область палитры',
        '// (src/art/palette.ts, REGIONS) — по одной на треугольник; затенение (AO, 0…255) — в каждой вершине. SCREENS —',
        '// экраны мониторов и видеостены (середина, размер, поворот в градусах), LAMP — место лампы.',
        'export const DESK = {',
        f'  pos: [{fmt(pos)}],',
        f'  nrm: [{fmt(nrm)}],',
        f'  reg: [{",".join(map(str, reg))}],',
        f'  ao: [{",".join(map(str, ao))}],',
        '} as const;',
        '',
        'export const SCREENS = [',
        screens + ',',
        '] as const;',
        '',
        'export const LAMP = [0.8, ' + fmt([DESK_TOP + 0.2]) + ', -0.16] as const;',
        '',
    ]
    gen = os.path.join(ROOT, 'src', 'art', 'desk.gen.ts')
    glb = os.path.join(ROOT, 'assets', 'models', 'desk.glb')
    with open(gen, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines))
    # паспорт: откуда модель, чем сделана и отпечатки файлов (tools/test/desk.test.ts сверяет их со сборкой)
    def sha(path):
        with open(path, 'rb') as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    passport = {
        'id': 'desk',
        'name': 'Рабочее место диспетчера скорой: стол, мониторы, связь, зал с видеостеной',
        'licence': 'своя работа студии «Горница»',
        'made': {'script': 'blender/build.py', 'blender': VERSION, 'aoSamples': AO_SAMPLES, 'aoDistance': AO_DISTANCE},
        'triangles': len(reg),
        'screens': [s['name'] for s in SCREENS],
        'regions': REGIONS,
        'files': {
            'src/art/desk.gen.ts': {'sha256': sha(gen), 'bytes': os.path.getsize(gen)},
            'assets/models/desk.glb': {'sha256': sha(glb), 'bytes': os.path.getsize(glb)},
        },
    }
    with open(os.path.join(ROOT, 'assets', 'models', 'desk.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(passport, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print(f'рабочее место: {len(reg)} треугольников, {len(SCREENS)} экранов')


# title.py берёт отсюда зал и стол — при импорте модель не пересобирается
if __name__ == '__main__':
    main()
