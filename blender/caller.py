# Картинка звонящего для сцены «Разговор» (ADR 0009; docs/13-art.md, «Сцены»): человек Microsoft Rocketbox (MIT) в
# позе «телефон у уха» там, откуда он звонит, рендер Cycles с малой глубиной резкости. Skia кладёт картинку сверху
# сцены разговора и рисует поверх ответы звонящего.
#
# Запуск: python blender/caller.py <папка исходников Rocketbox> [--preview]
#   исходники скачивает и сверяет tools/people/fetch.ts (закреплённая ревизия и SHA-256 — tools/people/sources.json).
# Пишет:
# - assets/scenes/caller-<id>.jpg — картинка звонящего;
# - assets/scenes/callers.json — паспорт: версия Blender, настройки рендера, исходники Rocketbox, отпечатки файлов.
#
# Оси — Blender: z вверх, человек стоит в начале координат лицом к −y, камера — перед ним. Позу задают цели обратной
# кинематики: правая кисть — на телефоне у правого уха, левая — опущена. Случайности нет, кроме шума Cycles с закреплённым зерном.
import bpy  # noqa: I001 — bpy первым: без него нет bmesh

import hashlib
import json
import math
import os
import sys

from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import look  # noqa: E402 — общие материалы и отделка кадра

VERSION = '4.5.15'
if bpy.app.version_string.split(' ')[0] != VERSION:
    sys.exit(f'нужен Blender {VERSION}, а это {bpy.app.version_string}')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = [a for a in sys.argv[sys.argv.index(__file__) + 1:]] if __file__ in sys.argv else sys.argv[1:]
PREVIEW = '--preview' in ARGS
SRC = next((a for a in ARGS if not a.startswith('--')), None)
if not SRC:
    sys.exit('укажите папку исходников Rocketbox (её заполняет bun tools/people/fetch.ts <папка>)')

# предпросмотр — малый кадр; CALLER_PREVIEW_SCALE=2 — вдвое крупнее, чтобы разглядеть кисть
_K = float(os.environ.get('CALLER_PREVIEW_SCALE', '1'))
W, H = (1080, 960) if not PREVIEW else (int(360 * _K), int(320 * _K))
# сгиб пальцев вокруг телефона: градусы в трёх суставах от ладони к кончику — подобраны по кадру
CURL = tuple(float(x) for x in os.environ.get('CALLER_CURL', '30,50,30').split(','))
SAMPLES = 192 if not PREVIEW else 16
SEED = 11

# Звонящие: кто, какой человек Rocketbox, где стоит (комната), насколько повёрнут правым ухом — с телефоном — к камере
# (yaw, градусы; 0 — лицом к камере). Крупность и высоту камеры считает `camera` по голове каждого.
CALLERS = {
    'daughter': {
        'avatar': 'Adults/Female_Adult_02/Export/Female_Adult_02.fbx',
        'room': 'kitchen',
        'yaw': 32,
    },
    # мужчина дома: сын, муж, сосед, сам больной (часть П8)
    'man': {
        'avatar': 'Adults/Male_Adult_01/Export/Male_Adult_01.fbx',
        'room': 'kitchen',
        'yaw': 34,
    },
    # срез, С7: ещё четыре человека — пожилая женщина и пожилой мужчина (их пожилыми ведёт и «Больница», cast.ts),
    # молодая женщина и подросток, который звонит за родителя
    'grandma': {
        'avatar': 'Professions/Business_Female_02/Export/Business_Female_02.fbx',
        'room': 'kitchen',
        'yaw': 30,
        'grey': 1.7,
        'grey_head': True,
    },
    'grandpa': {
        'avatar': 'Adults/Male_Adult_03/Export/Male_Adult_03.fbx',
        'grey': 1.7,
        'room': 'kitchen',
        'yaw': 32,
    },
    'young': {
        'avatar': 'Adults/Female_Adult_05/Export/Female_Adult_05.fbx',
        'room': 'kitchen',
        'yaw': 34,
    },
    'teen': {
        'avatar': 'Children/Male_Child_01/Export/Male_Child_01.fbx',
        'room': 'kitchen',
        'yaw': 32,
    },
}
# те же люди на вечерней улице — звонки не из дома (родственник, сам больной, прохожий; игра владельца 20.11.2026:
# вместо картинки была тёмная сцена со словом, её приняли за незагрузку)
CALLERS['daughter-street'] = {**CALLERS['daughter'], 'room': 'street'}
CALLERS['man-street'] = {**CALLERS['man'], 'room': 'street'}
for _id in ('grandma', 'grandpa', 'young', 'teen'):
    CALLERS[f'{_id}-street'] = {**CALLERS[_id], 'room': 'street'}
# --only имя,имя — нарисовать только этих; паспорт остальных остаётся как был
ONLY = next((a.split('=', 1)[1].split(',') for a in ARGS if a.startswith('--only=')), None)


lin = look.lin


def mat(name, color, rough=0.6, emit=None, strength=0.0, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit is not None:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = strength
    return m


def block(name, material, size, loc, rot=(0, 0, 0), bevel=0.01):
    """Коробка: размер, середина, поворот — градусы."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=tuple(math.radians(a) for a in rot))
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(material)
    if bevel:
        bev = ob.modifiers.new('bevel', 'BEVEL')
        bev.width = min(bevel, min(size) * 0.4)
        bev.segments = 2
    return ob


def tube(name, material, radius, depth, loc, rot=(0, 0, 0), sides=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=depth, location=loc,
                                        rotation=tuple(math.radians(a) for a in rot))
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(material)
    for p in ob.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    return ob


def ball(name, material, radius, loc, squash=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = squash
    ob.data.materials.append(material)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def lamp(kind, loc, energy, color, size=None, rot=None, spot=None, soft=None, size_y=None):
    bpy.ops.object.light_add(type=kind, location=loc)
    ob = bpy.context.object
    ob.data.energy = energy
    ob.data.color = color
    if size is not None:
        ob.data.size = size
    if size_y is not None:
        ob.data.shape = 'RECTANGLE'
        ob.data.size_y = size_y
    if spot is not None:
        ob.data.spot_size = math.radians(spot)
        ob.data.spot_blend = 0.7
    if soft is not None:
        ob.data.shadow_soft_size = soft
    if rot is not None:
        ob.rotation_euler = tuple(math.radians(a) for a in rot)
    return ob


def kitchen():
    """Кухня вечером за спиной звонящего: окно с синим вечером и огнями города, занавеска и цветок на подоконнике,
    шкафы с ручками, фартук из плитки, подсветка под шкафами, чайник и банки, холодильник, тёплый подвес над столом.
    Размыта: звонящий — в резкости, кухня — пятнами света."""
    wall = look.grain('wall', lin('#9d8f78'), lin('#ab9d86'), scale=3.0, rough=(0.8, 0.9), bump=0.05)
    tile = look.bricks('tile', lin('#d6d2c6'), lin('#cdc8ba'), lin('#8f8a7d'), size=(0.15, 0.15), gap=0.006, rough=0.25, bump=0.3,
                       offset=0.0, turn=(math.radians(90), 0, 0))
    wood = look.grain('wood', lin('#7b5a40'), lin('#93704f'), scale=10, rough=(0.4, 0.6), stretch=(1, 10, 10))
    front = look.grain('front', lin('#5d7a70'), lin('#688478'), scale=6, rough=(0.4, 0.55), bump=0.03)
    steel = mat('steel', lin('#b8bcbf'), 0.25, metal=1.0)
    Y = 3.2
    block('back_wall', wall, (7, 0.1, 3.2), (0, Y, 1.6), bevel=0)
    block('side_wall', wall, (0.1, 7, 3.2), (-2.6, 0, 1.6), bevel=0)
    block('side_wall_r', wall, (0.1, 7, 3.2), (3.2, 0, 1.6), bevel=0)
    block('ceiling', mat('ceiling', lin('#d9d4c8'), 0.9), (7, 7, 0.05), (0, 0, 2.75), bevel=0)
    block('floor', mat('floor', lin('#6d5a48'), 0.6), (7, 7, 0.05), (0, 0, -0.025), bevel=0)
    # справа: нижние шкафы со столешницей, фартук из плитки, верхние шкафы, подсветка под ними
    block('tiles', tile, (2.6, 0.02, 0.62), (1.5, Y - 0.06, 1.22), bevel=0)
    block('counter', wood, (2.6, 0.62, 0.04), (1.5, Y - 0.36, 0.9))
    block('cabinets', front, (2.6, 0.58, 0.86), (1.5, Y - 0.35, 0.45))
    for i in range(4):
        block(f'upper{i}', front, (0.63, 0.36, 0.78), (0.53 + i * 0.65, Y - 0.23, 1.95))
        block(f'upper_handle{i}', steel, (0.02, 0.02, 0.16), (0.53 + i * 0.65 + (0.24 if i % 2 == 0 else -0.24), Y - 0.43, 1.72), bevel=0.004)
    block('under_strip', look.glow('under_strip', lin('#ffd9a6'), 14.0), (2.3, 0.03, 0.015), (1.5, Y - 0.2, 1.555), bevel=0)
    lamp('AREA', (1.5, Y - 0.25, 1.53), 90, (1.0, 0.8, 0.55), size=2.2, size_y=0.08, rot=(180, 0, 0))
    # на столешнице: чайник, банки, доска
    tube('kettle', steel, 0.085, 0.2, (0.75, Y - 0.38, 1.02))
    ball('kettle_lid', steel, 0.085, (0.75, Y - 0.38, 1.12), (1, 1, 0.45))
    for i, (c, h) in enumerate((('#b5533c', 0.16), ('#d9c38a', 0.2), ('#6f8b5a', 0.13))):
        tube(f'jar{i}', mat(f'jar{i}', lin(c), 0.35), 0.05, h, (1.25 + i * 0.16, Y - 0.2, 0.92 + h / 2), sides=16)
    block('board', wood, (0.3, 0.02, 0.4), (1.95, Y - 0.1, 1.13), rot=(-8, 0, 0))
    # холодильник у правого края
    block('fridge', mat('fridge', lin('#d9dadb'), 0.3), (0.7, 0.68, 2.0), (3.0 - 0.1, Y - 0.4, 1.0), bevel=0.02)
    # окно слева: синий вечер за стеклом, далёкие огни, рама с переплётом, занавеска, цветок
    block('window_frame', mat('frame', lin('#e6e2d8'), 0.4), (1.5, 0.1, 1.6), (-0.95, Y - 0.04, 1.6))
    dusk = bpy.data.materials.new('dusk')
    dusk.use_nodes = True
    nt = dusk.node_tree
    bs = nt.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (0, 0, 0, 1)
    co, sep, ramp = nt.nodes.new('ShaderNodeTexCoord'), nt.nodes.new('ShaderNodeSeparateXYZ'), nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(co.outputs['Object'], sep.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = -0.7, 0.7
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].color, ramp.color_ramp.elements[1].color = lin('#a58a93'), lin('#1b2f58')
    nt.links.new(ramp.outputs['Color'], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = 1.6
    block('window_glass', dusk, (1.34, 0.02, 1.44), (-0.95, Y - 0.08, 1.6), bevel=0)
    bars = look.Boxes('window_bars', mat('frame', lin('#e6e2d8'), 0.4))
    bars.add((0.05, 0.04, 1.44), (-0.95, Y - 0.1, 1.6))
    bars.add((1.34, 0.04, 0.05), (-0.95, Y - 0.1, 1.95))
    bars.build()
    # огни города за окном — точки тёплого и холодного света; где — по счёту
    far = {k: look.Boxes(f'far_{k}', look.glow(f'far_{k}', lin(c), 5.0)) for k, c in (('warm', '#ffc98a'), ('cool', '#cfe2ff'), ('red', '#ff6a55'))}
    for i in range(8):
        kind = ('warm', 'cool', 'warm', 'warm', 'cool', 'warm', 'red')[i % 7]
        far[kind].add((0.007, 0.01, 0.007), (-1.55 + (i * 0.618 * 1.24) % 1.24, Y - 0.095, 0.93 + ((i * i * 0.137 + i * 0.29) % 0.34)))
    for b in far.values():
        b.build()
    cloth = look.stripes('curtain', lin('#c9b28c'), lin('#d8c4a0'), width=0.09, rough=0.9, axis=0)
    block('curtain_l', cloth, (0.32, 0.05, 1.75), (-1.78, Y - 0.16, 1.62), bevel=0.02)
    block('curtain_r', cloth, (0.26, 0.05, 1.75), (-0.2, Y - 0.16, 1.62), bevel=0.02)
    block('cornice', wood, (2.0, 0.05, 0.05), (-0.95, Y - 0.16, 2.5))
    block('sill', mat('frame', lin('#e6e2d8'), 0.4), (1.6, 0.22, 0.04), (-0.95, Y - 0.14, 0.8))
    tube('pot', mat('pot', lin('#a2573c'), 0.7), 0.08, 0.13, (-1.25, Y - 0.16, 0.885), sides=16)
    leaf = look.grain('leaf', lin('#2f5a36'), lin('#4c7a45'), scale=14, rough=(0.5, 0.7))
    # куст из мелких листьев: места — по счёту, по кругу и вверх
    for i in range(26):
        ang, h = i * 2.4, (i * 0.618) % 1.0
        rad = (0.02 + 0.1 * math.sin(h * math.pi)) * (0.35, 0.7, 1.0)[i % 3]
        ball(f'leaf{i}', leaf, 0.034 + 0.012 * ((i * 7) % 3) / 2, (-1.25 + math.cos(ang) * rad, Y - 0.16 + math.sin(ang) * rad * 0.6, 0.97 + h * 0.34),
             (1.2, 0.8, 0.55))
    # подвес над столом — тёплый шар света в кадре справа сверху
    tube('pendant_cord', mat('cord', lin('#2a2a2a'), 0.6), 0.006, 0.6, (0.95, 2.3, 2.45), sides=8)
    ball('pendant', look.glow('pendant', lin('#ffc27a'), 9.0), 0.13, (0.95, 2.3, 2.08), (1, 1, 0.8))
    lamp('POINT', (0.95, 2.3, 1.9), 60, (1.0, 0.78, 0.5), soft=0.13)
    # потолочный свет — тёплый, мягкий, неяркий: вечер
    lamp('AREA', (0.2, 0.6, 2.7), 60, (1.0, 0.84, 0.66), size=1.4)


def street():
    """Вечерняя улица за спиной звонящего (звонки не из дома): широкий тротуар, остановка со светлым щитом, мокрая
    дорога с лужами, на той стороне — дом: светлые витрины первого этажа без вывесок, окна выше, фонари, деревья.
    Размыта: огни — кругами."""
    asphalt = look.grain('asphalt', lin('#26282c'), lin('#3a3d41'), scale=42, rough=(0.45, 0.75), bump=0.25, puddles=0.6, puddle_level=0.55)
    walk = look.bricks('walk', lin('#4f5154'), lin('#5d5f63'), lin('#35373a'), size=(0.5, 0.5), gap=0.014, rough=0.6, bump=0.4, offset=0.0)
    facade = look.grain('facade', lin('#34373f'), lin('#42454d'), scale=1.5, rough=(0.8, 0.95))
    metal = mat('metal', lin('#3a3d42'), 0.4, metal=0.6)
    block('ground', asphalt, (60, 60, 0.05), (0, 10, -0.025), bevel=0)
    block('sidewalk', walk, (60, 8, 0.12), (0, 0.5, 0.06), bevel=0)
    block('curb', mat('curb', lin('#7d7b76'), 0.7), (60, 0.3, 0.16), (0, 4.6, 0.08))
    block('far_walk', walk, (60, 3, 0.12), (0, 13.5, 0.06), bevel=0)
    # дом напротив: первый этаж — светлые витрины без вывесок, выше — окна сеткой; какие горят — по номеру
    Y = 15.0
    block('house', facade, (40, 0.4, 18), (0, Y + 0.2, 9), bevel=0)
    kinds = {'warm': look.glow('warm_window', lin('#ffcf8a'), 4.0), 'amber': look.glow('amber_window', lin('#f0a55a'), 3.0),
             'cool': look.glow('cool_window', lin('#cfe2ff'), 2.6), 'dark': mat('dark_window', lin('#1a1d24'), 0.15)}
    panes = {k: look.Boxes(f'panes_{k}', m) for k, m in kinds.items()}
    order = ('dark', 'warm', 'dark', 'amber', 'dark', 'dark', 'cool', 'warm', 'dark')
    for i in range(24):
        for j in range(1, 6):
            panes[order[(i * 7 + j * 3 + (i * j) % 4) % len(order)]].add((0.9, 0.05, 1.2), (-17.25 + i * 1.5, Y - 0.02, 1.9 + j * 2.8))
    shop = {'warm': look.Boxes('shop_warm', look.glow('shop_warm', lin('#ffd9a8'), 1.5)), 'cool': look.Boxes('shop_cool', look.glow('shop_cool', lin('#d9e8ff'), 1.2)),
            'dark': panes['dark']}
    shops = ('warm', 'cool', 'dark', 'warm', 'cool', 'warm', 'cool', 'dark')
    bars = look.Boxes('shop_bars', mat('pier', lin('#2a2c31'), 0.7))
    for i in range(8):
        shop[shops[i]].add((3.9, 0.05, 2.2), (-15.75 + i * 4.5, Y - 0.02, 1.6))
        for k in (-1, 0, 1):
            bars.add((0.07, 0.08, 2.2), (-15.75 + i * 4.5 + k * 1.0, Y - 0.06, 1.6))
        bars.add((3.9, 0.08, 0.07), (-15.75 + i * 4.5, Y - 0.06, 2.2))
    shop['warm'].build()
    shop['cool'].build()
    bars.build()
    # машины у той стороны: тёмные кузова, красные и белые огни — в размытии кружки
    cars = look.Boxes('cars', mat('car', lin('#15181c'), 0.3))
    red, white = look.Boxes('car_red', look.glow('car_red', lin('#ff3a2a'), 9.0)), look.Boxes('car_white', look.glow('car_white', lin('#fff1d6'), 14.0))
    for x, lights in ((-3.4, red), (2.6, white), (7.6, red)):
        cars.add((4.2, 1.7, 0.9), (x, 11.0, 0.65))
        cars.add((2.2, 1.5, 0.6), (x - 0.2, 11.0, 1.35))
        for dx in (-1.9, -1.3) if lights is red else (1.3, 1.9):
            lights.add((0.1, 0.03, 0.05), (x + dx, 10.14, 0.78))
    cars.build()
    red.build()
    white.build()
    for b in panes.values():
        b.build()
    piers = look.Boxes('piers', mat('pier', lin('#2a2c31'), 0.7))
    for i in range(9):
        piers.add((0.6, 0.12, 3.2), (-18.0 + i * 4.5, Y - 0.06, 1.6))
    piers.add((40, 0.5, 0.25), (0, Y - 0.2, 3.05))
    piers.build()
    # фонари той стороны: столб и светящая голова — огни в размытии
    head = look.glow('lamp', lin('#ffd9a0'), 60.0)
    for i, x in enumerate((-7.5, -1.9, 4.6, 10.2)):
        block(f'far_pole{i}', metal, (0.1, 0.1, 4.0), (x, 12.4, 2.0), bevel=0)
        block(f'far_head{i}', head, (0.5, 0.2, 0.08), (x, 12.0, 3.95), bevel=0)
        lamp('SPOT', (x, 12.0, 3.8), 900, (1.0, 0.78, 0.5), spot=120, soft=0.15)
    # деревья той стороны — тёмные кроны
    leaf = look.grain('leaf', lin('#101815'), lin('#1d2823'), scale=3.0, rough=(0.8, 0.95), bump=0.4)
    for i, (x, r) in enumerate(((-10.5, 1.5), (13.0, 1.6))):
        tube(f'trunk{i}', mat('bark', lin('#231d19'), 0.9), 0.12, 3.0, (x, 13.4, 1.5), sides=8)
        for k, (dx, dz, q) in enumerate(((0, 0, 1.0), (0.8, -0.3, 0.7), (-0.7, 0.2, 0.75), (0.1, 0.8, 0.6))):
            ball(f'crown{i}_{k}', leaf, r * q, (x + dx * r, 13.4, 3.9 + dz * r))
    # остановка справа за спиной: крыша, стойки, стекло, светлый щит без рекламы, лавка
    ad = look.glow('ad', lin('#e9eef5'), 3.6)
    block('stop_roof', metal, (3.0, 1.5, 0.07), (2.2, 3.2, 2.5))
    for k, x in enumerate((0.8, 3.6)):
        block(f'stop_post{k}', metal, (0.07, 0.07, 2.45), (x, 3.85, 1.25), bevel=0)
    block('stop_ad', ad, (1.15, 0.06, 1.75), (2.9, 3.85, 1.3))
    block('stop_ad_frame', metal, (1.27, 0.05, 1.87), (2.9, 3.87, 1.3))
    block('stop_bench', look.grain('bench', lin('#5a3d28'), lin('#76533a'), scale=9, rough=(0.55, 0.8)), (1.5, 0.35, 0.05), (1.6, 3.6, 0.55))
    block('stop_tube', look.glow('stop_tube', lin('#e6f0ff'), 10.0), (2.4, 0.05, 0.03), (2.2, 3.2, 2.45), bevel=0)
    lamp('AREA', (2.2, 3.2, 2.4), 70, (0.86, 0.93, 1.0), size=2.4, size_y=0.3)
    # фонарь нашей стороны слева позади: тёплый контровой свет на волосы и плечо
    block('lamp_pole', metal, (0.1, 0.1, 5.2), (-2.6, 3.9, 2.6), bevel=0)
    block('lamp_arm', metal, (0.08, 1.1, 0.08), (-2.6, 3.4, 5.15), bevel=0)
    block('lamp_head', head, (0.22, 0.45, 0.08), (-2.6, 2.9, 5.08), bevel=0)
    sp = lamp('SPOT', (-2.6, 2.9, 5.0), 1500, (1.0, 0.8, 0.56), spot=115, soft=0.3)
    sp.rotation_euler = (Vector((0, 0, 1.6)) - sp.location).to_track_quat('-Z', 'Y').to_euler()
    # свет щита на спину и плечо — холодный
    lamp('AREA', (2.9, 3.7, 1.3), 80, (0.85, 0.9, 1.0), size=1.2, rot=(90, 0, 180))


ROOMS = {'kitchen': kitchen, 'street': street}
# небо за окнами и над улицей
SKY = {'kitchen': (0.02, 0.02, 0.025, 1), 'street': (0.02, 0.035, 0.08, 1)}


def person(spec):
    path = os.path.join(SRC, 'Assets', 'Avatars', spec['avatar'])
    tex_dir = os.path.join(os.path.dirname(os.path.dirname(path)), 'Textures')
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm)
    # у детей Rocketbox кости — «Bip02 …»: те же имена, что у взрослых (группы вершин переименуются вместе с костями)
    for b in arm.data.bones:
        if b.name.startswith('Bip02'):
            b.name = 'Bip01' + b.name[5:]
    # текстуры — из папки Textures рядом с Export
    for img in bpy.data.images:
        if img.filepath and not os.path.exists(bpy.path.abspath(img.filepath)):
            name = os.path.basename(img.filepath.replace('\\', '/'))
            alt = os.path.join(tex_dir, name)
            if os.path.exists(alt):
                img.filepath = alt
    for m in body.data.materials:
        m.blend_method = 'HASHED' if 'opacity' in m.name or 'glasses' in m.name else 'OPAQUE'
        # очки (у пожилой женщины): прозрачность стёкол — из альфы своей текстуры, импорт FBX её не подключает, и стёкла
        # выходят чёрной полосой
        if 'glasses' in m.name and m.use_nodes:
            nt = m.node_tree
            bsdf = nt.nodes.get('Principled BSDF')
            tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and 'opacity' in n.image.filepath), None)
            if bsdf and tex:
                nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        # пожилые (срез, С7): волосы седые — цвет волос без насыщенности и светлее, как седину в «Больнице» (cast.ts)
        if spec.get('grey') and 'opacity' in m.name and m.use_nodes:
            nt = m.node_tree
            bsdf = nt.nodes.get('Principled BSDF')
            link = next((l for l in nt.links if bsdf and l.to_node == bsdf and l.to_socket.name == 'Base Color'), None)
            if link:
                hs = nt.nodes.new('ShaderNodeHueSaturation')
                hs.inputs['Saturation'].default_value = 0.08
                hs.inputs['Value'].default_value = spec['grey']
                nt.links.new(link.from_socket, hs.inputs['Color'])
                nt.links.new(hs.outputs['Color'], bsdf.inputs['Base Color'])
    if spec.get('grey_head'):
        grey_head(body, spec['grey'])
    # сетка Rocketbox — грубая: сглаживаем грани и делим один раз, чтобы плечи, рукава и щёки не шли углами
    for poly in body.data.polygons:
        poly.use_smooth = True
    if not os.environ.get('CALLER_NO_SUBDIV'):
        sub = body.modifiers.new('smooth', 'SUBSURF')
        sub.levels = sub.render_levels = 1
        sub.uv_smooth = 'PRESERVE_BOUNDARIES'
        sub.boundary_smooth = 'PRESERVE_CORNERS'
    # FBX приносит действие с ключами поворота самого скелета: при рендере Blender пересчитывает кадр и возвращает
    # человека лицом к камере, как при импорте, — а кисть, телефон, камера и свет уже посчитаны для повёрнутого. До
    # 22.11.2026 так и выходило: тело стоит прямо, рука тянется к уху «повёрнутой» головы — кисть вывернута, телефон
    # висит у виска (игра владельца: «рука вывернута назад»). Действие снимаем: позу задаёт только этот скрипт.
    for ob in bpy.data.objects:
        ob.animation_data_clear()
    # при импорте человек стоит лицом к −y, к камере; yaw > 0 — поворот правым ухом (с телефоном) к камере
    arm.rotation_euler.z += math.radians(spec['yaw'])
    bpy.context.view_layer.update()
    return arm, body


def grey_head(body, value):
    """Седина в текстуре головы: у пожилой женщины светлые волосы нарисованы в самой текстуре, пряди — отдельно. Маску
    волос строим из самой текстуры Rocketbox: волосы темнее кожи и лежат вне лица и шеи развёртки; по маске — цвет без
    насыщенности и светлее. Маска живёт только в памяти Blender, в игру не попадает."""
    import numpy as np
    for m in body.data.materials:
        if 'head' not in m.name or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        link = next((l for l in nt.links if bsdf and l.to_node == bsdf and l.to_socket.name == 'Base Color'), None)
        tex = link.from_node if link else None
        if not tex or tex.type != 'TEX_IMAGE' or not tex.image:
            continue
        img = tex.image
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        n = 256
        lum = px.reshape(h, w, 4)[:, :, :3].mean(axis=2).reshape(n, h // n, n, w // n).mean(axis=(1, 3))

        def blur(a, r):
            for ax in (0, 1):
                c = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in (0, 1)], mode='edge'), axis=ax)
                a = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
            return a
        soft = blur(lum, 3)
        hair = np.clip((0.56 - soft) / 0.08, 0, 1)
        # развёртка: u вправо, v вверх. Лицо (глаза, нос, губы), уши, шея и плечи, рот и глаза внизу слева — не волосы
        v, u = np.mgrid[0:n, 0:n] / n
        keep = np.ones((n, n), dtype=np.float32)
        keep[(abs(u - 0.5) < 0.19) & (v > 0.47) & (v < 0.79)] = 0
        keep[(abs(abs(u - 0.5) - 0.26) < 0.045) & (v > 0.56) & (v < 0.72)] = 0
        keep[(v > 0.33) & (v < 0.56) & (abs(u - 0.5) < 0.42)] = 0
        keep[(u < 0.36) & (v < 0.42)] = 0
        keep[soft < 0.04] = 0
        mask = blur(hair * keep, 2)
        out = np.ones((n, n, 4), dtype=np.float32)
        out[:, :, 0] = out[:, :, 1] = out[:, :, 2] = mask
        mi = bpy.data.images.new('hair_mask', n, n, alpha=False, is_data=True)
        mi.pixels.foreach_set(out.ravel())
        mt = nt.nodes.new('ShaderNodeTexImage')
        mt.image = mi
        hs = nt.nodes.new('ShaderNodeHueSaturation')
        hs.inputs['Saturation'].default_value = 0.08
        hs.inputs['Value'].default_value = value
        nt.links.new(mt.outputs['Color'], hs.inputs['Fac'])
        nt.links.new(link.from_socket, hs.inputs['Color'])
        nt.links.new(hs.outputs['Color'], bsdf.inputs['Base Color'])
        if os.environ.get('CALLER_DEBUG'):
            mi.filepath_raw = os.path.join(os.environ.get('CALLER_PREVIEW', '/tmp'), 'hair-mask.png')
            mi.file_format = 'PNG'
            mi.save()


def bone_head(arm, name):
    return arm.matrix_world @ arm.pose.bones[name].head


HEAD_BOX = {}


def body_axes(arm):
    """Оси человека по его глазам: вправо — от левого глаза к правому, вверх — z, вперёд — вверх × вправо."""
    r = bone_head(arm, 'Bip01 REye') - bone_head(arm, 'Bip01 LEye')
    r.z = 0
    r.normalize()
    u = Vector((0, 0, 1))
    return r, u.cross(r), u


def head_box(arm):
    """Рамка головы в осях человека (вправо, вперёд, вверх) по вершинам сетки, привязанным к костям головы, — до позы."""
    if 'box' in HEAD_BOX:
        return HEAD_BOX['box']
    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm)
    # кость головы и кости лица под ней (щёки, челюсть, губы, веки): вес вершины — их сумма
    names = {'Bip01 Head'} | {b.name for b in arm.data.bones['Bip01 Head'].children_recursive}
    groups = {g.index for g in body.vertex_groups if g.name in names}
    axes = body_axes(arm)
    pts = []
    for v in body.data.vertices:
        if sum(ge.weight for ge in v.groups if ge.group in groups) > 0.6:
            pts.append(body.matrix_world @ v.co)
    pts = [tuple(p.dot(a) for a in axes) for p in pts]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    HEAD_BOX['box'] = (axes, lo, hi)
    HEAD_BOX['pts'] = pts
    return HEAD_BOX['box']


def at(axes, r, f, u):
    return axes[0] * r + axes[1] * f + axes[2] * u


def unit_rot(m):
    """Поворот без масштаба (скелет Rocketbox — в сантиметрах, масштаб 0,01)."""
    return m.to_3x3().normalized()


def phone_frame(arm):
    """Где телефон у правого уха, в позе покоя: оси (наружу от головы, поперёк, вдоль — от рта к уху) и середина.
    Экран лежит на ухе и на щеке: обе точки — по сетке головы, а не по её рамке, иначе низ телефона висит в воздухе
    в двух сантиметрах от щеки."""
    axes, lo, hi = head_box(arm)
    eye = bone_head(arm, 'Bip01 REye')
    mouth = bone_head(arm, 'Bip01 RMouthCorner')
    # мерка головы: у подростка она меньше — расстояния от глаза до уха и ото рта до щеки меньше во столько же
    k = (eye - bone_head(arm, 'Bip01 LEye')).length / 0.064
    ef, mf = eye.dot(axes[1]), mouth.dot(axes[1])

    def side(f, u, rad):
        """Самая правая точка головы рядом с (вперёд f, вверх u)."""
        near = [p[0] for p in HEAD_BOX['pts'] if (p[1] - f) ** 2 + (p[2] - u) ** 2 < rad * rad]
        return max(near) if near else hi[0]
    # ухо — на 10 см позади глаза, на его высоте; ушная раковина мягкая — телефон прижимает её (`EAR_PRESS`)
    f, u = ef - 0.1 * k, eye.z - 0.005
    ear = at(axes, side(f, u, 0.022 * k) - EAR_PRESS, f, u)
    # щека — позади угла рта, чуть ниже
    f, u = mf - 0.045 * k, mouth.z - 0.012 * k
    cheek = at(axes, side(f, u, 0.016 * k) + 0.001, f, u)
    if os.environ.get('CALLER_DEBUG'):
        rel = lambda v: tuple(round(v.dot(a), 3) for a in axes)
        print('DEBUG ухо', rel(ear), 'щека', rel(cheek), 'глаз', rel(eye), 'рот', rel(mouth), 'рамка', [round(v, 3) for v in lo], [round(v, 3) for v in hi], 'точек', len(HEAD_BOX['pts']))
    z = (ear - cheek).normalized()
    x = (axes[0] - z * axes[0].dot(z)).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    # динамик — у уха: верхний край телефона — на 3 см выше слухового прохода
    m.translation = ear + z * (0.03 - PHONE[2] / 2) + x * (PHONE[0] / 2)
    return m


# телефон: толщина, ширина, длина — метры; насколько он прижимает ухо
EAR_PRESS = float(os.environ.get('CALLER_EAR', '0.012'))
PHONE = (0.008, 0.072, 0.152)


def pose_call(arm, spec):
    """Правая рука держит телефон у правого уха, левая опущена, голова чуть к телефону. Возвращает место телефона.

    Хват (22.11.2026; игра владельца: «рука вывернута назад»). До этого кисть ставили двумя слежениями по осям кости
    (`TRACK_Y` к «пальцам», `LOCK_Y`/`TRACK_Z` «ладонью к голове»): какая ось кости — ладонь, подбирали по кадру, и
    ладонь смотрела вперёд, а не к голове; пальцы уходили назад к затылку, и при прямом локте вниз запястье ломалось
    назад почти под прямым углом. Теперь оси кисти меряются по самой руке в позе покоя — пальцы (от запястья к
    костяшке среднего), сторона большого пальца (от мизинца к указательному), ладонь (их произведение) — и кисть
    ставится поворотом целиком: ладонь — на тыльную сторону телефона, к голове; пальцы — наискось вверх по телефону,
    вдоль предплечья (запястье прямое), кончиками — за его передний край; большой палец — у заднего края."""
    head_box(arm)
    pb = arm.pose.bones
    mw = arm.matrix_world
    right, fwd, up = body_axes(arm)

    def target(name, loc=(0, 0, 0)):
        e = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(e)
        e.location = loc
        return e

    def rest_rot(name):
        return unit_rot(mw @ arm.data.bones[name].matrix_local)
    # оси кисти в позе покоя
    h0 = bone_head(arm, 'Bip01 R Hand')
    F0 = bone_head(arm, 'Bip01 R Finger2') - h0
    palm = F0.length
    F0.normalize()
    T0 = bone_head(arm, 'Bip01 R Finger1') - bone_head(arm, 'Bip01 R Finger4')
    T0 = (T0 - F0 * T0.dot(F0)).normalized()
    N0 = T0.cross(F0)   # из ладони наружу (правая рука)
    hand_rest = rest_rot('Bip01 R Hand')
    shoulder = bone_head(arm, 'Bip01 R UpperArm')
    phone = phone_frame(arm)
    # голова — чуть к телефону; телефон едет вместе с головой
    hb = pb['Bip01 Head']
    hb.rotation_mode = 'XYZ'
    hb.rotation_euler = (0, math.radians(8), 0)
    bpy.context.view_layer.update()
    phone = (mw @ hb.matrix) @ (mw @ arm.data.bones['Bip01 Head'].matrix_local).inverted() @ phone
    x, y, z = (phone.col[i].xyz.normalized() for i in range(3))
    # локоть — внизу, впереди и чуть сбоку от плеча: предплечье поднимается к уху почти вертикально
    er, eu, ef = (float(v) for v in os.environ.get('CALLER_ELBOW', spec.get('elbow', '0.12,-0.6,0.3')).split(','))
    wrist = target('ik_wrist')
    ik = pb['Bip01 R Hand'].constraints.new('IK')
    ik.target = wrist
    ik.pole_target = target('ik_elbow', shoulder + right * er + up * eu + fwd * ef)
    ik.pole_angle = math.radians(float(os.environ.get('CALLER_POLE', '0')))
    ik.use_tail = False
    ik.chain_count = 2
    aim = target('hand_aim')
    aim.rotation_mode = 'QUATERNION'
    cp = pb['Bip01 R Hand'].constraints.new('COPY_ROTATION')
    cp.target = aim
    cp.target_space = cp.owner_space = 'WORLD'
    # где на тыльной стороне телефона лежит костяшка среднего пальца (поперёк — к переднему краю, вдоль — от середины
    # к верху) и насколько кость запястья над телефоном: пятка ладони — у нижнего конца, пальцы уходят за передний край
    ky, kz, lift = (float(v) for v in os.environ.get('CALLER_GRIP', spec.get('grip', '0.02,-0.005,0.017')).split(','))
    N = -x
    # кисть отведена к мизинцу от линии предплечья — так телефон и держат: пальцы идут наискось к переднему краю
    ulnar = math.radians(float(os.environ.get('CALLER_ULNAR', '20')))
    ang = math.radians(25)
    fore = pb['Bip01 R Forearm']
    for _ in range(5):
        # пальцы — в плоскости телефона, наискось от его оси к переднему краю; угол — по предплечью
        F = z * math.cos(ang) + y * math.sin(ang)
        T = F.cross(N)
        rot = Matrix((F, T, N)).transposed() @ Matrix((F0, T0, N0))
        aim.rotation_quaternion = (rot @ hand_rest).to_quaternion()
        wrist.location = phone.translation + x * (PHONE[0] / 2 + lift) + y * ky + z * kz - F * palm
        bpy.context.view_layer.update()
        arm_dir = ((mw @ pb['Bip01 R Hand'].matrix).translation - (mw @ fore.matrix).translation).normalized()
        ang = min(math.radians(50), max(math.radians(10), math.atan2(arm_dir.dot(y), arm_dir.dot(z)) + ulnar))
    # пальцы согнуты вокруг телефона: ось сгиба — сторона большого пальца, от пальцев к ладони
    for f in range(1, 5):
        for k, sub in enumerate(('', '1', '2')):
            name = f'Bip01 R Finger{f}{sub}'
            if name in pb:
                b = pb[name]
                b.rotation_mode = 'AXIS_ANGLE'
                ax = rest_rot(name).inverted() @ T0
                # мизинец и безымянный согнуты сильнее — они у нижнего края
                b.rotation_axis_angle = (math.radians(CURL[k] * (1 + 0.12 * (f - 2))), *ax)
    # большой палец — к ладони, на задний край телефона
    tb = float(os.environ.get('CALLER_THUMB', '18'))
    for sub in ('', '1', '2'):
        name = f'Bip01 R Finger0{sub}'
        if name in pb:
            b = pb[name]
            b.rotation_mode = 'AXIS_ANGLE'
            ax = rest_rot(name).inverted() @ F0
            b.rotation_axis_angle = (math.radians(-tb if sub == '' else 0), *ax)
    # левая рука опущена
    hip = bone_head(arm, 'Bip01 Pelvis')
    left = -right
    ik_l = pb['Bip01 L Hand'].constraints.new('IK')
    ik_l.target = target('ik_hand_l', hip + left * 0.2 + fwd * 0.08 + up * -0.08)
    ik_l.pole_target = target('ik_elbow_l', hip + left * 0.35 + up * 0.25 + fwd * 0.02)
    ik_l.pole_angle = 0
    ik_l.use_tail = False
    ik_l.chain_count = 2
    bpy.context.view_layer.update()
    if os.environ.get('CALLER_DEBUG'):
        hm = mw @ pb['Bip01 R Hand'].matrix
        el = (mw @ fore.matrix).translation
        f = lambda v: '(' + ', '.join(f'{c:+.3f}' for c in v) + ')'
        rel = lambda v: f((v.dot(right), v.dot(fwd), v.z))
        print('DEBUG оси: вправо', f(right), 'вперёд', f(fwd))
        print('DEBUG (вправо, вперёд, вверх): плечо', rel(shoulder), 'локоть', rel(el), 'запястье', rel(hm.translation), 'цель', rel(wrist.location))
        print('DEBUG телефон', rel(phone.translation), 'ось', rel(z), 'наружу', rel(x), 'пальцы', rel(F), 'наклон', round(math.degrees(ang)))
        print('DEBUG излом запястья, градусы:', round(math.degrees(arm_dir.angle(F))), '— из них из плоскости ладони:', round(math.degrees(math.asin(arm_dir.dot(x)))))
    return phone


def phone_in_hand(phone):
    """Смартфон в правой руке, у уха: тонкая пластина 152 × 72 × 8 мм со скруглёнными углами, экраном к голове;
    наружу — матовая тёмная спинка в рамке и блок камер у верхнего края. До 22.11.2026 это была коробка со фаской
    4 мм — читалась чёрным клином или бруском."""
    import bmesh
    frame = mat('phone_frame', lin('#4a4e56'), 0.38, metal=0.9)
    back = mat('phone_back', lin('#1b1e24'), 0.62)
    back.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.3
    glass = mat('phone_glass', lin('#050506'), 0.12)
    ring = mat('phone_ring', lin('#6a6e76'), 0.3, metal=1.0)
    t, w, h = PHONE

    def plate(name, material, wy, hz, thick, radius, loc, bevel):
        """Пластина со скруглёнными углами: толщина — по x, ширина — по y, длина — по z."""
        bm = bmesh.new()
        ring_v = []
        for cy, cz, a0 in ((wy / 2 - radius, hz / 2 - radius, 0), (-wy / 2 + radius, hz / 2 - radius, 90),
                           (-wy / 2 + radius, -hz / 2 + radius, 180), (wy / 2 - radius, -hz / 2 + radius, 270)):
            for i in range(9):
                a = math.radians(a0 + i * 90 / 8)
                ring_v.append(bm.verts.new((-thick / 2, cy + radius * math.cos(a), cz + radius * math.sin(a))))
        face = bm.faces.new(ring_v)
        ext = bmesh.ops.extrude_face_region(bm, geom=[face])
        bmesh.ops.translate(bm, verts=[v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)], vec=(thick, 0, 0))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        ob.data.materials.append(material)
        if bevel:
            bev = ob.modifiers.new('bevel', 'BEVEL')
            bev.width = bevel
            bev.segments = 3
            bev.limit_method = 'ANGLE'
            bev.angle_limit = math.radians(50)
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.matrix_world = phone @ Matrix.Translation(loc)
        return ob
    ph = plate('mobile', frame, w, h, t, 0.011, (0, 0, 0), 0.0022)
    # спинка — наружу, экран — к голове: обе чуть выступают из рамки
    plate('mobile_back', back, w - 0.003, h - 0.003, 0.0012, 0.0098, (t / 2 - 0.0003, 0, 0), 0.0005)
    plate('mobile_screen', glass, w - 0.004, h - 0.004, 0.001, 0.0094, (-t / 2 + 0.0002, 0, 0), 0.0004)
    # блок камер — на спинке у верхнего края, со стороны затылка: пальцы его не закрывают
    cy, cz = -w / 2 + 0.021, h / 2 - 0.023
    plate('mobile_camera', back, 0.03, 0.034, 0.0022, 0.008, (t / 2 + 0.0014, cy, cz), 0.0007)
    for i, dz in enumerate((0.0075, -0.0075)):
        for name, material, r, d, out in ((f'mobile_ring{i}', ring, 0.0062, 0.0012, 0.0026), (f'mobile_lens{i}', glass, 0.0048, 0.0013, 0.0029)):
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=d)
            ob = bpy.context.object
            ob.name = name
            ob.data.materials.append(material)
            for p in ob.data.polygons:
                p.use_smooth = len(p.vertices) == 4
            ob.matrix_world = phone @ Matrix.Translation((t / 2 + out, cy, cz + dz)) @ Matrix.Rotation(math.radians(90), 4, 'Y')
    return ph


# кадр: макушка — на десятой части высоты от верха, глаза — на трети; камера — на высоте глаз, без наклона
HEAD_TOP, EYES = 0.10, 1 / 3


def camera(arm, body, spec):
    """Камера на высоте глаз человека, смотрит ровно по горизонту — у каждого своя высота, наклона нет. Глаза в кадре
    выше середины за счёт сдвига объектива (`shift_y`), а не наклона: вертикали комнаты остаются вертикалями, и потолок
    не занимает верх кадра. Крупность — по голове: от макушки до глаз у всех одна доля кадра.

    До 22.11.2026 камера стояла на 5 см ниже кости головы (у подбородка) и смотрела вверх, на точку выше себя (`look`
    до +0,04 у мужчины): снимок выходил «снизу вверх», полкадра — потолок (игра владельца)."""
    head = bone_head(arm, 'Bip01 Head')
    eyes = (bone_head(arm, 'Bip01 REye') + bone_head(arm, 'Bip01 LEye')) / 2
    deps = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(deps)
    me = ev.to_mesh()
    top = max((ev.matrix_world @ v.co).z for v in me.vertices)
    ev.to_mesh_clear()
    right, fwd, _ = body_axes(arm)
    # середина головы — позади глаз; кадр чуть сдвинут к руке с телефоном
    mid = eyes - fwd * 0.08 + right * 0.02
    mid.z = eyes.z
    loc = Vector((mid.x + 0.3, mid.y - 1.3, eyes.z))
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    cam.rotation_euler = (mid - loc).to_track_quat('-Z', 'Y').to_euler()
    height = (top - eyes.z) / (EYES - HEAD_TOP)   # сколько метров по высоте видит кадр на расстоянии человека
    cam.data.sensor_width = 36
    cam.data.lens = 36 * (mid - loc).length / (height * W / H)
    cam.data.shift_y = -(0.5 - EYES) * H / W
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (eyes - loc).length
    cam.data.dof.aperture_fstop = 2.8
    bpy.context.scene.camera = cam
    if os.environ.get('CALLER_DEBUG'):
        from bpy_extras.object_utils import world_to_camera_view
        sc = bpy.context.scene
        sc.render.resolution_x, sc.render.resolution_y = W, H
        bpy.context.view_layer.update()
        e = world_to_camera_view(sc, cam, eyes)
        t = world_to_camera_view(sc, cam, Vector((eyes.x, eyes.y, top)))
        print(f'DEBUG кадр: объектив {cam.data.lens:.1f} мм, высота камеры {loc.z:.3f}, макушка {top:.3f} — {(1 - t.y) * 100:.1f} % от верха, глаза — {(1 - e.y) * 100:.1f} %')
    # Свет на человека. Рука с телефоном — слева в кадре, поэтому рисующий свет — справа спереди: слева его закрывали
    # рука и телефон, и пол-лица уходило в тень. Слева сзади — контровой: отделяет волосы и плечо от фона.
    if spec['room'] == 'street':
        # улица: холодноватый мягкий свет витрины за спиной зрителя, слабое заполнение от неба
        key = lamp('AREA', head + Vector((1.0, -1.5, 0.35)), 85, (0.92, 0.95, 1.0), size=1.3)
        fill = lamp('AREA', head + Vector((-1.0, -1.6, -0.2)), 16, (0.7, 0.8, 1.0), size=1.6)
        rim = lamp('AREA', head + Vector((-1.1, 1.3, 0.7)), 90, (1.0, 0.76, 0.5), size=0.6)
    else:
        # кухня: тёплый мягкий свет лампы над столом, заполнение — от стен, контровой — холодный, от окна
        key = lamp('AREA', head + Vector((1.0, -1.4, 0.5)), 150, (1.0, 0.9, 0.78), size=1.3)
        fill = lamp('AREA', head + Vector((-1.0, -1.6, -0.1)), 26, (0.9, 0.92, 1.0), size=1.6)
        rim = lamp('AREA', head + Vector((-1.2, 1.2, 0.6)), 80, (0.7, 0.82, 1.0), size=0.6)
    for lt in (key, fill, rim):
        lt.rotation_euler = (head - lt.location).to_track_quat('-Z', 'Y').to_euler()
        lt.visible_camera = False
    return cam


def render(path, sky=SKY['kitchen']):
    scene = bpy.context.scene
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
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 86
    world = bpy.data.worlds.new('room')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = sky
    scene.world = world
    # отделка: мягкое свечение огней за спиной, лёгкое затемнение углов (blender/look.py)
    look.polish(scene, bloom=0.35, threshold=2.0, size=0.5, vignette=0.14)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def sha(path):
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    done = {}
    for cid, spec in CALLERS.items():
        if ONLY and cid not in ONLY:
            continue
        HEAD_BOX.clear()   # рамка головы — своя у каждого человека
        if os.environ.get('CALLER_YAW'):
            spec = {**spec, 'yaw': float(os.environ['CALLER_YAW'])}
        bpy.ops.wm.read_factory_settings(use_empty=True)
        ROOMS[spec['room']]()
        arm, body = person(spec)
        phone_in_hand(pose_call(arm, spec))
        camera(arm, body, spec)
        if os.environ.get('CALLER_DRY'):   # только числа позы и кадра (CALLER_DEBUG), без рендера
            continue
        if PREVIEW:
            out = os.path.join(os.environ.get('CALLER_PREVIEW', '/tmp'), f'caller-{cid}-preview.jpg')
            render(out, SKY[spec['room']])
            print('предпросмотр:', out)
            continue
        out = os.path.join(ROOT, 'assets', 'scenes', f'caller-{cid}.jpg')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        render(out, SKY[spec['room']])
        done[cid] = {'avatar': spec['avatar'], 'room': spec['room'], 'file': f'assets/scenes/caller-{cid}.jpg',
                     'sha256': sha(out), 'bytes': os.path.getsize(out)}
    if PREVIEW:
        return
    with open(os.path.join(ROOT, 'tools', 'people', 'sources.json'), encoding='utf-8') as fh:
        sources = json.load(fh)
    old = os.path.join(ROOT, 'assets', 'scenes', 'callers.json')
    if ONLY and os.path.exists(old):
        with open(old, encoding='utf-8') as fh:
            kept = json.load(fh).get('callers', {})
        done = {**{k: v for k, v in kept.items() if k not in done}, **done}
    passport = {
        'id': 'callers',
        'name': 'Звонящие для сцены «Разговор»: люди Microsoft Rocketbox в позе «телефон у уха»',
        'licence': 'люди — Microsoft Rocketbox, MIT (assets/licenses/rocketbox-LICENSE.md); комнаты, поза и рендер — своя работа студии',
        'made': {'script': 'blender/caller.py', 'blender': VERSION, 'engine': 'CYCLES', 'samples': SAMPLES,
                 'denoiser': 'OPENIMAGEDENOISE', 'seed': SEED, 'size': [W, H]},
        'rocketbox': {'repo': sources['repo'], 'commit': sources['commit']},
        'callers': done,
    }
    with open(os.path.join(ROOT, 'assets', 'scenes', 'callers.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(passport, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('звонящие:', ', '.join(done))


main()
