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

PREVIEW = '--preview' in sys.argv
W, H = (1080, 1920) if not PREVIEW else (360, 640)
SAMPLES = 160 if not PREVIEW else 16
SEED = 11
TOP = 0.74
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


def materials():
    return {
        'desk': mat('desk', COL['desk'], rough=0.42, coat=0.15),
        'wall': mat('wall', COL['wall'], rough=0.85),
        'sill': mat('sill', COL['lamp'], rough=0.4),
        'frame': mat('frame', COL['edge'], rough=0.45),
        'glass': mat('glass', (0.6, 0.65, 0.7, 1), rough=0.02),
        'paper': mat('paper', COL['paper'], rough=0.85),
        'envelope': mat('envelope', insert.lin('#e7dcc4'), rough=0.8),
        'board': mat('board', insert.lin('#8a6a46'), rough=0.6),
        'metal': mat('metal', COL['metal'], rough=0.25, metal=0.9),
        'cover': mat('cover', insert.lin('#2d4a3f'), rough=0.55, coat=0.2),
        'label': mat('label', insert.lin('#efe9da'), rough=0.8),
        'pages': mat('pages', insert.lin('#ece6d6'), rough=0.9),
        'bag': mat('bag', insert.lin('#d2461f'), rough=0.6, coat=0.1),
        'strap': mat('strap', insert.lin('#2b2e31'), rough=0.7),
        'reflect': mat('reflect', insert.lin('#cfd3d4'), rough=0.3, metal=0.4),
        'tag': mat('tag', insert.lin('#f4f1e6'), rough=0.7),
        'mug': mat('mug', COL['spruce'], rough=0.3, coat=0.5),
        'pen': mat('pen', COL['kumach'], rough=0.3, coat=0.4),
        'dark': mat('dark', COL['dark'], rough=0.45),
        'key': mat('key', COL['key'], rough=0.55),
        'asphalt': mat('asphalt', insert.lin('#55595c'), rough=0.85),
        'garage': mat('garage', insert.lin('#b9b4a8'), rough=0.8),
        'gate': mat('gate', insert.lin('#7a7d80'), rough=0.6),
        'tree': mat('tree', insert.lin('#3f5a45'), rough=0.9),
        'floor': mat('floor', COL['floor'], rough=0.7),
        'edge': mat('edge', COL['edge'], rough=0.5),
    }


def room(M):
    # пол кабинета, стол с передней стенкой и стена с окном за ним
    box('floor', M['floor'], (4.0, 3.0, 0.02), (0, -0.6, -0.02))
    box('desk_top', M['desk'], (1.7, 0.84, 0.03), (0, 0.4, TOP - 0.03), bevel=0.008, segments=4)
    box('desk_front', M['edge'], (1.6, 0.02, 0.5), (0, 0.06, TOP - 0.56))
    box('wall_low', M['wall'], (3.0, 0.12, 0.95), (0, WALL + 0.06, 0))
    box('wall_high', M['wall'], (3.0, 0.12, 0.8), (0, WALL + 0.06, 2.0))
    box('wall_l', M['wall'], (0.9, 0.12, 1.1), (-1.05, WALL + 0.06, 0.9))
    box('wall_r', M['wall'], (0.9, 0.12, 1.1), (1.05, WALL + 0.06, 0.9))
    box('sill', M['sill'], (1.3, 0.22, 0.03), (0, WALL - 0.02, 0.92), bevel=0.006)
    # рама окна: две створки
    for i, x in enumerate((-0.6, 0.0, 0.6)):
        box(f'mullion{i}', M['frame'], (0.05, 0.06, 1.1), (x, WALL + 0.04, 0.9), bevel=0.005)
    box('transom_lo', M['frame'], (1.25, 0.06, 0.05), (0, WALL + 0.04, 0.9), bevel=0.005)
    box('transom_hi', M['frame'], (1.25, 0.06, 0.05), (0, WALL + 0.04, 1.95), bevel=0.005)


def yard(M):
    """Двор подстанции днём за окном: асфальт, гараж с воротами, деревья; кабинет на втором этаже."""
    box('ground', M['asphalt'], (60, 60, 0.1), (0, 30, -4.1))
    box('garage', M['garage'], (24, 0.4, 7), (0, 26, -4.0))
    for i, x in enumerate((-6.0, 0.0, 6.0)):
        box(f'gate{i}', M['gate'], (4.0, 0.1, 3.6), (x, 25.75, -4.0))
    for i, (x, y, r) in enumerate(((-13, 22, 2.4), (13, 21, 2.8), (-17, 30, 3.0), (17, 31, 3.2))):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, -4.0 + r + 1.6))
        bpy.context.object.data.materials.append(M['tree'])
    cars = []
    # стоят боком к окну, полосой с надписью к нам: общепрофильная (класс B) и реанимобиль (класс C)
    for i, (x, y, heading, label) in enumerate(((-3.6, 18.0, 14, None), (3.8, 19.5, 166, 'РЕАНИМАЦИЯ'))):
        car = insert.ambulance()
        car.name = f'car{i}'
        car.location = (x, y, -4.0)
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
                insert.block(f'resus_band{side}', red, (1.7, 0.01, 0.2), (-0.75, y, 1.45), parent=car)
                insert.text(f'resus_label{side}', label, 0.14, white, (-0.75, y + side * 0.008, 1.45), (90, 0, 0 if side < 0 else 180), car)
    # фары машин на стоянке не горят
    for ob in list(bpy.data.objects):
        if ob.type == 'LIGHT' and ob.parent in cars:
            bpy.data.objects.remove(ob, do_unlink=True)


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
    # мелочи: кружка, ручка
    cyl('mug', M['mug'], 0.038, 0.095, (0.5, 0.7, TOP), sides=40, bevel=0.003)
    box('mug_handle', M['mug'], (0.012, 0.034, 0.048), (0.543, 0.7, TOP + 0.024), bevel=0.005)
    cyl('pen', M['pen'], 0.0045, 0.14, (0.0, 0.4, TOP + 0.005), rot=(0, 90, 70), sides=12)
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
    bpy.ops.object.light_add(type='SUN', location=(0, 10, 10))
    sun = bpy.context.object
    sun.data.energy = 2.2
    sun.data.angle = math.radians(8)
    # солнце — из-за спины зрителя: двор освещён спереди
    sun.rotation_euler = (math.radians(50), 0, math.radians(20))
    world = bpy.data.worlds.new('day')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = insert.lin('#b9c9d8')
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
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
