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
# --preview — три кадра малым размером в папку scratch, для подбора камеры; файлы игры не трогает.
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
W, H = (540, 960) if not PREVIEW else (270, 480)
FPS = 24
# на месте вызова — 3 с и 16 проходов: камера едва движется, шум снимает OIDN, рендер втрое короче
ON_SCENE = INSERT in ('door', 'stop', 'flat')
SECONDS = 5 if INSERT == 'depart' else 3 if ON_SCENE else 4
FRAMES = FPS * SECONDS
SAMPLES = (16 if ON_SCENE else 24) if not PREVIEW else 8
SEED = 5
STILL = {'depart': 84, 'start': 72}.get(INSERT, 48)  # кадр для «Меньше движения»: машина во дворе, видна полоса с надписью
FONT = os.path.join(ROOT, 'node_modules', '@expo-google-fonts', 'onest', '600SemiBold', 'Onest_600SemiBold.ttf')
# маячки — мягкое мерцание 1,5 раза в секунду, без резких вспышек
BEACON_HZ = 1.5


def lin(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


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


def yard():
    """Двор подстанции вечером: асфальт, бордюр, здание с поднятыми воротами гаража, фонарь, небо в сумерках."""
    asphalt = mat('asphalt', lin('#3b3e41'), 0.85)
    wall = mat('wall', lin('#b9b4a8'), 0.8)
    trim = mat('trim', lin('#7a7d80'), 0.6)
    inside = mat('inside', lin('#55585b'), 0.9)
    block('ground', asphalt, (40, 40, 0.1), (0, 0, -0.05))
    block('curb', trim, (40, 0.25, 0.15), (0, -6.5, 0.075))
    # здание: стена с проёмом ворот, внутри гаража — свет
    block('wall_left', wall, (6, 0.4, 5), (-6.5, 4.0, 2.5))
    block('wall_right', wall, (6, 0.4, 5), (6.5, 4.0, 2.5))
    block('wall_top', wall, (7, 0.4, 1.4), (0, 4.0, 4.3))
    block('gate_frame', trim, (7.2, 0.5, 0.25), (0, 3.95, 3.58))
    block('gate_shutter', trim, (6.9, 0.45, 0.35), (0, 3.95, 3.35))
    block('garage_back', inside, (7, 0.2, 5), (0, 12.0, 2.5))
    block('garage_floor', mat('gfloor', lin('#5d5f5f'), 0.7), (7, 8, 0.05), (0, 8.0, 0.02))
    block('garage_side_l', inside, (0.2, 8, 5), (-3.5, 8.0, 2.5))
    block('garage_side_r', inside, (0.2, 8, 5), (3.5, 8.0, 2.5))
    block('garage_roof', inside, (7.4, 8.4, 0.2), (0, 8.0, 5.0))
    for i, x in enumerate((-2.0, 2.0)):
        bpy.ops.object.light_add(type='AREA', location=(x, 8.0, 4.8))
        lamp = bpy.context.object
        lamp.name = f'garage_lamp{i}'
        lamp.data.size = 1.5
        lamp.data.energy = 600
        lamp.data.color = (1.0, 0.95, 0.85)
        lamp.rotation_euler = (math.radians(180), 0, 0)
    # окна здания — тёплые
    glow = mat('windows', (0, 0, 0, 1), emit=lin('#f1c98a'), strength=3.0)
    for i in range(4):
        block(f'window{i}', glow, (1.1, 0.05, 1.0), ((-8.2, -5.2, 5.2, 8.2)[i], 3.78, 2.6))
    # фонарь во дворе
    pole = mat('pole', lin('#2a2d30'), 0.5, metal=0.6)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=6, location=(-5.0, -4.0, 3.0))
    bpy.context.object.data.materials.append(pole)
    bpy.ops.object.light_add(type='SPOT', location=(-4.6, -4.0, 5.9))
    street = bpy.context.object
    street.data.energy = 1500
    street.data.spot_size = math.radians(110)
    street.data.color = (1.0, 0.78, 0.5)
    street.rotation_euler = (0, 0, 0)
    # деревья вдали — тёмные силуэты
    dark = mat('trees', lin('#1b2329'), 0.9)
    for i, x in enumerate((-14, -10, 10, 14, 18)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=2.2 + (i % 2) * 0.6, location=(x, 9 + i, 3.0 + (i % 3) * 0.4))
        bpy.context.object.data.materials.append(dark)
    # дома вдали — силуэты; часть окон горит (какие — по счёту, без случайности)
    city = mat('city', lin('#1e2630'), 0.9)
    lit = mat('lit', (0, 0, 0, 1), emit=lin('#f0c27a'), strength=4.0)
    for i, (x, w, h) in enumerate(((-16, 7, 18), (-7, 6, 26), (2, 8, 15), (11, 6, 22), (19, 7, 30))):
        y = 34 + (i % 2) * 6
        block(f'house{i}', city, (w, 6, h), (x, y, h / 2))
        cols, rows = int(w / 1.6), int(h / 2.4)
        for r in range(1, rows):
            for c in range(cols):
                if (i * 7 + r * 5 + c * 3) % 4 == 0:
                    block(f'house{i}_w{r}_{c}', lit, (0.7, 0.05, 0.9),
                          (x - w / 2 + 0.8 + c * (w - 1.6) / max(1, cols - 1), y - 3.01, r * 2.4))
    world = bpy.data.worlds.new('dusk')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexGradient')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value = (0, math.radians(-90), 0)
    nt.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], sky.inputs['Vector'])
    nt.links.new(sky.outputs['Fac'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].color = lin('#4a5f86')
    ramp.color_ramp.elements[1].color = lin('#121a2c')
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.6
    bpy.context.scene.world = world


def van_profile(length, height, nose):
    """Боковой профиль фургона с высокой крышей в осях (x вперёд, z вверх): низ, капот, лобовое, крыша, корма."""
    return [(-length / 2, 0.35), (length / 2, 0.35), (length / 2, 0.95), (length / 2 - nose * 0.35, 1.2),
            (length / 2 - nose, 2.0), (length / 2 - nose - 0.35, 2.55), (-length / 2, 2.55)]


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
    ob.parent = parent
    return ob


def ambulance():
    """Машина скорой класса B: фургон с высокой крышей; оси — x вперёд, y влево, z вверх; середина — на земле."""
    root = bpy.data.objects.new('ambulance', None)
    bpy.context.collection.objects.link(root)
    white = mat('white', lin('#f1f0ec'), 0.25, coat=0.6)
    red = mat('stripe', lin('#c4122f'), 0.35, coat=0.4)
    glass = mat('glass', lin('#0c1116'), 0.05, coat=0.8)
    tire = mat('tire', lin('#141516'), 0.8)
    rim = mat('rim', lin('#9aa0a4'), 0.3, metal=0.9)
    letters = mat('letters', lin('#ffffff'), 0.4)
    L, Wd = 5.4, 2.0
    extrude('body', white, van_profile(L, 2.55, 1.35), Wd, root)
    # полоса по борту на уровне ручек, с надписью
    for side in (-1, 1):
        y = side * (Wd / 2 + 0.006)
        block(f'stripe{side}', red, (L - 0.25, 0.01, 0.32), (-0.1, y, 1.12), parent=root)
        text(f'label{side}', 'СКОРАЯ МЕДИЦИНСКАЯ ПОМОЩЬ', 0.17, letters,
             (-0.35, y + side * 0.008, 1.12), (90, 0, 0 if side < 0 else 180), root)
        # окна кабины и салона
        block(f'cab_window{side}', glass, (0.9, 0.02, 0.6), (1.55, side * (Wd / 2 + 0.002), 1.7), parent=root)
        block(f'saloon_window{side}', glass, (1.2, 0.02, 0.45), (-0.6, side * (Wd / 2 + 0.002), 1.85), parent=root)
    # лобовое стекло — по наклону профиля
    # лобовое стекло — на наклонном участке профиля, от конца капота к крыше
    a, b = (L / 2 - 1.35 * 0.35, 1.2), (L / 2 - 1.35, 2.0)
    ang = math.degrees(math.atan2(b[1] - a[1], a[0] - b[0]))
    nx, nz = math.sin(math.radians(ang)), math.cos(math.radians(ang))
    block('windshield', glass, (math.hypot(b[0] - a[0], b[1] - a[1]) - 0.12, Wd - 0.22, 0.02),
          ((a[0] + b[0]) / 2 + nx * 0.012, 0, (a[1] + b[1]) / 2 + nz * 0.012), parent=root, rot=(0, ang, 0))
    # передняя часть: решётка, фары, бампер
    block('grille', mat('grille', lin('#22262a'), 0.4), (0.04, 1.1, 0.3), (L / 2 + 0.005, 0, 0.72), parent=root)
    head = mat('headlamp', (0, 0, 0, 1), emit=lin('#fff4dd'), strength=12.0)
    tail = mat('taillamp', (0, 0, 0, 1), emit=lin('#ff2a2a'), strength=6.0)
    for side in (-1, 1):
        block(f'headlamp{side}', head, (0.03, 0.32, 0.16), (L / 2 + 0.01, side * 0.72, 0.78), parent=root)
        block(f'taillamp{side}', tail, (0.03, 0.14, 0.5), (-L / 2 - 0.01, side * 0.9, 1.0), parent=root)
    block('bumper', mat('bumper', lin('#2a2d30'), 0.5), (0.18, Wd + 0.04, 0.22), (L / 2, 0, 0.42), parent=root, bevel=0.04)
    # колёса
    for i, x in enumerate((1.75, -1.6)):
        for side in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(radius=0.36, depth=0.26, location=(x, side * (Wd / 2 - 0.1), 0.36),
                                                rotation=(math.radians(90), 0, 0))
            w = bpy.context.object
            w.name = f'wheel{i}{side}'
            w.data.materials.append(tire)
            w.parent = root
            bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=0.27, location=(x, side * (Wd / 2 - 0.1), 0.36),
                                                rotation=(math.radians(90), 0, 0))
            r = bpy.context.object
            r.data.materials.append(rim)
            r.parent = root
    # маячки на крыше спереди и сзади — синие, мягко мерцают
    beacon = mat('beacon', lin('#1d4fd6'), 0.2, emit=lin('#3d78ff'), strength=8.0)
    for name, x in (('beacon_front', L / 2 - 1.75), ('beacon_rear', -L / 2 + 0.2)):
        block(name, beacon, (0.22, 1.3, 0.12), (x, 0, 2.62), parent=root, bevel=0.03)
    em = beacon.node_tree.nodes['Principled BSDF'].inputs['Emission Strength']
    for f in range(0, FRAMES + 1, 2):
        t = f / FPS
        em.default_value = 2.0 + 10.0 * (0.5 + 0.5 * math.sin(2 * math.pi * BEACON_HZ * t))
        em.keyframe_insert('default_value', frame=f + 1)
    # свет фар на асфальт
    for side in (-1, 1):
        bpy.ops.object.light_add(type='SPOT', location=(L / 2 + 0.1, side * 0.72, 0.8))
        spot = bpy.context.object
        spot.data.energy = 600
        spot.data.spot_size = math.radians(55)
        spot.data.color = (1.0, 0.95, 0.85)
        spot.rotation_euler = (0, math.radians(100), 0)
        spot.parent = root
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
    bpy.ops.object.camera_add(location=(3.8, -11.0, 1.6))
    cam = bpy.context.object
    look = Vector((-0.4, 1.2, 1.6))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 26
    bpy.context.scene.camera = cam
    if INSERT == 'start':
        # начало смены: камера медленно подходит к подстанции, плавно, без рывков
        for f, loc, lk in ((1, (7.0, -14.5, 2.6), (-0.2, 2.0, 1.8)), (FRAMES, (4.2, -10.2, 1.7), (-0.6, 1.6, 1.7))):
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


def dusk_world(top='#4a5f86', bottom='#121a2c', strength=0.6):
    world = bpy.data.worlds.new('dusk')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexGradient')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value = (0, math.radians(-90), 0)
    nt.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], sky.inputs['Vector'])
    nt.links.new(sky.outputs['Fac'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].color = lin(top)
    ramp.color_ramp.elements[1].color = lin(bottom)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = world


def street(y_curb=-1.6):
    """Улица вечером: асфальт, бордюр, тротуар."""
    block('road', mat('asphalt', lin('#34373a'), 0.85), (60, 30, 0.1), (0, y_curb - 15, -0.05))
    block('curb', mat('trim', lin('#7a7d80'), 0.6), (60, 0.25, 0.16), (0, y_curb, 0.08))
    block('walk', mat('walk', lin('#5b5d5c'), 0.85), (60, 20, 0.12), (0, y_curb + 10.1, 0.06))


def lamp_post(name, loc, energy=1400):
    pole = mat('pole', lin('#2a2d30'), 0.5, metal=0.6)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=6, location=(loc[0], loc[1], 3.0))
    bpy.context.object.data.materials.append(pole)
    bpy.ops.object.light_add(type='SPOT', location=(loc[0], loc[1] - 0.4, 5.9))
    sp = bpy.context.object
    sp.name = name
    sp.data.energy = energy
    sp.data.spot_size = math.radians(110)
    sp.data.color = (1.0, 0.78, 0.5)


def facade(y, x0, x1, floors, lit_every=4, name='facade'):
    """Панельный дом: стена с рядами окон; часть окон горит — по счёту, без случайности."""
    wall = mat('panel', lin('#a9a59b'), 0.85)
    dark = mat('window_dark', lin('#1b222b'), 0.15, coat=0.5)
    lit = mat('window_lit', (0, 0, 0, 1), emit=lin('#f1c98a'), strength=3.0)
    w = x1 - x0
    block(name, wall, (w, 0.4, floors * 2.8 + 0.6), ((x0 + x1) / 2, y + 0.2, (floors * 2.8 + 0.6) / 2))
    cols = int(w / 2.2)
    for r in range(floors):
        for c in range(cols):
            x = x0 + 1.1 + c * 2.2
            z = 1.6 + r * 2.8
            if r == 0 and abs(x) < 2.2:
                continue
            m = lit if (r * 5 + c * 3) % lit_every == 0 else dark
            block(f'{name}_w{r}_{c}', m, (1.2, 0.05, 1.3), (x, y - 0.01, z))


def entrance():
    """«У подъезда»: панельный дом, подъезд с козырьком и фонарём, домофон, лавочка; машина скорой у бордюра."""
    street()
    facade(4.0, -14, 14, 5)
    door = mat('door', lin('#3d4a52'), 0.45, metal=0.5)
    concrete = mat('concrete', lin('#8d8b85'), 0.9)
    block('door', door, (1.3, 0.12, 2.2), (0, 3.95, 1.36), bevel=0.02)
    block('door_frame', mat('frame', lin('#2a3035'), 0.5), (1.6, 0.1, 2.45), (0, 3.98, 1.37))
    block('steps', concrete, (2.6, 1.2, 0.26), (0, 3.3, 0.13))
    block('canopy', concrete, (3.2, 1.6, 0.18), (0, 3.2, 2.85))
    block('canopy_post_l', concrete, (0.16, 0.16, 2.6), (-1.45, 2.5, 1.4))
    block('canopy_post_r', concrete, (0.16, 0.16, 2.6), (1.45, 2.5, 1.4))
    # домофон — светится; лампа над дверью — тёплая
    block('intercom', mat('intercom', lin('#1a1f24'), 0.3, emit=lin('#8fd0ff'), strength=1.5), (0.18, 0.05, 0.28), (0.95, 3.88, 1.35))
    bpy.ops.object.light_add(type='POINT', location=(0, 3.4, 2.65))
    bulb = bpy.context.object
    bulb.data.energy = 120
    bulb.data.color = (1.0, 0.82, 0.58)
    bulb.data.shadow_soft_size = 0.15
    block('bench', mat('bench', lin('#6b4a32'), 0.7), (1.8, 0.5, 0.08), (-3.4, 2.7, 0.48))
    for x in (-4.1, -2.7):
        block(f'bench_leg{x}', mat('pole', lin('#2a2d30'), 0.5, metal=0.6), (0.08, 0.4, 0.46), (x, 2.7, 0.23))
    lamp_post('street_lamp', (6.5, -0.9))
    dusk_world('#3d5079', '#0f1626', 0.5)


def bus_stop():
    """«На остановке»: навес остановки со стеклом и лавкой, фонари, деревья; машина скорой у остановки."""
    street()
    frame = mat('stop_frame', lin('#4b5a63'), 0.4, metal=0.7)
    glass = mat('stop_glass', lin('#9fb6c2'), 0.05, coat=0.9)
    glass.blend_method = 'BLEND' if hasattr(glass, 'blend_method') else None
    bsdf = glass.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Transmission Weight'].default_value = 0.9
    bsdf.inputs['Alpha'].default_value = 0.35
    x0, x1, y0, y1 = 1.0, 6.0, 1.0, 2.6
    for x in (x0, x1):
        for y in (y0 + 0.2, y1):
            block(f'post{x}{y}', frame, (0.1, 0.1, 2.5), (x, y, 1.25))
    block('stop_roof', frame, (x1 - x0 + 0.5, y1 - y0 + 0.7, 0.12), ((x0 + x1) / 2, (y0 + y1) / 2 + 0.1, 2.56), bevel=0.03)
    block('stop_back', glass, (x1 - x0, 0.03, 2.1), ((x0 + x1) / 2, y1, 1.25))
    block('stop_side', glass, (0.03, y1 - y0 - 0.2, 2.1), (x1, (y0 + y1) / 2 + 0.1, 1.25))
    block('stop_bench', mat('bench', lin('#6b4a32'), 0.7), (3.6, 0.45, 0.08), ((x0 + x1) / 2, y1 - 0.35, 0.5))
    # табличка остановки — без названия и номеров маршрутов: место условное
    sign = mat('stop_sign', lin('#e3c84a'), 0.4, emit=lin('#e3c84a'), strength=0.4)
    block('stop_sign', sign, (0.9, 0.05, 0.5), (x0 - 0.6, y0 + 0.2, 2.6))
    block('stop_sign_pole', frame, (0.07, 0.07, 2.4), (x0 - 0.6, y0 + 0.2, 1.2))
    bpy.ops.object.light_add(type='AREA', location=((x0 + x1) / 2, (y0 + y1) / 2, 2.45))
    roof_lamp = bpy.context.object
    roof_lamp.data.size = 3.0
    roof_lamp.data.energy = 220
    roof_lamp.data.color = (0.9, 0.95, 1.0)
    for i, x in enumerate((-9, 12)):
        lamp_post(f'lamp{i}', (x, -0.9))
    facade(12.0, -20, 24, 9, lit_every=5, name='far_house')
    dusk_world('#3d5079', '#0f1626', 0.5)


def flat():
    """«В квартире»: прихожая вечером, входная дверь открыта на тёмную лестницу, у порога — укладка бригады (без
    креста и надписей), из комнаты — тёплый свет."""
    floor = mat('floor', lin('#7a5a3c'), 0.55)
    wall = mat('wallpaper', lin('#c9bfa6'), 0.85)
    trim = mat('trim', lin('#e9e4d8'), 0.6)
    block('hall_floor', floor, (3.0, 7.0, 0.05), (0, 2.5, 0))
    block('hall_ceiling', trim, (3.0, 7.0, 0.05), (0, 2.5, 2.7))
    block('wall_left', wall, (0.1, 7.0, 2.7), (-1.5, 2.5, 1.35))
    # правая стена с дверным проёмом в комнату; в комнате горит тёплый свет
    block('wall_right_a', wall, (0.1, 3.2, 2.7), (1.5, 0.6, 1.35))
    block('wall_right_b', wall, (0.1, 2.0, 2.7), (1.5, 5.0, 1.35))
    block('wall_right_top', wall, (0.1, 1.8, 0.6), (1.5, 3.1, 2.4))
    block('room_floor', floor, (3.0, 3.0, 0.05), (3.0, 3.1, 0))
    block('room_back', mat('room_wall', lin('#d8c9a8'), 0.85), (0.1, 3.0, 2.7), (4.5, 3.1, 1.35))
    block('room_side_a', mat('room_wall', lin('#d8c9a8'), 0.85), (3.0, 0.1, 2.7), (3.0, 1.6, 1.35))
    block('room_side_b', mat('room_wall', lin('#d8c9a8'), 0.85), (3.0, 0.1, 2.7), (3.0, 4.6, 1.35))
    bpy.ops.object.light_add(type='POINT', location=(3.0, 3.1, 2.2))
    room = bpy.context.object
    room.data.energy = 220
    room.data.shadow_soft_size = 0.3
    room.data.color = (1.0, 0.84, 0.6)
    # дальняя стена — входная дверь открыта, за ней тёмная лестница
    block('wall_far_l', wall, (1.0, 0.1, 2.7), (-1.0, 6.0, 1.35))
    block('wall_far_r', wall, (1.0, 0.1, 2.7), (1.0, 6.0, 1.35))
    block('wall_far_top', wall, (1.0, 0.1, 0.6), (0, 6.0, 2.4))
    block('stairwell', mat('stairwell', lin('#20262b'), 0.9), (3.0, 0.1, 2.7), (0, 7.5, 1.35))
    bpy.ops.object.light_add(type='POINT', location=(0.3, 7.0, 2.3))
    stair = bpy.context.object
    stair.data.energy = 25
    stair.data.color = (0.75, 0.85, 1.0)
    block('front_door', mat('door', lin('#5a4030'), 0.5), (0.08, 0.95, 2.05), (-0.45, 6.5, 1.03), rot=(0, 0, 0))
    # вешалка с пальто, обувь
    block('hanger', mat('pole', lin('#2a2d30'), 0.5, metal=0.6), (0.05, 1.2, 0.05), (-1.4, 3.6, 1.9))
    coat = mat('coat', lin('#3c4a5e'), 0.9)
    block('coat', coat, (0.25, 0.55, 1.0), (-1.3, 3.4, 1.35), bevel=0.08)
    block('coat2', mat('coat2', lin('#7b3b32'), 0.9), (0.25, 0.45, 0.9), (-1.3, 4.0, 1.4), bevel=0.08)
    for i in range(3):
        block(f'shoe{i}', mat('shoe', lin('#1e1e1e'), 0.6), (0.3, 0.12, 0.1), (-1.15, 4.4 + i * 0.25, 0.06), bevel=0.03)
    # укладка бригады у порога: оранжевый чемодан с ручкой, без креста и надписей
    case = mat('kit', lin('#d9662a'), 0.45, coat=0.4)
    block('kit', case, (0.55, 0.32, 0.4), (0.55, 4.9, 0.21), bevel=0.04)
    block('kit_band', mat('kit_band', lin('#f1f0ec'), 0.5), (0.56, 0.33, 0.05), (0.55, 4.9, 0.3))
    block('kit_handle', mat('pole', lin('#2a2d30'), 0.5, metal=0.6), (0.3, 0.04, 0.05), (0.55, 4.9, 0.45))
    block('room_ceiling', trim, (3.0, 3.0, 0.05), (3.0, 3.1, 2.7))
    bpy.ops.object.light_add(type='POINT', location=(0, 2.0, 2.55))
    hall = bpy.context.object
    hall.data.energy = 25
    hall.data.color = (1.0, 0.9, 0.75)
    dusk_world('#151a22', '#0b0e13', 0.2)


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
        car.location = (-3.4, -0.6, 0)
        car.rotation_euler = (0, 0, math.radians(0))
        scene_camera((((3.6, -4.6, 1.2), (-1.4, 2.0, 0.9)), ((2.9, -4.0, 1.25), (-1.7, 2.0, 0.9))), lens=20)
    elif INSERT == 'stop':
        bus_stop()
        car = ambulance()
        car.location = (-1.8, -0.5, 0)
        car.rotation_euler = (0, 0, math.radians(0))
        scene_camera((((7.0, -4.4, 1.2), (1.4, 1.8, 0.9)), ((6.2, -4.0, 1.25), (1.0, 1.8, 0.9))), lens=20)
    else:
        flat()
        scene_camera((((-0.6, -0.6, 1.55), (0.7, 6.0, 1.05)), ((-0.5, 0.6, 1.5), (0.9, 6.0, 1.0))), lens=20)


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
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    # быстрее на ролик: меньше отражений, сцена между кадрами не пересобирается
    scene.cycles.max_bounces = 4
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.05
    scene.render.use_persistent_data = True


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
    frames = ([40, STILL, 104] if INSERT in ('depart', 'start') else [1, STILL, FRAMES]) if PREVIEW else range(1, FRAMES + 1)
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
