# Original 3D creature avatars

Approved October 24, 2026. Seven original Pokémon-inspired creatures, with a soft sculpted finish, expressive glossy eyes, real articulated motion, and deterministic identities. The user approved the moss otter's appearance and motion, then expanded the roster to at least seven distinct characters.

## Cast

| Creature | Appearance | Greeting |
| --- | --- | --- |
| Moss otter | Cream muzzle, small paws, leaf-shaped tail | Paw wave |
| Ember gecko | Amber belly, rounded crest, curved tail | Happy hop |
| Cloud bat | Oversized ears, fluffy chest, soft wings | Wing flutter |
| Tide axolotl | Coral-like gills, paddle tail, broad smile | Two-handed wave |
| Crystal beetle | Rounded shell, translucent horn, tiny feet | Bow |
| Dusk rabbit | Asymmetric ears, cheek tufts, short paws | Ear perk and wave |
| Spark jerboa | Golden coat, tall ears, cream cheek fans, long hindfeet, star-tipped tail | Spark hop |

Each creature has three curated palettes. Mesh sources and export tooling remain in the repository. GLBs contain rigs, eye/head controls, blinking and named idle/greeting clips. Portraits are rendered from those GLBs in the browser scene, so the fallback and live artwork match.

## Review checkpoint

The moss otter was completed and shown at desktop/mobile welcome and dialog sizes. The user approved the actual model's appearance and motion before production of the remaining six species.

The authenticated `/dashboard/avatar-preview` route remains the collection review tool. The production catalog is a fixed seven-species v1 with three palettes per species. Publish species only with their GLB and all three matching portraits; asset tests enforce the complete roster.

## Integration after review

Preserve ChatAvatar's seed, animated, className and alt props. Add Three.js and React Three Fiber v9 in a dynamically loaded client renderer. Use matching image portraits for static instances; never mount canvases on bot cards. Keep DiceBear 10 installed.

The server generates a new welcome seed on each dashboard request. The creation dialog generates a seed once per opening, previews it, submits it, and preserves it during failed submissions. Validate and save that seed in the existing bots.avatar column. No schema change, migration, or compatibility layer.

## Character selection

The user subsequently requested the supplied Vengeance UI diagonal carousel interaction. The welcome screen, creation dialog, and artwork review now show a spring-driven diagonal row with a full-size interactive center character and smaller tilted portrait neighbors. Only the center character creates a WebGL canvas.

Deliberate mouse hover or a click/tap brings a neighboring creature into the center. Previous/next buttons, seven direct-choice dots, arrow keys, Home/End, and horizontal touch swipes provide alternatives. Pointer movement and a hover cooldown prevent slides moving under a stationary pointer from triggering continuous changes. Reduced motion removes travel animation and uses portraits.

The welcome selection carries into the creation dialog with the same species and palette but a fresh valid seed for that opening. Users may change the creature without losing typed fields. Selecting a species derives a valid seed through the unchanged versioned catalog, so the server persists precisely the previewed artwork in `bots.avatar`. Selection is disabled while creation is pending; validation retries retain it. No schema changes are needed.

Welcome sizes: 240px desktop, 200px mobile. Creation dialog: 144px. Bot card portrait: 40px. Idle motion includes breathing, blinking, and appendages; pointer gaze affects head and eyes. Click/tap/Enter/Space plays one greeting; repeated activation during that gesture is ignored.

## Lifecycle and accessibility

Use a matching portrait while loading, on WebGL/model failure, and with reduced motion. Suspend motion offscreen, in hidden tabs, and behind dialogs; cap rendering pixel density. Avatar activation must never submit forms. Preserve focus behavior and expose a single accessible greeting action.

## Verification

Test stable seed mapping, catalog coverage, portrait matching, rig/clip export contracts, pointer and keyboard interaction, touch, reduced motion, loading failure, tab/offscreen suspension, and repeated mount/unmount. At rollout test preview-to-persistence identity and form security. Run focused tests, lint, type checking, and production build. Review real desktop/mobile screenshots and animation frames.

Keep work uncommitted on main as requested. No production deployment or Git operation is part of this work.
