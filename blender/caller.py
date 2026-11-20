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

from mathutils import Vector

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
CURL = tuple(float(x) for x in os.environ.get('CALLER_CURL', '0,0,-55').split(','))
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
}
# те же люди на вечерней улице — звонки не из дома (родственник, сам больной, прохожий; игра владельца 20.11.2026:
# вместо картинки была тёмная сцена со словом, её приняли за незагрузку)
CALLERS['daughter-street'] = {**CALLERS['daughter'], 'room': 'street'}
CALLERS['man-street'] = {**CALLERS['man'], 'room': 'street'}
# --only имя,имя — нарисовать только этих; паспорт остальных остаётся как был
ONLY = next((a.split('=', 1)[1].split(',') for a in ARGS if a.startswith('--only=')), None)


def lin(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def mat(name, color, rough=0.6, emit=None, strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    if emit is not None:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = strength
    return m


def block(name, material, size, loc, rot=(0, 0, 0)):
    """Коробка: размер, середина, поворот — градусы."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=tuple(math.radians(a) for a in rot))
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    ob.data.materials.append(material)
    bev = ob.modifiers.new('bevel', 'BEVEL')
    bev.width = 0.01
    bev.segments = 2
    return ob


def kitchen():
    """Кухня вечером за спиной звонящего: стена с плиткой, шкафы, окно с синим вечером, тёплый свет. Размыта."""
    wall = mat('wall', lin('#c9c2b4'), 0.8)
    tile = mat('tile', lin('#d8d6cf'), 0.3)
    wood = mat('wood', lin('#8a6a4e'), 0.55)
    front = mat('front', lin('#e4e1d8'), 0.4)
    dusk = mat('dusk', (0, 0, 0, 1), emit=lin('#4e6a8f'), strength=2.2)
    block('back_wall', wall, (6, 0.1, 3.2), (0, 2.2, 1.6))
    block('side_wall', wall, (0.1, 5, 3.2), (-2.2, 0, 1.6))
    block('floor', mat('floor', lin('#6d5a48'), 0.6), (6, 6, 0.05), (0, 0, -0.025))
    # фартук из плитки, столешница и нижние шкафы справа
    for i in range(12):
        for j in range(4):
            block(f'tile{i}_{j}', tile, (0.145, 0.02, 0.145), (0.2 + i * 0.15, 2.14, 0.98 + j * 0.15))
    block('counter', wood, (1.9, 0.62, 0.04), (1.05, 1.85, 0.9))
    block('cabinets', front, (1.9, 0.58, 0.86), (1.05, 1.86, 0.45))
    block('upper', front, (1.9, 0.36, 0.7), (1.05, 2.0, 1.95))
    # окно слева: синий вечер за стеклом
    block('window_frame', mat('frame', lin('#efece4'), 0.4), (1.2, 0.08, 1.4), (-1.0, 2.16, 1.55))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-1.0, 2.11, 1.55), rotation=(math.radians(90), 0, 0))
    glass = bpy.context.object
    glass.scale = (1.05, 1.25, 1)
    glass.data.materials.append(dusk)
    # лампа под шкафами — тёплая
    bpy.ops.object.light_add(type='AREA', location=(1.05, 1.8, 1.55), rotation=(0, 0, 0))
    under = bpy.context.object
    under.data.shape = 'RECTANGLE'
    under.data.size, under.data.size_y = 1.6, 0.1
    under.data.energy = 120
    under.data.color = (1.0, 0.78, 0.52)
    under.rotation_euler = (math.radians(180), 0, 0)
    # потолочный светильник — тёплый, мягкий
    bpy.ops.object.light_add(type='AREA', location=(0.2, 0.4, 2.9))
    ceil = bpy.context.object
    ceil.data.size = 1.2
    ceil.data.energy = 260
    ceil.data.color = (1.0, 0.86, 0.7)


def street():
    """Вечерняя улица за спиной звонящего (звонки не из дома, игра владельца 20.11.2026): остановка со светлым
    рекламным щитом, фонарь, дом напротив с окнами, мокрый асфальт. Размыта."""
    asphalt = mat('asphalt', lin('#2b2d31'), 0.32)
    curb = mat('curb', lin('#7d7b76'), 0.7)
    facade = mat('facade', lin('#3c3f47'), 0.85)
    dark = mat('dark_window', lin('#23262d'), 0.2)
    warm = mat('warm_window', (0, 0, 0, 1), emit=lin('#ffcf8a'), strength=3.0)
    metal = mat('metal', lin('#3a3d42'), 0.4)
    ad = mat('ad', (0, 0, 0, 1), emit=lin('#e9eef5'), strength=4.0)
    lamp = mat('lamp', (0, 0, 0, 1), emit=lin('#ffe2b8'), strength=30.0)
    block('ground', asphalt, (30, 30, 0.05), (0, 0, -0.025))
    block('curb', curb, (30, 0.3, 0.14), (0, 1.1, 0.07))
    block('sidewalk', mat('sidewalk', lin('#5d5c59'), 0.8), (30, 3, 0.12), (0, 2.75, 0.06))
    # дом напротив: окна — сеткой, часть горит; какие — по номеру, без случайности
    block('house', facade, (18, 0.3, 12), (0, 7.5, 6))
    for i in range(14):
        for j in range(6):
            lit = (i * 7 + j * 3) % 5 < 2
            block(f'win{i}_{j}', warm if lit else dark, (0.55, 0.05, 0.8), (-6.5 + i * 1.0, 7.33, 1.6 + j * 1.6))
    # остановка справа: крыша, стойки, светлый рекламный щит
    block('stop_roof', metal, (2.6, 1.3, 0.06), (1.6, 2.6, 2.45))
    for k, x in enumerate((0.35, 2.85)):
        block(f'stop_post{k}', metal, (0.06, 0.06, 2.4), (x, 3.2, 1.2))
    block('stop_ad', ad, (1.1, 0.06, 1.7), (2.3, 3.2, 1.25))
    block('stop_bench', metal, (1.4, 0.35, 0.05), (1.2, 3.0, 0.48))
    # фонарь слева: столб, голова светится, свет вниз — тёплый
    block('lamp_pole', metal, (0.1, 0.1, 5.2), (-2.4, 2.4, 2.6))
    block('lamp_arm', metal, (0.9, 0.08, 0.08), (-2.0, 2.4, 5.15))
    block('lamp_head', lamp, (0.45, 0.22, 0.08), (-1.6, 2.4, 5.08))
    bpy.ops.object.light_add(type='SPOT', location=(-1.6, 2.4, 5.0))
    spot = bpy.context.object
    spot.data.energy = 1300
    spot.data.spot_size = math.radians(110)
    spot.data.color = (1.0, 0.86, 0.66)
    spot.rotation_euler = (0, 0, 0)
    # свет щита на спину и плечо — холодный
    bpy.ops.object.light_add(type='AREA', location=(2.3, 3.1, 1.3))
    glow = bpy.context.object
    glow.data.size = 1.2
    glow.data.energy = 90
    glow.data.color = (0.85, 0.9, 1.0)
    glow.rotation_euler = (math.radians(90), 0, math.radians(180))


ROOMS = {'kitchen': kitchen, 'street': street}
# небо за окнами и над улицей
SKY = {'kitchen': (0.02, 0.02, 0.025, 1), 'street': (0.012, 0.02, 0.045, 1)}


def person(spec):
    path = os.path.join(SRC, 'Assets', 'Avatars', spec['avatar'])
    tex_dir = os.path.join(os.path.dirname(os.path.dirname(path)), 'Textures')
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm)
    # текстуры — из папки Textures рядом с Export
    for img in bpy.data.images:
        if img.filepath and not os.path.exists(bpy.path.abspath(img.filepath)):
            name = os.path.basename(img.filepath.replace('\\', '/'))
            alt = os.path.join(tex_dir, name)
            if os.path.exists(alt):
                img.filepath = alt
    for m in body.data.materials:
        m.blend_method = 'HASHED' if 'opacity' in m.name else 'OPAQUE'
    arm.rotation_euler = (0, 0, math.radians(spec['yaw']))
    bpy.context.view_layer.update()
    return arm, body


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


def pose_call(arm):
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
    # запястье — за серединой телефона, ладонь к щеке, тыльная сторона наружу (до 0.11.0 ладонь смотрела наружу, а
    # запястье — на 7,5 см ниже: кисть выглядела вывихнутой, пальцы — подушечками к камере; владелец, 20.11.2026)
    hr, hu, hf = (float(x) for x in os.environ.get('CALLER_HAND', '0.04,-0.045,-0.02').split(','))
    ear = target('ik_ear', (top + bottom) / 2 + right * hr + up * hu + fwd * hf)
    # локоть — вбок и вниз, на уровне груди: плечо почти вдоль тела, предплечье поднимается к уху (у 0.9.0 подсказка
    # стояла на 65 см ниже головы и вперёд — локоть уходил перед грудь, рука шла вертикально от пояса; игра владельца
    # 20.11.2026: «искривлена рука, которая держит телефон»)
    er, eu, ef = (float(x) for x in os.environ.get('CALLER_ELBOW', '0.38,-0.58,0.08').split(','))
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
    # кисть: пальцы — вверх вдоль телефона, ладонь — к голове; пальцы согнуты вокруг телефона
    axes, lo, hi = head_box(arm)
    center = at(axes, *[(x + y) / 2 for x, y in zip(lo, hi)])
    up_t = target('hand_up', top + up * 0.05)
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
    return ear


def phone_in_hand(arm, ear):
    """Мобильный телефон в правой руке, у уха."""
    body = mat('phone', lin('#1e2125'), 0.3)
    bpy.ops.mesh.primitive_cube_add(size=1)
    ph = bpy.context.object
    ph.name = 'mobile'
    ph.data.materials.append(body)
    bev = ph.modifiers.new('bevel', 'BEVEL')
    bev.width = 0.006
    bev.segments = 3
    right, _, _ = body_axes(arm)
    top, bottom = phone_line(arm)
    z = (top - bottom).normalized()
    x = (right - z * right.dot(z)).normalized()
    y = z.cross(x)
    from mathutils import Matrix
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = (top + bottom) / 2 + right * 0.012
    ph.matrix_world = m @ Matrix.Diagonal((0.012, 0.075, 0.15, 1))
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
    cam.data.dof.aperture_fstop = 2.0
    bpy.context.scene.camera = cam
    # ключевой свет — мягкий, сбоку от окна; контровой — тёплый сзади
    bpy.ops.object.light_add(type='AREA', location=head + Vector((-1.2, -1.0, 0.4)))
    key = bpy.context.object
    key.data.size = 1.0
    key.data.energy = 230
    key.data.color = (0.86, 0.92, 1.0)
    key.rotation_euler = (head - key.location).to_track_quat('-Z', 'Y').to_euler()
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
        ear = pose_call(arm)
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
