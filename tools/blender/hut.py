"""Snowline hut: a stone alpine refuge with a gable roof and a snow band at the eave.

Shipped as snowlineHut() in src/props.js, which is the source of truth."""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import tl

OUT = os.path.join(os.path.dirname(__file__), 'renders')
tl.reset()
T = tl.Terrain(os.path.join(os.path.dirname(__file__), 'terrain.json'), 'hut')
T.build('#8b8a6a')

STONE, PLINTH, ROOF, SNOW, WOOD, RED = '#8f8a82', '#6f6a63', '#3f4c5c', '#f2f5f8', '#6e5238', '#c2402c'
W, D, E, R = 6.0, 4.6, 2.6, 4.1   # width (x), depth (z), eave and ridge height

tl.box('plinth', W + 0.3, 0.4, D + 0.3, PLINTH, 0, 0.1, 0)
v, f = tl.extrude_geo([(-D / 2, 0), (D / 2, 0), (D / 2, E), (0, R), (-D / 2, E)], W)
tl.make('walls', v, f, STONE, tl.three_matrix(-W / 2, 0, 0, 0, math.pi / 2, 0))
# quoins: lighter dressed stones on the corners
for sx in (-1, 1):
    for sz in (-1, 1):
        for k in range(6):
            long = k % 2 == 0
            tl.box(f'q{sx}{sz}{k}', 0.62 if long else 0.34, 0.4, 0.34 if long else 0.62, '#b9b2a6',
                   sx * (W / 2 - (0.29 if long else 0.15)) + sx * 0.03, 0.42 + k * 0.42, sz * (D / 2 - (0.15 if long else 0.29)) + sz * 0.03)

th = math.atan2(R - E, D / 2)
L = math.hypot(D / 2, R - E) + 0.5
t = 0.16
for sz in (-1, 1):
    # slab hinged at the ridge, running down and out past the eave
    dz, dy = math.cos(th) * sz, -math.sin(th)
    nz, ny = math.sin(th) * sz, math.cos(th)
    cz, cy = dz * L / 2 + nz * t / 2, R + dy * L / 2 + ny * t / 2
    tl.box(f'roof{sz}', W + 0.8, t, L, ROOF, 0, cy, cz, rx=sz * th)
    if sz < 0:  # back slope: full snow
        tl.box('snowB', W + 0.6, 0.14, L - 0.5, SNOW, 0, cy + ny * 0.15, cz + nz * 0.15 + dz * 0.15, rx=sz * th)
    else:       # front: a band held by the snow guard at the eave
        k = L * 0.8
        tl.box('snowF', W + 0.6, 0.16, L * 0.26, SNOW, 0, R + dy * k + ny * (t + 0.08), dz * k + nz * (t + 0.08), rx=sz * th)
        g = L * 0.93
        tl.cyl('guard', 0.035, 0.035, W + 0.4, '#9aa3ad', 0, R + dy * g + ny * (t + 0.18), dz * g + nz * (t + 0.18), rz=math.pi / 2, segs=6)
tl.box('ridge', W + 0.9, 0.14, 0.42, '#2f3946', 0, R + 0.16, 0)
# chimney through the back slope
tl.box('chim', 0.7, 1.9, 0.7, STONE, -1.8, R - 0.05, -0.9)
tl.box('chimcap', 0.9, 0.1, 0.9, PLINTH, -1.8, R + 0.95, -0.9)
# door with frame and canopy
tl.box('door', 1.0, 2.0, 0.08, RED, 1.2, 1.2, D / 2 + 0.03)
for sx in (-1, 1):
    tl.box(f'dfr{sx}', 0.12, 2.15, 0.12, WOOD, 1.2 + sx * 0.56, 1.27, D / 2 + 0.04)
tl.box('dlin', 1.3, 0.14, 0.14, WOOD, 1.2, 2.35, D / 2 + 0.04)
tl.box('canopy', 1.7, 0.08, 0.9, ROOF, 1.2, 2.72, D / 2 + 0.42, rx=0.3)
# window with shutters
tl.box('win', 1.0, 0.8, 0.06, '#28323a', -1.4, 1.7, D / 2 + 0.02)
tl.box('sill', 1.16, 0.1, 0.18, '#e8dcc2', -1.4, 1.26, D / 2 + 0.06)
for sx in (-1, 1):
    tl.box(f'sh{sx}', 0.5, 0.86, 0.05, RED, -1.4 + sx * 0.78, 1.7, D / 2 + 0.06)
# gable window and antenna on the east end
tl.box('gwin', 0.06, 0.5, 0.6, '#28323a', W / 2 + 0.02, 3.15, 0)
tl.cyl('mast', 0.04, 0.05, 4.6, '#bfc4c9', W / 2 + 0.25, 3.0, -1.5, segs=6)
for k in range(2):
    tl.box(f'xbar{k}', 0.04, 0.04, 0.9, '#bfc4c9', W / 2 + 0.25, 4.4 + k * 0.6, -1.5)
# solar panel on the front slope
k = L * 0.35
tl.box('solar', 1.5, 0.05, 1.0, '#1d2c44', -1.4, R - math.sin(th) * k + math.cos(th) * (t + 0.04), math.cos(th) * k + math.sin(th) * (t + 0.04), rx=th)
# bench with legs, woodpile
tl.box('bench', 2.0, 0.08, 0.42, WOOD, -1.4, 0.48, D / 2 + 0.55)
for sx in (-1, 1):
    tl.box(f'bl{sx}', 0.1, 0.44, 0.36, '#5a4030', -1.4 + sx * 0.8, 0.22, D / 2 + 0.55)
for i in range(9):
    tl.cyl(f'log{i}', 0.12, 0.12, 1.0, '#7b5a3a', -W / 2 - 0.35 - (i // 3) * 0.0, 0.14 + (i % 3) * 0.24, -1.2 + (i // 3) * 0.26, rx=math.pi / 2, segs=7)
for i, (x, z, s) in enumerate([(-4.2, 2.6, 0.9), (4.4, -2.9, 1.1), (3.9, 3.6, 0.6)]):
    tl.rock(f'r{i}', 70 + i, '#8f8b84', x, T.at(x, z) + s * 0.15, z, s, s * 0.7, s, ry=i)

print('tris', tl.stats())
tl.shots(os.path.join(OUT, 'hut'), {
    'front': ((5, 2.2, 13), (0, 2.0, 0), 35),
    'back': ((-9, 6, -8), (0, 2.0, 0), 35),
})
