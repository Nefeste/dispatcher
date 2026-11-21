# Кадр края стола для сцены «Пульт» (ADR 0009; docs/13-art.md, §3 и «Сцены»): Blender строит стол с телефоном,
# рацией, клавиатурой и гарнитурой, Cycles рендерит его с прозрачным фоном. Skia кладёт кадр внизу экрана под монитор с
# живой картой и рисует поверх то, что меняется: огонёк и экранчик телефона, строку рации.
#
# Запуск: python blender/pult.py [--preview] (Blender как модуль Python: pip install bpy==4.5.15, Python 3.11)
# Пишет:
# - assets/scenes/pult-desk.png — кадр стола, RGBA;
# - src/art/pult.gen.ts — размер кадра и места предметов в его пикселях: где касаться, четыре угла экранчиков, огонёк;
# - assets/scenes/pult.json — паспорт: версия Blender, настройки рендера, отпечатки файлов.
# --preview — малый кадр с малым числом выборок в папку scratch, для подбора камеры; файлы игры не трогает.
#
# Оси — Blender: x вправо, y от зрителя вглубь, z вверх; метры. Передний край стола — y = 0, верх стола — z = 0,74.
# Цвета — из src/art/palette.ts и src/ui/theme.ts (одно место для цвета). Что стоит на столе — по источникам листа
# стиля (docs/13-art.md, §3): телефон, гарнитура, клавиатура и мышь — 388н, прил. 8; рация — описания станций.
import hashlib
import json
import math
import os
import re
import sys

import bpy  # noqa: I001 — bpy первым: без него нет bmesh
import bmesh
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

VERSION = '4.5.15'
if bpy.app.version_string.split(' ')[0] != VERSION:
    sys.exit(f'нужен Blender {VERSION}, а это {bpy.app.version_string}')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import look  # noqa: E402 — общие материалы: зерно, полосы, свечение
PREVIEW = '--preview' in sys.argv

W, H = (1080, 640) if not PREVIEW else (540, 320)
SAMPLES = 256 if not PREVIEW else 24
TOP = 0.74  # верх стола


def colors():
    """Цвета по именам из palette.ts (свои) и theme.ts (брендбук): «#rrggbb» → линейный RGB."""
    out = {}
    for rel in ('src/ui/theme.ts', 'src/art/palette.ts'):
        with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
            for name, hexs in re.findall(r"^\s+(\w+): '(#[0-9a-fA-F]{6})'", fh.read(), re.M):
                out[name] = hexs
    def lin(h):
        c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)
    return {k: lin(v) for k, v in out.items()}


COL = colors()
MATS = {}


def mat(name, color, rough=0.5, metal=0.0, coat=0.0, emit=None, strength=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    if emit is not None:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = strength
    MATS[name] = m
    return m


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


def cyl(name, material, r, h, loc, rot=(0, 0, 0), sides=24, bevel=0.0, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r if r2 is None else r2, depth=h)
    ob = bpy.context.object
    ob.name = name
    for v in ob.data.vertices:
        v.co.z += h / 2
    ob.location = loc
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    return finish(ob, material, bevel)


def parent(children, name, loc, yaw):
    """Собрать предмет: дети в его осях, сам предмет — на столе с поворотом yaw (градусы, по часовой — минус)."""
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    for c in children:
        c.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, math.radians(yaw))
    return root


# --- материалы
def shade(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, 1.0)


def materials():
    return {
        # столешница — светлый ламинат: едва заметные волокна, блеск неровный — в нём живёт отсвет монитора
        'desk': look.grain('desk', shade(COL['desk'], 0.9), COL['desk'], scale=5.0, rough=(0.25, 0.5), bump=0.03, coat=0.15, stretch=(1, 14, 14)),
        'edge': mat('edge', COL['edge'], rough=0.5),
        # пластик корпусов — мелкая фактура: блик мягкий, не зеркальный
        'plastic': look.grain('plastic', shade(COL['plastic'], 0.85), COL['plastic'], scale=900.0, rough=(0.3, 0.45), bump=0.04, coat=0.15),
        'dark': look.grain('dark', shade(COL['dark'], 0.85), COL['dark'], scale=900.0, rough=(0.38, 0.55), bump=0.04),
        'key': mat('key', COL['key'], rough=0.55),
        'metal': mat('metal', COL['metal'], rough=0.28, metal=0.9),
        'glass': mat('glass', (0.004, 0.007, 0.009, 1), rough=0.06, coat=0.6),
        'lamp': mat('lamp', COL['kumach'], rough=0.25, coat=0.4),
        'paper': mat('paper', COL['paper'], rough=0.8),
        'mug': mat('mug', COL['spruce'], rough=0.3, coat=0.5),
        'cushion': look.grain('cushion', shade(COL['chair'], 0.8), COL['chair'], scale=300.0, rough=(0.65, 0.85), bump=0.3),
        'pad': look.grain('pad', shade(COL['pad'], 0.85), COL['pad'], scale=500.0, rough=(0.8, 0.95), bump=0.2),
        # блокнот в линейку
        'ruled': look.stripes('ruled', COL['paper'], look.lin('#b9c6d6'), width=0.0085, rough=0.85, axis=1, soft=0.42),
        'note': mat('note', look.lin('#e6cf6a'), rough=0.8),
        'tea': mat('tea', look.lin('#2b160b'), rough=0.08, coat=0.5),
        'led': look.glow('led', look.lin('#55d98a'), 6.0),
    }


def scene_objects(M):
    parts = {}
    # стол: столешница со скруглённым передним краем
    box('desk_top', M['desk'], (1.9, 0.75, 0.03), (0, 0.36, TOP - 0.03), bevel=0.008, segments=4)
    # подставка монитора — уходит под нижнюю рамку, которую рисует Skia
    box('mon_base', M['dark'], (0.26, 0.19, 0.012), (0, 0.6, TOP), bevel=0.004)
    cyl('mon_neck', M['metal'], 0.022, 0.5, (0, 0.63, TOP + 0.01), sides=20)
    # клавиатура: корпус и клавиши
    kb = [box('kbd', M['dark'], (0.44, 0.15, 0.016), (0, 0, 0), rot=(3, 0, 0), bevel=0.004)]
    for r in range(5):
        for c in range(15):
            kb.append(box(f'key{r}_{c}', M['key'], (0.022, 0.022, 0.008),
                          (-0.196 + c * 0.028, -0.056 + r * 0.028, 0.012 + r * 0.0014), bevel=0.002))
    parent(kb, 'keyboard', (-0.02, 0.31, TOP), 0)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, segments=24, ring_count=12)
    mouse = bpy.context.object
    mouse.name = 'mouse'
    mouse.scale = (0.95, 1.7, 0.6)
    mouse.location = (0.28, 0.27, TOP + 0.012)
    finish(mouse, M['dark'], 0)
    for p in mouse.data.polygons:
        p.use_smooth = True

    # телефон слева: наклонный корпус, экранчик, клавиши, трубка, огонёк линии
    ph = []
    bm = bmesh.new()
    w, d = 0.21, 0.19
    for x in (-w / 2, w / 2):
        for y, z in ((-d / 2, 0.035), (d / 2, 0.075)):
            bm.verts.new((x, y, 0))
            bm.verts.new((x, y, z))
    bm.verts.ensure_lookup_table()
    v = bm.verts
    for f in ((0, 2, 6, 4), (1, 5, 7, 3), (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6)):
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('phone_body')
    bm.to_mesh(me)
    body = bpy.data.objects.new('phone_body', me)
    bpy.context.collection.objects.link(body)
    finish(body, M['plastic'], bevel=0.006)
    ph.append(body)
    tilt = math.degrees(math.atan2(0.04, d))  # наклон верха
    def on_top(x, y, h=0.0):
        """Точка на наклонном верху корпуса: (x, y) — в плоскости стола, h — над верхом."""
        z = 0.035 + (y + d / 2) / d * 0.04
        return (x, y, z + h)
    disp = box('phone_display', M['glass'], (0.1, 0.045, 0.003), on_top(0.025, 0.045, -0.001), rot=(tilt, 0, 0), bevel=0.001)
    ph.append(disp)
    for r in range(4):
        for c in range(3):
            y = -0.012 - r * 0.02
            ph.append(box(f'phone_key{r}_{c}', M['key'], (0.017, 0.013, 0.006), on_top(0.003 + c * 0.023, y, -0.001),
                          rot=(tilt, 0, 0), bevel=0.0015))
    ph.append(box('phone_handset', M['plastic'], (0.05, 0.21, 0.034), (-0.082, 0.0, 0.03), rot=(tilt, 0, 0),
                  bevel=0.012, segments=5))
    lamp = cyl('phone_lamp', M['lamp'], 0.007, 0.006, on_top(0.085, 0.07, -0.001), rot=(tilt, 0, 0), sides=16, r2=0.005)
    ph.append(lamp)
    parent(ph, 'phone', (-0.35, 0.24, TOP), 14)
    parts['phone'] = {'body': ['phone_body', 'phone_handset'], 'lcd': 'phone_display', 'lamp': 'phone_lamp'}

    # рация справа: базовая станция, экранчик, ручки, решётка, антенна; тангента на витом шнуре
    rd = [box('radio_body', M['dark'], (0.25, 0.19, 0.075), (0, 0, 0), bevel=0.006)]
    rd.append(box('radio_display', M['glass'], (0.1, 0.003, 0.03), (0.04, -0.0955, 0.03), bevel=0.0008))
    for k, x in enumerate((0.065, 0.1)):
        rd.append(cyl(f'radio_knob{k}', M['metal'], 0.011, 0.018, (x, -0.095, 0.016), rot=(90, 0, 0), sides=20, bevel=0.002))
    for i in range(6):
        for j in range(4):
            rd.append(cyl(f'radio_grille{i}_{j}', M['key'], 0.003, 0.002, (-0.1 + i * 0.012, -0.0955, 0.018 + j * 0.012),
                          rot=(90, 0, 0), sides=10))
    rd.append(cyl('radio_antenna', M['dark'], 0.006, 0.26, (0.1, 0.07, 0.075), sides=12, r2=0.004))
    parent(rd, 'radio', (0.4, 0.45, TOP), -12)
    mic = box('radio_mic', M['plastic'], (0.055, 0.035, 0.095), (0.48, 0.26, TOP), rot=(-12, 0, -10), bevel=0.012, segments=5)
    cyl('radio_mic_key', M['key'], 0.006, 0.006, (0.455, 0.245, TOP + 0.06), rot=(78, 0, -10), sides=12)
    # витой шнур тангенты
    curve = bpy.data.curves.new('cord', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.0025
    sp = curve.splines.new('POLY')
    a, b = Vector((0.5, 0.29, TOP + 0.01)), Vector((0.47, 0.37, TOP + 0.02))
    n = 220
    sp.points.add(n - 1)
    for i in range(n):
        t = i / (n - 1)
        p = a.lerp(b, t)
        ang = t * math.pi * 2 * 22
        sag = math.sin(t * math.pi) * 0.012
        sp.points[i].co = (p.x + 0.007 * math.cos(ang), p.y, p.z - sag + 0.007 * math.sin(ang), 1)
    cord = bpy.data.objects.new('cord', curve)
    bpy.context.collection.objects.link(cord)
    cord.data.materials.append(M['dark'])
    parts['radio'] = {'body': ['radio_body'], 'lcd': 'radio_display', 'extra': [mic.name]}

    # гарнитура на подставке слева сзади
    hs = [cyl('hs_base', M['dark'], 0.05, 0.012, (0, 0, 0), sides=32, bevel=0.003),
          cyl('hs_pole', M['metal'], 0.007, 0.19, (0, 0, 0.012), sides=16)]
    # оголовье — гладкая дуга
    band = bpy.data.curves.new('hs_band', 'CURVE')
    band.dimensions = '3D'
    band.bevel_depth = 0.007
    band.bevel_resolution = 4
    arc = band.splines.new('POLY')
    arc.points.add(40)
    for k in range(41):
        ang = math.radians(-90 + k * 4.5)
        arc.points[k].co = (0.075 * math.sin(ang), 0, 0.195 + 0.075 * math.cos(ang), 1)
    band_ob = bpy.data.objects.new('hs_band', band)
    bpy.context.collection.objects.link(band_ob)
    band_ob.data.materials.append(M['dark'])
    hs.append(band_ob)
    for s in (-1, 1):
        hs.append(cyl(f'hs_cup{s}', M['cushion'], 0.035, 0.026, (s * 0.075 - s * 0.013, 0, 0.165), rot=(0, 90, 0), sides=28, bevel=0.006))
    hs.append(box('hs_mic', M['dark'], (0.006, 0.1, 0.006), (-0.072, -0.045, 0.15), rot=(-8, 0, 12), bevel=0.0025))
    parent(hs, 'headset', (0.04, 0.09, TOP), -8)

    # блокнот с ручкой, кружка
    box('notepad', M['ruled'], (0.13, 0.18, 0.008), (-0.17, 0.1, TOP), rot=(0, 0, 9), bevel=0.001)
    # пружина блокнота — по верхнему краю
    c9, s9 = math.cos(math.radians(9)), math.sin(math.radians(9))
    for i in range(12):
        dx = -0.055 + i * 0.01
        bpy.ops.mesh.primitive_torus_add(major_radius=0.005, minor_radius=0.0008, major_segments=12, minor_segments=5,
                                         location=(-0.17 + dx * c9 - 0.088 * s9, 0.1 + dx * s9 + 0.088 * c9, TOP + 0.006),
                                         rotation=(0, math.radians(90), math.radians(9 + 90)))
        ring = bpy.context.object
        ring.name = f'notepad_ring{i}'
        ring.data.materials.append(M['metal'])
    # листок-напоминание у телефона — пустой: слова на кадре пишет только Skia
    box('sticky', M['note'], (0.07, 0.07, 0.0015), (-0.37, 0.05, TOP), rot=(0, 0, -7), bevel=0.0004)
    cyl('pen', M['lamp'], 0.0045, 0.14, (-0.15, 0.09, TOP + 0.009), rot=(0, 90, 18), sides=12)
    cyl('mug', M['mug'], 0.04, 0.1, (0.3, 0.1, TOP), sides=40, bevel=0.003)
    cyl('mug_rim', M['mug'], 0.036, 0.0012, (0.3, 0.1, TOP + 0.1), sides=40)
    cyl('mug_tea', M['tea'], 0.0345, 0.0012, (0.3, 0.1, TOP + 0.1003), sides=40)
    for i, (dz, dx, w) in enumerate(((0.072, 0.048, 0.03), (0.05, 0.063, 0.012), (0.03, 0.048, 0.03))):
        box(f'mug_handle{i}', M['mug'], (w, 0.012, 0.014 if i != 1 else 0.036), (0.3 + dx, 0.1, TOP + dz - (0.007 if i != 1 else 0.018)), bevel=0.005)
    # коврик под мышью, колесо и шов кнопок мыши
    box('mouse_pad', M['pad'], (0.17, 0.17, 0.003), (0.305, 0.27, TOP - 0.0005), rot=(0, 0, -3), bevel=0.001)
    cyl('mouse_wheel', M['key'], 0.0055, 0.006, (0.277, 0.293, TOP + 0.026), rot=(0, 90, 0), sides=14)
    box('mouse_seam', M['key'], (0.0012, 0.04, 0.002), (0.28, 0.296, TOP + 0.0275), rot=(-16, 0, 0))
    # огоньки питания: рация и клавиатура — зелёные точки
    led = cyl('radio_led', M['led'], 0.0028, 0.002, (-0.085, -0.0955, 0.058), rot=(90, 0, 0), sides=10)
    led.parent = bpy.data.objects['radio']
    led2 = box('kbd_led', M['led'], (0.004, 0.002, 0.001), (0.2, 0.066, 0.02))
    led2.parent = bpy.data.objects['keyboard']
    # витой шнур трубки телефона — от трубки за корпус
    hc = bpy.data.curves.new('handset_cord', 'CURVE')
    hc.dimensions = '3D'
    hc.bevel_depth = 0.002
    hsp = hc.splines.new('POLY')
    a2, b2 = Vector((-0.46, 0.13, TOP + 0.012)), Vector((-0.33, 0.36, TOP + 0.012))
    n2 = 260
    hsp.points.add(n2 - 1)
    for i in range(n2):
        t = i / (n2 - 1)
        pnt = a2.lerp(b2, t)
        ang = t * math.pi * 2 * 30
        bow = math.sin(t * math.pi) * 0.05
        hsp.points[i].co = (pnt.x - bow + 0.006 * math.cos(ang), pnt.y, pnt.z + 0.006 * math.sin(ang) - 0.005, 1)
    hcord = bpy.data.objects.new('handset_cord', hc)
    bpy.context.collection.objects.link(hcord)
    hcord.data.materials.append(M['dark'])
    return parts


def lights():
    # потолок — холодный рассеянный свет зала
    bpy.ops.object.light_add(type='AREA', location=(0.3, 0.1, 3.0))
    top = bpy.context.object
    top.data.size = 3.0
    top.data.energy = 70
    top.data.color = (0.92, 0.96, 1.0)
    # настольная лампа справа — тёплый свет
    # (площадкой, не точкой: точка отражалась в лаке стола белым кругом у правого края)
    bpy.ops.object.light_add(type='AREA', location=(0.95, 0.5, 1.2))
    warm = bpy.context.object
    warm.data.size = 0.45
    warm.data.energy = 42
    warm.data.color = (1.0, 0.8, 0.55)
    warm.rotation_euler = (Vector((0.2, 0.25, TOP)) - warm.location).to_track_quat('-Z', 'Y').to_euler()
    warm.visible_glossy = False
    # монитор с картой светит на стол сзади; в кадре его нет — его рисует Skia
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.62, 1.12), rotation=(math.radians(90), 0, 0))
    glow = bpy.context.object
    glow.scale = (0.62, 0.36, 1)
    glow.data.materials.append(mat('glow', (0, 0, 0, 1), emit=COL['linen'], strength=2.5))
    glow.visible_camera = False
    # слабый холодный свет слева сзади — кромка на телефоне и гарнитуре, отделяет тёмные корпуса от стола
    bpy.ops.object.light_add(type='AREA', location=(-1.0, 0.9, 1.25))
    edge = bpy.context.object
    edge.data.size = 0.8
    edge.data.energy = 30
    edge.data.color = (0.75, 0.86, 1.0)
    edge.rotation_euler = (Vector((-0.2, 0.25, TOP)) - edge.location).to_track_quat('-Z', 'Y').to_euler()
    world = bpy.data.worlds.new('hall')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.03, 0.035, 0.04, 1)
    bpy.context.scene.world = world


def camera():
    """Взгляд сидящего диспетчера на край стола под монитором."""
    bpy.ops.object.camera_add(location=(0, -0.3, 1.13))
    cam = bpy.context.object
    target = Vector((0, 0.27, TOP))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 22
    cam.data.sensor_width = 36
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (target - cam.location).length
    cam.data.dof.aperture_fstop = 5.6
    bpy.context.scene.camera = cam
    return cam


def project(scene, cam, names):
    """Пиксели кадра (x вправо, y вниз) для всех вершин названных предметов, с модификаторами."""
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
    """Прямоугольник касания, обрезанный по кадру."""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [max(0, round(min(xs))), max(0, round(min(ys))), min(W, round(max(xs))), min(H, round(max(ys)))]


def face_quad(scene, cam, name, normal):
    """Четыре угла грани предмета с нормалью `normal` в его осях (экранчик), по часовой от левого верхнего."""
    ob = bpy.data.objects[name]
    me = ob.data
    best = max(me.polygons, key=lambda p: p.normal.dot(Vector(normal)))
    corners = []
    for i in best.vertices:
        c = world_to_camera_view(scene, cam, ob.matrix_world @ me.vertices[i].co)
        corners.append((c.x * W, (1 - c.y) * H))
    cx, cy = sum(p[0] for p in corners) / 4, sum(p[1] for p in corners) / 4
    corners.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))  # по часовой (y вниз)
    first = min(range(4), key=lambda i: corners[i][0] + corners[i][1])  # левый верхний — ближе всех к углу кадра
    corners = corners[first:] + corners[:first]
    return [[round(x, 1), round(y, 1)] for x, y in corners]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    M = materials()
    parts = scene_objects(M)
    lights()
    cam = camera()
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = 7
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = -0.3
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.compression = 90
    bpy.context.view_layer.update()

    phone = parts['phone']
    lamp = rect(project(scene, cam, [phone['lamp']]))
    places = {
        'phone': {
            'tap': rect(project(scene, cam, phone['body'] + [phone['lcd']])),
            'lcd': face_quad(scene, cam, phone['lcd'], (0, 0, 1)),
            'lamp': [round((lamp[0] + lamp[2]) / 2, 1), round((lamp[1] + lamp[3]) / 2, 1), round(max(lamp[2] - lamp[0], lamp[3] - lamp[1]) / 2, 1)],
        },
        'radio': {
            'tap': rect(project(scene, cam, parts['radio']['body'] + parts['radio']['extra'])),
            'lcd': face_quad(scene, cam, parts['radio']['lcd'], (0, -1, 0)),
        },
    }

    if PREVIEW:
        out = os.path.join(os.environ.get('PULT_PREVIEW', '/tmp'), 'pult-preview.png')
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print('предпросмотр:', out, json.dumps(places))
        return

    png = os.path.join(ROOT, 'assets', 'scenes', 'pult-desk.png')
    os.makedirs(os.path.dirname(png), exist_ok=True)
    scene.render.filepath = png
    bpy.ops.render.render(write_still=True)

    gen = os.path.join(ROOT, 'src', 'art', 'pult.gen.ts')
    lines = [
        '// Сделано blender/pult.py (Blender ' + VERSION + ') — руками не править. Кадр края стола для сцены «Пульт»',
        '// (assets/scenes/pult-desk.png) и места предметов в его пикселях: x вправо, y вниз. tap — прямоугольник касания',
        '// [x0, y0, x1, y1]; lcd — четыре угла экранчика по часовой от левого верхнего; lamp — огонёк [x, y, радиус].',
        f'export const PULT = {json.dumps({"w": W, "h": H, **places}, ensure_ascii=False)} as const;',
        '',
    ]
    with open(gen, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines))

    def sha(path):
        with open(path, 'rb') as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    passport = {
        'id': 'pult',
        'name': 'Край стола диспетчера для сцены «Пульт»: телефон, рация, клавиатура, гарнитура',
        'licence': 'своя работа студии «Горница»',
        'made': {'script': 'blender/pult.py', 'blender': VERSION, 'engine': 'CYCLES', 'samples': SAMPLES,
                 'denoiser': 'OPENIMAGEDENOISE', 'seed': 7, 'size': [W, H]},
        'files': {
            'assets/scenes/pult-desk.png': {'sha256': sha(png), 'bytes': os.path.getsize(png)},
            'src/art/pult.gen.ts': {'sha256': sha(gen), 'bytes': os.path.getsize(gen)},
        },
    }
    with open(os.path.join(ROOT, 'assets', 'scenes', 'pult.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(passport, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('пульт:', json.dumps(places))


main()
