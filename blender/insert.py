# Видеовставки (ADR 0009; docs/08-game-design.md, §5, §9 и §11; docs/13-art.md, «Сцены»): вечер, двор подстанции.
# «Бригада выезжает» (depart, 5 с) — машина скорой выезжает из гаража и уходит из кадра; «начало смены» (start, 4 с,
# часть П8) — машина стоит у ворот гаража, камера медленно подходит. Вставки на месте вызова (срез, С4):
# «у подъезда» (door) — машина у подъезда жилого дома, маячки на стене; «на остановке» (stop) — машина у остановки;
# «в квартире» (flat) — прихожая, открытая дверь, укладка бригады у порога (3 с каждая). Людей во вставках нет: игра не показывает
# помощь (ADR 0007). Blender строит всё своим кодом, Cycles рендерит кадры, ffmpeg собирает ролик H.264; один кадр —
# картинка для «Меньше движения».
#
# Запуск: python blender/insert.py [--insert=depart|start|door|stop|flat] [--preview]
# Пишет (<вид> — depart, start, door, stop или flat):
# - assets/scenes/insert-<вид>.mp4 — ролик 540 × 960, 24 кадра в секунду;
# - assets/scenes/insert-<вид>.jpg — один кадр вместо ролика;
# - assets/scenes/inserts.json — паспорт обеих вставок: версия Blender, рендер, кадры, ffmpeg, отпечатки файлов.
# --preview — три кадра малым размером в папку INSERT_FRAMES, для подбора камеры; файлы игры не трогает;
# --preview --full — те же три кадра размером и качеством ролика.
#
# Машина — по ГОСТ Р 50574-2019 (docs/09-content.md, «Машина скорой»): класс B, кузов белый, по борту красная полоса
# на уровне ручек с надписью «СКОРАЯ МЕДИЦИНСКАЯ ПОМОЩЬ» белым, маячки синие на крыше спереди и сзади. Эмблему
# «Красный Крест» не рисуем: её охраняют Женевские конвенции (решение агента — docs/specs/2026-11-prototype.md, §12).
# Марка не изображается: кузов — условный фургон с высокой крышей.
import bpy  # noqa: I001 — bpy первым: без него нет bmesh

import bmesh
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import look  # noqa: E402 — общие материалы и отделка кадра

VERSION = '4.5.15'
if bpy.app.version_string.split(' ')[0] != VERSION:
    sys.exit(f'нужен Blender {VERSION}, а это {bpy.app.version_string}')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREVIEW = '--preview' in sys.argv
# какая вставка: depart — «бригада выезжает» (первый выезд), start — «начало смены» (часть П8): тот же двор, машина у
# гаража, камера медленно подходит
INSERT = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--insert=')), 'depart')
KINDS = ('depart', 'start', 'door', 'stop', 'flat')
if INSERT not in KINDS:
    sys.exit('--insert=' + '|'.join(KINDS))
# --preview --full — те же три кадра, но размером и качеством ролика: посмотреть кадр до долгого рендера
FULL = '--full' in sys.argv
W, H = (540, 960) if not PREVIEW or FULL else (270, 480)
FPS = 24
# на месте вызова — 3 с и 16 проходов: камера едва движется, шум снимает OIDN, рендер втрое короче
ON_SCENE = INSERT in ('door', 'stop', 'flat')
SECONDS = 5 if INSERT == 'depart' else 3 if ON_SCENE else 4
FRAMES = FPS * SECONDS
SAMPLES = (16 if ON_SCENE else 24) if not PREVIEW or FULL else 8
SEED = 5
STILL = {'depart': 84, 'start': 72}.get(INSERT, 48)  # кадр для «Меньше движения»: машина во дворе, видна полоса с надписью
FONT = os.path.join(ROOT, 'node_modules', '@expo-google-fonts', 'onest', '600SemiBold', 'Onest_600SemiBold.ttf')
# маячки — мягкое мерцание 1,5 раза в секунду, без резких вспышек
BEACON_HZ = 1.5
# свет маячка на стены и асфальт, ватты в пике
BEACON_W = 900


lin = look.lin


def mat(name, color, rough=0.5, metal=0.0, coat=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    if emit is not None:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = strength
    return m


def block(name, material, size, loc, bevel=0.0, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=tuple(math.radians(a) for a in rot))
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(material)
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 3
        b.limit_method = 'ANGLE'
        for p in ob.data.polygons:
            p.use_smooth = True
    if parent:
        ob.parent = parent
    return ob


def tube(name, material, radius, depth, loc, rot=(0, 0, 0), parent=None, sides=24, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=depth, location=loc,
                                        rotation=tuple(math.radians(a) for a in rot))
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(material)
    for p in ob.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 3
        b.limit_method = 'ANGLE'
        b.angle_limit = math.radians(50)
    if parent:
        ob.parent = parent
    return ob


def blob(name, material, radius, loc, squash=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = squash
    ob.data.materials.append(material)
    return ob


def light(kind, loc, energy, color, name=None, size=None, spot=None, rot=None, parent=None, soft=None):
    bpy.ops.object.light_add(type=kind, location=loc)
    ob = bpy.context.object
    if name:
        ob.name = name
    ob.data.energy = energy
    ob.data.color = color
    if size is not None:
        ob.data.size = size
    if spot is not None:
        ob.data.spot_size = math.radians(spot)
        ob.data.spot_blend = 0.6
    if soft is not None:
        ob.data.shadow_soft_size = soft
    if rot is not None:
        ob.rotation_euler = tuple(math.radians(a) for a in rot)
    if parent:
        ob.parent = parent
    return ob


def wet_asphalt(name='asphalt', level=0.6):
    """Мокрый вечерний асфальт: зерно и лужи — в них отражаются огни."""
    return look.grain(name, lin('#2c2f33'), lin('#44484c'), scale=42, rough=(0.5, 0.8), bump=0.25, puddles=0.55,
                      puddle_level=level)


def dusk_world(top='#0c1326', mid='#33466f', horizon='#8b7f8f', strength=0.6, clouds=0.55):
    """Небо в сумерках: у горизонта — светлая тёплая полоса, выше — синее, в зените — тёмное."""
    world = bpy.data.worlds.new('dusk')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(coord.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, lin(horizon)
    e[1].position, e[1].color = 0.55, lin(top)
    m = e.new(0.16)
    m.color = lin(mid)
    # редкие облака: чуть светлее неба, вытянуты вдоль горизонта
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1.0, 1.0, 5.0)
    nt.links.new(coord.outputs['Generated'], mp.inputs['Vector'])
    cloud = nt.nodes.new('ShaderNodeTexNoise')
    cloud.inputs['Scale'].default_value = 2.6
    cloud.inputs['Detail'].default_value = 5.0
    nt.links.new(mp.outputs['Vector'], cloud.inputs['Vector'])
    cut = nt.nodes.new('ShaderNodeMapRange')
    cut.inputs['From Min'].default_value, cut.inputs['From Max'].default_value = 0.5, 0.75
    cut.inputs['To Max'].default_value = clouds
    nt.links.new(cloud.outputs['Fac'], cut.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.inputs['Color2'].default_value = lin('#56618a')
    nt.links.new(cut.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['Color1'])
    nt.links.new(mix.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = world


def tree(name, loc, height=6.0, crown=2.2):
    """Дерево: ствол и крона из нескольких комьев; места комьев — по счёту."""
    bark = mat('bark', lin('#231d19'), 0.9)
    leaf = look.grain('leaf', lin('#141d1a'), lin('#25322b'), scale=3.0, rough=(0.8, 0.95), bump=0.4)
    x, y, z = loc
    tube(name + '_trunk', bark, 0.16, height * 0.6, (x, y, z + height * 0.3), sides=10)
    for i in range(11):
        # комья кроны — по кругу и по высоте, размеры по счёту
        ang, ring = i * 2.4, (0.0 if i == 0 else 0.75)
        k = (1.0, 0.62, 0.7, 0.55, 0.66, 0.5, 0.6, 0.72, 0.48, 0.58, 0.52)[i]
        dz = (0.0, -0.5, 0.2, 0.75, -0.25, 0.9, 0.45, -0.6, 1.1, 0.1, -0.1)[i]
        ob = blob(f'{name}_c{i}', leaf, crown * k, (x + math.cos(ang) * ring * crown, y + math.sin(ang) * ring * crown,
                                                    z + height * 0.72 + dz * crown * 0.6), (1, 1, 0.9))
        for p in ob.data.polygons:
            p.use_smooth = True


def lamp_post(name, loc, energy=1400, arm=1.4, toward=-90, height=6.5, color=(1.0, 0.74, 0.42)):
    """Уличный фонарь: столб, вынос и светящая голова; свет — тёплый, вниз. toward — куда вынос, градусы от оси x."""
    pole = mat('pole', lin('#2a2d30'), 0.5, metal=0.6)
    head = look.glow('lamp_head', lin('#ffd9a0'), 45.0)
    x, y = loc[0], loc[1]
    dx, dy = math.cos(math.radians(toward)), math.sin(math.radians(toward))
    tube(name + '_pole', pole, 0.075, height, (x, y, height / 2), sides=12)
    tube(name + '_base', pole, 0.12, 0.8, (x, y, 0.4), sides=12)
    block(name + '_arm', pole, (arm, 0.07, 0.07), (x + dx * arm / 2, y + dy * arm / 2, height - 0.05), rot=(0, 0, toward))
    block(name + '_shade', pole, (0.6, 0.26, 0.1), (x + dx * (arm + 0.2), y + dy * (arm + 0.2), height - 0.05), rot=(0, 0, toward), bevel=0.03)
    block(name + '_head', head, (0.44, 0.18, 0.03), (x + dx * (arm + 0.2), y + dy * (arm + 0.2), height - 0.11), rot=(0, 0, toward))
    light('SPOT', (x + dx * (arm + 0.2), y + dy * (arm + 0.2), height - 0.2), energy, color, name=name, spot=125, soft=0.12)


def yard():
    """Двор подстанции вечером: мокрый асфальт с разметкой, двухэтажное здание с поднятыми воротами гаража и вывеской,
    фонарь, забор, деревья, мачта связи, дома вдали, небо в сумерках."""
    asphalt = wet_asphalt()
    wall = look.bricks('wall', lin('#a39a8a'), lin('#b5ad9d'), lin('#77726a'), size=(0.26, 0.085), gap=0.012, rough=0.85, bump=0.5,
                       turn=(math.radians(90), 0, 0))
    plinth = look.grain('plinth', lin('#5a5c5e'), lin('#6e7071'), scale=14, rough=(0.7, 0.9))
    trim = mat('trim', lin('#7a7d80'), 0.6)
    inside = look.grain('inside', lin('#5b5e60'), lin('#6c6f70'), scale=5, rough=(0.8, 0.95), bump=0.1)
    block('ground', asphalt, (60, 60, 0.1), (0, 0, -0.05))
    # разметка стоянки и стоп-линия у ворот — стёртая белая краска
    paint = look.grain('paint', lin('#8d8f8c'), lin('#c9cac4'), scale=30, rough=(0.5, 0.8), bump=0.05)
    lines = look.Boxes('lines', paint)
    for x in (-9.5, -6.5, 6.5, 9.5):
        lines.add((0.12, 4.2, 0.012), (x, 1.5, 0.004))
    lines.add((6.6, 0.16, 0.012), (0, 3.2, 0.004))
    lines.build()
    block('curb', look.grain('curb', lin('#6c6e70'), lin('#8a8c8c'), scale=20, rough=(0.6, 0.85)), (60, 0.3, 0.16), (0, -6.5, 0.08), bevel=0.02)
    # ближе к зрителю — выезд: тротуар за бордюром, кусты, фонарь у выезда
    block('verge', look.bricks('walk', lin('#55575a'), lin('#63656a'), lin('#3b3d40'), size=(0.5, 0.5), gap=0.014, rough=0.7, bump=0.4, offset=0.0),
          (60, 6.0, 0.14), (0, -9.65, 0.07))
    for i, x in enumerate((7.4, 9.0, -9.5, -11.0)):
        bush(f'verge_bush{i}', x, -7.4, 0.6 + (i % 2) * 0.12)
    lamp_post('gate_lamp_post', (5.2, -7.5), energy=2600, toward=180, arm=1.8)
    # здание: два этажа, стена с проёмом ворот, внутри гаража — свет
    block('wall_left', wall, (9, 0.4, 7.4), (-8.0, 4.0, 3.7))
    block('wall_right', wall, (9, 0.4, 7.4), (8.0, 4.0, 3.7))
    block('wall_top', wall, (7, 0.4, 3.8), (0, 4.0, 5.5))
    block('plinth_l', plinth, (9, 0.46, 0.7), (-8.0, 4.0, 0.35))
    block('plinth_r', plinth, (9, 0.46, 0.7), (8.0, 4.0, 0.35))
    block('parapet', trim, (25.2, 0.6, 0.22), (0, 4.0, 7.5), bevel=0.03)
    block('gate_frame', trim, (7.3, 0.5, 0.22), (0, 3.95, 3.6), bevel=0.02)
    for i, x in enumerate((-3.58, 3.58)):
        block(f'gate_post{i}', trim, (0.18, 0.5, 3.6), (x, 3.95, 1.8), bevel=0.02)
    # поднятые рольворота: рейки
    block('gate_shutter', look.stripes('shutter', lin('#6d7073'), lin('#8b8e90'), width=0.11, rough=0.45, axis=2),
          (6.98, 0.3, 0.75), (0, 3.95, 3.12))
    block('garage_back', inside, (7, 0.2, 5), (0, 12.0, 2.5))
    block('garage_floor', look.grain('gfloor', lin('#57595a'), lin('#6a6c6b'), scale=6, rough=(0.25, 0.55), bump=0.05), (7, 8, 0.05), (0, 8.0, 0.02))
    block('garage_side_l', inside, (0.2, 8, 5), (-3.5, 8.0, 2.5))
    block('garage_side_r', inside, (0.2, 8, 5), (3.5, 8.0, 2.5))
    block('garage_roof', inside, (7.4, 8.4, 0.2), (0, 8.0, 5.0))
    # в гараже: полоса безопасности на стенах, стеллаж, светильники-линии
    band = look.Boxes('garage_band', mat('garage_band', lin('#c9a23a'), 0.6))
    for x in (-3.38, 3.38):
        band.add((0.02, 8, 0.18), (x, 8.0, 1.1))
    band.add((6.8, 0.02, 0.18), (0, 11.88, 1.1))
    band.build()
    shelf = look.Boxes('garage_shelf', mat('shelf', lin('#3b4046'), 0.5, metal=0.5))
    for z in (0.5, 1.2, 1.9):
        shelf.add((1.8, 0.5, 0.05), (2.3, 11.55, z))
    for x in (1.42, 3.18):
        shelf.add((0.06, 0.5, 2.1), (x, 11.55, 1.05))
    shelf.build()
    crates = look.Boxes('garage_crates', mat('crate', lin('#8b4a2c'), 0.7))
    for x, z, w in ((1.8, 0.7, 0.5), (2.6, 0.7, 0.6), (2.1, 1.4, 0.7), (2.8, 2.1, 0.45)):
        crates.add((w, 0.4, 0.32), (x, 11.55, z))
    crates.build()
    tube_m = look.glow('garage_tube', lin('#fff1d6'), 9.0)
    for i, x in enumerate((-2.0, 2.0)):
        block(f'garage_tube{i}', tube_m, (0.12, 2.4, 0.05), (x, 8.0, 4.86))
        lamp = light('AREA', (x, 8.0, 4.78), 520, (1.0, 0.94, 0.84), name=f'garage_lamp{i}', size=1.5, rot=(180, 0, 0))
        lamp.visible_camera = False
    # окна: первый этаж и второй; часть горит тёплым, часть — тёмные, с рамой и подоконником
    frame = mat('wframe', lin('#d9d6cc'), 0.5)
    frames, sills = look.Boxes('frames', frame), look.Boxes('sills', trim)
    warm = look.glow('windows', lin('#eebf7c'), 2.2)
    cool = look.glow('windows_cool', lin('#c3d6ea'), 1.5)
    dark = mat('window_dark', lin('#141a22'), 0.08, coat=0.6)
    panes = {'warm': look.Boxes('panes_warm', warm), 'cool': look.Boxes('panes_cool', cool), 'dark': look.Boxes('panes_dark', dark)}
    k = 0
    for z in (2.5, 5.7):
        for x in (-11.2, -8.6, -6.0, 6.0, 8.6, 11.2, -2.4, 0.0, 2.4):
            if z < 4 and abs(x) < 4:
                continue
            kind = ('warm', 'dark', 'cool', 'warm', 'dark', 'warm', 'dark')[k % 7]
            k += 1
            frames.add((1.36, 0.08, 1.56), (x, 3.8, z))
            panes[kind].add((0.58, 0.05, 1.36), (x - 0.31, 3.765, z))
            panes[kind].add((0.58, 0.05, 1.36), (x + 0.31, 3.765, z))
            sills.add((1.5, 0.16, 0.05), (x, 3.74, z - 0.8))
    for b in (frames, sills, *panes.values()):
        b.build()
    # вывеска над воротами: подстанция — условная, без номера и названия города
    board = mat('board', lin('#1d3557'), 0.5)
    block('sign', board, (5.6, 0.06, 0.62), (0, 3.77, 4.25), bevel=0.01)
    text('sign_text', 'ПОДСТАНЦИЯ СКОРОЙ МЕДИЦИНСКОЙ ПОМОЩИ', 0.2, mat('sign_letters', lin('#f3f1ea'), 0.5, emit=lin('#f3f1ea'), strength=0.5),
         (0, 3.73, 4.25), (90, 0, 0), None)
    light('SPOT', (0, 2.9, 4.95), 60, (1.0, 0.9, 0.75), name='sign_lamp', spot=95, rot=(-55, 0, 0), soft=0.05)
    # светильник у ворот, водосточная труба, дверь персонала с козырьком
    for i, x in enumerate((-3.95, 3.95)):
        block(f'gate_lamp{i}', look.glow('gate_lamp', lin('#ffe1b0'), 22.0), (0.16, 0.1, 0.24), (x, 3.75, 3.2), bevel=0.02)
        light('POINT', (x, 3.5, 3.15), 45, (1.0, 0.82, 0.58), name=f'gate_lamp_l{i}', soft=0.1)
    pipe = mat('pipe', lin('#4a4e52'), 0.4, metal=0.7)
    tube('downpipe', pipe, 0.07, 7.2, (-4.6, 3.72, 3.6), sides=10)
    block('staff_door', mat('staff_door', lin('#39444d'), 0.45, metal=0.3), (1.0, 0.08, 2.1), (7.3, 3.78, 1.05), bevel=0.02)
    block('staff_canopy', trim, (1.5, 0.9, 0.08), (7.3, 3.4, 2.35))
    light('POINT', (7.3, 3.3, 2.15), 25, (1.0, 0.85, 0.62), name='staff_lamp', soft=0.08)
    # мачта связи на крыше: радио бригад; красный огонь наверху
    tube('mast', pipe, 0.05, 5.0, (9.5, 6.0, 10.0), sides=8)
    for z in (9.0, 10.5, 12.0):
        block(f'mast_bar{z}', pipe, (0.9, 0.03, 0.03), (9.5, 6.0, z))
    blob('mast_light', look.glow('mast_light', lin('#ff3b30'), 14.0), 0.07, (9.5, 6.0, 12.55))
    # фонарь во дворе — справа, в стороне от пути машины
    lamp_post('yard_lamp', (5.6, -1.2), energy=1700, toward=165)
    # забор слева вдоль двора и деревья за ним
    fence = look.Boxes('fence', mat('fence', lin('#33383c'), 0.5, metal=0.4))
    for i in range(22):
        fence.add((0.05, 0.05, 1.7), (-13.0, -8 + i * 0.6, 0.85))
    for z in (0.3, 1.6):
        fence.add((0.04, 13.0, 0.05), (-13.0, -1.7, z))
    fence.build()
    for i, (x, y, h, c) in enumerate(((-15.5, 6, 7.5, 2.6), (-16.5, -1, 6.5, 2.3), (15.5, 8, 8.0, 2.8), (19.0, 2, 6.5, 2.4), (-12.5, 12, 7.0, 2.4))):
        tree(f'tree{i}', (x, y, 0), h, c)
    # дома вдали — силуэты; часть окон горит (какие — по счёту, без случайности)
    city = mat('city', lin('#161d27'), 0.9)
    lit, lit2 = look.Boxes('city_lit', look.glow('lit', lin('#f0c27a'), 4.0)), look.Boxes('city_lit2', look.glow('lit2', lin('#bcd2ea'), 2.6))
    for i, (x, w, h) in enumerate(((-21, 9, 21), (-9, 7, 32), (2, 10, 19), (13, 7, 27), (23, 9, 36))):
        y = 38 + (i % 2) * 7
        block(f'house{i}', city, (w, 6, h), (x, y, h / 2))
        block(f'house{i}_cap', city, (w * 0.35, 3, 1.6), (x - w * 0.2, y, h + 0.8))
        cols, rows = int(w / 1.3), int(h / 2.6)
        for r in range(3, rows):
            for c in range(cols):
                v = (i * 7 + r * 5 + c * 3 + (r * c) % 3) % 9
                if v in (0, 4):
                    (lit if v == 0 else lit2).add((0.62, 0.05, 0.95), (x - w / 2 + 0.7 + c * (w - 1.4) / max(1, cols - 1), y - 3.02, r * 2.6))
    lit.build()
    lit2.build()
    dusk_world()


def van_profile(length, nose):
    """Боковой профиль фургона с высокой крышей в осях (x вперёд, z вверх): низ, бампер, капот, лобовое, обтекатель,
    крыша, корма."""
    h = length / 2
    return [(-h, 0.4), (h - 0.06, 0.4), (h, 0.56), (h, 0.98), (h - nose * 0.34, 1.18), (h - nose, 2.0), (h - nose - 0.22, 2.42),
            (h - nose - 0.6, 2.6), (-h + 0.1, 2.6), (-h, 2.48)]


def extrude(name, material, profile, width, parent, bevel=0.03):
    bm = bmesh.new()
    left = [bm.verts.new((x, -width / 2, z)) for x, z in profile]
    right = [bm.verts.new((x, width / 2, z)) for x, z in profile]
    bm.faces.new(left[::-1])
    bm.faces.new(right)
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((left[i], left[j], right[j], right[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 4
        b.limit_method = 'ANGLE'
        for p in ob.data.polygons:
            p.use_smooth = True
    ob.parent = parent
    return ob


def text(name, body, size, material, loc, rot, parent):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.extrude = 0.002
    if os.path.exists(FONT):
        curve.font = bpy.data.fonts.load(FONT)
    ob = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    ob.location = loc
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    if parent:
        ob.parent = parent
    return ob


def ambulance():
    """Машина скорой класса B: фургон с высокой крышей; оси — x вперёд, y влево, z вверх; середина — на земле."""
    root = bpy.data.objects.new('ambulance', None)
    bpy.context.collection.objects.link(root)
    white = mat('white', lin('#f1f0ec'), 0.22, coat=0.7)
    red = mat('stripe', lin('#c4122f'), 0.35, coat=0.4)
    glass = mat('glass', lin('#0a0f14'), 0.04, coat=0.9)
    tire = look.grain('tire', lin('#0e0f10'), lin('#1a1b1c'), scale=60, rough=(0.75, 0.9), bump=0.2)
    rim = mat('rim', lin('#a4a9ad'), 0.3, metal=0.9)
    hub = mat('hub', lin('#3a3d40'), 0.4, metal=0.8)
    letters = mat('letters', lin('#ffffff'), 0.4)
    black = mat('plastic', lin('#17191b'), 0.55)
    seam = mat('seam', lin('#5d6063'), 0.6)
    chrome = mat('chrome', lin('#c9ccce'), 0.15, metal=1.0)
    L, Wd, nose = 5.4, 2.0, 1.35
    extrude('body', white, van_profile(L, nose), Wd, root, bevel=0.07)
    # арки колёс и пороги — тёмный пластик
    for i, x in enumerate((1.75, -1.6)):
        tube(f'arch{i}', black, 0.47, Wd + 0.014, (x, 0, 0.44), rot=(90, 0, 0), parent=root, sides=32)
    for side in (-1, 1):
        y = side * (Wd / 2 + 0.006)
        block(f'sill{side}', black, (2.36, 0.012, 0.14), (0.08, y, 0.47), parent=root)
        block(f'sill_rear{side}', black, (0.62, 0.012, 0.14), (-2.39, y, 0.47), parent=root)
        # полоса по борту на уровне ручек, с надписью (ГОСТ Р 50574-2019)
        block(f'stripe{side}', red, (L - 0.25, 0.01, 0.32), (-0.1, y, 1.12), parent=root)
        text(f'label{side}', 'СКОРАЯ МЕДИЦИНСКАЯ ПОМОЩЬ', 0.17, letters,
             (-0.35, y + side * 0.008, 1.12), (90, 0, 0 if side < 0 else 180), root)
        # окно кабины — по наклону стойки лобового стекла; окно салона — с рамкой
        cab = extrude(f'cab_window{side}', glass, [(0.98, 1.42), (1.88, 1.42), (1.42, 1.93), (0.98, 1.93)], 0.02, root, bevel=0)
        cab.location = (0, side * (Wd / 2 + 0.002), 0)
        block(f'saloon_frame{side}', black, (1.34, 0.016, 0.56), (-0.75, side * (Wd / 2 + 0.001), 1.86), parent=root, bevel=0.004)
        block(f'saloon_window{side}', glass, (1.24, 0.02, 0.46), (-0.75, side * (Wd / 2 + 0.003), 1.86), parent=root)
        # швы дверей и ручки: дверь кабины, сдвижная дверь салона
        for j, (x, z0, z1) in enumerate(((0.9, 0.56, 2.05), (0.0, 0.56, 2.5), (-1.5, 0.95, 2.5))):
            block(f'seam{side}{j}', seam, (0.014, 0.008, z1 - z0), (x, y - side * 0.001, (z0 + z1) / 2), parent=root)
        block(f'handle_cab{side}', black, (0.16, 0.03, 0.045), (1.02, y + side * 0.012, 1.34), parent=root, bevel=0.01)
        block(f'handle_slide{side}', black, (0.16, 0.03, 0.045), (0.14, y + side * 0.012, 1.34), parent=root, bevel=0.01)
        # зеркало на кронштейне
        block(f'mirror_arm{side}', black, (0.05, 0.2, 0.04), (1.95, side * (Wd / 2 + 0.1), 1.5), parent=root)
        block(f'mirror{side}', black, (0.07, 0.13, 0.3), (1.97, side * (Wd / 2 + 0.22), 1.56), parent=root, bevel=0.02)
        # боковой повторитель и светоотражатель у кормы
        block(f'marker{side}', look.glow('amber_dim', lin('#ff9a1f'), 1.2), (0.09, 0.012, 0.045), (2.2, y, 0.92), parent=root)
    # лобовое стекло — на наклонном участке профиля, от конца капота к крыше
    a, b = (L / 2 - nose * 0.34, 1.18), (L / 2 - nose, 2.0)
    ang = math.degrees(math.atan2(b[1] - a[1], a[0] - b[0]))
    nx, nz = math.sin(math.radians(ang)), math.cos(math.radians(ang))
    block('windshield', glass, (math.hypot(b[0] - a[0], b[1] - a[1]) - 0.14, Wd - 0.26, 0.02),
          ((a[0] + b[0]) / 2 + nx * 0.012, 0, (a[1] + b[1]) / 2 + nz * 0.012), parent=root, rot=(0, ang, 0), bevel=0.006)
    for side in (-1, 1):
        block(f'wiper{side}', black, (0.5, 0.02, 0.015), (a[0] - 0.2 + nx * 0.03, side * 0.42, a[1] + 0.2 + nz * 0.03), parent=root, rot=(0, ang, side * 8))
    # передняя часть: решётка с ламелями, фары в корпусах, поворотники, бампер, место номера без знаков
    fx = L / 2
    block('grille', black, (0.05, 1.0, 0.3), (fx + 0.004, 0, 0.78), parent=root, bevel=0.01)
    slats = look.Boxes('grille_slats', chrome)
    for z in (0.69, 0.78, 0.87):
        slats.add((0.02, 0.92, 0.018), (fx + 0.032, 0, z))
    slats.build(root)
    head = look.glow('headlamp', lin('#fff4dd'), 14.0)
    tail = look.glow('taillamp', lin('#ff2a2a'), 5.0)
    amber = look.glow('amber', lin('#ff9a1f'), 2.5)
    for side in (-1, 1):
        block(f'lamp_case{side}', black, (0.05, 0.44, 0.24), (fx + 0.002, side * 0.74, 0.8), parent=root, bevel=0.02)
        block(f'headlamp{side}', head, (0.03, 0.26, 0.15), (fx + 0.022, side * 0.78, 0.8), parent=root, bevel=0.01)
        block(f'turn{side}', amber, (0.03, 0.09, 0.15), (fx + 0.022, side * 0.58, 0.8), parent=root)
        block(f'fog{side}', look.glow('fog', lin('#fff4dd'), 2.0), (0.03, 0.14, 0.06), (fx + 0.06, side * 0.7, 0.5), parent=root)
        # корма: фонари, отражатели
        block(f'taillamp{side}', tail, (0.03, 0.14, 0.44), (-fx - 0.008, side * 0.9, 1.05), parent=root, bevel=0.01)
        block(f'tail_amber{side}', amber, (0.03, 0.14, 0.12), (-fx - 0.008, side * 0.9, 1.36), parent=root)
    block('bumper', black, (0.22, Wd + 0.06, 0.24), (fx - 0.02, 0, 0.5), parent=root, bevel=0.05)
    block('plate', mat('plate', lin('#e9e9e4'), 0.5), (0.012, 0.5, 0.11), (fx + 0.095, 0, 0.5), parent=root)
    block('bumper_rear', black, (0.2, Wd + 0.04, 0.2), (-fx + 0.02, 0, 0.48), parent=root, bevel=0.04)
    block('step', mat('step', lin('#6d7073'), 0.5, metal=0.6), (0.24, 1.3, 0.04), (-fx - 0.1, 0, 0.42), parent=root)
    block('plate_rear', mat('plate', lin('#e9e9e4'), 0.5), (0.012, 0.5, 0.11), (-fx - 0.012, 0, 0.72), parent=root)
    # задние двери: шов посередине, окна, ручка
    block('rear_seam', seam, (0.008, 0.014, 1.9), (-fx - 0.002, 0, 1.5), parent=root)
    for side in (-1, 1):
        block(f'rear_window{side}', glass, (0.02, 0.6, 0.48), (-fx + 0.03, side * 0.42, 1.95), parent=root, rot=(0, -4, 0))
    block('rear_handle', black, (0.03, 0.2, 0.05), (-fx - 0.012, 0.14, 1.3), parent=root, bevel=0.01)
    # колёса: шина, диск, ступица
    for i, x in enumerate((1.75, -1.6)):
        for side in (-1, 1):
            y = side * (Wd / 2 - 0.12)
            tube(f'wheel{i}{side}', tire, 0.37, 0.26, (x, y, 0.37), rot=(90, 0, 0), parent=root, sides=40, bevel=0.04)
            tube(f'rim{i}{side}', rim, 0.22, 0.268, (x, y, 0.37), rot=(90, 0, 0), parent=root, sides=32, bevel=0.015)
            tube(f'hub{i}{side}', hub, 0.09, 0.285, (x, y, 0.37), rot=(90, 0, 0), parent=root, sides=16)
    # крыша: люк и короб вентиляции
    block('roof_hatch', mat('hatch', lin('#d9d8d3'), 0.4), (0.7, 0.7, 0.05), (-0.9, 0, 2.62), parent=root, bevel=0.02)
    # маячки на крыше спереди и сзади — синие, мягко мерцают; под ними — тёмное основание
    beacon = mat('beacon', lin('#1d4fd6'), 0.15, coat=0.8, emit=lin('#3d78ff'), strength=8.0)
    spots = []
    for name, x, wide in (('beacon_front', L / 2 - nose - 0.82, 1.36), ('beacon_rear', -L / 2 + 0.28, 1.36)):
        block(name + '_base', black, (0.3, wide + 0.06, 0.05), (x, 0, 2.62), parent=root, bevel=0.01)
        for side in (-1, 1):
            block(f'{name}{side}', beacon, (0.24, wide * 0.36, 0.13), (x, side * wide * 0.3, 2.71), parent=root, bevel=0.04)
        block(name + '_mid', mat('beacon_mid', lin('#d7dadc'), 0.3), (0.2, wide * 0.2, 0.1), (x, 0, 2.7), parent=root, bevel=0.03)
        # свет маячка на стены и асфальт — точка над крышей, мерцает вместе со стеклом
        spots.append(light('POINT', (x, 0, 3.0), 0, (0.3, 0.5, 1.0), name=name + '_light', soft=0.25, parent=root))
    em = beacon.node_tree.nodes['Principled BSDF'].inputs['Emission Strength']
    for f in range(0, FRAMES + 1, 2):
        t = f / FPS
        k = 0.5 + 0.5 * math.sin(2 * math.pi * BEACON_HZ * t)
        em.default_value = 2.0 + 10.0 * k
        em.keyframe_insert('default_value', frame=f + 1)
        for i, sp in enumerate(spots):
            # задний маячок — в противофазе: свет перебегает, не гаснет
            sp.data.energy = BEACON_W * (0.15 + 0.85 * (k if i == 0 else 1 - k))
            sp.data.keyframe_insert('energy', frame=f + 1)
    # свет фар на асфальт
    for side in (-1, 1):
        light('SPOT', (L / 2 + 0.1, side * 0.74, 0.8), 700, (1.0, 0.95, 0.85), spot=60, rot=(0, 98, 0), parent=root, soft=0.05)
    return root


def drive(car):
    """Путь машины: из гаража прямо во двор, поворот налево — к выезду, из кадра. Курс — градусы от оси x."""
    keys = [
        (1, (0, 9.0), -90),
        (44, (0, 3.0), -90),
        (84, (-1.2, -2.4), -125),
        (110, (-4.6, -4.8), -165),
        (FRAMES, (-6.6, -5.4), -176),
    ]
    for f, (x, y), heading in keys:
        car.location = (x, y, 0)
        car.rotation_euler = (0, 0, math.radians(heading))
        car.keyframe_insert('location', frame=f)
        car.keyframe_insert('rotation_euler', frame=f)


def camera():
    bpy.ops.object.camera_add(location=(3.4, -9.6, 1.5))
    cam = bpy.context.object
    look_at = Vector((-0.4, 1.2, 2.9))
    cam.rotation_euler = (look_at - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 23
    bpy.context.scene.camera = cam
    if INSERT == 'start':
        # начало смены: камера медленно подходит к подстанции, плавно, без рывков
        for f, loc, lk in ((1, (6.2, -12.6, 2.3), (-0.2, 2.0, 3.0)), (FRAMES, (3.8, -8.8, 1.6), (-0.6, 1.6, 2.8))):
            cam.location = loc
            cam.rotation_euler = (Vector(lk) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
            cam.keyframe_insert('location', frame=f)
            cam.keyframe_insert('rotation_euler', frame=f)
    return cam


def park(car):
    """Начало смены: машина стоит во дворе у ворот гаража, мордой к выезду."""
    car.location = (0, 4.2, 0)
    car.rotation_euler = (0, 0, math.radians(-90))

# --- вставки на месте вызова (срез, С4) ---------------------------------------------------------------------------


def street(walk=3.0):
    """Улица вечером: мокрый асфальт с осевой линией, бордюр у y = 0, тротуар из плитки шириной walk, за ним — газон."""
    block('road', wet_asphalt(), (80, 30, 0.1), (0, -15, -0.05))
    paint = look.grain('paint', lin('#8d8f8c'), lin('#c9cac4'), scale=30, rough=(0.5, 0.8), bump=0.05)
    marks = look.Boxes('marks', paint)
    for i in range(-8, 9):
        marks.add((2.2, 0.13, 0.012), (i * 4.6, -4.4, 0.004))
    marks.build()
    block('curb', look.grain('curb', lin('#6c6e70'), lin('#8a8c8c'), scale=20, rough=(0.6, 0.85)), (80, 0.26, 0.17), (0, 0.13, 0.085), bevel=0.02)
    block('walk', look.bricks('walk', lin('#55575a'), lin('#63656a'), lin('#3b3d40'), size=(0.5, 0.5), gap=0.014, rough=0.7, bump=0.4, offset=0.0),
          (80, walk, 0.14), (0, 0.26 + walk / 2, 0.07))
    block('lawn', look.grain('lawn', lin('#1b2a1c'), lin('#2c3d27'), scale=26, rough=(0.85, 1.0), bump=0.6), (80, 40, 0.16), (0, 0.26 + walk + 20, 0.07))
    # люк на дороге
    tube('manhole', look.grain('manhole', lin('#2a2c2e'), lin('#3b3d3e'), scale=40, rough=(0.4, 0.6), metal=0.8), 0.36, 0.02, (2.6, -2.2, 0.004), sides=28)


def low_fence(name, x0, x1, y):
    """Низкая ограда газона: стойки и две трубы, крашеные."""
    rail = look.Boxes(name, mat('rail', lin('#4c6b4a'), 0.55, metal=0.3))
    n = int((x1 - x0) / 1.5)
    for i in range(n + 1):
        rail.add((0.05, 0.05, 0.5), (x0 + i * (x1 - x0) / n, y, 0.39))
    for z in (0.36, 0.6):
        rail.add((x1 - x0, 0.04, 0.04), ((x0 + x1) / 2, y, z))
    rail.build()


def facade(y, x0, x1, floors, lit_every=4, name='facade', door_x=None, balconies=True, panel=3.2):
    """Панельный дом: плиты со швами, цоколь, окна с рамами и подоконниками, балконы через подъезд, парапет. Какие окна
    горят и каким светом — по счёту, без случайности."""
    wall = look.grain('panel', lin('#8f8b82'), lin('#a8a399'), scale=1.6, rough=(0.8, 0.95), bump=0.12, detail=8)
    joint = mat('joint', lin('#4e4c48'), 0.9)
    plinth = look.grain('plinth', lin('#5a5c5e'), lin('#6e7071'), scale=14, rough=(0.7, 0.9))
    frame = mat('wframe', lin('#d9d6cc'), 0.5)
    dark = mat('window_dark', lin('#141a22'), 0.08, coat=0.6)
    kinds = {
        'warm': look.glow('window_lit', lin('#f1c98a'), 3.0), 'amber': look.glow('window_amber', lin('#e9a55c'), 2.4),
        'cool': look.glow('window_cool', lin('#cfe0f2'), 1.8), 'tv': look.glow('window_tv', lin('#7fa8e6'), 1.4), 'dark': dark,
    }
    w, fh = x1 - x0, 2.8
    top = floors * fh + 0.9
    block(name, wall, (w, 0.4, top), ((x0 + x1) / 2, y + 0.2, top / 2))
    block(name + '_plinth', plinth, (w, 0.5, 0.9), ((x0 + x1) / 2, y + 0.2, 0.45))
    block(name + '_parapet', joint, (w + 0.2, 0.6, 0.25), ((x0 + x1) / 2, y + 0.2, top + 0.1))
    joints = look.Boxes(name + '_joints', joint)
    for r in range(floors + 1):
        joints.add((w, 0.03, 0.035), ((x0 + x1) / 2, y - 0.005, 0.9 + r * fh))
    cols = int(w / panel)
    for c in range(cols + 1):
        joints.add((0.035, 0.03, top - 0.9), (x0 + c * panel, y - 0.005, (top + 0.9) / 2))
    joints.build()
    frames, sills = look.Boxes(name + '_frames', frame), look.Boxes(name + '_sills', plinth)
    panes = {k: look.Boxes(f'{name}_{k}', m) for k, m in kinds.items()}
    curtain = look.Boxes(name + '_curtains', look.glow('curtain', lin('#b98a55'), 0.9, base=lin('#6a5038')))
    slab = look.Boxes(name + '_slabs', plinth)
    guard = look.Boxes(name + '_guards', look.grain('guard', lin('#5f7482'), lin('#748a97'), scale=6, rough=(0.6, 0.8)))
    order = ('dark', 'warm', 'dark', 'cool', 'dark', 'amber', 'dark', 'dark', 'warm', 'tv', 'dark')
    for r in range(floors):
        for c in range(cols):
            x = x0 + panel / 2 + c * panel
            z = 0.9 + r * fh + 1.45
            if door_x is not None and r == 0 and abs(x - door_x) < panel * 0.6:
                continue
            kind = order[(r * 5 + c * 3 + (r * c) % 4) % len(order)] if (r * 5 + c * 3) % lit_every else 'warm'
            balcony = balconies and c % 3 == 1 and r > 0
            ww, wh = (1.9, 1.5) if not balcony else (2.3, 1.5)
            frames.add((ww + 0.14, 0.08, wh + 0.14), (x, y - 0.0, z))
            # створки: две или три, между ними — импост рамы
            n = 2 if ww < 2 else 3
            for k in range(n):
                pw = (ww - 0.06 * (n - 1)) / n
                panes[kind].add((pw, 0.05, wh), (x - ww / 2 + pw / 2 + k * (pw + 0.06), y - 0.035, z))
            if kind in ('warm', 'amber') and (r + c) % 2 == 0:
                curtain.add((ww * 0.3, 0.02, wh), (x + (ww * 0.35 if c % 2 else -ww * 0.35), y - 0.065, z))
            sills.add((ww + 0.24, 0.14, 0.05), (x, y - 0.07, z - wh / 2 - 0.09))
            if balcony:
                slab.add((panel - 0.5, 1.0, 0.12), (x, y - 0.5, z - wh / 2 - 0.5))
                guard.add((panel - 0.5, 0.05, 1.0), (x, y - 0.98, z - wh / 2 + 0.05))
                for sx in (-1, 1):
                    guard.add((0.05, 1.0, 1.0), (x + sx * (panel / 2 - 0.27), y - 0.5, z - wh / 2 + 0.05))
    for b in (frames, sills, curtain, slab, guard, *panes.values()):
        b.build()


def bench(x, y, yaw=0):
    wood = look.grain('bench', lin('#5a3d28'), lin('#76533a'), scale=9, rough=(0.55, 0.8), stretch=(1, 12, 12))
    iron = mat('pole', lin('#2a2d30'), 0.5, metal=0.6)
    r = math.radians(yaw)
    c, s = math.cos(r), math.sin(r)
    planks, legs = look.Boxes(f'bench{x}', wood), look.Boxes(f'bench_legs{x}', iron)
    for dy in (-0.16, 0.0, 0.16):
        planks.add((1.8, 0.13, 0.04), (x - dy * s, y + dy * c, 0.6), r)
    for dz in (0.86, 1.02):
        planks.add((1.8, 0.04, 0.12), (x - 0.27 * s, y + 0.27 * c, dz), r)
    for dx in (-0.75, 0.75):
        legs.add((0.06, 0.5, 0.44), (x + dx * c, y + dx * s, 0.36), r)
        legs.add((0.06, 0.05, 0.6), (x + dx * c - 0.27 * s, y + dx * s + 0.27 * c, 0.8), r)
    planks.build()
    legs.build()


def bin_(x, y):
    tube(f'bin{x}', mat('bin', lin('#3a4a40'), 0.5, metal=0.5), 0.2, 0.55, (x, y, 0.5), sides=16)
    tube(f'bin_leg{x}', mat('pole', lin('#2a2d30'), 0.5, metal=0.6), 0.03, 0.3, (x, y, 0.2), sides=8)


def bush(name, x, y, r=0.7):
    leaf = look.grain('leaf', lin('#141d1a'), lin('#25322b'), scale=3.0, rough=(0.8, 0.95), bump=0.4)
    for i, (dx, dz, k) in enumerate(((0, 0, 1.0), (0.6, -0.1, 0.8), (-0.55, -0.05, 0.85))):
        blob(f'{name}{i}', leaf, r * k, (x + dx * r, y, 0.2 + r * 0.7 + dz), (1.1, 0.9, 0.8))


def entrance():
    """«У подъезда»: панельный дом с балконами, подъезд с козырьком и лампой, домофон, доска объявлений, лавочка и урна,
    ограда газона, кусты, фонарь; машина скорой у бордюра, маячки — на стене."""
    street(walk=2.6)
    Y = 7.0
    facade(Y, -19.2, 19.2, 9, door_x=0.0)
    door = look.grain('door', lin('#38454d'), lin('#465660'), scale=30, rough=(0.35, 0.55), metal=0.6, stretch=(1, 1, 0.1))
    concrete = look.grain('concrete', lin('#7d7b76'), lin('#96938c'), scale=9, rough=(0.8, 0.95), bump=0.3)
    # дорожка к подъезду
    block('path', look.bricks('walk', lin('#55575a'), lin('#63656a'), lin('#3b3d40'), size=(0.5, 0.5)), (3.0, Y - 2.8, 0.15), (0, (Y + 2.86) / 2, 0.08))
    # тамбур подъезда: ниша, дверь с окошком и ручкой, рама
    block('porch_wall', concrete, (3.4, 0.5, 3.0), (0, Y - 0.05, 1.5))
    block('door_frame', mat('frame', lin('#23282c'), 0.5), (1.5, 0.1, 2.3), (0, Y - 0.32, 1.42))
    block('door', door, (1.2, 0.1, 2.1), (0, Y - 0.36, 1.36), bevel=0.02)
    block('door_glass', mat('window_dark', lin('#141a22'), 0.08, coat=0.6), (0.22, 0.02, 0.7), (-0.3, Y - 0.42, 1.75))
    block('door_handle', mat('chrome', lin('#c9ccce'), 0.15, metal=1.0), (0.04, 0.06, 0.4), (0.42, Y - 0.44, 1.35), bevel=0.01)
    block('steps', concrete, (3.0, 1.5, 0.3), (0, Y - 1.05, 0.15), bevel=0.02)
    block('step_low', concrete, (3.0, 0.4, 0.16), (0, Y - 2.0, 0.08), bevel=0.02)
    block('canopy', concrete, (3.8, 2.2, 0.2), (0, Y - 1.1, 3.0), bevel=0.02)
    block('canopy_edge', mat('joint', lin('#4e4c48'), 0.9), (3.84, 0.06, 0.3), (0, Y - 2.2, 3.0))
    for i, x in enumerate((-1.7, 1.7)):
        tube(f'canopy_post{i}', mat('pole', lin('#2a2d30'), 0.5, metal=0.6), 0.05, 2.7, (x, Y - 2.05, 1.55), sides=10)
    # домофон — светится; лампа под козырьком — тёплая, в плафоне
    block('intercom', mat('intercom', lin('#1a1f24'), 0.3), (0.2, 0.05, 0.32), (0.95, Y - 0.33, 1.4), bevel=0.01)
    block('intercom_keys', look.glow('intercom_keys', lin('#8fd0ff'), 2.5), (0.1, 0.02, 0.12), (0.95, Y - 0.36, 1.36))
    blob('porch_bulb', look.glow('porch_bulb', lin('#ffdcae'), 25.0), 0.09, (0, Y - 1.0, 2.82), (1, 1, 0.6))
    light('POINT', (0, Y - 1.0, 2.6), 200, (1.0, 0.8, 0.55), name='porch_lamp', soft=0.12)
    # номер подъезда и доска объявлений — без текста: место условное
    block('notice', mat('notice', lin('#3f5a7a'), 0.6), (0.7, 0.04, 0.5), (-1.15, Y - 0.32, 1.6))
    papers = look.Boxes('notice_papers', mat('paper', lin('#e6e2d6'), 0.8))
    for dx, dz, w, h in ((-0.18, 0.06, 0.2, 0.26), (0.1, 0.08, 0.16, 0.2), (0.12, -0.14, 0.22, 0.14)):
        papers.add((w, 0.01, h), (-1.15 + dx, Y - 0.345, 1.6 + dz))
    papers.build()
    tube('downpipe', mat('pipe', lin('#4a4e52'), 0.4, metal=0.7), 0.06, 26.0, (3.2, Y - 0.1, 13.1), sides=10)
    bench(-3.2, 3.9)
    bench(3.4, 3.9)
    bin_(-1.95, 3.7)
    low_fence('fence_l', -19, -1.7, 3.05)
    low_fence('fence_r', 1.7, 19, 3.05)
    for i, x in enumerate((-9.5, -5.6, 5.4, 9.0, 13.0)):
        bush(f'bush{i}', x, 5.6, 0.75 + (i % 2) * 0.15)
    tree('tree_l', (-11.5, 4.6, 0), 8.5, 2.6)
    tree('tree_r', (8.0, 4.4, 0), 7.5, 2.3)
    lamp_post('street_lamp', (5.4, 0.7), energy=3200, toward=-90, arm=1.6)
    lamp_post('street_lamp2', (-13.0, 0.7), energy=3200, toward=-90, arm=1.6)
    dusk_world(strength=0.5)


def bus_stop():
    """«На остановке»: навес остановки со стеклом, лавкой и светлым щитом, знак без названия и номеров маршрутов, карман
    у бордюра, фонари, деревья, дом напротив; машина скорой у остановки."""
    street(walk=4.2)
    frame = mat('stop_frame', lin('#3f4d56'), 0.35, metal=0.8)
    glass = mat('stop_glass', lin('#9fb6c2'), 0.03, coat=0.9)
    bsdf = glass.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Transmission Weight'].default_value = 0.92
    bsdf.inputs['IOR'].default_value = 1.1
    x0, x1, y0, y1 = 1.0, 6.4, 1.3, 3.0
    for x in (x0, (x0 + x1) / 2, x1):
        for y in (y0, y1):
            if y == y0 and x == (x0 + x1) / 2:
                continue
            block(f'post{x}{y}', frame, (0.09, 0.09, 2.6), (x, y, 1.44))
    block('stop_roof', frame, (x1 - x0 + 0.6, y1 - y0 + 0.9, 0.1), ((x0 + x1) / 2, (y0 + y1) / 2 - 0.1, 2.78), bevel=0.03)
    block('stop_fascia', look.glow('stop_fascia', lin('#e3c84a'), 0.5, base=lin('#e3c84a')), (x1 - x0 + 0.62, 0.03, 0.22), ((x0 + x1) / 2, y0 - 0.56, 2.7))
    for i in range(3):
        xa = x0 + (x1 - x0) * i / 3
        block(f'stop_back{i}', glass, ((x1 - x0) / 3 - 0.12, 0.02, 2.0), (xa + (x1 - x0) / 6, y1, 1.45))
    block('stop_rail', frame, (x1 - x0, 0.05, 0.06), ((x0 + x1) / 2, y1, 0.42))
    block('stop_side', glass, (0.02, y1 - y0 - 0.3, 2.0), (x1, (y0 + y1) / 2 + 0.1, 1.45))
    # светлый щит в торце — без рекламы: ровный свет
    block('stop_ad_frame', frame, (0.1, 1.3, 1.9), (x0, (y0 + y1) / 2 + 0.1, 1.4), bevel=0.01)
    block('stop_ad', look.glow('stop_ad', lin('#e9eef5'), 3.2), (0.11, 1.14, 1.72), (x0, (y0 + y1) / 2 + 0.1, 1.4))
    wood = look.grain('bench', lin('#5a3d28'), lin('#76533a'), scale=9, rough=(0.55, 0.8), stretch=(1, 12, 12))
    seat = look.Boxes('stop_bench', wood)
    for dy in (-0.14, 0.0, 0.14):
        seat.add((3.4, 0.11, 0.04), ((x0 + x1) / 2 + 0.3, y1 - 0.45 + dy, 0.62))
    seat.build()
    for x in (2.4, 5.6):
        block(f'stop_bench_leg{x}', frame, (0.06, 0.4, 0.46), (x, y1 - 0.45, 0.37))
    # знак остановки — жёлтая табличка без названия и номеров маршрутов: место условное
    sign = look.glow('stop_sign', lin('#e3c84a'), 0.5, base=lin('#e3c84a'))
    block('stop_sign', sign, (0.8, 0.04, 0.55), (x0 - 1.3, 0.7, 2.75), bevel=0.01)
    tube('stop_sign_pole', frame, 0.035, 3.0, (x0 - 1.3, 0.72, 1.5), sides=10)
    lamp_l = light('AREA', ((x0 + x1) / 2, (y0 + y1) / 2, 2.66), 260, (0.86, 0.93, 1.0), name='roof_lamp', size=3.4, rot=(0, 0, 0))
    lamp_l.data.shape = 'RECTANGLE'
    lamp_l.data.size_y = 0.5
    block('roof_tube', look.glow('roof_tube', lin('#e6f0ff'), 8.0), (3.6, 0.06, 0.03), ((x0 + x1) / 2, (y0 + y1) / 2, 2.71))
    light('AREA', (x0 + 0.1, (y0 + y1) / 2 + 0.1, 1.4), 60, (0.9, 0.94, 1.0), name='ad_glow', size=1.2, rot=(0, 90, 0))
    bin_(x1 + 0.7, 1.6)
    low_fence('fence', -20, 22, 4.7)
    lamp_post('lamp0', (-7.5, 0.7), energy=3200, toward=-90, arm=1.6)
    lamp_post('lamp1', (10.5, 0.7), energy=3200, toward=-90, arm=1.6)
    for i, (x, y, h, c) in enumerate(((-6.0, 8.0, 7.0, 2.0), (9.5, 8.5, 7.5, 2.1), (-14, 8.5, 8.0, 2.4))):
        tree(f'tree{i}', (x, y, 0), h, c)
    facade(13.5, -28.8, 28.8, 12, lit_every=5, name='far_house', balconies=True)
    dusk_world(strength=0.5)


def flat():
    """«В квартире»: прихожая вечером — обои в полоску, ламинат, плинтус, зеркало с тумбой, вешалка с одеждой, коврик;
    входная дверь открыта на лестницу со светом, из комнаты — тёплый свет; у порога — укладка бригады (без креста и
    надписей)."""
    floor = look.bricks('floor', lin('#6d4e33'), lin('#84603f'), lin('#3d2a1b'), size=(0.9, 0.13), gap=0.004, rough=0.38, bump=0.15,
                        coat=0.25, offset=0.37, turn=(0, 0, math.radians(90)))
    wall = look.stripes('wallpaper', lin('#b9ad90'), lin('#c8bea3'), width=0.16, rough=0.85, axis=1)
    wall_far = look.stripes('wallpaper_far', lin('#b9ad90'), lin('#c8bea3'), width=0.16, rough=0.85, axis=0)
    trim = mat('trim', lin('#e4dfd2'), 0.55)
    wood = look.grain('casing', lin('#4b3524'), lin('#644a33'), scale=12, rough=(0.4, 0.6), stretch=(8, 8, 1), coat=0.2)
    block('hall_floor', floor, (3.0, 9.0, 0.05), (0, 2.5, 0))
    block('hall_ceiling', trim, (3.0, 9.0, 0.05), (0, 2.5, 2.7))
    block('wall_left', wall, (0.1, 9.0, 2.7), (-1.5, 2.5, 1.35))
    # правая стена с дверным проёмом в комнату; в комнате горит тёплый свет
    block('wall_right_a', wall, (0.1, 4.2, 2.7), (1.5, 0.1, 1.35))
    block('wall_right_b', wall, (0.1, 2.0, 2.7), (1.5, 5.0, 1.35))
    block('wall_right_top', wall, (0.1, 1.8, 0.6), (1.5, 3.1, 2.4))
    # плинтусы и наличники
    base = look.Boxes('baseboards', wood)
    base.add((0.02, 9.0, 0.09), (-1.44, 2.5, 0.07))
    base.add((0.02, 4.2, 0.09), (1.44, 0.1, 0.07))
    base.add((0.02, 2.0, 0.09), (1.44, 5.0, 0.07))
    for y in (2.15, 4.05):
        base.add((0.16, 0.09, 2.15), (1.5, y, 1.075))
    base.add((0.16, 1.99, 0.09), (1.5, 3.1, 2.145))
    for x in (-0.52, 0.52):
        base.add((0.09, 0.16, 2.12), (x, 6.0, 1.06))
    base.add((1.13, 0.16, 0.09), (0, 6.0, 2.145))
    base.build()
    # комната: ковёр, кресло, торшер, штора — видны в проёме
    room_wall = look.grain('room_wall', lin('#cdbd9b'), lin('#d8c9a8'), scale=3, rough=(0.8, 0.9), bump=0.05)
    block('room_floor', floor, (3.0, 3.4, 0.05), (3.0, 3.1, 0))
    block('room_back', room_wall, (0.1, 3.4, 2.7), (4.5, 3.1, 1.35))
    block('room_side_a', room_wall, (3.0, 0.1, 2.7), (3.0, 1.4, 1.35))
    block('room_side_b', room_wall, (3.0, 0.1, 2.7), (3.0, 4.8, 1.35))
    block('room_ceiling', trim, (3.0, 3.4, 0.05), (3.0, 3.1, 2.7))
    block('room_rug', look.grain('rug', lin('#6e2f2a'), lin('#8a4a3a'), scale=18, rough=(0.9, 1.0), bump=0.3), (1.8, 2.2, 0.02), (3.1, 3.1, 0.035))
    block('armchair', look.grain('armchair', lin('#4d5a48'), lin('#5c6a55'), scale=40, rough=(0.85, 0.95)), (0.8, 0.85, 0.45), (3.9, 4.1, 0.27), bevel=0.1)
    block('armchair_back', look.grain('armchair', lin('#4d5a48'), lin('#5c6a55')), (0.25, 0.85, 0.6), (4.22, 4.1, 0.75), bevel=0.1)
    block('curtain', look.stripes('room_curtain', lin('#8a6a4a'), lin('#a07d58'), width=0.14, rough=0.9, axis=1), (0.06, 1.6, 2.4), (4.4, 2.6, 1.35))
    tube('floor_lamp_pole', mat('pole', lin('#2a2d30'), 0.5, metal=0.6), 0.015, 1.5, (4.0, 3.2, 0.75), sides=8)
    tube('floor_lamp_shade', look.glow('shade', lin('#ffcf8f'), 6.0, base=lin('#d9b98a')), 0.2, 0.3, (4.0, 3.2, 1.6), sides=20)
    light('POINT', (3.6, 3.1, 1.7), 150, (1.0, 0.8, 0.54), name='room_lamp', soft=0.3)
    light('AREA', (3.0, 3.1, 2.6), 90, (1.0, 0.86, 0.64), name='room_top', size=1.4, rot=(0, 0, 0))
    # дальняя стена — входная дверь открыта, за ней лестничная клетка: свет, перила, дверь соседей
    block('wall_far_l', wall_far, (1.0, 0.1, 2.7), (-1.0, 6.0, 1.35))
    block('wall_far_r', wall_far, (1.0, 0.1, 2.7), (1.0, 6.0, 1.35))
    block('wall_far_top', wall_far, (1.0, 0.1, 0.6), (0, 6.0, 2.4))
    stair_wall = look.grain('stair_wall', lin('#56655f'), lin('#62726b'), scale=5, rough=(0.5, 0.7), bump=0.1)
    block('stairwell', stair_wall, (4.0, 0.1, 1.5), (0, 8.4, 0.75))
    block('stairwell_top', look.grain('stair_white', lin('#a9a79d'), lin('#b9b6ab'), scale=5, rough=(0.8, 0.9)), (4.0, 0.1, 1.3), (0, 8.4, 2.1))
    block('landing', look.bricks('landing', lin('#6b6a66'), lin('#7a7974'), lin('#3f3e3b'), size=(0.3, 0.3), gap=0.006, rough=0.5, offset=0.0), (4.0, 2.4, 0.05), (0, 7.2, 0.0))
    block('landing_ceiling', trim, (4.0, 2.4, 0.05), (0, 7.2, 2.75))
    block('neighbor_door', look.grain('neighbor_door', lin('#3d2c22'), lin('#4c382b'), scale=20, rough=(0.4, 0.6), stretch=(8, 8, 1)), (0.9, 0.06, 2.05), (0.15, 8.33, 1.03), bevel=0.01)
    blob('neighbor_peephole', mat('chrome', lin('#c9ccce'), 0.15, metal=1.0), 0.015, (0.15, 8.29, 1.5))
    rail = look.Boxes('stair_rail', mat('rail_stair', lin('#2b3338'), 0.5, metal=0.5))
    for i in range(6):
        rail.add((0.02, 0.02, 0.9), (-1.2 + i * 0.16, 7.5 + i * 0.12, 0.45 + i * 0.05))
    rail.add((1.0, 0.05, 0.05), (-0.8, 7.8, 1.02), 0.6)
    rail.build()
    block('stair_bulb', look.glow('stair_bulb', lin('#e9f1ff'), 12.0), (0.3, 0.12, 0.05), (0.2, 7.4, 2.7))
    light('AREA', (0.2, 7.4, 2.62), 55, (0.82, 0.9, 1.0), name='stair_lamp', size=0.5, rot=(0, 0, 0))
    # входная дверь — открыта внутрь, к левой стене: полотно с обивкой, ручка, глазок, замок
    leaf = look.grain('front_door', lin('#4a3324'), lin('#5c4130'), scale=20, rough=(0.45, 0.65), stretch=(1, 8, 8))
    block('front_door', leaf, (0.06, 0.95, 2.05), (-0.5, 5.52, 1.03), bevel=0.01, rot=(0, 0, 6))
    block('front_door_handle', mat('chrome', lin('#c9ccce'), 0.15, metal=1.0), (0.05, 0.14, 0.03), (-0.44, 5.2, 1.02), bevel=0.008, rot=(0, 0, 6))
    block('front_door_lock', mat('chrome', lin('#c9ccce'), 0.15, metal=1.0), (0.02, 0.05, 0.12), (-0.46, 5.16, 1.2), rot=(0, 0, 6))
    block('doormat', look.grain('doormat', lin('#3a3a34'), lin('#55554a'), scale=60, rough=(0.9, 1.0), bump=0.6), (0.8, 0.5, 0.02), (0.05, 5.5, 0.035))
    # левая стена: зеркало в раме над тумбой для обуви, вешалка с одеждой и полкой
    block('mirror_frame', wood, (0.04, 0.7, 1.3), (-1.44, 1.9, 1.5), bevel=0.01)
    block('mirror', mat('mirror', lin('#dfe5e8'), 0.03, metal=1.0), (0.02, 0.6, 1.2), (-1.425, 1.9, 1.5))
    block('shoe_cabinet', wood, (0.34, 0.9, 0.6), (-1.28, 1.9, 0.33), bevel=0.01)
    block('cabinet_top', look.grain('cabinet_top', lin('#3a2a1e'), lin('#4a3626'), scale=10, rough=(0.3, 0.5)), (0.38, 0.96, 0.03), (-1.27, 1.9, 0.645))
    tube('vase', mat('vase', lin('#39566b'), 0.25, coat=0.6), 0.06, 0.2, (-1.3, 1.65, 0.76), sides=20, bevel=0.01)
    block('keys_tray', mat('tray', lin('#8a8f93'), 0.3, metal=0.9), (0.14, 0.2, 0.015), (-1.26, 2.15, 0.667), bevel=0.004)
    block('hanger_shelf', wood, (0.26, 1.5, 0.03), (-1.34, 3.8, 1.95))
    block('hanger', wood, (0.03, 1.5, 0.12), (-1.44, 3.8, 1.75))
    hooks = look.Boxes('hooks', mat('chrome', lin('#c9ccce'), 0.15, metal=1.0))
    for i in range(5):
        hooks.add((0.07, 0.02, 0.02), (-1.4, 3.2 + i * 0.3, 1.74))
    hooks.build()
    cloth = lambda n, c1, c2: look.grain(n, lin(c1), lin(c2), scale=50, rough=(0.85, 1.0), bump=0.3)  # noqa: E731
    block('coat', cloth('coat', '#33404f', '#3f4d5f'), (0.13, 0.56, 1.05), (-1.36, 3.25, 1.2), bevel=0.055)
    block('coat2', cloth('coat2', '#6e342c', '#803f35'), (0.14, 0.5, 0.85), (-1.35, 3.82, 1.3), bevel=0.055)
    block('coat3', cloth('coat3', '#6b6252', '#7b725f'), (0.12, 0.46, 0.95), (-1.37, 4.38, 1.25), bevel=0.05)
    block('hat', cloth('hat', '#2d2b2a', '#3a3836'), (0.24, 0.26, 0.12), (-1.33, 3.4, 2.03), bevel=0.05)
    block('box_shelf', mat('cardboard', lin('#9a7a55'), 0.8), (0.24, 0.4, 0.18), (-1.33, 4.15, 2.06))
    shoes = look.Boxes('shoes', mat('shoe', lin('#1e1e1e'), 0.5))
    for i, (y, l) in enumerate(((3.1, 0.28), (3.24, 0.28), (3.75, 0.3), (3.9, 0.3), (4.4, 0.26))):
        shoes.add((l, 0.1, 0.09), (-1.2, y, 0.07), 0.08 * (i % 2))
    shoes.build()
    tube('umbrella', cloth('umbrella', '#26323d', '#303e4a'), 0.035, 0.85, (-1.36, 4.72, 0.46), rot=(6, 0, 0), sides=10)
    # правая стена: выключатель и картина — пятна цвета, без сюжета
    block('switch', trim, (0.015, 0.08, 0.08), (1.44, 1.95, 1.1), bevel=0.004)
    block('picture_frame', wood, (0.03, 0.62, 0.46), (1.44, 0.9, 1.55), bevel=0.006)
    block('picture', look.grain('picture', lin('#3f6a78'), lin('#c9a45c'), scale=2.2, rough=(0.6, 0.7), detail=1.0, bump=0.0), (0.02, 0.52, 0.36), (1.425, 0.9, 1.55))
    block('runner', look.stripes('runner', lin('#5d2f2a'), lin('#7a4034'), width=0.5, rough=0.95, axis=1, soft=0.2), (1.0, 3.6, 0.015), (0.0, 2.6, 0.032))
    # укладка бригады у порога: оранжевый чемодан с белой полосой, ручкой и замками, без креста и надписей
    case = mat('kit', lin('#d9662a'), 0.45, coat=0.4)
    block('kit', case, (0.55, 0.32, 0.4), (0.78, 3.2, 0.23), bevel=0.05, rot=(0, 0, -12))
    block('kit_band', mat('kit_band', lin('#f1f0ec'), 0.5), (0.56, 0.33, 0.05), (0.78, 3.2, 0.31), rot=(0, 0, -12), bevel=0.01)
    block('kit_handle', mat('pole', lin('#2a2d30'), 0.5, metal=0.6), (0.28, 0.04, 0.05), (0.78, 3.2, 0.47), rot=(0, 0, -12), bevel=0.015)
    for dx in (-0.16, 0.16):
        c, s = math.cos(math.radians(-12)), math.sin(math.radians(-12))
        block(f'kit_latch{dx}', mat('chrome', lin('#c9ccce'), 0.15, metal=1.0), (0.05, 0.02, 0.06),
              (0.78 + dx * c + 0.165 * s, 3.2 + dx * s - 0.165 * c, 0.36), rot=(0, 0, -12))
    # свет прихожей: плафон на потолке светится сам, свет — вниз широким пятном, потолок не пересвечен
    blob('hall_shade', look.glow('hall_shade', lin('#ffe6c4'), 5.0), 0.17, (0, 2.6, 2.62), (1, 1, 0.45)).visible_shadow = False
    tube('hall_shade_base', mat('chrome', lin('#c9ccce'), 0.15, metal=1.0), 0.19, 0.03, (0, 2.6, 2.67), sides=24)
    light('AREA', (0, 2.6, 2.5), 70, (1.0, 0.88, 0.7), name='hall_lamp', size=0.5, rot=(0, 0, 0))
    dusk_world(top='#0b0e13', mid='#10141b', horizon='#151a22', strength=0.2, clouds=0.0)


def scene_camera(path, lens=26):
    """Камера вставки на месте: медленно — от первой точки ко второй, без рывков."""
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    cam.data.lens = lens
    bpy.context.scene.camera = cam
    for f, loc, lk in ((1, *path[0]), (FRAMES, *path[1])):
        cam.location = loc
        cam.rotation_euler = (Vector(lk) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        cam.keyframe_insert('location', frame=f)
        cam.keyframe_insert('rotation_euler', frame=f)
    for fc in cam.animation_data.action.fcurves:
        for k in fc.keyframe_points:
            k.interpolation = 'SINE'
    return cam


def on_scene():
    """Вставка на месте вызова: место, машина (кроме квартиры), камера."""
    if INSERT == 'door':
        entrance()
        car = ambulance()
        # встала наспех, под углом к бордюру: виден борт с полосой
        car.location = (-0.9, -1.75, 0)
        car.rotation_euler = (0, 0, math.radians(13))
        scene_camera((((7.0, -8.4, 0.9), (-0.4, 1.6, 5.4)), ((6.3, -7.7, 0.95), (-0.6, 1.6, 5.4))), lens=22)
    elif INSERT == 'stop':
        bus_stop()
        car = ambulance()
        car.location = (-0.9, -1.6, 0)
        car.rotation_euler = (0, 0, math.radians(10))
        scene_camera((((9.8, -7.9, 0.9), (1.2, 1.1, 4.8)), ((9.1, -7.3, 0.95), (1.0, 1.1, 4.8))), lens=22)
    else:
        flat()
        scene_camera((((-0.5, -0.9, 1.5), (0.45, 6.0, 0.8)), ((-0.4, 0.2, 1.46), (0.55, 6.0, 0.76))), lens=20)


def setup(scene):
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
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, FRAMES
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    # быстрее на ролик: меньше отражений, сцена между кадрами не пересобирается
    scene.cycles.max_bounces = 4
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.05
    scene.render.use_persistent_data = True
    # отделка: свечение вокруг фар, маячков, окон и ламп, лёгкое затемнение углов (blender/look.py)
    look.polish(scene, bloom=0.6, threshold=1.5, size=0.45, vignette=0.2)


def sha(path):
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    if ON_SCENE:
        on_scene()
    else:
        yard()
        car = ambulance()
        if INSERT == 'start':
            park(car)
        else:
            drive(car)
        camera()
    setup(scene)
    out_dir = os.environ.get('INSERT_FRAMES', '/tmp/insert-frames')
    os.makedirs(out_dir, exist_ok=True)
    frames = ([40, STILL, 104] if INSERT == 'depart' else [1, STILL, FRAMES]) if PREVIEW else range(1, FRAMES + 1)
    for f in frames:
        scene.frame_set(f)
        scene.render.filepath = os.path.join(out_dir, f'f{f:04d}.png')
        bpy.ops.render.render(write_still=True)
    if PREVIEW:
        print('предпросмотр:', out_dir)
        return
    mp4 = os.path.join(ROOT, 'assets', 'scenes', f'insert-{INSERT}.mp4')
    jpg = os.path.join(ROOT, 'assets', 'scenes', f'insert-{INSERT}.jpg')
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        sys.exit('нужен ffmpeg')
    # H.264, без звука, ключевой кадр в начале — для проигрывателя телефона; -bitexact — повторяемые байты
    enc = [ffmpeg, '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(out_dir, 'f%04d.png'),
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
           '-threads', '1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1', mp4]
    subprocess.run(enc, check=True)
    subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', os.path.join(out_dir, f'f{STILL:04d}.png'), '-q:v', '3',
                    '-fflags', '+bitexact', '-flags:v', '+bitexact', jpg], check=True)
    ver = subprocess.run([ffmpeg, '-version'], capture_output=True, text=True).stdout.split('\n')[0]
    path = os.path.join(ROOT, 'assets', 'scenes', 'inserts.json')
    old = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as fh:
            old = json.load(fh)
    made = {'script': 'blender/insert.py', 'blender': VERSION, 'engine': 'CYCLES', 'samples': SAMPLES,
            'denoiser': 'OPENIMAGEDENOISE', 'seed': SEED, 'size': [W, H], 'fps': FPS, 'frames': FRAMES,
            'still': STILL, 'ffmpeg': ver, 'codec': 'H.264 (libx264, CRF 26)'}
    files = {k: v for k, v in old.get('files', {}).items() if f'insert-{INSERT}.' not in k}
    files[f'assets/scenes/insert-{INSERT}.mp4'] = {'sha256': sha(mp4), 'bytes': os.path.getsize(mp4)}
    files[f'assets/scenes/insert-{INSERT}.jpg'] = {'sha256': sha(jpg), 'bytes': os.path.getsize(jpg)}
    passport = {
        'id': 'inserts',
        'name': 'Видеовставки: «начало смены» — двор подстанции вечером, камера подходит к машине у гаража; «бригада выезжает» — машина скорой выезжает из гаража; на месте вызова — «у подъезда», «на остановке», «в квартире»',
        'licence': 'своя работа студии «Горница»; шрифт надписи — Onest (SIL OFL 1.1, assets/fonts/Onest-OFL.txt)',
        'made': {**old.get('made', {}), INSERT: made} if 'script' not in old.get('made', {}) else {'depart': old['made'], INSERT: made},
        'files': dict(sorted(files.items())),
    }
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(passport, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('вставка:', mp4, os.path.getsize(mp4))


# запуск — только из командной строки: blender/station.py берёт отсюда машину, не запуская вставку
if __name__ == '__main__':
    main()
