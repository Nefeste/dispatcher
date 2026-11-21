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
# кинематики: правая кисть — у правого уха, левая — опущена. Случайности нет, кроме шума Cycles с закреплённым зерном.
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
# ось кисти к ладони и сгиб пальцев (градусы по осям кости) — подобраны по кадру
PALM = os.environ.get('CALLER_PALM', 'TRACK_Z')
CURL = tuple(float(x) for x in os.environ.get('CALLER_CURL', '0,0,-45').split(','))
SAMPLES = 192 if not PREVIEW else 16
SEED = 11

# Звонящие прототипа: кто, какой человек Rocketbox, где стоит (комната), куда смотрит.
CALLERS = {
    'daughter': {
        'avatar': 'Adults/Female_Adult_02/Export/Female_Adult_02.fbx',
        'room': 'kitchen',
        'yaw': -28,
    },
    # мужчина дома: сын, муж, сосед, сам больной (часть П8)
    'man': {
        'avatar': 'Adults/Male_Adult_01/Export/Male_Adult_01.fbx',
        'room': 'kitchen',
        # повёрнут сильнее: при −28° рука с телефоном закрывала лицо
        'yaw': -50,
        # он выше: камера смотрит выше и чуть шире, чтобы голова не упиралась в край кадра
        'look': 0.04,
        'lens': 52,
    },
    # срез, С7: ещё четыре человека — пожилая женщина и пожилой мужчина (их пожилыми ведёт и «Больница», cast.ts),
    # молодая женщина и подросток, который звонит за родителя
    'grandma': {
        'avatar': 'Professions/Business_Female_02/Export/Business_Female_02.fbx',
        'room': 'kitchen',
        'yaw': -32,
        'grey': 1.7,
        'grey_head': True,
    },
    # пожилой мужчина и подросток: при −34…−46° предплечье закрывало рот — повёрнуты сильнее, запястье — дальше назад
    'grandpa': {
        'avatar': 'Adults/Male_Adult_03/Export/Male_Adult_03.fbx',
        'grey': 1.7,
        'room': 'kitchen',
        'yaw': -58,
        'wrist': '0.09,0.04',
        # он ниже остальных взрослых: тот же объектив, что у женщин, — иначе в кадре он мельче всех
        'look': -0.06,
        'lens': 60,
    },
    'young': {
        'avatar': 'Adults/Female_Adult_05/Export/Female_Adult_05.fbx',
        'room': 'kitchen',
        'yaw': -30,
    },
    'teen': {
        'avatar': 'Children/Male_Child_01/Export/Male_Child_01.fbx',
        'room': 'kitchen',
        'yaw': -58,
        'wrist': '0.09,0.04',
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
    arm.rotation_euler = (0, 0, math.radians(spec['yaw']))
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
    """Рамка головы в осях человека (вправо, вперёд, вверх) по вершинам сетки, привязанным к кости головы, — до позы."""
    if 'box' in HEAD_BOX:
        return HEAD_BOX['box']
    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm)
    g = body.vertex_groups.get('Bip01 Head')
    axes = body_axes(arm)
    pts = []
    for v in body.data.vertices:
        for ge in v.groups:
            if ge.group == g.index and ge.weight > 0.6:
                pts.append(body.matrix_world @ v.co)
    lo = [min(p.dot(a) for p in pts) for a in axes]
    hi = [max(p.dot(a) for p in pts) for a in axes]
    HEAD_BOX['box'] = (axes, lo, hi)
    return HEAD_BOX['box']


def at(axes, r, f, u):
    return axes[0] * r + axes[1] * f + axes[2] * u


def phone_line(arm):
    """Верх и низ телефона у правого уха: от уха (край головы на высоте глаз) к щеке у рта."""
    axes, lo, hi = head_box(arm)
    eye = bone_head(arm, 'Bip01 REye')
    mouth = bone_head(arm, 'Bip01 RMouthCorner')
    ef, mf = eye.dot(axes[1]), mouth.dot(axes[1])
    # ухо — сбоку головы, на 8–9 см позади глаза и чуть ниже; низ телефона — у щеки, рядом с углом рта
    top = at(axes, hi[0] + 0.006, ef - 0.115, eye.z - 0.01)
    bottom = at(axes, hi[0] - 0.006, mf - 0.06, mouth.z - 0.02)
    return top, bottom


def pose_call(arm, spec):
    """Правая кисть — у правого уха, локоть вниз и вбок; левая рука опущена; голова чуть к телефону."""
    head_box(arm)
    pb = arm.pose.bones
    head = bone_head(arm, 'Bip01 Head')
    right, fwd, _ = body_axes(arm)
    def target(name, loc):
        e = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(e)
        e.location = loc
        return e
    up = Vector((0, 0, 1))
    # запястье — под телефоном у уха: телефон в ладони прижат к уху (точки лица — по костям глаза и угла рта)
    top, bottom = phone_line(arm)
    # хват — по фотографиям людей с телефоном у уха (Викисклад, 20.11.2026; docs/13-art.md, «Звонящий»): запястье — у
    # нижнего переднего края телефона, у челюсти; пальцы — поперёк тыльной стороны телефона, к затылку, и обхватывают его
    # дальний край; ладонь — к щеке; предплечье уходит вниз. У 0.11.0 пальцы смотрели вверх вдоль телефона — владелец:
    # «кисть всё ещё неудовлетворительно».
    z = (top - bottom).normalized()
    out = (right - z * right.dot(z)).normalized()
    # пальцы — назад к затылку (по горизонтали), чуть вверх и внутрь, к голове: кончики ложатся за ухом
    fb, fu, fi = (float(x) for x in os.environ.get('CALLER_FINGERS', spec.get('fingers', '0.85,0.35,0.25')).split(','))
    fingers = (-fwd * fb + up * fu - out * fi).normalized()
    # середина ладони — над серединой телефона (он — у щеки, `phone_in_hand`), запястье — на `wl` назад по пальцам
    wl, wo = (float(x) for x in os.environ.get('CALLER_WRIST', spec.get('wrist', '0.06,0.025')).split(','))
    phone = (top + bottom) / 2 + right * 0.012
    ear = target('ik_ear', phone - fingers * wl + out * wo)
    # локоть — внизу у рёбер, сбоку и чуть позади: плечо вдоль тела, предплечье поднимается к лицу почти вертикально, как
    # на фотографиях (у 0.9.0 подсказка стояла впереди — локоть уходил перед грудь; у 0.11.0 — сбоку на уровне груди, и
    # предплечье шло по диагонали через низ лица; владелец, 20.11.2026)
    er, eu, ef = (float(x) for x in os.environ.get('CALLER_ELBOW', spec.get('elbow', '0.25,-0.9,-0.05')).split(','))
    elbow = target('ik_elbow', head + right * er + up * eu + fwd * ef)
    ik = pb['Bip01 R Hand'].constraints.new('IK')
    ik.target = ear
    ik.pole_target = elbow
    ik.pole_angle = math.radians(float(os.environ.get('CALLER_POLE', '0')))
    ik.use_tail = False
    ik.chain_count = 2
    hip = bone_head(arm, 'Bip01 Pelvis')
    left = -right
    low = target('ik_hand_l', hip + left * 0.2 + fwd * 0.08 + up * -0.08)
    low_elbow = target('ik_elbow_l', hip + left * 0.35 + up * 0.25 + fwd * 0.02)
    ik_l = pb['Bip01 L Hand'].constraints.new('IK')
    ik_l.target = low
    ik_l.pole_target = low_elbow
    ik_l.pole_angle = 0
    ik_l.use_tail = False
    ik_l.chain_count = 2
    # кисть: пальцы — по `fingers`; ладонь — к голове; пальцы согнуты вокруг телефона
    axes, lo, hi = head_box(arm)
    center = at(axes, *[(x + y) / 2 for x, y in zip(lo, hi)])
    up_t = target('hand_up', ear.location + fingers * 0.3)
    tr = pb['Bip01 R Hand'].constraints.new('DAMPED_TRACK')
    tr.target = up_t
    tr.track_axis = 'TRACK_Y'
    lk = pb['Bip01 R Hand'].constraints.new('LOCKED_TRACK')
    lk.target = target('hand_palm', center)
    lk.lock_axis = 'LOCK_Y'
    lk.track_axis = PALM
    for f in range(5):
        for k, sub in enumerate(('', '1', '2')):
            name = f'Bip01 R Finger{f}{sub}'
            if name in pb:
                b = pb[name]
                b.rotation_mode = 'XYZ'
                b.rotation_euler = tuple(math.radians(a * (0.6 if f == 0 else 1)) for a in CURL)
    pb['Bip01 Head'].rotation_mode = 'XYZ'
    pb['Bip01 Head'].rotation_euler = (0, math.radians(8), 0)
    bpy.context.view_layer.update()
    if os.environ.get('CALLER_DEBUG'):
        hm = arm.matrix_world @ pb['Bip01 R Hand'].matrix
        f = lambda v: '(' + ', '.join(f'{c:+.2f}' for c in v) + ')'
        print('DEBUG right', f(right), 'fwd', f(fwd), 'z', f(z), 'out', f(out), 'fingers', f(fingers))
        print('DEBUG hand x', f(hm.col[0].xyz.normalized()), 'y', f(hm.col[1].xyz.normalized()), 'z', f(hm.col[2].xyz.normalized()))
        print('DEBUG wrist', f(hm.translation), 'target', f(ear.location), 'aim', f(up_t.location), 'phone top', f(top), 'bottom', f(bottom))
        mid = arm.matrix_world @ pb['Bip01 R Finger2'].head
        print('DEBUG middle finger base', f(mid))
        print('DEBUG head', f(head), 'REye', f(bone_head(arm, 'Bip01 REye')), 'LEye', f(bone_head(arm, 'Bip01 LEye')))
        print('DEBUG head box center', f(center), 'camera side ~ head + (0.3, -1.3)')
    return ear


def phone_in_hand(arm, ear):
    """Мобильный телефон в правой руке, у уха: тёмный матовый корпус со скруглёнными краями, на тыльной стороне —
    блок камеры."""
    # тёмный и матовый: глянцевый на скользящем угле отражал светлую стену и выходил серой пластиной
    body = mat('phone', lin('#0b0c0e'), 0.85)
    body.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.12
    lens = mat('phone_lens', lin('#050506'), 0.25)
    lens.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.3
    right, _, _ = body_axes(arm)
    top, bottom = phone_line(arm)
    z = (top - bottom).normalized()
    x = (right - z * right.dot(z)).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = (top + bottom) / 2 + right * 0.012

    def part(name, material, size, loc, bevel):
        bpy.ops.mesh.primitive_cube_add(size=1)
        ob = bpy.context.object
        ob.name = name
        ob.scale = size
        bpy.ops.object.transform_apply(scale=True)
        ob.data.materials.append(material)
        bev = ob.modifiers.new('bevel', 'BEVEL')
        bev.width = bevel
        bev.segments = 4
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.matrix_world = m @ Matrix.Translation(loc)
        return ob
    ph = part('mobile', body, (0.0095, 0.074, 0.152), (0, 0, 0), 0.0042)
    # блок камеры — на тыльной стороне (она смотрит наружу, от головы), у верхнего края
    part('mobile_camera', body, (0.004, 0.032, 0.034), (0.006, -0.014, 0.05), 0.0018)
    part('mobile_lens', lens, (0.002, 0.012, 0.012), (0.0085, -0.02, 0.056), 0.0009)
    part('mobile_lens2', lens, (0.002, 0.012, 0.012), (0.0085, -0.02, 0.041), 0.0009)
    return ph


def camera(arm, spec):
    head = bone_head(arm, 'Bip01 Head')
    fwd = arm.matrix_world.to_quaternion() @ Vector((0, -1, 0))
    bpy.ops.object.camera_add(location=head + Vector((0.3, -1.3, -0.05)))
    cam = bpy.context.object
    look = head + Vector((0.02, 0, spec.get('look', -0.12)))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = spec.get('lens', 62)
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (head - cam.location).length
    cam.data.dof.aperture_fstop = 2.8
    bpy.context.scene.camera = cam
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
    _ = fwd
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
        arm, _ = person(spec)
        ear = pose_call(arm, spec)
        phone_in_hand(arm, ear)
        camera(arm, spec)
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
