# Общий вид кадров из Blender (docs/13-art.md, «Сцены», «Отделка кадров»): процедурные материалы — шум, швы, лужи,
# доски — и отделка кадра после рендера: мягкое свечение ярких огней и лёгкое затемнение углов. Картинок со стороны
# нет: всё — узлы Blender с закреплёнными числами, случайности нет. Скрипты сцен берут отсюда материалы и отделку:
# insert.py, station.py, pult.py, caller.py.
import bpy  # noqa: I001

import bmesh
from mathutils import Matrix


def lin(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def _new(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']


def grain(name, c1, c2, scale=8.0, rough=(0.6, 0.9), bump=0.15, metal=0.0, coat=0.0, detail=5.0, stretch=(1, 1, 1),
          puddles=0.0, puddle_level=0.5, coords='Object'):
    """Поверхность с шумом: цвет между c1 и c2, шероховатость в пределах rough, мелкий рельеф. puddles > 0 — лужи:
    крупные пятна такого масштаба, гладкие и тёмные (мокрый асфальт)."""
    old = bpy.data.materials.get(name)
    if old:
        return old
    m, nt, b = _new(name)
    co = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = stretch
    nt.links.new(co.outputs[coords], mp.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = 0.62
    nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.32, 0.68
    ramp.color_ramp.elements[0].color, ramp.color_ramp.elements[1].color = c1, c2
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    rr = nt.nodes.new('ShaderNodeMapRange')
    rr.inputs['From Min'].default_value, rr.inputs['From Max'].default_value = 0.3, 0.7
    rr.inputs['To Min'].default_value, rr.inputs['To Max'].default_value = rough
    nt.links.new(n.outputs['Fac'], rr.inputs['Value'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = bump
    bp.inputs['Distance'].default_value = 0.02
    nt.links.new(n.outputs['Fac'], bp.inputs['Height'])
    color, roughness = ramp.outputs['Color'], rr.outputs['Result']
    if puddles > 0:
        big = nt.nodes.new('ShaderNodeTexNoise')
        big.inputs['Scale'].default_value = puddles
        big.inputs['Detail'].default_value = 2.0
        nt.links.new(co.outputs[coords], big.inputs['Vector'])
        mask = nt.nodes.new('ShaderNodeMapRange')
        mask.inputs['From Min'].default_value = puddle_level
        mask.inputs['From Max'].default_value = puddle_level + 0.06
        nt.links.new(big.outputs['Fac'], mask.inputs['Value'])
        wet = nt.nodes.new('ShaderNodeMapRange')
        wet.inputs['To Max'].default_value = 0.02
        nt.links.new(mask.outputs['Result'], wet.inputs['Value'])
        nt.links.new(roughness, wet.inputs['To Min'])
        roughness = wet.outputs['Result']
        dk = nt.nodes.new('ShaderNodeMixRGB')
        dk.blend_type = 'MULTIPLY'
        dk.inputs['Color2'].default_value = (0.45, 0.47, 0.5, 1)
        nt.links.new(mask.outputs['Result'], dk.inputs['Fac'])
        nt.links.new(color, dk.inputs['Color1'])
        color = dk.outputs['Color']
        dry = nt.nodes.new('ShaderNodeMapRange')
        dry.inputs['To Min'].default_value, dry.inputs['To Max'].default_value = bump, 0.0
        nt.links.new(mask.outputs['Result'], dry.inputs['Value'])
        nt.links.new(dry.outputs['Result'], bp.inputs['Strength'])
    nt.links.new(color, b.inputs['Base Color'])
    nt.links.new(roughness, b.inputs['Roughness'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    return m


def bricks(name, c1, c2, mortar, size=(0.5, 0.12), gap=0.012, rough=0.6, bump=0.3, coat=0.0, offset=0.5,
           coords='Object', turn=(0, 0, 0)):
    """Кладка или доски: плитка, кирпич, ламинат — узел «кирпич» с двумя цветами и швом. size — длина и высота, метры."""
    old = bpy.data.materials.get(name)
    if old:
        return old
    m, nt, b = _new(name)
    co = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = turn
    nt.links.new(co.outputs[coords], mp.inputs['Vector'])
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.offset = offset
    br.inputs['Color1'].default_value, br.inputs['Color2'].default_value = c1, c2
    br.inputs['Mortar'].default_value = mortar
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = gap
    br.inputs['Mortar Smooth'].default_value = 0.1
    br.inputs['Bias'].default_value = 0.0
    br.inputs['Brick Width'].default_value = size[0]
    br.inputs['Row Height'].default_value = size[1]
    nt.links.new(mp.outputs['Vector'], br.inputs['Vector'])
    nt.links.new(br.outputs['Color'], b.inputs['Base Color'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.invert = True
    bp.inputs['Strength'].default_value = bump
    bp.inputs['Distance'].default_value = 0.01
    nt.links.new(br.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    return m


def stripes(name, c1, c2, width=0.12, rough=0.85, coords='Object', axis=0, soft=0.02):
    """Полосы вдоль оси: обои, рольворота, решётка. width — шаг полос, метры."""
    old = bpy.data.materials.get(name)
    if old:
        return old
    m, nt, b = _new(name)
    co = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(co.outputs[coords], sep.inputs['Vector'])
    mod = nt.nodes.new('ShaderNodeMath')
    mod.operation = 'PINGPONG'
    mod.inputs[1].default_value = width / 2
    nt.links.new(sep.outputs[axis], mod.inputs[0])
    edge = nt.nodes.new('ShaderNodeMapRange')
    edge.inputs['From Min'].default_value = width / 4 - soft * width
    edge.inputs['From Max'].default_value = width / 4 + soft * width
    nt.links.new(mod.outputs[0], edge.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.inputs['Color1'].default_value, mix.inputs['Color2'].default_value = c1, c2
    nt.links.new(edge.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(mix.outputs['Color'], b.inputs['Base Color'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.2
    bp.inputs['Distance'].default_value = 0.005
    nt.links.new(edge.outputs['Result'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = rough
    return m


def glow(name, color, strength, base=(0, 0, 0, 1)):
    old = bpy.data.materials.get(name)
    if old:
        return old
    m, _, b = _new(name)
    b.inputs['Base Color'].default_value = base
    b.inputs['Emission Color'].default_value = color
    b.inputs['Emission Strength'].default_value = strength
    return m


class Boxes:
    """Много коробок одним предметом: окна, швы, рейки. Быстрее сотен отдельных предметов и одинаково при повторе."""

    def __init__(self, name, material):
        self.name, self.material, self.bm = name, material, bmesh.new()

    def add(self, size, loc, rot_z=0.0):
        m = Matrix.Translation(loc) @ Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Diagonal((size[0], size[1], size[2], 1))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        return self

    def build(self, parent=None):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        ob.data.materials.append(self.material)
        if parent:
            ob.parent = parent
        return ob


def polish(scene, bloom=0.5, threshold=1.2, size=0.5, vignette=0.22):
    """Отделка кадра: мягкое свечение вокруг ярких огней (фары, маячки, окна, лампы) и лёгкое затемнение углов."""
    scene.use_nodes = True
    nt = scene.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    src = nt.nodes.new('CompositorNodeRLayers')
    out = nt.nodes.new('CompositorNodeComposite')
    last = src.outputs['Image']
    if bloom > 0:
        g = nt.nodes.new('CompositorNodeGlare')
        g.glare_type = 'BLOOM'
        g.quality = 'HIGH'
        g.inputs['Threshold'].default_value = threshold
        g.inputs['Strength'].default_value = bloom
        g.inputs['Size'].default_value = size
        nt.links.new(last, g.inputs['Image'])
        last = g.outputs['Image']
    if vignette > 0:
        el = nt.nodes.new('CompositorNodeEllipseMask')
        el.inputs['Size'].default_value = (0.92, 0.92)
        bl = nt.nodes.new('CompositorNodeBlur')
        bl.filter_type = 'FAST_GAUSS'
        px = 0.2 * max(scene.render.resolution_x, scene.render.resolution_y)
        bl.inputs['Size'].default_value = (px, px)
        nt.links.new(el.outputs['Mask'], bl.inputs['Image'])
        lift = nt.nodes.new('CompositorNodeMapRange')
        lift.inputs['To Min'].default_value = 1.0 - vignette
        lift.inputs['To Max'].default_value = 1.0
        nt.links.new(bl.outputs['Image'], lift.inputs['Value'])
        mul = nt.nodes.new('CompositorNodeMixRGB')
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Fac'].default_value = 1.0
        nt.links.new(last, mul.inputs[1])
        nt.links.new(lift.outputs['Value'], mul.inputs[2])
        last = mul.outputs['Image']
    nt.links.new(last, out.inputs['Image'])
