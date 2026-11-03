// Saved progress and settings: a versioned shape that is checked field by
// field on load, so a stale or hand-edited save can never break the boot.
// Pure module (no DOM) so the tests can feed it anything.

export const SAVE_KEY = 'timberline-overland.v1';
export const SAVE_VERSION = 1;

const nonNeg = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

/**
 * Turn whatever was stored into a save the game can trust.
 * allowed: { langs, qualities, times, weathers, cams, placeIds, half } — the
 * values this build understands. Fields that fail a check fall back to null
 * (settings: the caller's default) instead of throwing.
 */
export function parseSave(text, allowed) {
  let raw = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  // v0.1.0 wrote the same shape without a version field.
  const version = Number.isInteger(raw.version) ? raw.version : 1;

  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const settings = {
    lang: oneOf(s.lang, allowed.langs, null),
    quality: oneOf(s.quality, allowed.qualities, null),
    muted: typeof s.muted === 'boolean' ? s.muted : null,
    time: oneOf(s.time, allowed.times, null),
    weather: oneOf(s.weather, allowed.weathers, null),
    cam: oneOf(s.cam, allowed.cams, null),
  };

  let journal = null;
  const j = raw.journal;
  if (j && typeof j === 'object' && Array.isArray(j.found)) {
    const found = [...new Set(j.found.filter((id) => allowed.placeIds.includes(id)))];
    const completedAt = Number.isFinite(j.completedAt) && j.completedAt >= 0 && found.length === allowed.placeIds.length ? j.completedAt : null;
    journal = {
      found,
      time: nonNeg(j.time),
      distance: nonNeg(j.distance),
      recoveries: Number.isInteger(j.recoveries) && j.recoveries >= 0 ? j.recoveries : 0,
      maxTilt: Math.min(180, nonNeg(j.maxTilt)),
      completedAt,
    };
  }

  let pos = null;
  const p = raw.pos;
  if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) < allowed.half && Math.abs(p.z) < allowed.half) {
    pos = { x: p.x, z: p.z, heading: Number.isFinite(p.heading) ? p.heading : 0 };
  }

  return { version, settings, journal, pos };
}

export function serializeSave({ settings, journal, pos }) {
  return JSON.stringify({ version: SAVE_VERSION, settings, journal, pos: pos || null });
}
