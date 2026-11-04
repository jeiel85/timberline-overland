# Blender blockouts

Landmarks are designed here on the real terrain, then written as three.js code
in `src/props.js` (see `DECISIONS.md`). Nothing in this folder ships with the game;
`src/props.js` is the source of truth.

- `tl.py` — primitives that build vertices exactly like three.js (`BoxGeometry`,
  `CylinderGeometry`, `ExtrudeGeometry`, Euler XYZ) in a site's local frame
  (x right, y up, +z toward visitors, metres above the landmark), so a design
  ports line by line. Renders with Workbench and back-face culling, as three.js
  draws `FrontSide` materials.
- `sample.mjs` — samples `generateTerrain()` around the sites into `terrain.json`.
- `mine.py`, `hut.py`, `dock.py` — the blockouts for the old mine, the snowline hut
  and the tarn dock. Each renders a few views into `renders/`.

```bash
node tools/blender/sample.mjs
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P tools/blender/mine.py
```
