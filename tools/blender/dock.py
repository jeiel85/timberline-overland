"""Tarn dock: plank pier on pilings with a T head, and a real canoe on the shore.

Shipped as tarnDock() in src/props.js, which is the source of truth."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import tl

OUT = os.path.join(os.path.dirname(__file__), 'renders')
tl.reset()
T = tl.Terrain(os.path.join(os.path.dirname(__file__), 'terrain.json'), 'tarn')
T.build('#6f8a3a', water_color='#4f86a0')
WATER = T.o['waterLocal']

DECK = 0.24           # deck top above the shore
Z0, Z1, HEAD = 6.0, 21.6, 3.0
PLANK, BEAM, POST = '#8d6a48', '#5a4030', '#4d3626'
rnd = random.Random(7)

# planks: narrow pier, then the wider head
z = Z0
while z < Z1 + HEAD:
    head = z >= Z1
    w = (5.2 if head else 2.4) + (rnd.random() - 0.5) * 0.08
    tl.box(f'pl{z:.2f}', w, 0.06, 0.27, PLANK, (rnd.random() - 0.5) * 0.05, DECK - 0.03 + (rnd.random() - 0.5) * 0.012, z + 0.14, ry=(rnd.random() - 0.5) * 0.02)
    z += 0.31
for sx in (-1, 1):
    tl.box(f'str{sx}', 0.16, 0.24, Z1 + HEAD - Z0, BEAM, sx * 0.95, DECK - 0.18, (Z0 + Z1 + HEAD) / 2)
    tl.box(f'curb{sx}', 0.12, 0.12, Z1 - 13.0, BEAM, sx * 1.14, DECK + 0.06, (13.0 + Z1) / 2)
tl.box('hbeam', 5.2, 0.24, 0.16, BEAM, 0, DECK - 0.18, Z1 + 0.1)
tl.box('hbeam2', 5.2, 0.24, 0.16, BEAM, 0, DECK - 0.18, Z1 + HEAD - 0.1)
# pilings down to the lake bed; the head corners stand proud as mooring posts
piles = [(sx * 1.05, z, 0) for z in (8.0, 10.4, 12.8, 15.2, 17.6, 20.0) for sx in (-1, 1)]
piles += [(sx * 2.45, z, 0.55) for z in (Z1 + 0.15, Z1 + HEAD - 0.15) for sx in (-1, 1)]
for i, (x, z, proud) in enumerate(piles):
    g = T.at(x, z) - 0.3
    top = DECK + proud
    tl.cyl(f'pile{i}', 0.11, 0.12, top - g, POST, x, (top + g) / 2, z, segs=8)
# shore sill and a short ramp onto the deck
tl.box('sill', 2.8, 0.25, 0.3, BEAM, 0, 0.0, Z0 + 0.1)
ramp_len = 1.3
a = math.atan2(DECK, ramp_len)
tl.box('ramp', 2.4, 0.06, math.hypot(DECK, ramp_len), PLANK, 0, DECK / 2 - 0.03, Z0 - ramp_len / 2, rx=-a)
# ladder off the end, lantern post on a head corner
for sx in (-1, 1):
    tl.box(f'lad{sx}', 0.06, 1.4, 0.06, '#9aa3ad', sx * 0.25, DECK - 0.5, Z1 + HEAD + 0.08)
for k in range(4):
    tl.box(f'rung{k}', 0.5, 0.04, 0.04, '#9aa3ad', 0, DECK - 0.05 - k * 0.3, Z1 + HEAD + 0.08)
tl.box('lpost', 0.1, 1.5, 0.1, POST, 2.45, DECK + 0.75, Z1 + 0.15)
tl.box('lamp', 0.2, 0.28, 0.2, '#ffb45e', 2.45, DECK + 1.62, Z1 + 0.15)


# --- canoe: a parametric hull -----------------------------------------------------
def hull(Lc=4.6, B=0.84, Dp=0.36, rise=0.2, nu=24, nv=8):
    v, f = [], []
    for i in range(nu + 1):
        u = -1 + 2 * i / nu
        w = B / 2 * max(0.0, 1 - abs(u) ** 2.2) ** 0.6
        d = Dp * (1 - 0.3 * u * u)
        top = rise * u ** 4
        for j in range(nv + 1):
            p = math.pi * j / nv
            s = math.sin(p) ** 0.7
            v.append((-w * math.cos(p), top - d * s, u * Lc / 2))
    for i in range(nu):
        for j in range(nv):
            a0 = i * (nv + 1) + j
            b0 = (i + 1) * (nv + 1) + j
            f.append((a0, b0, b0 + 1, a0 + 1))
    return v, f

cv, cf = hull()
cx, cz, cr = -4.2, 8.6, 0.35
cy = T.at(cx, cz) + 0.36 * 0.98
Mc = tl.three_matrix(cx, cy, cz, 0, cr, 0.06)
tl.make('canoe_out', cv, [tuple(reversed(face)) for face in cf], '#c9452f', Mc)
cv_in = [(x * 0.94, y + 0.025, z * 0.985) for x, y, z in cv]
tl.make('canoe_in', cv_in, cf, '#b88a55', Mc)
for k, u in enumerate((-0.5, 0.0, 0.5)):
    w = 0.84 / 2 * (1 - abs(u) ** 2.2) ** 0.6
    tl.box(f'thw{k}', 2 * w, 0.04, 0.07 if k == 1 else 0.2, '#a77a4a', 0, -0.06 if k != 1 else 0.0, u * 2.3, M=Mc)
tl.box('paddle', 0.06, 0.03, 1.5, '#d2a050', 0.15, -0.02, -0.6, ry=0.15, M=Mc)

# the bench stays where it was
tl.box('bench', 1.8, 0.1, 0.45, '#7a5a3c', 3.6, 0.5, -1.5)

print('tris', tl.stats())
tl.shots(os.path.join(OUT, 'dock'), {
    'shore': ((-7.5, 2.4, 3.5), (0, 0, 16), 32),
    'side': ((12, 3.5, 12), (0, 0, 15), 35),
    'canoe': ((-1.5, 1.8, 11.5), (-4.2, 0, 8.6), 40),
})
