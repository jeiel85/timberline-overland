// Expedition progress: which landmarks have been found, the suggested next
// stop, and the run's statistics. Pure so it can be tested and saved as JSON.

export class Journal {
  constructor(landmarks, saved = null) {
    this.places = landmarks.filter((l) => l.counted);
    const known = new Set(this.places.map((l) => l.id));
    this.found = new Set((saved?.found || []).filter((id) => known.has(id)));
    this.time = saved?.time || 0;
    this.distance = saved?.distance || 0;
    this.recoveries = saved?.recoveries || 0;
    this.maxTilt = saved?.maxTilt || 0;
    this.completedAt = saved?.completedAt ?? null;
  }

  get total() {
    return this.places.length;
  }

  get count() {
    return this.found.size;
  }

  get complete() {
    return this.found.size === this.places.length;
  }

  /** The first place along the intended route that is still undiscovered. */
  get next() {
    return this.places.find((l) => !this.found.has(l.id)) || null;
  }

  /** Marks and returns a place reached at (x, z), or null. */
  check(x, z) {
    for (const l of this.places) {
      if (this.found.has(l.id)) continue;
      if (Math.hypot(x - l.x, z - l.z) <= l.r) {
        this.found.add(l.id);
        if (this.complete && this.completedAt === null) this.completedAt = this.time;
        return l;
      }
    }
    return null;
  }

  tick(dt, travelled, tiltDeg) {
    if (this.completedAt === null) this.time += dt;
    this.distance += travelled;
    this.maxTilt = Math.max(this.maxTilt, tiltDeg);
  }

  toJSON() {
    return {
      found: [...this.found],
      time: this.time,
      distance: this.distance,
      recoveries: this.recoveries,
      maxTilt: this.maxTilt,
      completedAt: this.completedAt,
    };
  }
}

export function formatTime(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`;
}
