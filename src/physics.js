// Static physics world: the terrain heightfield, boulders as convex hulls,
// tree trunks, landmark buildings and walls at the map edge.

const yawQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

export function buildPhysics(RAPIER, T, S, rockHulls, props) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  const kinds = new Map();

  // Rapier stores heightfields column-major: index = ix * (N + 1) + iz.
  const hf = new Float32Array(T.VN * T.VN);
  for (let iz = 0; iz < T.VN; iz++) {
    for (let ix = 0; ix < T.VN; ix++) hf[ix * T.VN + iz] = T.heights[iz * T.VN + ix];
  }
  const ground = world.createCollider(
    RAPIER.ColliderDesc.heightfield(T.N, T.N, hf, { x: T.SIZE, y: 1, z: T.SIZE }).setFriction(0.9),
  );
  kinds.set(ground.handle, 'terrain');

  for (const b of S.boulders) {
    const base = rockHulls[b.shape];
    const pts = new Float32Array(base.length);
    for (let i = 0; i < base.length; i += 3) {
      pts[i] = base[i] * b.sx;
      pts[i + 1] = base[i + 1] * b.sy;
      pts[i + 2] = base[i + 2] * b.sz;
    }
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (!desc) continue;
    desc.setTranslation(b.x, b.y, b.z).setRotation(yawQuat(b.rot)).setFriction(1.0);
    kinds.set(world.createCollider(desc).handle, 'rock');
  }

  for (const t of S.trees) {
    const r = (t.type === 2 ? 0.17 : 0.24) * t.s + 0.06;
    const desc = RAPIER.ColliderDesc.cylinder(2.5, r).setTranslation(t.x, t.y + 2.5, t.z).setFriction(0.6);
    kinds.set(world.createCollider(desc).handle, 'wood');
  }

  // Landmark parts: yawed boxes, or convex hulls (world-space points) for heaps and rocks.
  for (const p of props) {
    const desc = p.hull
      ? RAPIER.ColliderDesc.convexHull(p.hull)
      : RAPIER.ColliderDesc.cuboid(p.hx, p.hy, p.hz).setTranslation(p.x, p.y, p.z).setRotation(yawQuat(p.rot || 0));
    if (!desc) continue;
    desc.setFriction(0.8);
    kinds.set(world.createCollider(desc).handle, p.kind || 'wood');
  }

  const H = T.HALF;
  for (const [x, z, hx, hz] of [[H + 5, 0, 5, H + 10], [-H - 5, 0, 5, H + 10], [0, H + 5, H + 10, 5], [0, -H - 5, H + 10, 5]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 600, hz).setTranslation(x, 300, z));
  }

  return {
    world,
    colliderKind: (c) => kinds.get(c.handle) ?? 'rock',
    /** Highest solid surface under (x, z), used to drop the car back in safely. */
    groundY(x, z, fromY, excludeBody) {
      const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, fromY + 200, true, undefined, undefined, undefined, excludeBody);
      return hit ? fromY - hit.timeOfImpact : T.heightAt(x, z);
    },
  };
}
