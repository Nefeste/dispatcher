# Кадр зала диспетчерской для заглавного экрана, загрузки и фона меню (docs/13-art.md, §7 «Заглавный экран и
# программа»): тот же зал и стол, что у сцены рабочего места (blender/build.py — те же функции, та же палитра), но ночью
# и в Cycles: светильники приглушены, зал освещают видеостена, мониторы и настольная лампа; малая глубина резкости.
# Skia кладёт кадр на весь экран и рисует поверх логотип, меню и огонёк телефона.
#
# Запуск: python blender/title.py [--preview] (Blender как модуль Python: pip install bpy==4.5.15, Python 3.11)
# Пишет:
# - assets/scenes/title-hall.jpg — кадр, 1080 × 1920;
# - src/art/title.gen.ts — размер кадра и место огонька телефона в его пикселях;
# - assets/scenes/title.json — паспорт: версия Blender, настройки рендера, отпечатки файлов.
# --preview — малый кадр в папку TITLE_PREVIEW (или /tmp), файлы игры не трогает; --dry — без рендера: места и паспорт.
#
# Экраны — не картинки со стороны: узлы Blender. Видеостена и правый монитор — «карта»: тёмная суша, река полосой
# шума, улицы — края ячеек Вороного; левый монитор — тёмная программа со строками. Числа закреплены, случайности нет.
import hashlib
import json
import math
import os
import re
import sys

import bpy  # noqa: I001
import bmesh
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402 — зал, стол, приборы
import look  # noqa: E402 — отделка кадра

VERSION = build.VERSION
ROOT = build.ROOT
PREVIEW = '--preview' in sys.argv
W, H = (1080, 1920) if not PREVIEW else (360, 640)
SAMPLES = 128 if not PREVIEW else 24


def colors():
    out = {}
    for rel in ('src/ui/theme.ts', 'src/art/palette.ts', 'src/scenes/palette.ts'):
        with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
            for name, hexs in re.findall(r"^\s+(\w+): '(#[0-9a-fA-F]{6})'", fh.read(), re.M):
                out.setdefault(name, look.lin(hexs))
    out['accent'], out['paper'], out['mug'] = out['kumach'], out['paper'], out['spruce']
    return out


COL = colors()

# шероховатость, металл, лак — по области палитры
SURF = {
    'floor': (0.35, 0.0, 0.3), 'wall': (0.85, 0.0, 0.0), 'partition': (0.9, 0.0, 0.0), 'desk': (0.3, 0.0, 0.4),
    'edge': (0.5, 0.0, 0.0), 'metal': (0.3, 1.0, 0.0), 'plastic': (0.4, 0.0, 0.2), 'dark': (0.45, 0.0, 0.1),
    'key': (0.5, 0.0, 0.0), 'chair': (0.8, 0.0, 0.0), 'accent': (0.4, 0.0, 0.2), 'paper': (0.8, 0.0, 0.0),
    'mug': (0.25, 0.0, 0.5), 'lamp': (0.4, 0.0, 0.2), 'glass': (0.1, 0.0, 0.5), 'pad': (0.9, 0.0, 0.0),
}


def surfaces():
    for r in build.REGIONS:
        m = bpy.data.materials[r]
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = COL[r]
        if r == 'glow':
            # ночь: светильники потолка приглушены
            b.inputs['Emission Color'].default_value = (0.75, 0.86, 1.0, 1.0)
            b.inputs['Emission Strength'].default_value = 0.06
            continue
        rough, metal, coat = SURF[r]
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        b.inputs['Coat Weight'].default_value = coat
    # огонёк линии на телефоне — свой материал: горит (Skia мигает им поверх кадра)
    led = bpy.data.objects['phone_led']
    lm = bpy.data.materials.new('led')
    lm.use_nodes = True
    lb = lm.node_tree.nodes['Principled BSDF']
    lb.inputs['Base Color'].default_value = COL['kumach']
    led.data.materials.clear()
    led.data.materials.append(lm)
    for p in led.data.polygons:
        p.material_index = 0


def map_screen(name, land, water, road, strength, scale):
    """Экран-«карта»: суша, река — полоса шума, улицы — края ячеек Вороного."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Roughness'].default_value = 0.15
    co = nt.nodes.new('ShaderNodeTexCoord')
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = scale
    nt.links.new(co.outputs['UV'], vor.inputs['Vector'])
    line = nt.nodes.new('ShaderNodeMapRange')
    line.inputs['From Min'].default_value, line.inputs['From Max'].default_value = 0.004, 0.011
    line.inputs['To Min'].default_value, line.inputs['To Max'].default_value = 1.0, 0.0
    nt.links.new(vor.outputs['Distance'], line.inputs['Value'])
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.1
    noise.inputs['Detail'].default_value = 1.0
    nt.links.new(co.outputs['UV'], noise.inputs['Vector'])
    river = nt.nodes.new('ShaderNodeMapRange')
    river.inputs['From Min'].default_value, river.inputs['From Max'].default_value = 0.488, 0.496
    nt.links.new(noise.outputs['Fac'], river.inputs['Value'])
    river2 = nt.nodes.new('ShaderNodeMapRange')
    river2.inputs['From Min'].default_value, river2.inputs['From Max'].default_value = 0.522, 0.53
    river2.inputs['To Min'].default_value, river2.inputs['To Max'].default_value = 1.0, 0.0
    nt.links.new(noise.outputs['Fac'], river2.inputs['Value'])
    band = nt.nodes.new('ShaderNodeMath')
    band.operation = 'MULTIPLY'
    nt.links.new(river.outputs['Result'], band.inputs[0])
    nt.links.new(river2.outputs['Result'], band.inputs[1])
    roads = nt.nodes.new('ShaderNodeMixRGB')
    roads.inputs[1].default_value, roads.inputs[2].default_value = land, road
    nt.links.new(line.outputs['Result'], roads.inputs['Fac'])
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.inputs[2].default_value = water
    nt.links.new(roads.outputs['Color'], mix.inputs[1])
    nt.links.new(band.outputs['Value'], mix.inputs['Fac'])
    nt.links.new(mix.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = strength
    return m


def program_screen(name, strength):
    """Экран-«программа»: тёмный фон и светлые строки карточки."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Roughness'].default_value = 0.15
    co = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Y'
    wave.inputs['Scale'].default_value = 3.0
    nt.links.new(co.outputs['UV'], wave.inputs['Vector'])
    rows = nt.nodes.new('ShaderNodeMapRange')
    rows.inputs['From Min'].default_value, rows.inputs['From Max'].default_value = 0.975, 0.99
    nt.links.new(wave.outputs['Fac'], rows.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.inputs[1].default_value, mix.inputs[2].default_value = COL['panel'], COL['blue']
    nt.links.new(rows.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(mix.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = strength
    return m


def screens():
    night = map_screen('scr_wall', (0.012, 0.022, 0.032, 1), (0.03, 0.075, 0.11, 1), (0.10, 0.17, 0.23, 1), 1.4, 16.0)
    day = map_screen('scr_map', COL['linen'], (0.42, 0.58, 0.66, 1), (1, 1, 1, 1), 0.3, 12.0)
    prog = program_screen('scr_prog', 1.3)
    for s in build.SCREENS:
        n = s['name']
        m = night if n == 'videowall' else day if n.endswith('map') or n.endswith('mon1') else prog
        bm = bmesh.new()
        vs = []
        for u, v in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = build.rot((u * s['w'] / 2, v * s['h'] / 2, 0.001), s['yaw'], s['pitch'])
            vs.append(bm.verts.new(build.g2b(s['x'] + p[0], s['y'] + p[1], s['z'] + p[2])))
        f = bm.faces.new(vs)
        uv = bm.loops.layers.uv.new('uv')
        for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = (u * s['w'] / s['h'], v)
        me = bpy.data.meshes.new('scr_' + n)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('scr_' + n, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(m)


def lights():
    # настольная лампа: тёплый свет на правый край стола
    lx, ly, lz = build.g2b(0.8, build.DESK_TOP + 0.22, -0.16)
    bpy.ops.object.light_add(type='SPOT', location=(lx, ly, lz))
    lamp = bpy.context.object
    lamp.data.energy = 26
    lamp.data.color = (1.0, 0.74, 0.46)
    lamp.data.spot_size = math.radians(120)
    lamp.data.spot_blend = 0.6
    lamp.data.shadow_soft_size = 0.05
    # слабый холодный свет зала сверху — чтобы тени не были чёрными
    bpy.ops.object.light_add(type='AREA', location=(0, 1.0, 3.1))
    top = bpy.context.object
    top.data.size = 5.0
    top.data.energy = 12
    top.data.color = (0.7, 0.82, 1.0)
    world = bpy.context.scene.world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.006, 0.008, 1)


def camera():
    """Взгляд стоящего за креслом диспетчера: стол — внизу кадра, мониторы — в середине, видеостена — над ними."""
    cam_d = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_d)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = build.g2b(0.0, 1.56, 1.75)
    target = Vector(build.g2b(0.0, 1.5, -1.0))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_d.sensor_fit = 'VERTICAL'
    cam_d.sensor_height = 36
    cam_d.lens = 23
    cam_d.dof.use_dof = True
    cam_d.dof.focus_distance = 2.1
    cam_d.dof.aperture_fstop = 1.0
    bpy.context.scene.camera = cam
    return cam


def main():
    scene = build.reset()
    build.room()
    build.desk()
    build.devices()
    for i, (x, z, yaw) in enumerate(((-1.95, -2.4, 12), (1.95, -2.4, -12), (-1.1, -3.7, 0), (1.1, -3.7, 0))):
        build.neighbour(i, x, z, yaw)
    surfaces()
    screens()
    lights()
    cam = camera()
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = 7
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 0.7
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    look.polish(scene, bloom=0.5, threshold=1.6, size=0.5, vignette=0.25)
    bpy.context.view_layer.update()

    led = bpy.data.objects['phone_led']
    pts = [world_to_camera_view(scene, cam, led.matrix_world @ v.co) for v in led.data.vertices]
    xs, ys = [p.x * W for p in pts], [(1 - p.y) * H for p in pts]
    lamp = [round(sum(xs) / len(xs), 1), round(sum(ys) / len(ys), 1), round(max(max(xs) - min(xs), max(ys) - min(ys)) / 2, 1)]
    # вызов на видеостене: точка на её карте и радиус первого круга (7 см стены) — круги рисует Skia
    wall = next(s for s in build.SCREENS if s['name'] == 'videowall')
    c0 = world_to_camera_view(scene, cam, Vector(build.g2b(wall['x'] + 0.95, wall['y'] + 0.3, wall['z'])))
    c1 = world_to_camera_view(scene, cam, Vector(build.g2b(wall['x'] + 1.02, wall['y'] + 0.3, wall['z'])))
    call = [round(c0.x * W, 1), round((1 - c0.y) * H, 1)]
    call_r = round(abs(c1.x - c0.x) * W, 1)

    if PREVIEW:
        out = os.path.join(os.environ.get('TITLE_PREVIEW', '/tmp'), 'title-preview.jpg')
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print('предпросмотр:', out, lamp, call, call_r)
        return

    jpg = os.path.join(ROOT, 'assets', 'scenes', 'title-hall.jpg')
    scene.render.filepath = jpg
    # --dry — кадр уже есть: переписать только места и паспорт
    if '--dry' not in sys.argv:
        bpy.ops.render.render(write_still=True)
    gen = os.path.join(ROOT, 'src', 'art', 'title.gen.ts')
    lines = [
        '// Сделано blender/title.py (Blender ' + VERSION + ') — руками не править. Кадр зала для заглавного экрана',
        '// (assets/scenes/title-hall.jpg): размер, огонёк телефона [x, y, радиус] и вызов на видеостене — точка [x, y] и',
        '// радиус первого круга — в его пикселях, x вправо, y вниз.',
        f'export const TITLE = {json.dumps({"w": W, "h": H, "lamp": lamp, "call": call, "callR": call_r})} as const;',
        '',
    ]
    with open(gen, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines))

    def sha(path):
        with open(path, 'rb') as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    passport = {
        'id': 'title',
        'name': 'Зал диспетчерской ночью: фон заглавного экрана, загрузки и меню',
        'licence': 'своя работа студии «Горница»',
        'made': {'script': 'blender/title.py', 'model': 'blender/build.py', 'blender': VERSION, 'engine': 'CYCLES',
                 'samples': SAMPLES, 'denoiser': 'OPENIMAGEDENOISE', 'seed': 7, 'size': [W, H]},
        'files': {
            'assets/scenes/title-hall.jpg': {'sha256': sha(jpg), 'bytes': os.path.getsize(jpg)},
            'src/art/title.gen.ts': {'sha256': sha(gen), 'bytes': os.path.getsize(gen)},
        },
    }
    with open(os.path.join(ROOT, 'assets', 'scenes', 'title.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(passport, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('заглавный кадр:', lamp)


main()
