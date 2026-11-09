# OpenMods creature source assets

The seven creatures are original OpenMods artwork authored for this project.
No external character models, textures, or animation clips are included. The
user approved the moss otter's appearance and motion as the collection standard.
Each species has three curated palettes, for 21 seeded appearances.

## Rebuild

Use the pinned Blender 4.5.9 LTS release, including its bundled Python. The
Linux x86_64 helper downloads the official portable build into the user cache
and verifies its pinned SHA-256 checksum before extraction:

```sh
BLENDER_BIN="$(bash scripts/creatures/install-blender.sh)"
"$BLENDER_BIN" --background --factory-startup \
  --python scripts/creatures/build_moss_otter.py
"$BLENDER_BIN" --background --factory-startup \
  --python scripts/creatures/build_sky_garden.py
for creature in ember-gecko tide-axolotl spark-jerboa; do
  "$BLENDER_BIN" --background --factory-startup \
    --python scripts/creatures/build_water_fire.py -- --character "$creature"
done
```

The build writes the editable, compressed `.blend` source and a structural
manifest into `assets/creatures/<species>/`, and the browser GLB into
`public/creatures/v1/<species>.glb`. The source scripts and shared
`creature_builder.py` toolkit are authoritative; edit them
to make reproducible geometry or motion changes. The `.blend` includes a review
camera, lights, armature, materials, and both animation actions for interactive
art work. Blender itself is not a runtime or repository dependency.

Optional offline art inspection:

```sh
"$BLENDER_BIN" --background --factory-startup \
  --python scripts/creatures/build_moss_otter.py -- --render --pose greet
```

`--pose` accepts `neutral`, `greet`, and `blink`; renders are written to `/tmp`.
The sky/garden builder accepts `--species cloud-bat`, `crystal-beetle`, or
`dusk-rabbit`; the elemental builder requires `--character` as shown above.
The shipped portraits must be captured from the browser renderer, so their
camera and lighting match the interactive avatar.

## Browser review and portraits

Build and run a local production preview (the authenticated review route is
`/dashboard/avatar-preview`):

```sh
npm run build
npm run start -- --hostname 127.0.0.1 --port 3001
```

In a second terminal, install the test browser once if needed, then capture and
verify the artwork:

```sh
npx playwright install chromium
for creature in moss-otter ember-gecko cloud-bat tide-axolotl crystal-beetle dusk-rabbit spark-jerboa; do
  npm run creatures:portraits -- http://127.0.0.1:3001 "$creature"
done
npm run test:creatures
npm run test:creatures:browser -- http://127.0.0.1:3001
npm run test:creatures:dashboard -- http://127.0.0.1:3001
npm run test:creatures:selector -- http://127.0.0.1:3001
```

The browser tools use a short-lived synthetic Auth0 session restricted to HTTP
localhost, using the local ignored environment file. They never print the
session or secret. The dashboard integration test creates rows for unique
synthetic test users and deletes only those rows in cleanup. These tools do not
test the real OAuth login.
Portrait capture renders the neutral GLB pose at 512 CSS pixels before
downsampling to a transparent 512px WebP. Desktop/mobile screenshots are saved
under `/tmp/openmods-creature-review` by default. Mobile coverage uses browser
emulation; the visibility lifecycle check simulates the standard visibility
event rather than an operating-system background transition.

Also run the browser checks against `next dev` to cover React Strict Mode's
effect replay. Animation actions retain their instance-local mixer bindings
through cleanup/replay; cleanup stops playback without invalidating those actions.

The dashboard and creation dialog use the supplied Vengeance UI diagonal
carousel interaction. Neighboring characters are portraits; only the centered
character creates a canvas. Hover, arrows, direct-choice controls, keyboard
navigation, and touch swipes select an appearance. The selection helper derives
a valid seed through the existing v1 mapping, preserving the palette and saving
the exact previewed identity. The selector browser suite also checks 320px and
390px layouts, reduced motion, and stationary-pointer behavior.

## Runtime asset contract

- glTF coordinates: Y up, +Z forward. The renderer normalizes model height and
  centers its bounds; species retain their distinct silhouettes.
- `head`, `eye_L`, `eye_R`: named bones for bounded runtime gaze. Their channels
  are removed from the sampled clips so the mixer does not own their rotation.
- `Blink`: morph target on all ten eye-surface meshes. Zero is open; one is
  closed. A runtime blink should update these targets together.
- `idle`: breathing and species-specific appendage motion.
- `greet`: species-specific wave, hop, flutter, bow, or ear perk, returning to idle.
- `body`, `cream`, `accent`: material names recolored by the selected palette.
- Other materials supply the eyes, highlights, nose, and mouth. They remain fixed.
- Each vertex has one skin influence. The original mesh topology, skin, and
  morph targets are exported without applying topology-changing modifiers.

Inspect the **exported GLB** in the browser after changing the source. The build
manifest is structural evidence, not evidence of visual quality or browser
animation correctness. Check all greeting frames, closed-eye deformation, and
pointer gaze before accepting an art revision.
