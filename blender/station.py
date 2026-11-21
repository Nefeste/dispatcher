# Кадр сцены «Станция» между сменами (срез, часть С2; ADR 0009; docs/08-game-design.md, §15; docs/13-art.md): рабочее
# место диспетчера сверху — на столе письмо старшего врача, табель бригад на планшете, журнал фонда и укладка; за окном —
# двор подстанции с машинами класса B и C (спецификация среза, §7). Cycles рендерит кадр; Skia кладёт его на весь экран и
# пишет поверх то, что меняется: строки письма, табель, фонд на наклейке журнала, бирку укладки. Касание предмета —
# решение станции.
#
# Запуск: python blender/station.py [--preview] (Blender как модуль Python: pip install bpy==4.5.15, Python 3.11)
# Пишет:
# - assets/scenes/station-desk.jpg — кадр;
# - src/art/station.gen.ts — размер кадра и места предметов в его пикселях: где касаться и четыре угла листа, табеля,
#   наклейки журнала и бирки укладки — туда Skia пишет текст;
# - assets/scenes/station.json — паспорт: версия Blender, настройки рендера, отпечатки файлов.
# --preview — малый кадр с малым числом выборок в папку STATION_PREVIEW (по умолчанию /tmp); файлы игры не трогает.
#
# Оси — Blender: x вправо, y от зрителя вглубь, z вверх; метры. Передний край стола — y = 0, верх стола — z = 0,74,
# стена с окном — y = 0,8. Цвета — из src/art/palette.ts и src/ui/theme.ts. Машины — та же модель, что во вставке
# «бригада выезжает» (blender/insert.py, ambulance), без эмблемы Красного Креста. Укладка — сумка-укладка выездной
# бригады (388н, прил. 5, п. 3.26 — общепрофильная, п. 5.31 — реанимационная).
import hashlib
import json
import math
import os
import re
import subprocess
import shutil
import sys

import bpy  # noqa: I001
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

VERSION = '4.5.15'
if bpy.app.version_string.split(' ')[0] != VERSION:
    sys.exit(f'нужен Blender {VERSION}, а это {bpy.app.version_string}')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insert  # noqa: E402 — машина из вставки: модуль без запуска (main только из командной строки)
import look  # noqa: E402 — общие материалы и отделка кадра

PREVIEW = '--preview' in sys.argv
W, H = (1080, 1920) if not PREVIEW else (360, 640)
SAMPLES = 160 if not PREVIEW else 16
SEED = 11
TOP = 0.74
# яркость неба: подобрана так, чтобы двор был светлым, а небо не выгорало
SKY = float(os.environ.get('STATION_SKY', '0.12'))
WALL = 0.8


def colors():
    out = {}
    for rel in ('src/ui/theme.ts', 'src/art/palette.ts'):
        with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
            for name, hexs in re.findall(r"^\s+(\w+): '(#[0-9a-fA-F]{6})'", fh.read(), re.M):
                out[name] = hexs
    return {k: insert.lin(v) for k, v in out.items()}


COL = colors()


def mat(name, color, rough=0.5, metal=0.0, coat=0.0, emit=None, strength=0.0):
    return insert.mat('st_' + name, color, rough, metal, coat, emit, strength)


def finish(ob, material, bevel=0.0, segments=3):
    ob.data.materials.append(material)
    if bevel > 0:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
    for p in ob.data.polygons:
        p.use_smooth = bevel > 0
    return ob


def box(name, material, size, loc, rot=(0, 0, 0), bevel=0.0, segments=3):
    """Коробка: размер (x, y, z), середина низа — loc, поворот — градусы по x, y, z."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    for v in ob.data.vertices:
        v.co.z += size[2] / 2
    ob.location = loc
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    return finish(ob, material, bevel, segments)


def cyl(name, material, r, h, loc, rot=(0, 0, 0), sides=24, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=h)
    ob = bpy.context.object
    ob.name = name
    for v in ob.data.vertices:
        v.co.z += h / 2
    ob.location = loc
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    return finish(ob, material, bevel)


def shade(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, 1.0)


def materials():
    return {
        # столешница — светлый ламинат: едва заметные волокна вдоль стола, блеск неровный
        'desk': look.grain('st_desk', shade(COL['desk'], 0.9), COL['desk'], scale=5.0, rough=(0.28, 0.5), bump=0.03, coat=0.15, stretch=(1, 14, 14)),
        'wall': look.grain('st_wall', shade(COL['wall'], 0.94), COL['wall'], scale=7.0, rough=(0.8, 0.9), bump=0.08),
        'sill': mat('sill', COL['lamp'], rough=0.4),
        'frame': mat('frame', COL['edge'], rough=0.45),
        'glass': mat('glass', (0.6, 0.65, 0.7, 1), rough=0.02),
        'paper': look.grain('st_paper', shade(COL['paper'], 0.96), COL['paper'], scale=120.0, rough=(0.8, 0.9), bump=0.02),
        'envelope': look.grain('st_envelope', insert.lin('#d8caa9'), insert.lin('#e7dcc4'), scale=90.0, rough=(0.75, 0.9), bump=0.04),
        'board': look.grain('st_board', insert.lin('#7a5b3a'), insert.lin('#96744d'), scale=14.0, rough=(0.5, 0.7), bump=0.06, stretch=(12, 1, 12)),
        'metal': mat('metal', COL['metal'], rough=0.25, metal=0.9),
        # обложка журнала — бумвинил: мелкое зерно
        'cover': look.grain('st_cover', insert.lin('#27433a'), insert.lin('#335447'), scale=260.0, rough=(0.45, 0.65), bump=0.25, coat=0.15),
        'label': mat('label', insert.lin('#efe9da'), rough=0.8),
        'pages': mat('pages', insert.lin('#ece6d6'), rough=0.9),
        # сумка — плотная ткань: переплетение мелким зерном
        'bag': look.grain('st_bag', insert.lin('#c23f1b'), insert.lin('#dc4c22'), scale=320.0, rough=(0.55, 0.8), bump=0.35),
        'strap': mat('strap', insert.lin('#2b2e31'), rough=0.7),
        'reflect': mat('reflect', insert.lin('#cfd3d4'), rough=0.3, metal=0.4),
        'tag': mat('tag', insert.lin('#f4f1e6'), rough=0.7),
        'mug': mat('mug', COL['spruce'], rough=0.3, coat=0.5),
        'pen': mat('pen', COL['kumach'], rough=0.3, coat=0.4),
        'dark': mat('dark', COL['dark'], rough=0.45),
        'key': mat('key', COL['key'], rough=0.55),
        'asphalt': look.grain('st_asphalt', insert.lin('#4b4f52'), insert.lin('#5f6366'), scale=30.0, rough=(0.75, 0.95), bump=0.2),
        'garage': look.bricks('st_garage', insert.lin('#a39a8a'), insert.lin('#b5ad9d'), insert.lin('#77726a'), size=(0.26, 0.085), gap=0.012,
                              rough=0.85, bump=0.5, turn=(math.radians(90), 0, 0)),
        'gate': look.stripes('st_gate', insert.lin('#6d7073'), insert.lin('#8b8e90'), width=0.11, rough=0.45, axis=2),
        'tree': mat('tree', insert.lin('#3f5a45'), rough=0.9),
        'floor': mat('floor', COL['floor'], rough=0.7),
        'edge': mat('edge', COL['edge'], rough=0.5),
    }


def room(M):
    # стол с передней стенкой и стена с окном за ним; стол подходит к зрителю вплотную — пола в кадре нет
    box('floor', M['floor'], (4.0, 3.0, 0.02), (0, -0.6, -0.02))
    box('desk_top', M['desk'], (1.7, 1.3, 0.03), (0, 0.17, TOP - 0.03), bevel=0.008, segments=4)
    box('wall_low', M['wall'], (3.0, 0.12, 0.95), (0, WALL + 0.06, 0))
    box('wall_high', M['wall'], (3.0, 0.12, 0.8), (0, WALL + 0.06, 2.0))
    box('wall_l', M['wall'], (0.9, 0.12, 1.1), (-1.05, WALL + 0.06, 0.9))
    box('wall_r', M['wall'], (0.9, 0.12, 1.1), (1.05, WALL + 0.06, 0.9))
    box('sill', M['sill'], (1.3, 0.22, 0.03), (0, WALL - 0.02, 0.92), bevel=0.006)
    # рама окна: две створки, переплёт, ручка
    for i, x in enumerate((-0.6, 0.0, 0.6)):
        box(f'mullion{i}', M['frame'], (0.05, 0.06, 1.1), (x, WALL + 0.04, 0.9), bevel=0.005)
    box('transom_lo', M['frame'], (1.25, 0.06, 0.05), (0, WALL + 0.04, 0.9), bevel=0.005)
    box('transom_hi', M['frame'], (1.25, 0.06, 0.05), (0, WALL + 0.04, 1.95), bevel=0.005)
    box('window_handle', M['metal'], (0.012, 0.02, 0.09), (0.035, WALL + 0.0, 1.32), bevel=0.004)
    # на подоконнике слева — цветок в горшке
    cyl('pot', mat('pot', insert.lin('#a2573c'), rough=0.7), 0.055, 0.09, (-0.47, WALL - 0.03, 0.95), sides=24, bevel=0.004)
    leaf = look.grain('st_leaf', insert.lin('#2f5a36'), insert.lin('#4c7a45'), scale=30, rough=(0.45, 0.65))
    # куст из мелких листьев: места — по счёту, по кругу и вверх
    for i in range(34):
        ang, h = i * 2.4, (i * 0.618) % 1.0
        rad = (0.015 + 0.075 * math.sin(h * math.pi)) * (0.35, 0.7, 1.0)[i % 3]
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.022 + 0.008 * ((i * 7) % 3) / 2,
                                              location=(-0.47 + math.cos(ang) * rad, WALL - 0.03 + math.sin(ang) * rad * 0.8, 1.05 + h * 0.2))
        ob = bpy.context.object
        ob.name = f'leaf{i}'
        ob.scale = (1.3, 0.9, 0.5)
        ob.rotation_euler = (math.radians(20 * math.sin(ang)), math.radians(20 * math.cos(ang)), ang)
        ob.data.materials.append(leaf)
        for p in ob.data.polygons:
            p.use_smooth = True


def yard(M):
    """Двор подстанции днём за окном: асфальт с разметкой стоянки, кирпичный гараж с рольворотами и окнами второго
    этажа, фонарь, деревья; кабинет на втором этаже."""
    G = -4.0
    box('ground', M['asphalt'], (80, 80, 0.1), (0, 30, G - 0.1))
    box('garage', M['garage'], (30, 0.4, 7.4), (0, 26, G))
    box('garage_parapet', M['edge'], (30.4, 0.7, 0.3), (0, 26, G + 7.4), bevel=0.03)
    box('garage_plinth', mat('plinth', insert.lin('#63666a'), rough=0.85), (30, 0.5, 0.7), (0, 25.95, G))
    for i, x in enumerate((-6.0, 0.0, 6.0)):
        box(f'gate{i}', M['gate'], (4.0, 0.1, 3.6), (x, 25.75, G))
        box(f'gate_frame{i}', M['edge'], (4.3, 0.14, 0.2), (x, 25.72, G + 3.6))
    win = look.Boxes('garage_windows', mat('yard_glass', insert.lin('#2b3a4a'), rough=0.05, coat=0.8))
    frm = look.Boxes('garage_frames', mat('yard_frame', insert.lin('#d9d6cc'), rough=0.5))
    for x in (-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5):
        frm.add((1.5, 0.08, 1.7), (x, 25.78, G + 5.6))
        for dx in (-0.34, 0.34):
            win.add((0.62, 0.05, 1.5), (x + dx, 25.74, G + 5.6))
    win.build()
    frm.build()
    # разметка стоянки — белая, стёртая
    paint = look.grain('st_paint', insert.lin('#a9aba7'), insert.lin('#d5d6d0'), scale=30, rough=(0.6, 0.85), bump=0.05)
    lines = look.Boxes('yard_lines', paint)
    for x in (-9.0, -6.0, -3.0, 0.0, 3.0, 6.0, 9.0):
        lines.add((0.12, 5.0, 0.01), (x, 22.6, G + 0.004))
    lines.add((24, 0.14, 0.01), (0, 15.4, G + 0.004))
    lines.build()
    # дневные деревья: материал кроны и коры заводим до insert.tree — тот берёт их по имени
    look.grain('leaf', insert.lin('#38563a'), insert.lin('#567a4c'), scale=3.0, rough=(0.7, 0.9), bump=0.4)
    mat_bark = insert.mat('bark', insert.lin('#4a3d33'), 0.9)
    _ = mat_bark
    for i, (x, y, h, c) in enumerate(((-13.5, 22, 7.5, 2.4), (13.5, 21, 8.0, 2.6), (-18, 30, 9.0, 3.0), (18, 31, 9.5, 3.2))):
        insert.tree(f'tree{i}', (x, y, G), h, c)
    insert.lamp_post('yard_lamp', (10.0, 24.6), energy=0, toward=-90, height=6.0)
    for ob in list(bpy.data.objects):
        if ob.name.startswith('yard_lamp') and ob.type != 'LIGHT':
            ob.location.z += G
    cars = []
    # стоят боком к окну, полосой с надписью к нам: общепрофильная (класс B) и реанимобиль (класс C)
    for i, (x, y, heading, label) in enumerate(((-3.6, 18.0, 14, None), (3.8, 19.5, 166, 'РЕАНИМАЦИЯ'))):
        car = insert.ambulance()
        car.name = f'car{i}'
        car.location = (x, y, G)
        car.rotation_euler = (0, 0, math.radians(heading))
        cars.append(car)
        # реанимобиль (класс C) — лимонный флуоресцентный, со своей надписью на полосе (ГОСТ Р 50574-2019, п. 4.2.1,
        # табл. 1 и 3; docs/09-content.md, `gost-50574`)
        if label:
            lemon = mat('lemon', insert.lin('#e4e43a'), rough=0.3, coat=0.6)
            for ch in car.children:
                if ch.type == 'MESH' and ch.data.materials and ch.data.materials[0].name == 'white':
                    ch.data.materials[0] = lemon
            # «РЕАНИМАЦИЯ» — белым на красной полосе под окном салона, над полосой «СКОРАЯ МЕДИЦИНСКАЯ ПОМОЩЬ»
            red, white = insert.mat('stripe', insert.lin('#c4122f'), 0.35, coat=0.4), insert.mat('letters', insert.lin('#ffffff'), 0.4)
            for side in (-1, 1):
                y = side * (1.0 + 0.006)
                insert.block(f'resus_band{side}', red, (1.7, 0.01, 0.2), (-0.75, y, 1.46), parent=car)
                insert.text(f'resus_label{side}', label, 0.14, white, (-0.75, y + side * 0.008, 1.46), (90, 0, 0 if side < 0 else 180), car)
    # фары и маячки машин на стоянке не горят: гасим свет и свечение стёкол
    for ob in list(bpy.data.objects):
        if ob.type == 'LIGHT' and (ob.parent in cars or ob.name.startswith('yard_lamp')):
            bpy.data.objects.remove(ob, do_unlink=True)
    for name, k in (('headlamp', 0.35), ('fog', 0.1), ('amber', 0.25), ('amber_dim', 0.2), ('taillamp', 0.3), ('beacon', 0.5), ('lamp_head', 0.3)):
        m = bpy.data.materials.get(name)
        if m:
            bs = m.node_tree.nodes['Principled BSDF']
            m.node_tree.animation_data_clear()
            bs.inputs['Emission Strength'].default_value = k
            if name in ('headlamp', 'fog', 'lamp_head'):
                bs.inputs['Base Color'].default_value = insert.lin('#d9dcdc')


def items(M):
    """Четыре предмета сеткой 2 × 2 посреди стола: письмо и табель дальше, журнал и укладка ближе."""
    parts = {}
    # письмо старшего врача: конверт и лист А4 на нём
    box('envelope', M['envelope'], (0.22, 0.15, 0.003), (-0.22, 0.58, TOP), rot=(0, 0, -12), bevel=0.0008)
    sheet = box('letter', M['paper'], (0.2, 0.28, 0.0015), (-0.205, 0.53, TOP + 0.003), rot=(0, 0, 5), bevel=0.0004)
    parts['letter'] = {'tap': ['envelope', 'letter'], 'quad': sheet.name}
    # табель бригад: планшет с зажимом и листом
    box('clipboard', M['board'], (0.23, 0.32, 0.006), (0.215, 0.55, TOP), rot=(0, 0, -4), bevel=0.003)
    roster = box('roster', M['paper'], (0.2, 0.26, 0.0015), (0.215, 0.538, TOP + 0.006), rot=(0, 0, -4), bevel=0.0004)
    clip = box('clip', M['metal'], (0.1, 0.035, 0.012), (0.216, 0.695, TOP + 0.006), rot=(0, 0, -4), bevel=0.003)
    parts['roster'] = {'tap': ['clipboard', 'roster', clip.name], 'quad': roster.name}
    # журнал фонда: книга в твёрдой обложке, наклейка на обложке
    lx, ly, lyaw = -0.205, 0.15, 3
    box('ledger_back', M['cover'], (0.205, 0.28, 0.003), (lx, ly, TOP), rot=(0, 0, lyaw), bevel=0.0015)
    box('ledger_pages', M['pages'], (0.192, 0.268, 0.022), (lx, ly, TOP + 0.003), rot=(0, 0, lyaw))
    box('ledger', M['cover'], (0.205, 0.28, 0.004), (lx, ly, TOP + 0.025), rot=(0, 0, lyaw), bevel=0.0015)
    label = box('ledger_label', M['label'], (0.15, 0.085, 0.0008), (lx + 0.002, ly + 0.03, TOP + 0.029), rot=(0, 0, lyaw))
    parts['ledger'] = {'tap': ['ledger', 'ledger_pages', 'ledger_back'], 'quad': label.name}
    # укладка: сумка со светоотражающей полосой, ручкой и биркой
    bx, by, yaw = 0.2, 0.13, -6
    box('bag', M['bag'], (0.27, 0.17, 0.13), (bx, by, TOP), rot=(0, 0, yaw), bevel=0.028, segments=5)
    box('bag_strip', M['reflect'], (0.272, 0.174, 0.02), (bx, by, TOP + 0.052), rot=(0, 0, yaw), bevel=0.007)
    c, sn = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    at = lambda dx, dy, z: (bx + dx * c - dy * sn, by + dx * sn + dy * c, z)  # noqa: E731 — точка в осях сумки
    for i, dx in enumerate((-0.06, 0.06)):
        box(f'bag_post{i}', M['strap'], (0.018, 0.022, 0.05), at(dx, 0.0, TOP + 0.12), rot=(0, 0, yaw), bevel=0.004)
    box('bag_grip', M['strap'], (0.15, 0.026, 0.02), at(0, 0.0, TOP + 0.165), rot=(0, 0, yaw), bevel=0.008)
    tag = box('bag_tag', M['tag'], (0.1, 0.055, 0.0015), at(-0.02, -0.045, TOP + 0.131), rot=(0, 0, yaw - 4), bevel=0.0005)
    parts['bag'] = {'tap': ['bag', 'bag_strip', 'bag_grip'], 'quad': tag.name}
    # отделка предметов (места листов и касаний не меняет): клапан конверта, корешок и закладка журнала, молния и
    # вторая полоса сумки
    fold = mat('fold', insert.lin('#c9b994'), rough=0.85)
    for i, ang in enumerate((-12 + 24, -12 - 24)):
        box(f'envelope_fold{i}', fold, (0.125, 0.0012, 0.0006), (-0.22 + (-0.052 if i == 0 else 0.052) * math.cos(math.radians(-12)), 0.607 + (-0.052 if i == 0 else 0.052) * math.sin(math.radians(-12)), TOP + 0.0031), rot=(0, 0, ang + (180 if i else 0)))
    lc, ls = math.cos(math.radians(lyaw)), math.sin(math.radians(lyaw))
    box('ledger_spine', mat('spine', insert.lin('#1c2f28'), rough=0.5, coat=0.2), (0.024, 0.281, 0.0045), (lx - 0.092 * lc, ly - 0.092 * ls, TOP + 0.025), rot=(0, 0, lyaw), bevel=0.0015)
    box('ledger_ribbon', M['pen'], (0.008, 0.07, 0.0008), (lx + 0.05 * lc + 0.165 * ls, ly + 0.05 * ls - 0.165 * lc, TOP + 0.0005), rot=(0, 0, lyaw + 8))
    box('bag_zip', M['strap'], (0.24, 0.006, 0.002), at(0, 0.035, TOP + 0.13), rot=(0, 0, yaw))
    box('bag_zip_pull', M['metal'], (0.016, 0.008, 0.004), at(0.1, 0.035, TOP + 0.131), rot=(0, 0, yaw), bevel=0.001)
    box('bag_strip2', M['reflect'], (0.2725, 0.1745, 0.008), at(0, 0, TOP + 0.03), rot=(0, 0, yaw), bevel=0.003)
    for i, dx in enumerate((-0.141, 0.141)):
        box(f'bag_ring{i}', M['metal'], (0.006, 0.02, 0.02), at(dx, 0.0, TOP + 0.09), rot=(0, 0, yaw), bevel=0.002)
    # мелочи: кружка с чаем на подставке, ручка с колпачком, карандаш
    cyl('coaster', mat('coaster', insert.lin('#6e5a45'), rough=0.8), 0.052, 0.004, (0.5, 0.7, TOP), sides=40)
    cyl('mug', M['mug'], 0.038, 0.095, (0.5, 0.7, TOP + 0.004), sides=40, bevel=0.003)
    cyl('mug_tea', mat('tea', insert.lin('#2b160b'), rough=0.08, coat=0.5), 0.033, 0.001, (0.5, 0.7, TOP + 0.0992), sides=40)
    for i, (dz, dx, w) in enumerate(((0.07, 0.048, 0.03), (0.05, 0.062, 0.012), (0.03, 0.048, 0.03))):
        box(f'mug_handle{i}', M['mug'], (w, 0.012, 0.014 if i != 1 else 0.034), (0.5 + dx, 0.7, TOP + dz - (0.007 if i != 1 else 0.017)), bevel=0.005)
    cyl('pen', M['pen'], 0.0045, 0.14, (0.0, 0.4, TOP + 0.005), rot=(0, 90, 70), sides=12)
    pc, ps = math.cos(math.radians(70)), math.sin(math.radians(70))
    cyl('pen_tip', M['metal'], 0.0046, 0.018, (0.14 * pc, 0.4 + 0.14 * ps, TOP + 0.005), rot=(0, 90, 70), sides=12, bevel=0.001)
    cyl('pen_cap', M['dark'], 0.0048, 0.03, (0.0, 0.4, TOP + 0.005), rot=(0, 90, 70), sides=12)
    # у ближнего края стола: очки, штамп с подушкой, скрепки, карандаш — вне мест касаний
    rim = M['dark']
    for i, dx in enumerate((-0.032, 0.032)):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.024, minor_radius=0.0022, major_segments=32, minor_segments=8,
                                         location=(-0.02 + dx, -0.085, TOP + 0.004))
        lens_rim = bpy.context.object
        lens_rim.name = f'glasses{i}'
        lens_rim.data.materials.append(rim)
        for p in lens_rim.data.polygons:
            p.use_smooth = True
    box('glasses_bridge', rim, (0.016, 0.003, 0.003), (-0.02, -0.08, TOP + 0.003))
    for i, sx in enumerate((-1, 1)):
        box(f'glasses_arm{i}', rim, (0.003, 0.12, 0.003), (-0.02 + sx * 0.062, -0.03, TOP + 0.002), rot=(0, 0, -sx * 14))
    box('stamp_pad', mat('stamp_pad', insert.lin('#28384f'), rough=0.4, coat=0.3), (0.11, 0.075, 0.016), (0.22, -0.085, TOP), rot=(0, 0, 9), bevel=0.004)
    cyl('stamp', mat('stamp', insert.lin('#3b2a20'), rough=0.35, coat=0.4), 0.019, 0.05, (0.1, -0.06, TOP), sides=24, bevel=0.004)
    cyl('stamp_knob', mat('stamp', insert.lin('#3b2a20'), rough=0.35, coat=0.4), 0.014, 0.03, (0.1, -0.06, TOP + 0.05), sides=24, bevel=0.006)
    cyl('pencil', mat('pencil', insert.lin('#d9a441'), rough=0.45), 0.0038, 0.17, (-0.42, -0.07, TOP + 0.004), rot=(0, 90, 24), sides=6)
    for i, (x, y, a) in enumerate(((-0.6, 0.02, 20), (-0.57, -0.02, 75), (-0.62, -0.05, -30))):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.008, minor_radius=0.0007, major_segments=16, minor_segments=6, location=(x, y, TOP + 0.001))
        clip = bpy.context.object
        clip.name = f'paperclip{i}'
        clip.scale = (2.0, 0.7, 1)
        clip.rotation_euler = (0, 0, math.radians(a))
        clip.data.materials.append(M['metal'])
    return parts


def lights():
    # день из окна — холодный рассеянный свет; потолок зала; настольная лампа — тёплый акцент
    bpy.ops.object.light_add(type='AREA', location=(0, WALL + 0.3, 1.45))
    win = bpy.context.object
    win.data.shape = 'RECTANGLE'
    win.data.size, win.data.size_y = 1.2, 1.0
    win.data.energy = 220
    win.data.color = (0.9, 0.95, 1.0)
    win.rotation_euler = (math.radians(90), 0, 0)
    win.visible_camera = False
    bpy.ops.object.light_add(type='AREA', location=(0.2, -0.2, 2.8))
    top = bpy.context.object
    top.data.size = 2.5
    top.data.energy = 120
    top.data.color = (0.95, 0.97, 1.0)
    bpy.ops.object.light_add(type='POINT', location=(0.9, 0.3, 1.25))
    warm = bpy.context.object
    warm.data.energy = 18
    warm.data.shadow_soft_size = 0.08
    warm.data.color = (1.0, 0.82, 0.58)
    # небо — физическая модель дневного неба (узел «небо» Blender): солнце — из-за спины зрителя, двор освещён спереди
    world = bpy.data.worlds.new('day')
    world.use_nodes = True
    nt = world.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(38)
    sky.sun_rotation = math.radians(200)
    sky.sun_intensity = 0.25
    sky.air_density = 1.2
    sky.dust_density = 1.5
    sky.ozone_density = 2.0
    nt.links.new(sky.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    nt.nodes['Background'].inputs['Strength'].default_value = SKY
    bpy.context.scene.world = world


def camera():
    """Взгляд сидящего диспетчера на стол, чуть сверху: стол внизу кадра, окно — вверху."""
    bpy.ops.object.camera_add(location=(0, -0.52, 1.48))
    cam = bpy.context.object
    target = Vector((0, 0.42, 0.98))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 24
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_height = 36
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (Vector((0, 0.3, TOP)) - cam.location).length
    cam.data.dof.aperture_fstop = 6.3
    bpy.context.scene.camera = cam
    return cam


def project(scene, cam, names):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for n in names:
        ob = bpy.data.objects[n].evaluated_get(deps)
        for v in ob.to_mesh().vertices:
            c = world_to_camera_view(scene, cam, ob.matrix_world @ v.co)
            pts.append((c.x * W, (1 - c.y) * H))
        ob.to_mesh_clear()
    return pts


def rect(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [max(0, round(min(xs))), max(0, round(min(ys))), min(W, round(max(xs))), min(H, round(max(ys)))]


def top_quad(scene, cam, name):
    """Четыре угла верхней грани плоского предмета на экране, по часовой от левого верхнего (дальнего левого)."""
    ob = bpy.data.objects[name]
    me = ob.data
    best = max(me.polygons, key=lambda p: (ob.matrix_world.to_3x3() @ p.normal).z)
    corners = []
    for i in best.vertices:
        c = world_to_camera_view(scene, cam, ob.matrix_world @ me.vertices[i].co)
        corners.append((c.x * W, (1 - c.y) * H))
    cx, cy = sum(p[0] for p in corners) / 4, sum(p[1] for p in corners) / 4
    corners.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    first = min(range(4), key=lambda i: corners[i][0] + corners[i][1])
    corners = corners[first:] + corners[:first]
    return [[round(x, 1), round(y, 1)] for x, y in corners]


def sha(path):
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    M = materials()
    room(M)
    yard(M)
    parts = items(M)
    lights()
    cam = camera()
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = SEED
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = -0.2
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    look.polish(scene, bloom=0.15, threshold=3.0, size=0.4, vignette=0.12)
    bpy.context.view_layer.update()

    places = {k: {'tap': rect(project(scene, cam, v['tap'])), 'quad': top_quad(scene, cam, v['quad'])} for k, v in parts.items()}

    if PREVIEW:
        out = os.path.join(os.environ.get('STATION_PREVIEW', '/tmp'), 'station-preview.png')
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print('предпросмотр:', out, json.dumps(places))
        return

    tmp = os.path.join(os.environ.get('STATION_TMP', '/tmp'), 'station-desk.png')
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    jpg = os.path.join(ROOT, 'assets', 'scenes', 'station-desk.jpg')
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        sys.exit('нужен ffmpeg')
    subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', tmp, '-q:v', '3', '-fflags', '+bitexact', '-flags:v', '+bitexact', jpg], check=True)

    gen = os.path.join(ROOT, 'src', 'art', 'station.gen.ts')
    lines = [
        '// Сделано blender/station.py (Blender ' + VERSION + ') — руками не править. Кадр сцены «Станция»',
        '// (assets/scenes/station-desk.jpg) и места предметов в его пикселях: x вправо, y вниз. tap — прямоугольник',
        '// касания [x0, y0, x1, y1]; quad — четыре угла листа, табеля, наклейки или бирки по часовой от левого верхнего.',
        f'export const STATION_ART = {json.dumps({"w": W, "h": H, **places}, ensure_ascii=False)} as const;',
        '',
    ]
    with open(gen, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines))
    ver = subprocess.run([ffmpeg, '-version'], capture_output=True, text=True).stdout.split('\n')[0]
    passport = {
        'id': 'station',
        'name': 'Рабочее место между сменами: письмо старшего врача, табель бригад, журнал фонда, укладка; за окном — двор подстанции с машинами класса B и C',
        'licence': 'своя работа студии «Горница»; шрифт надписи на машинах — Onest (SIL OFL 1.1, assets/fonts/Onest-OFL.txt)',
        'made': {'script': 'blender/station.py', 'blender': VERSION, 'engine': 'CYCLES', 'samples': SAMPLES,
                 'denoiser': 'OPENIMAGEDENOISE', 'seed': SEED, 'size': [W, H], 'ffmpeg': ver, 'jpeg': 'q 3'},
        'files': {
            'assets/scenes/station-desk.jpg': {'sha256': sha(jpg), 'bytes': os.path.getsize(jpg)},
            'src/art/station.gen.ts': {'sha256': sha(gen), 'bytes': os.path.getsize(gen)},
        },
    }
    with open(os.path.join(ROOT, 'assets', 'scenes', 'station.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(passport, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('станция:', json.dumps(places))


main()
