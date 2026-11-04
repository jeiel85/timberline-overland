"""Old mine blockout on the real terrain patch (site-local three.js coords).

Shipped as oldMine() in src/props.js, which is the source of truth."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import tl

OUT = os.path.join(os.path.dirname(__file__), 'renders')
os.makedirs(OUT, exist_ok=True)
tl.reset()
T = tl.Terrain(os.path.join(os.path.dirname(__file__), 'terrain.json'), 'mine')
T.build('#8a8a62')

PX, FZ, FY = 2.5, -7.6, 4.75      # track axis, portal face, portal floor
TIMBER, DARK, STONE = '#5b4129', '#0b0a09', '#7d776f'
RAIL, SLEEPER, BALLAST = '#6c5a4e', '#5a4430', '#8d8273'

# --- portal: stone headwall, timber set, lagged mouth ------------------------------
# battered (leaning back into the hill) and stepped down at the sides
BAT = -0.12
tl.box('pierL', 2.0, 3.6, 0.9, STONE, PX - 2.5, FY + 1.5, FZ - 0.6, rx=BAT)
tl.box('pierR', 2.0, 3.6, 0.9, STONE, PX + 2.5, FY + 1.5, FZ - 0.6, rx=BAT)
tl.box('lintel', 4.9, 1.5, 0.9, STONE, PX, FY + 3.85, FZ - 0.95, rx=BAT)
for sx in (-1, 1):
    tl.box(f'post{sx}', 0.32, 2.95, 0.32, TIMBER, PX + sx * 1.36, FY + 1.47, FZ + 0.12, rz=-sx * 0.035)
    tl.box(f'lag{sx}', 0.08, 2.85, 0.45, '#2a1f17', PX + sx * 1.3, FY + 1.42, FZ - 0.22)
tl.box('cap', 3.5, 0.38, 0.42, TIMBER, PX, FY + 3.08, FZ + 0.12)
# the hillside rises into the opening, so the darkness hangs just behind the set
tl.box('ceiling', 2.7, 0.1, 0.45, '#2a1f17', PX, FY + 2.85, FZ - 0.22)
tl.box('dark', 2.7, 2.9, 0.1, DARK, PX, FY + 1.45, FZ - 0.42)
tl.box('lantern', 0.18, 0.28, 0.18, '#ffb45e', PX + 1.0, FY + 2.7, FZ + 0.42)
# rubble that ties the headwall into the hillside
for i, (x, y, z, s, sy) in enumerate([(-1.9, 0.6, -7.8, 1.7, 1.2), (6.9, 0.5, -7.6, 1.9, 1.3),
                                      (0.6, 4.4, -9.5, 1.6, 1.0), (4.6, 4.2, -9.4, 1.8, 1.1),
                                      (-1.2, 2.6, -8.9, 1.3, 1.0), (6.4, 2.4, -8.8, 1.4, 1.0)]):
    tl.rock(f'rub{i}', 30 + i, '#8f8b84', x, T.at(x, z) + s * 0.15, z, s, s * 0.8 * sy, s, ry=i)

# --- track: ballast bed on the bench, trestle over the drop ------------------------
tl.box('ballast', 2.0, 1.2, 4.4, BALLAST, PX, FY - 0.6, -5.4)
z = FZ - 1.6
while z < 1.5:
    tl.box(f'sl{z:.1f}', 1.7, 0.1, 0.22, SLEEPER, PX, FY + 0.05, z)
    z += 0.75
for sx in (-1, 1):
    tl.box(f'rail{sx}', 0.07, 0.1, 11.0, RAIL, PX + sx * 0.5, FY + 0.15, -4.0)
    tl.box(f'stringer{sx}', 0.25, 0.35, 4.9, TIMBER, PX + sx * 0.6, FY - 0.18, -0.75)
for zb in (-2.2, -0.4, 1.4):
    top = FY - 0.35
    gl = T.at(PX - 0.85, zb) - 0.2
    gr = T.at(PX + 0.85, zb) - 0.2
    for sx, g in ((-1, gl), (1, gr)):
        tl.box(f'bent{zb}{sx}', 0.24, top - g, 0.24, TIMBER, PX + sx * 0.85, (top + g) / 2, zb)
    tl.box(f'bcap{zb}', 2.1, 0.25, 0.28, TIMBER, PX, FY - 0.48, zb)
    lo = max(gl, gr) + 0.3
    h, w = top - 0.2 - lo, 1.7
    if h > 0.6:
        a = math.atan2(h, w)
        L = math.hypot(h, w)
        for s in (-1, 1):
            tl.box(f'brace{zb}{s}', 0.1, L, 0.08, TIMBER, PX, lo + h / 2, zb + s * 0.07, rz=s * (math.pi / 2 - a))
# buffer stop and the ore chute
tl.box('buffer', 1.6, 0.3, 0.3, TIMBER, PX, FY + 0.35, 1.62)
for sx in (-1, 1):
    tl.box(f'bpost{sx}', 0.2, 0.7, 0.2, TIMBER, PX + sx * 0.7, FY + 0.15, 1.62)
chute_len, tilt, turn = 2.6, 0.7, 0.75
cx = PX + math.sin(turn) * 1.1
cz = 1.75 + math.cos(turn) * 1.1
cy = FY - 0.35 - math.sin(tilt) * 1.1
Mc = tl.three_matrix(cx, cy, cz, 0, turn, 0) @ tl.three_matrix(0, 0, 0, tilt, 0, 0)
tl.box('chute', 0.9, 0.06, chute_len, '#6d5238', 0, 0, 0, M=Mc)
for sx in (-1, 1):
    tl.box(f'chutes{sx}', 0.06, 0.35, chute_len, '#6d5238', sx * 0.45, 0.17, 0, M=Mc)

# --- ore car on the trestle ----------------------------------------------------------
CZ = -0.9
for sx in (-1, 1):
    for dz in (-0.45, 0.45):
        tl.cyl(f'wh{sx}{dz}', 0.2, 0.2, 0.1, '#2f2a26', PX + sx * 0.5, FY + 0.42, CZ + dz, rz=math.pi / 2, segs=12)
tl.box('frame', 1.2, 0.18, 1.5, '#3a3330', PX, FY + 0.62, CZ)
tl.cyl('bucket', 1.35 / math.sqrt(2), 1.0 / math.sqrt(2), 0.75, '#7a4a2a', PX, FY + 1.085, CZ, ry=math.pi / 4, segs=4)
tl.cyl('rim', 1.42 / math.sqrt(2), 1.38 / math.sqrt(2), 0.08, '#3a3330', PX, FY + 1.43, CZ, ry=math.pi / 4, segs=4)
tl.box('ore', 1.2, 0.05, 1.2, '#4a4642', PX, FY + 1.36, CZ)

# --- waste dump: a heap that drapes onto the slope -------------------------------------
def heap(cx, cz, depth, radius, rings=12, segs=22, seed=5):
    """A mound whose depth above the ground tapers to nothing at its rim, stretched downhill."""
    rnd = random.Random(seed)
    downhill = math.atan2(T.at(cx - 1, cz) - T.at(cx + 1, cz), T.at(cx, cz - 1) - T.at(cx, cz + 1))
    v = [(cx, T.at(cx, cz) + depth, cz)]
    f = []
    for k in range(1, rings + 1):
        t = k / rings
        for j in range(segs):
            a = (j + (rnd.random() - 0.5) * 0.4) / segs * 2 * math.pi
            reach = radius * (1 + 0.5 * max(0.0, math.cos(a - downhill)))
            r = reach * t * (1 + ((rnd.random() - 0.5) * 0.12 if k < rings else 0))
            x, z = cx + math.sin(a) * r, cz + math.cos(a) * r
            g = T.at(x, z)
            v.append((x, g + depth * (1 - t) ** 1.5 + (rnd.random() - 0.5) * 0.16 if k < rings else g - 0.15, z))
    for j in range(segs):
        f.append((0, 1 + j, 1 + (j + 1) % segs))
    for k in range(1, rings):
        a0, a1 = 1 + (k - 1) * segs, 1 + k * segs
        for j in range(segs):
            jn = (j + 1) % segs
            f.append((a0 + j, a1 + jn, a0 + jn))
            f.append((a0 + j, a1 + j, a1 + jn))
    return v, f

# under the end of the chute
end_x = cx + 1.3 * math.cos(tilt) * math.sin(turn)
end_z = cz + 1.3 * math.cos(tilt) * math.cos(turn)
hv, hf = heap(end_x + 0.3, end_z + 0.3, 1.7, 2.5)
tl.make('heap', hv, hf, '#93887a')
for i, (x, z, s_) in enumerate([(4.4, 5.2, 0.55), (7.0, 4.2, 0.7), (5.8, 6.2, 0.45), (3.5, 3.6, 0.4)]):
    tl.rock(f'hr{i}', 50 + i, '#9a9286', x, T.at(x, z) + s_ * 0.2, z, s_, s_ * 0.7, s_, ry=i)

# timber pile on the bench
for i in range(5):
    tl.box(f'beam{i}', 0.22, 0.22, 3.2, '#6e5238', -0.6 + (i % 3) * 0.26 + (0.13 if i >= 3 else 0),
           T.at(-0.4, -5.6) + 0.11 + (0.22 if i >= 3 else 0), -5.6, ry=0.25)

print('tris', tl.stats())
eye = (-2.0, T.at(-2, 7) + 1.7, 7.0)
tl.shots(os.path.join(OUT, 'mine'), {
    'trail': (eye, (2.5, 3.5, -5), 30),
    'three': ((14, 9, 10), (2.5, 3.0, -3), 30),
    'side': ((-14, 6, -2), (2.5, 3.0, -2), 30),
    'chase': ((-2.8, T.at(-2.8, 13.5) + 3.4, 13.5), (1.5, 3.2, -3), 40),
})
