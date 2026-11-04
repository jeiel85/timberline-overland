"""Design kit: three.js-equivalent primitives in Blender, in a site's local frame.

Coordinates are three.js site-local (x right, y up, z toward visitors, metres,
y relative to the landmark's ground height). Every primitive builds its vertices
exactly like the matching three.js geometry (BoxGeometry, CylinderGeometry with
theta measured from +z, ExtrudeGeometry along +z) and applies three's Euler XYZ
rotation, so a design ports to props.js line by line.
"""
import bpy, bmesh, json, math, os, random
from mathutils import Matrix, Vector, Euler

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three -> blender

_mats = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def hexcol(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1.0)


def mat(color):
    if color not in _mats:
        m = bpy.data.materials.new(color)
        m.diffuse_color = hexcol(color)
        _mats[color] = m
    return _mats[color]


def three_matrix(x=0, y=0, z=0, rx=0, ry=0, rz=0, sx=1, sy=1, sz=1):
    # three: Euler 'XYZ' -> R = Rx * Ry * Rz
    R = Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rz, 4, 'Z')
    return Matrix.Translation((x, y, z)) @ R @ Matrix.Diagonal((sx, sy, sz, 1))


def make(name, verts, faces, color, M=None, parent=None, smooth=False):
    """verts in three coords; M a three matrix (or a list of them, outermost first)."""
    Ms = M if isinstance(M, list) else ([M] if M is not None else [])
    T = Matrix.Identity(4)
    for m in Ms:
        T = T @ m
    W = C @ T
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(W @ Vector(v)) for v in verts], [], faces)
    me.validate()
    if smooth:
        me.shade_smooth()
    me.materials.append(mat(color))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# --- geometry generators (three.js conventions) -------------------------------------

def box_geo(w, h, d):
    x, y, z = w / 2, h / 2, d / 2
    v = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z), (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    return v, f


def cyl_geo(rt, rb, h, segs=10, open_ended=False):
    v, f = [], []
    for i in range(segs):
        t = i / segs * 2 * math.pi
        v.append((rt * math.sin(t), h / 2, rt * math.cos(t)))
    for i in range(segs):
        t = i / segs * 2 * math.pi
        v.append((rb * math.sin(t), -h / 2, rb * math.cos(t)))
    for i in range(segs):
        j = (i + 1) % segs
        f.append((i, segs + i, segs + j, j))
    if not open_ended:
        if rt > 0:
            f.append(tuple(range(segs)))
        if rb > 0:
            f.append(tuple(reversed(range(segs, 2 * segs))))
    return v, f


def extrude_geo(pts, depth):
    """A closed 2D outline (x, y), extruded along +z from 0 to depth."""
    n = len(pts)
    v = [(x, y, 0) for x, y in pts] + [(x, y, depth) for x, y in pts]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
    return v, f


def rock_geo(seed, r=1.0, flat=0.35):
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    for vert in bm.verts:
        k = 1 + 0.22 * (rnd.random() * 2 - 1)
        vert.co *= k
        if vert.co.z < -flat * r:
            vert.co.z = -flat * r + (vert.co.z + flat * r) * 0.4
    v = [(p.co.x, p.co.z, -p.co.y) for p in bm.verts]  # blender -> three
    f = [tuple(vv.index for vv in face.verts) for face in bm.faces]
    bm.free()
    return v, f


# --- site-level helpers -----------------------------------------------------------------

def box(name, w, h, d, color, x, y, z, rx=0, ry=0, rz=0, M=None):
    v, f = box_geo(w, h, d)
    return make(name, v, f, color, ([M] if M else []) + [three_matrix(x, y, z, rx, ry, rz)])


def cyl(name, rt, rb, h, color, x, y, z, rx=0, ry=0, rz=0, segs=10, M=None, open_ended=False):
    v, f = cyl_geo(rt, rb, h, segs, open_ended)
    return make(name, v, f, color, ([M] if M else []) + [three_matrix(x, y, z, rx, ry, rz)])


def rock(name, seed, color, x, y, z, sx, sy, sz, ry=0):
    v, f = rock_geo(seed)
    return make(name, v, f, color, three_matrix(x, y, z, 0, ry, 0, sx, sy, sz))


class Terrain:
    def __init__(self, path, site):
        d = json.load(open(path))
        self.water = d['waterY']
        self.o = d[site]

    def at(self, x, z):
        o = self.o
        fx = (x + o['R']) / o['step']
        fz = (z + o['R']) / o['step']
        n = o['n']
        ix = max(0, min(n - 2, int(math.floor(fx))))
        iz = max(0, min(n - 2, int(math.floor(fz))))
        tx, tz = fx - ix, fz - iz
        h = o['h']
        a = h[iz * n + ix] + (h[iz * n + ix + 1] - h[iz * n + ix]) * tx
        b = h[(iz + 1) * n + ix] + (h[(iz + 1) * n + ix + 1] - h[(iz + 1) * n + ix]) * tx
        return a + (b - a) * tz

    def build(self, color='#6f8a3a', water_color=None):
        o = self.o
        n, R, st = o['n'], o['R'], o['step']
        v = [(-R + i * st, o['h'][j * n + i], -R + j * st) for j in range(n) for i in range(n)]
        f = [(j * n + i, (j + 1) * n + i, (j + 1) * n + i + 1, j * n + i + 1) for j in range(n - 1) for i in range(n - 1)]
        make('terrain', v, f, color)
        if water_color:
            y = o['waterLocal']
            make('water', [(-R, y, -R), (R, y, -R), (R, y, R), (-R, y, R)], [(0, 3, 2, 1)], water_color)


def camera(pos, target, lens=32):
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = lens
    cam_data.clip_end = 500
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    p = C @ Vector(pos)
    t = C @ Vector(target)
    cam.location = p
    cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path, res=(960, 600)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'Standard'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    sh.show_backface_culling = True  # as three.js FrontSide draws
    sh.shadow_intensity = 0.55
    sh.show_cavity = True
    sh.cavity_type = 'WORLD'
    sc.display.light_direction = (0.45, -0.35, 0.82)
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = hexcol('#a9c6dc')[:3]
    sh.background_type = 'WORLD'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def shots(prefix, views):
    """views: {name: (camera pos, target, lens)} in three local coords."""
    out = []
    for name, (p, t, lens) in views.items():
        for o in [o for o in bpy.data.objects if o.type == 'CAMERA']:
            bpy.data.objects.remove(o)
        camera(p, t, lens)
        out.append(render(f'{prefix}_{name}.png'))
    return out


def stats():
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name not in ('terrain', 'water'):
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return tris
