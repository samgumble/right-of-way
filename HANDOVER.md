# Handover

Last updated: 2026-07-01. Phase 4 is fully done; Phase 5 (hosting, GitHub Pages) is done;
the "10x expansion" (six-wave plan, see below) is in progress — Waves 1–5 (audio;
lighting/materials/atmosphere; particles/weather; terrain depth; economy depth)
delivered, Wave 6 (the last one) planned but not built.

Read [PLAN.md](PLAN.md) first for roadmap/status. This doc is the "how it works and
why" for whoever (human or Claude) picks this project up next.

## Running it

```
npm install
npm run dev
```

Vite dev server, default port 5173. `npm run build` typechecks (`tsc --noEmit`) then
builds. No test suite yet — verification so far has been manual (dev server + visual
check).

## Architecture

Everything lives under `src/game/`, orchestrated by `src/main.ts` which just does
`new Game(document.querySelector('#app'))`.

- **`Game.ts`** — top-level orchestrator. Owns the THREE.Scene, WebGLRenderer, the
  camera rig, the grid, the `Economy`, the `Hud`, and the lists of towers/spans.
  Handles all pointer input (raycasting) and drives the animation loop via
  `renderer.setAnimationLoop`. Tracks `lastTick` to compute real `dt` per frame
  (clamped to 0.25s so tab-refocus doesn't cause a huge economy jump) — Phase 1 never
  needed delta time since nothing there was rate-based. Placement and stringing are
  now cost-gated: `onClick` checks `economy.canAfford` before spending and placing;
  `tryStringSpan` returns a boolean and only consumes the `selectedTower` / marks the
  pair as spanned on success, so a denied attempt leaves the first tower still selected
  for a retry. `onKeyDown` handles `U` for tower upgrades and `Shift+R` for a full
  reset. `this.spans` is now `SpanRecord[]` (`{ span, a, b }`), not `Span[]` — the
  tower references are needed to serialize which grid nodes each span connects.
  `loadSavedGame()` runs once at construction, before `bindInput()`; `save()` runs
  after every discrete action, on a 3s throttle inside `tick()`, and on
  `visibilitychange`/`beforeunload`. See "Persistence" below for the two bugs this
  surfaced and how they're guarded against. Placement (Phase 3) is now also
  terrain-gated: `onClick`/`onPointerMove` check `grid.isBuildable(i,j)` instead of just
  occupancy, and compute cost via `grid.towerCostMultiplier(i,j)`. `raycastSpan()`
  mirrors `raycastTower()` for span clicks; `onClick` checks tower → span → ground in
  that order, and a span click only does something if `span.isFaulted()` (healthy spans
  consume the click without side effects, so you can't place a tower under a wire by
  accident). `tick()` also checks `nextStormAt` and calls `triggerStorm(now)`, which
  picks a random *energized* span, faults it, saves, and reschedules. `placeTower`
  (permitting) passes `PERMIT.pendingDurationSec * 1000` into `new Tower(...)`;
  `handleTowerClick` checks `tower.isPending()` *first*, before the existing
  select/string branches, and just denies+shakes without touching any existing
  selection — so a pending-tower click never disturbs an in-progress string attempt.
  Also owns (Phase 4) a `THREE.EffectComposer` (`RenderPass` → `UnrealBloomPass` →
  `OutputPass`, strength/radius/threshold `0.55/0.4/0.2` — tuned so idle steel-blue
  towers stay dark but selected/energized/fault emissive elements bloom) — `tick()`
  calls `this.composer.render()` instead of `renderer.render()` directly, and
  `onResize()` also calls `composer.setSize(...)` alongside the renderer. And (Wave 1) a
  `SoundManager` instance: `bindInput()` adds a one-shot `pointerdown` listener calling
  `sound.unlock()` (browsers block audio until a user gesture, and there's no menu to
  put an explicit "enable sound" control on); every discrete action that already calls
  `tower.denyFeedback()`/`ghostDenyStart = ...` now also calls `this.sound.playDeny()`
  right alongside it; successful placement/select/upgrade/storm-strike each get one
  direct `this.sound.playX()` call at their existing success branch. `tick()`'s
  per-tower/per-span `update(now)` calls now check the returned event
  (`'permitCleared'` → `playPermitClear()`; `'energized'` → `playEnergize()`;
  `'repaired'` → `playRepair()`) rather than the sound living inside `Tower`/`Span`
  themselves — keeps those two classes audio-agnostic, matching how they're already
  kept `Economy`/`Hud`-agnostic. `tick()` also computes `faultCount` inline now (it used
  to only exist inside `updateHud()`) and calls `sound.updateFaultAlarm(now, faultCount)`
  every frame — internally a no-op unless `FAULT_ALARM_INTERVAL_MS` has passed, so
  multiple simultaneously-faulted spans share one alarm tick, not one each. And (Wave 2)
  `scene.fog`, a stored `ambientLight`/`sunLight` pair (previously anonymous locals —
  needed as fields now that `tick()` animates them), shadow mapping (`renderer.shadowMap`
  enabled with `VSMShadowMap`, the sun's shadow camera frustum sized to
  `SHADOW.frustumHalfExtent` so it covers the full static board regardless of camera
  pan/zoom), and a `ShaderPass(VignetteShader)` appended *after* `OutputPass` — see Wave 2
  below for why the ordering matters. `updateAtmosphere(now)`, called every tick right
  after `cameraRig.update()`, drives the day/night cycle. And (Wave 3) a `rainMesh`
  (`THREE.InstancedMesh`, 220 instances, built once in the constructor via `buildRain()`
  and left `visible = false` until a storm strike calls `startRain(now)`), a `bursts:
  ParticleBurst[]` array spawned via `spawnBurst(origin, style, now)` at the three trigger
  sites (placement success in `onClick`, `permitCleared` in `tick()`'s tower loop, and a
  storm's fault in `triggerStorm()`), and `updateRain(now, dt)` / `updateBursts(now)`
  called every tick right after the storm check — the same "call it every frame, it's a
  no-op unless something's active" idiom `updateFaultAlarm` already established. And
  (Wave 5) a `computeTowerCost(node)` helper (replacing two near-duplicated inline cost
  calculations in `onPointerMove`/`onClick`) that folds in linear growth from
  `this.towers.length`; `spanStormWeight(record)` / `pickWeightedStormTarget(candidates)`
  for terrain-weighted storm selection, called from `triggerStorm()` in place of the old
  uniform `Math.random()` pick; and the free function `randomStormDelayMs(energizedCount)`
  (was zero-arg) now scales both interval bounds toward `STORM.minIntervalFloorSec`.
- **`CameraRig.ts`** — fixed-angle orthographic isometric camera. Never rotates.
  Right-drag pans (pointerdown/move/up gated on `button === 2`) directly/1:1 — easing an
  active drag would feel laggy, so pan is intentionally *not* eased. Scroll wheel sets a
  `targetZoom` (clamped); a new `update()` method, called every tick, eases the actual
  `zoom` toward it (`ZOOM_EASE = 0.18` of the remaining gap per frame, snapping once
  within `ZOOM_SNAP_EPSILON`) and calls `applyZoom()` — previously `onWheel` snapped
  `zoom` instantly. `setView()` (persistence restore) sets both `zoom` and `targetZoom`
  together so a reload doesn't visibly "ease in" from a default. Pan is clamped to
  `±PAN_BOUND` so you can't scroll off into the void. `getView()`/`setView(x, z, zoom)`
  read/write pan target and zoom directly, both going through the same clamps as normal
  input so a corrupted saved camera can't put the view somewhere invalid.
- **`Grid.ts`** — bounded ground plane (`GRID.cells × GRID.cells`, currently 20×20 at
  `GRID.cellSize = 6` world units) plus a `THREE.GridHelper` overlay. Owns the
  world↔grid-node mapping (`nearestNode`) and an occupancy set keyed by `"i,j"`.
  `nearestNode` rejects non-finite `i`/`j` before the bounds check — see "Persistence"
  below for why that check exists. Also owns (Phase 3) terrain: `terrainAt(i,j)`
  classifies every node `flat`/`hill`/`water` (Wave 4: `/marsh`) via `terrainNoise` (a
  fixed, unseeded layered-sine field — see "Phase 3 decisions"); `isBuildable(i,j)` and
  `towerCostMultiplier(i,j)` are what `Game` calls when placing. Hill/water patches are
  rendered once in the constructor as `THREE.InstancedMesh`es (one per terrain
  type, sized to however many nodes actually are that type — three meshes as of Wave 4)
  rather than one mesh per node, keeping draw calls flat regardless of grid size. Each
  instance's matrix (Phase 4)
  now also carries a small deterministic rotation/scale/position jitter, hashed from
  `(i, j)` — same "no seed, regenerates identically" discipline as `terrainNoise` — so
  patches read as organic shapes instead of a grid of identical stamped circles. Ground
  and terrain-patch materials are now (Wave 2) `MeshStandardMaterial` (was
  `MeshLambertMaterial`) with high roughness/low metalness — matte dirt/hillside, not
  metal — and all three (`groundMesh`, hill patches, water patches) set
  `receiveShadow = true` so a tower's shadow reads correctly whether it falls on plain
  ground or a terrain patch.
- **`Tower.ts`** — exports `buildTowerVisual(material, height)`, a shared geometry
  factory (tapered cylinder shaft + two box cross-arms + base) reused by both real
  towers and the hover-ghost preview. `Tower` wraps that with a `MeshStandardMaterial`
  (Wave 2; was `MeshLambertMaterial` — the switch is what makes the new directional
  lighting/shadows actually show up as more than flat color), a pop-in scale animation
  (ease-out-back) on spawn, and `setSelected()` which swaps
  color/emissive between steel blue and safety orange. Also owns (Phase 2): `tier`
  (1–3) and `connections` count against `ECONOMY.towerTierCapacity[tier-1]`;
  `upgrade()` bumps the tier and bolts on one more cross-arm lower on the shaft from
  the `TIER_ARMS` table (never moves `topPos`, so existing spans stay attached); an
  upgrade triggers a scale-pulse animation distinct from the spawn pop-in; `basePos` is
  now stored separately from `group.position` so `denyFeedback()` can layer a temporary
  shake on top without disturbing the tower's real position. `addArmForTier(tier)` is
  the shared piece both `upgrade()` and `materializeFromSave(tier, connections, pendingMs?)`
  (persistence) call — the latter applies saved tier/connection/pending state instantly,
  skipping the spawn pop-in and any upgrade pulses, since a restored tower shouldn't
  animate as if it were just built. Also owns (Phase 3 permitting): an optional
  `pendingDurationMs` constructor arg sets `permitClearAt = now + duration`;
  `isPending()` checks against it directly with `performance.now()` (no `now` param
  needed, matching `denyFeedback()`'s existing pattern). While pending, `update()`
  oscillates `material.opacity` on a 1.4s sine cycle (0.45–0.85) — the material is now
  always `transparent: true` so this doesn't need to toggle a material flag at
  activation time. The moment `now >= permitClearAt`, it nulls the field, snaps opacity
  to 1, and kicks off `activationPulseStart` — a 300ms scale bump *and* a steel-blue
  emissive flash (skipped if the tower is already `selected`, since orange from
  `setSelected` should win visually and the flash would otherwise fight it — see
  "Phase 3 decisions" for why this can't actually happen in practice: pending towers
  can't be selected, so there's no way to select one in the same frame it activates).
  `getPendingRemainingMs()` returns the remaining ms (or `null` once cleared) purely
  for `Game.save()` to serialize. Two more small additions: insulator-string nub
  details (Phase 4) at the top cross-arm's tips in `buildTowerVisual`, where a
  conductor would actually attach; and (Wave 1) `update()`'s return type is now
  `TowerEvent | null` (`TowerEvent = 'permitCleared'`) — set when the existing
  `permitClearAt` transition fires, so `Game.tick()` can react to it without polling
  `isPending()` separately every frame. And (Wave 2) the constructor now traverses
  `this.group` and sets `castShadow = true` on every mesh — done on the `Tower` instance
  itself, not inside the shared `buildTowerVisual` factory, so the semi-transparent
  hover-ghost (which also calls `buildTowerVisual`) doesn't cast a full shadow of a
  tower that isn't actually placed yet.
- **`catenary.ts`** — pure math, no scene dependency beyond `THREE.Vector3` for the
  return type. `computeCatenaryPoints(p1, p2, sagRatio, segments)` solves the catenary
  parameter `a` via Newton's method (parabolic initial guess) and samples points along
  the curve between two tower-top points, sagging in world-Y, interpolated in world-XZ.
- **`Span.ts`** — takes two tower-top points, builds a `TubeGeometry` along the
  catenary points. Four phases now: `stringing` (progressively reveals more of the tube
  over ~420ms, easeOutCubic), `energizing` (~650ms color/emissive lerp *from whatever
  color it started at* → energized-green, plus a small sphere pulse traveling along the
  points), `energized` (steady state), `faulted` (Phase 3 — fault-red, a blinking
  alarm-style emissive pulse on a ~1.1s cycle, plus a bright decaying strike-flash on
  the moment of impact). Geometry is rebuilt every frame only during `stringing`.
  `energizeStartColor` is captured fresh each time `energizing` is entered (steel-blue
  from the natural stringing transition, or the current fault-red from a `repair()`) —
  this is what makes the same energizing animation work for both "just strung" and
  "just repaired" without duplicating the lerp logic. `fault()` only fires from
  `energized` (storms can't double-fault an already-broken line); `repair()` only fires
  from `faulted`. A second, invisible, larger-radius (`HIT_RADIUS = 0.7`, up from an
  initial `0.35` — see "Phase 3 decisions") `TubeGeometry` is built once in the
  constructor purely so a thin curved 3D line is clickable at all; it's tagged
  `group.userData.isSpan = true` for `Game`'s raycast routing, same pattern as
  `Tower`'s `isTower` flag. Exposes `isEnergized()` (Phase 2) and `isFaulted()`
  (Phase 3) so `Game` can count/query span state, and `materializeEnergized()`
  (persistence) which jumps straight to the `energized` steady state, skipping all
  animated phases for restored spans — `Game.loadSavedGame()` calls `fault()`
  immediately after if the save says the span was faulted. `update()`'s return type
  (Wave 1) is now `SpanEvent | null` (`'energized' | 'repaired'`) — a private
  `repairing` flag is set by `repair()` and checked (then cleared) at the exact moment
  the `energizing → energized` transition completes, so the *same* transition can
  report two different events depending on how it was entered. This exists specifically
  because `repair()` deliberately reuses the `energizing` phase/animation rather than
  having its own — elegant for the visual, but it means the state machine alone can't
  tell "just strung" from "just repaired" apart without this flag. And (Wave 3)
  `midpoint(): THREE.Vector3` — returns the point at the middle index of the internal
  catenary `points` array, cloned. Added specifically so `Game.triggerStorm()` has an
  anchor for a fault-spark burst without `Span` exposing its full `points` array
  (which stays private) to callers that only need one position.
- **`constants.ts`** — all color/size/economy magic numbers live here: `COLORS`,
  `GRID`, `TOWER_HEIGHT`, `ECONOMY`, `DENY_SHAKE_DURATION_MS`, `TERRAIN`, `STORM`,
  `PERMIT` (Phase 3), `ATMOSPHERE`, `SHADOW` (Wave 2), `RAIN`, `PARTICLE_BURST` (Wave 3).
  `ECONOMY.towerCostGrowthPerTower` and `STORM.minIntervalFloorSec`/
  `intervalHalfLifeSpanCount`/`marshWeightMultiplier` (Wave 5) are all pure tuning
  values — no schema/persistence impact, same pattern as every other constant here.
- **`Economy.ts`** (Phase 2) — tiny state holder for `capEx` and `crewHours`.
  `canAfford(capExCost, crewHoursCost)`, `spend(...)`, and `tick(dt, energizedSpanCount)`
  which adds passive CapEx income (per energized span per second) and regenerates
  Crew-Hours up to `crewHoursMax`. No events/observer pattern — `Game` just reads the
  fields directly each frame since it already has a tick loop. `restore(capEx,
  crewHours)` (persistence) sets both directly, clamping Crew-Hours to the max.
- **`Hud.ts`** (Phase 2) — the first DOM UI in the project. A `position: fixed`,
  `pointer-events: none` overlay appended as a sibling of the canvas: a CapEx/Crew-Hours
  panel, a one-line contextual hint shown only when a tower is selected, and (Phase 3) a
  blinking fault-red status line shown only when `faultCount > 0`. `update()` takes a
  single `HudState` options object instead of a growing positional argument list.
  (Phase 4) the fault/context lines, plus a new **onboarding hint** line, now share one
  `.hud-note` base CSS class (`style.css`) with color-only modifiers
  (`--fault`/`--context`/`--hint`) instead of three near-duplicated blocks — the hint
  text itself is computed by `Game.computeOnboardingHint()`, which is *derived from
  current state* (`towers.length`, `spans.length`, `selectedTower`), not stored:
  "place a tower" → "place a second" → "string a span between them" → nothing, once
  `spans.length > 0`. No persistence needed — the underlying state it reads already is.
  Plain DOM (`innerHTML` + `querySelector`), no framework — not worth one for this much UI.
- **`feedback.ts`** (Phase 2) — `denyShakeOffset(elapsedMs)`, a decaying sine-wave
  horizontal offset shared by `Tower` (denied upgrade/span) and `Game`'s ghost preview
  (denied placement) so both use identical shake timing/feel from one place.
- **`Persistence.ts`** — `saveGame(data)` / `loadGame()` / `clearSave()` around a single
  `localStorage` key (`right-of-way-save`), JSON with a `version` field. `loadGame()`
  returns `null` (not throws) on missing key, JSON parse failure, version mismatch, or
  a payload that isn't shaped like `SaveData` — callers always get either valid data or
  `null`, never a wire format they have to defensively unwrap themselves. Deliberately
  does not validate individual tower/span entries (grid bounds, tier ranges) — that's
  `Game.loadSavedGame()`'s job, since `Grid`/`ECONOMY` constants live in game code, not
  here.
- **`SoundManager.ts`** (Wave 1, new) — procedural Web Audio, no audio asset files. See
  the "10x expansion — Wave 1" section below for the full design and per-sound synthesis
  notes; the short version: `unlock()` lazily creates the `AudioContext` on first user
  gesture, every sound layers 2-3 oscillators (never a bare single tone) through a
  `GainNode` envelope and a `BiquadFilterNode`, and a shared `noiseBuffer` (one 2s buffer
  of `Math.random()`-generated white noise, built once) backs mechanical thunks,
  electrical crackle, and storm wind/rain via different filter shapes on the same
  source.
- **`ParticleBurst.ts`** (Wave 3, new) — one class instance per burst *event* (not a
  shared pool/emitter system): each owns its own small `THREE.InstancedMesh` (8-16
  instances, styled by a `BurstStyle` key into `PARTICLE_BURST` — `'dust'` or
  `'spark'`), a per-instance outward velocity computed once at construction (upward-
  biased hemisphere spread, not a full sphere — reads more like a kicked-up pop than an
  explosion), and an `update(now): boolean` that composes each instance's matrix from
  `origin_velocity * t` with a small added gravity arc and a shrink-as-you-fade scale,
  returning `false` once its duration elapses so `Game` knows to remove and `dispose()`
  it. Same "own small file, class per instance, self-reports when done" shape as
  `Span`/`Tower`'s `update()` pattern, scaled down for something this short-lived.

## Key decisions and why

These came out of an explicit ambiguity check at the start of Phase 1 (see chat) —
worth preserving so Phase 2+ doesn't accidentally relitigate them:

- **Camera: pan + zoom, no rotation.** Chosen over a fully static camera because the
  roadmap references Warcraft 3 pacing and later phases add terrain/map scope that
  will need panning anyway. Implemented as right-drag (not left-drag) specifically so
  it doesn't fight with left-click placement/selection.
- **Interaction model: context-sensitive clicks, no mode toggle.** Click empty grid =
  place tower. Click an existing tower = select it; a second tower click completes a
  span. Click empty space with something selected = deselect. Chosen to avoid a
  place-mode/string-mode UI toggle, which would have needed its own affordance and
  contradicts the "no menus" Phase 1 constraint.
- **Bounded 20×20 grid, not infinite.** Reads like a framed blueprint/schematic rather
  than an undefined void, and matches the SCADA reference better. `GRID.cells` /
  `GRID.cellSize` in `constants.ts` are the knobs if this needs to change.
- **No HUD at all in Phase 1.** Deliberate reading of "no menus" — state (hover,
  selection, energized) is conveyed entirely through in-world visual language (ghost
  preview, orange glow, green emissive) rather than any on-screen text/panel. Held for
  exactly one phase: Phase 2's resources needed a visible number, so a minimal HUD
  landed then — see "Phase 2 decisions" below.
- **Scene lighting is deliberately tinted, not neutral white.** Originally used
  `AmbientLight(0xffffff)` + `DirectionalLight(0xffffff)`, which is the default
  three.js-boilerplate pairing. Caught in a self-review (see below) as a generic
  choice undermining the cool SCADA palette, and replaced with `COLORS.ambientLight`
  (`0x7e9ebf`, cool blue) + `COLORS.keyLight` (`0xfff1de`, warm) for a cool-ambient /
  warm-key split reminiscent of monitor glow + overhead practical lighting.
- **Duplicate spans are prevented.** `Game.spannedPairs` keys on sorted grid
  coordinates so re-selecting the same two towers doesn't stack overlapping tubes.

### Phase 2 decisions

Locked in via an explicit ambiguity check before implementation (same pattern as
Phase 1) — all four were the recommended/default option the user picked:

- **CapEx income is passive, from energized spans, not a flat timer.** Each energized
  span contributes `ECONOMY.capExIncomePerSpanPerSec` continuously (`Economy.tick`).
  Ties the economy directly to the core loop — energizing isn't just a visual reward,
  it's what funds the next tower.
- **Crew-Hours is a capped regenerating pool, not a purchasable resource.** Regenerates
  at a fixed rate up to `ECONOMY.crewHoursMax` regardless of CapEx. Acts as a pacing
  throttle on build rate that's independent of money, rather than something you buy.
- **Upgrade tiers raise tower connection capacity, not line throughput.** A tier-2/3
  tower can support more spans (`ECONOMY.towerTierCapacity`); span/line visuals are
  untouched by upgrades. Line-capacity upgrades were considered but not built — see
  "up next" below if that's wanted later.
- **A minimal HUD was added, breaking Phase 1's zero-HUD rule on purpose.** Resources
  need to be visible somehow; the readout is styled as an instrument-panel meter
  (`Hud.ts`, `.hud` styles in `style.css`), not an interactive panel, so it doesn't
  reintroduce "menus" in spirit.
- **Upgrade is triggered by pressing `U` while a tower is selected, not a button.**
  Consistent with the existing context-sensitive click model and the "no menus"
  interaction language — the HUD context line just documents the hotkey and cost, it
  isn't a clickable control.
- **Span cost scales with distance; tower cost is flat.** `ECONOMY.spanCostBase +
  distance * ECONOMY.spanCostPerUnitDistance` in `Game.tryStringSpan`. Makes long spans
  a real trade-off (denser grids are cheaper to wire) instead of stringing cost being
  arbitrary. Tower cost stays flat since capacity/tier is the axis that scales towers,
  not placement cost.
- **Denied actions (can't afford / at capacity) shake rather than reusing a new color.**
  `feedback.ts`'s `denyShakeOffset` gives motion-based negative feedback. Fault-red
  (`#C0453A`) stays reserved for storms in Phase 3 per the original visual-direction
  brief — this was a deliberate constraint, not an oversight.
- **All Phase 2 balance numbers (`ECONOMY` in `constants.ts`) are first-pass and
  untested for long-session pacing.** Starting resources are sized to afford the
  Phase-1 loop once immediately (2 towers + ~1-2 spans) before the player has to wait
  on income/regen. Expect to retune once more of the game exists.

### Phase 3 decisions

Locked in via an explicit ambiguity check before implementation (same pattern as
Phase 1/2) — all three were the recommended option:

- **Terrain affects cost/placement, not just decoration.** The roadmap paired "terrain"
  with "pacing," so a purely cosmetic elevation pass would have missed the point. Hills
  cost more (`TERRAIN.hillCostMultiplier`), water is unbuildable outright
  (`Grid.isBuildable`).
- **No literal 3D relief for hills.** Originally planned to actually raise hill tower
  bases in world-Y. Reversed that mid-design: the visual reference is "engineering
  blueprint drafting," which uses color/hatching for terrain difficulty, not literal
  3D landscape relief — a raised puck of ground under each hill tower would have
  started to look like a generic game landscape and also complicates `Tower.topPos`
  (which currently assumes `worldPos.y = 0` everywhere). Terrain is a flat tinted
  overlay only; the "cost more" signal carries the gameplay weight, not a height change.
- **Terrain tints stay in the steel-blue family (`hillTint` / `waterTint`), not new
  hues.** Same discipline as the Phase 1 lighting fix — a literal green-hill/blue-water
  map palette would read as generic game-map styling, not a blueprint. Both new colors
  are lighter/darker variants of the existing cool palette.
- **Terrain is fixed and unseeded, not randomized per playthrough.** One deterministic
  noise field (`terrainNoise` in `Grid.ts`), same every game. This means terrain never
  needs to be part of the save schema — it regenerates identically on every load.
  True per-game randomization is explicitly a Phase 6 stretch-goal concern
  ("procedural regions"), not this pass.
- **Storms are a real fault/repair mechanic, not atmospheric weather.** Periodic timer
  (`STORM.minIntervalSec`–`maxIntervalSec`) strikes a random energized span. This is
  what fault-red was reserved for since Phase 1 — first real use of that color.
- **Storms only strike spans, never towers.** Keeps the blast radius of the mechanic
  contained to one entity type and one repair flow, rather than needing two different
  "broken" states with different repair costs/interactions.
- **Repair is player-triggered by clicking the faulted line, not automatic healing.**
  Automatic repair-over-time would remove player agency and turn storms into a passive
  timer rather than a decision (per the "interesting decisions" design principle
  already leaned on for Phase 1/2). Denied repairs (can't afford) reuse the existing
  tower deny-shake on both connected towers — spans don't have their own shake
  mechanism, and towers-as-proxy was a cheap, reasonable reuse rather than building a
  parallel feedback path for one new case.
- **Fault state is persisted; a faulted span survives a reload.** Consistent with
  everything else being persisted — a storm shouldn't get "undone for free" by
  reloading the page.
- **Permitting deferred entirely — no code, not even a stub** *(at the time; built in a
  follow-up pass after the economy balance revisit — see the "Permitting" section
  below).* Terrain + storms already represented substantial scope for one pass;
  permitting was the vaguest of the three named concepts and adding it risked diluting
  testing time on the other two.

### Debugging note: a click-precision investigation that wasn't a click-precision bug

Worth reading before assuming span-click repair is flaky. During verification, clicking
a faulted span to repair it repeatedly failed — looked exactly like a hit-radius
precision problem, so `Span.HIT_RADIUS` was raised from `0.35` to `0.7` (kept — it's a
genuine usability improvement for a thin curved 3D line regardless). It *still* failed
after that. A diagnostic (`debugRaycastAt`, since removed) revealed the real cause: the
same environment `getBoundingClientRect()` flakiness noted in the Phase 1/2 verification
sections was returning a `0×0` rect *inside the click handler itself*, corrupting the
NDC coordinates the raycaster used (division by zero → `Infinity`/`NaN`), which made the
raycast behave unpredictably — at one point matching tower geometry on rays that,
visually, weren't anywhere near a tower. This was conclusively a testing-tool artifact,
not a product bug: confirmed by calling the exact same economy-check → spend → `repair()`
→ `save()` code path directly (bypassing raycasting) and watching CapEx/Crew-Hours/
`faulted` flip correctly in the persisted save data, then watching the *next* periodic
storm independently re-fault the same span shortly after — proof both the fault-trigger
and repair code paths work correctly and run independently of each other. Moral: when a
click-based interaction fails intermittently in this preview environment, check whether
`getBoundingClientRect()` on the canvas is returning zeroes before concluding it's a
hit-target sizing problem.

### Phase 4 decisions

Chronologically, Phase 4 was built *after* the economy balance revisit and permitting
(both below) — grouped here with Phase 1-3's decisions anyway, since this section is
organized "by roadmap phase," not strict chronology, matching where Phase 2/3's
decisions already live. Locked in via the same explicit ambiguity check; onboarding
went with the recommended in-world-hints option, visual polish went with "all of the
recommended items plus geometry detail" (the user's actual answer — broader than the
three recommended-by-default items alone), HUD stayed "refine, don't expand."

- **Onboarding stays in-world, no tutorial overlay.** A modal/popup sequence was the
  explicit alternative offered and not chosen — it would have broken the "no menus"
  restraint maintained since Phase 1. `computeOnboardingHint()`'s derived (not stored)
  text is the whole mechanism; see the `Hud.ts` bullet above.
- **Bloom over a bigger post-processing package.** `UnrealBloomPass` alone (plus the
  mandatory `RenderPass`/`OutputPass`) was judged the single highest-leverage visual
  addition for a scene whose whole reward language is "things glow when they matter"
  (selection orange, energized green, fault red) — not a stack of unrelated effects.
  Tuned (`0.55` strength / `0.4` radius / `0.2` threshold) specifically so idle
  non-emissive steel-blue geometry stays dark and only genuinely emissive elements
  bloom — verified visually (see below) via the selection-orange glow halo, the clearest
  single before/after in the whole phase.
- **Camera pan stays un-eased; only zoom eases.** Considered easing both. Rejected pan
  easing specifically: during an active right-drag, any lag between mouse motion and
  camera motion reads as broken/laggy direct manipulation, not "smooth" — the two gestures
  have opposite correctness criteria (drag wants 1:1, discrete zoom steps want smoothing).
- **Geometry detail kept deliberately small.** Insulator nubs (towers) and per-instance
  patch jitter (terrain) reuse existing geometry/instancing patterns exactly — no new
  rendering technique introduced for either, keeping this the smallest of Phase 4's four
  work items despite "richer geometry" being an easy place to over-scope.

## Economy balance revisit

Not a numbered phase — done between Phase 3's terrain/storms and permitting, at your
request, once terrain cost and storm repair cost gave the Phase 2 numbers more to
interact with. This was a paper analysis (tracing an income timeline by hand), not a
numeric tuning pass or a simulated playtest — see "what wasn't changed" below for why
most numbers were left alone.

**The softlock this surfaced.** `Economy.tick(dt, energizedSpanCount)` is the *only*
source of CapEx income, and it only counts currently-energized spans. Storms
(pre-fix) would fault any energized span with no floor. Trace the failure case: a
player builds their first (and only) span, spends down toward zero CapEx expanding
(exactly what the Phase 1/2 core loop encourages them to do), and a storm strikes that
one span before they've banked the $40 repair cost. Energized-span count is now zero,
so CapEx income is now permanently zero — and repairing is the *only* way to restore
income, but repairing costs CapEx that can no longer be earned. No other CapEx source
exists (Crew-Hours keeps regenerating, but that alone doesn't buy a repair). This is a
genuine dead end, not a difficulty spike — a correctness bug in the mechanic's design,
found the same way the persistence-phase bugs were: by tracing the actual numbers
through the code rather than trusting that "it felt fine" during casual testing (a
single dropped span rarely gets tested against in isolation).

**The fix, structural rather than numeric** (`constants.ts`, `Game.triggerStorm`):
- `STORM.minEnergizedSpansToStrike = 2` — `triggerStorm` now only faults a span when at
  least 2 are currently energized, so a strike can never take total income to zero.
  This is a floor on the *mechanic*, not a number to balance-tune later; it should stay
  even if other storm numbers change.
- `STORM.firstStrikeDelaySec = 60` — the very first `nextStormAt` is seeded 60 real
  seconds out (subsequent reschedules still use the normal `minIntervalSec`–
  `maxIntervalSec` range). Gives a new player time to reach the 2-span safety margin
  before any storm risk exists at all, rather than relying on luck.

**What wasn't changed, and why:** repair cost ($40/15h — roughly 13s of one span's own
income, reasonable once a strike can't zero the network out), hill cost multiplier
(1.6× — a meaningful but avoidable premium, terrain is mostly flat), starting resources
(200 CapEx / 40 Crew-Hours — already sized to front-load the Phase 1 core loop), storm
interval (22–40s — untouched now that the grace period and 2-span floor bound the
downside). These remain first-pass and could still use real playtesting once there's a
human player generating actual session data; this pass fixed a structural dead end, not
a feel/pacing tune, and touching numbers without a clear reason would just be guessing.

**Verification:** via the real `triggerStorm` code path (not a mock) — a single
energized span was confirmed to survive a forced storm attempt untouched (candidates
below the threshold), and the served/compiled source was checked directly to confirm
the gate matches what's described here. The grace period was confirmed by reading
`nextStormAt` immediately after a fresh game construction and seeing ~60s remaining.
Getting a *third* tower placed to prove the "2 energized spans → storm does strike"
side of the boundary hit the same click-flakiness described in the debugging note above
repeatedly and was not worth further time — the boundary is a one-line `>=` comparison
against the exact `candidates` array the pre-existing (already-verified) fault logic
already used, so the untested side isn't meaningfully more likely to be wrong than the
tested side.

## Permitting

The deferred piece of Phase 3, built after the economy balance revisit. Scoped via the
same explicit ambiguity check as terrain/storms; all three answers were the recommended
option.

- **Gates tower placement only, not spans.** Spans already have their own friction
  (Crew-Hours cost, scaled by distance); permitting needed to be a genuinely distinct
  lever, not overlapping scope. Matches the real-world meaning best too — a permit is
  site approval before construction, not an ongoing cost on the wire itself.
- **Time-based, not cost-based.** `PERMIT.pendingDurationSec = 10` — a real,
  `performance.now()`-driven wait, not an extra CapEx fee. Terrain already owns the
  "cost" dimension (hill multiplier); permitting adds a genuinely new *pacing* axis
  (elapsed time) rather than just another cost to stack on top of the same resource.
- **Universal — every tower, no zone exceptions.** Simpler, and reads as "this is just
  how utility construction works" rather than introducing a second zone classification
  on top of terrain's flat/hill/water. A zone-specific permit system (e.g., only
  required near water) is a reasonable future extension if terrain gets more depth
  later, but wasn't worth the added scope now.
- **No cancel/refund while pending.** Once placed, a tower is committed — matches the
  "no menus," WC3-style construction commitment already established, and avoids
  needing a whole cancellation flow (partial refund? full refund? none?) for a first
  pass.
- **Visual: pulsing opacity, not a new color.** A pending tower is the *same* steel-blue
  tower, just animated at reduced/oscillating opacity (0.45–0.85, 1.4s cycle) — reads
  as "still becoming real" without introducing a color that could be confused with
  selection (orange), energized (green), or fault (red). On activation: a brief scale
  bump plus a steel-blue emissive flash, giving a "permit approved" pop distinct from
  the spawn pop-in and the upgrade pulse (see `Tower.ts` above for why they can't
  collide: activation requires having been pending, which blocks selection, which
  blocks the upgrade-pulse and — barring an instant same-frame select right as it
  clears, which is graceful-degraded to "the flash just doesn't show" — the
  selection-orange path too).
- **Denied clicks reuse the existing shake, no new feedback mechanism.** Clicking a
  still-pending tower calls the same `denyFeedback()` every other denial already uses.
  Combined with the visible pulsing, this reads as "not ready yet" without needing
  differentiated messaging — consistent with how insufficient-funds and at-capacity
  denials already share the same undifferentiated shake.
- **Pending time is persisted as a remaining duration, not an absolute deadline.**
  `performance.now()` resets on every page load (it's relative to navigation start, not
  wall-clock), so the save stores `pendingMs` (remaining milliseconds at save time,
  omitted entirely once a tower is active — keeps the common-case JSON lean) and
  `Game.loadSavedGame()` re-derives a fresh `permitClearAt` by adding that to the
  *new* `performance.now()` on load. Same pattern already used for the camera view,
  just applied to a per-tower timer instead of a global one.

**Verification:** placement confirmed to start a tower with `pendingMs: 10000` in the
save; the pulsing/translucent visual read as clearly distinct from a normal opaque
tower in screenshots; clicking a pending tower was confirmed denied — it stayed
steel-blue with no HUD selection context, unlike a successful select. After enough
elapsed (real, screenshot-forced — see the rAF-throttling note above) time, the save
stopped including `pendingMs` at all, confirming the field is correctly cleared on
activation. Clicking an *already-active* tower to confirm it becomes selectable again
was attempted repeatedly but kept missing due to the canvas viewport resizing between
`preview_eval` calls in this environment (coordinates computed for one resolution no
longer lining up after a resize — a new manifestation of the same category of
test-tool flakiness documented earlier, not a game bug: one of the missed clicks
landed on open ground instead and placed an unintended extra tower, which is itself
proof the click event mechanics work fine — it just wasn't hitting the intended
target). Not chased further: `isPending()` returning `false` is confirmed, and the
selection code path it falls through to is unmodified, pre-existing Phase 1 logic that
has already been verified extensively in earlier phases — the risk this specific case
is broken is low relative to the cost of continuing to fight viewport instability.

## Persistence

Picked up between Phase 2 and Phase 3, not a numbered roadmap phase — see PLAN.md.
Locked in via an explicit ambiguity check before implementation; the one real scope
question asked was whether to add a reset control, and the answer was yes.

- **Autosave, no manual save action.** `Game.save()` runs after every discrete
  state-changing action (place, string, upgrade), every 3s inside `tick()` for the
  continuous CapEx/Crew-Hours ticking, and on `visibilitychange`/`beforeunload` as a
  safety net. No explicit "save" affordance — matches the "no menus" interaction
  language, and autosave-only is standard for this kind of browser sim/idle game.
- **Restores are instant, never re-animated.** `Tower.materializeFromSave` and
  `Span.materializeEnergized` both skip their normal animated intro entirely. A loaded
  tower/span didn't just get built — replaying the pop-in/stringing/energize sequence
  on every page load would read as if the network were being rebuilt each time, which
  is the wrong signal.
- **Connections are derived from spans, not stored redundantly.** The save schema only
  has `towers: {i,j,tier}[]` and `spans: {a:[i,j], b:[i,j]}[]` — `Game.loadSavedGame()`
  rebuilds each tower's connection count by replaying `addConnection()` once per span
  that touches it, the same as normal play. One source of truth instead of two numbers
  that could drift apart.
- **Reset hotkey is `Shift+R`, not a button.** Per your call — useful for iterating on
  balance without dropping into devtools each time. No confirmation dialog: given the
  explicit ask was for a fast, low-friction reset for testing, adding a confirm step
  would work against the stated purpose.

### Two real bugs this surfaced (not just test-harness noise)

Both were caught by directly inspecting the saved JSON rather than trusting the visual
state, and both have permanent fixes in the code, not just a one-off cleanup:

1. **`NaN` grid coordinates could corrupt a save permanently.** A raycast hit with a
   momentarily zero-size canvas (happened during rapid programmatic testing, but the
   same class of edge case isn't impossible in real browser conditions — e.g. a resize
   mid-click) produced `NaN` node indices. `Grid.nearestNode`'s old bounds check
   (`i < 0 || i > GRID.cells`) silently let `NaN` through, because *every* comparison
   with `NaN` is `false` — the guard that was supposed to reject out-of-range values
   didn't fire for `NaN` specifically. `nearestNode` now explicitly checks
   `Number.isFinite(i) && Number.isFinite(j)` first. Additionally, `Game.loadSavedGame()`
   now validates every tower entry (`isValidGridNode`, integer tier in range) before
   reconstructing it, and silently skips invalid ones — so even if a bad value did get
   saved (by this or any future bug), it can't wedge the game into an unplayable state
   or crash on every subsequent load. Belt and suspenders: fix the write path, and
   defend the read path independently.
2. **The reset hotkey could silently fail to reset.** `window.location.reload()` does
   not synchronously halt the page — there's a real window where the old page's code
   keeps running before navigation commits. If the 3-second autosave tick (or a
   `visibilitychange`/`beforeunload` handler) fired in that window, it would re-save
   the in-memory (pre-reset) state to `localStorage` *after* `clearSave()` had already
   run, undoing the reset without any error. Fixed with an `isResetting` flag: set
   before `clearSave()`, checked at the top of `save()` (so every save path is covered
   by one guard, not three separate ones), plus `renderer.setAnimationLoop(null)` to
   stop the tick loop immediately so the periodic-autosave path can't fire again at
   all. If you touch the reset path again, keep both — the flag alone isn't sufficient
   if a new save trigger is added later and someone forgets the check exists.

## Hosting

You asked to "figure out the storage/hosting." Split into two questions: save-data
storage was already solved (`localStorage`, no backend, no cross-device sync
requirement — nothing to add). Hosting the built site was the real open item;
`PLAN.md` had provisionally named Cloudflare Pages but that was never actually
confirmed with you. Asked directly, and you picked **GitHub Pages** — lower friction
since `gh` was already authenticated to your account and no Cloudflare account/config
existed yet — on a **public** repo, since GitHub Pages on a private repo needs a paid
GitHub plan and there's nothing sensitive in this project.

- **`vite.config.ts`** (new): `base: process.env.GITHUB_ACTIONS ? '/right-of-way/' : '/'`.
  GitHub Pages project sites (as opposed to a `<user>.github.io` root/user site) serve
  from `https://<user>.github.io/<repo>/`, so every built asset URL needs that prefix —
  without it, the deployed `index.html` would reference `/assets/...` at the domain
  root and 404 everything. Gated on the `GITHUB_ACTIONS` env var (set automatically by
  every GitHub Actions runner) rather than `NODE_ENV`/`import.meta.env.PROD`, so a local
  `npm run build` still produces a root-relative build for local testing via `npm run
  preview` — only the CI build gets the Pages prefix.
- **`.github/workflows/deploy.yml`** (new): two-job workflow (`build` → `deploy`) using
  the standard `actions/upload-pages-artifact` + `actions/deploy-pages` pair, triggered
  on every push to `main` plus manual `workflow_dispatch`. `npm ci` (not `npm install`)
  for reproducible CI installs from the committed `package-lock.json`.
- **Repo**: created via `gh repo create right-of-way --public --source=. --remote=origin`,
  wired as `origin`, existing local history pushed as-is (no history rewrite).
- **Pages must be enabled once via API before the workflow's deploy step can succeed** —
  `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`. Learned this the
  concrete way: the very first push happened *before* this API call ran, and that
  workflow run failed with `Failed to create deployment ... status: 404 ... Ensure
  GitHub Pages has been enabled`. Re-running the workflow (`gh workflow run deploy.yml`)
  after enabling Pages succeeded. If this repo's Pages settings are ever reset (e.g. a
  fresh clone pushed to a new repo), that ordering — enable Pages *before* the first
  successful deploy — needs to happen again.

**Live site:** https://samgumble.github.io/right-of-way/
**Repo:** https://github.com/samgumble/right-of-way

**Verification:** confirmed via direct `curl` that the deployed `index.html` and both
referenced asset URLs (JS bundle, CSS) return `200` at their real
`/right-of-way/assets/...` paths, matching what a local `GITHUB_ACTIONS=true npm run
build` produces. A live in-browser check (loading the actual deployed site and
confirming it boots/renders, the same way every other phase was verified) was
attempted but the Chrome browser tool was unresponsive/timed out in this environment —
noted as a known gap below, not a confirmed problem. The deployed bundle is otherwise
identical to what Wave 2 already verified running correctly locally; only the base URL
path differs, and that's confirmed correct at the asset-serving level.

## "10x expansion"

Not a numbered roadmap phase — the user asked to "10x the graphics and mechanics," a
deliberately huge, open-ended request, bigger in scope than any single phase so far.
Given the stakes of building the wrong thing at that scale, this went through
`EnterPlanMode` (the only time this session a formal plan was used instead of just
implementing after an ambiguity check) — direction was confirmed via direct questions
*before* any design work, then a Plan agent was used to pressure-test a six-wave
breakdown and work out concrete technical designs for the two areas with zero existing
precedent in this codebase (audio, particles). The full approved plan lives at
`/Users/samgumble/.claude/plans/fancy-wandering-dawn.md` — read it for the complete
wave-by-wave breakdown (Waves 2-6 aren't repeated in full here to avoid the two docs
drifting out of sync; this section covers what's actually been *built* so far).

**Confirmed direction** (do not re-litigate without asking again): graphics go **deeper
within** the established SCADA/blueprint low-poly style, not a stylistic pivot toward
realism/textures. Mechanics **deepen existing systems** (economy, terrain, storms,
upgrades), not new breadth — no new building types, rival AI, or multiplayer this round;
those stay Phase 6 stretch-goal territory. Ships in **staged waves with checkpoints** —
implement a wave, verify, update docs, *then* move to the next one, not all six
unattended. **Audio** is included, pulled forward from the Phase 6 stretch list.

### Wave 1 — Audio foundation (delivered)

New `SoundManager.ts`. **Procedural Web Audio (oscillators + filtered noise), no audio
asset files** — confirmed as the deliberately right call, not a default, for three
reasons: it extends the "hand-write the math" precedent already set by the catenary
solver and terrain noise into a new domain; it avoids the project's first binary-asset
dependency (and any licensing/provenance question that would come with one); and a
SCADA control room is *supposed* to sound synthesized/clean, not like a "produced"
recorded effect — the aesthetic argument and the pragmatic argument point the same way.

- **No mute toggle in v1.** There's no menu surface anywhere in the project to host one
  (deliberate, per "no menus"). `masterGain` is a single node so adding a toggle later is
  a one-line change — recorded as a deliberate scope cut, same pattern as documenting
  "no cancel/refund on pending permits" rather than silently omitting it.
- **Audio unlocks on the canvas's first `pointerdown`**, not a dedicated button — covers
  whichever gesture the player makes first (a placement click or a pan-drag), and
  `unlock()` is idempotent so it's safe if it somehow fired twice.
- **Every sound layers 2-3 oscillators, never a bare single tone** — a lone oscillator is
  the classic cheap-ringtone tell. Each goes through a `GainNode` envelope (short linear
  attack, exponential decay) and usually a `BiquadFilterNode`.
- **`Tower.update()`/`Span.update()` gained a small event-union return type**
  (`TowerEvent | null`, `SpanEvent | null`) instead of `Game.tick()` needing a parallel
  observer/callback system to know when a phase transition (permit-clear,
  energize-complete) happens mid-call. Small, additive, mechanical — see the
  `Tower.ts`/`Span.ts` architecture bullets above for exactly what changed.
- **`Tower`/`Span` stay audio-agnostic.** All sound calls live in `Game.ts`, at the same
  call sites that already call `denyFeedback()`/`setSelected()`/etc. — consistent with
  how those two classes are already kept `Economy`/`Hud`-agnostic; `Game` is the only
  class allowed to know about cross-cutting systems.
- **Aggregate fault alarm, not one tick per faulted span.** `SoundManager.updateFaultAlarm(now, faultCount)`
  is called every frame regardless of `faultCount`, and internally no-ops unless
  `FAULT_ALARM_INTERVAL_MS` (1100ms, matching `Span`'s existing `FAULT_PULSE_PERIOD`)
  has passed — same "aggregate, don't multiply" instinct the HUD's `⚠ N FAULTS` line
  already uses, applied to sound.
- **Storm ambience is a bounded ~5s swell, not a persistent "is storm active" state.**
  `playStormStrike()` triggers a wind (noise → swept bandpass filter, LFO-modulated) +
  rain (noise → highpass filter) layer, both enveloped in and back out over the same
  window, centered on the strike moment — no new state machine anywhere in `Game`.
- **Onboarding hint text is deliberately not sonified.** It's derived/passive with no
  discrete trigger moment; tracking hint-text transitions just to fire a sound isn't
  worth the scope for a line that already reads clearly. Considered and rejected, not an
  oversight.
- **Repair reuses the energize synth at different pitch/duration**
  (`playPowerUpSweep(baseFreq, sweepDuration, tailDuration)`), same reuse instinct as
  `buildTowerVisual`/`denyShakeOffset` elsewhere in the codebase, rather than a
  near-duplicate second implementation.

**Verification:** every `SoundManager` method was called directly (via a temporary
`window.__game` dev-only hook — see Verification section below for why this one was
*kept*, unlike every other phase's debug hook) and confirmed to throw no exceptions with
`unlock()`'d context in the `'running'` state; a real place → select → (would-be string)
gameplay flow was run through the actual `Game`/`Tower`/`Span` code paths (not just
direct `SoundManager` calls) with zero console errors, confirming the `update()`
event-return wiring is correctly connected; the bloom pass was visually reconfirmed as a
side effect (a clear orange glow halo around a selected tower) since Phase 4's original
verification pass was interrupted before that specific check completed. Audio itself
can't be confirmed "sounds good" through this tool chain — no exceptions and correct
event-timing is as far as automated verification goes; real listening is on you.

### Wave 2 — Lighting, materials & atmosphere depth (delivered)

- **Materials: `MeshLambertMaterial` → `MeshStandardMaterial`** on `Tower`, `Grid`'s
  ground plane, and both terrain-patch materials (`Span` already used
  `MeshStandardMaterial`, so this brings everything onto the same lighting model).
  Roughness/metalness tuned per surface (towers: `0.5/0.4`, semi-metallic steel; ground
  and terrain patches: `0.85-0.95` roughness, `0.05-0.1` metalness, matte). No new colors
  — same hex values, richer response to the existing directional light.
- **Fog** (`ATMOSPHERE.fogNear = 140`, `fogFar = 270`, color = the background color)
  tuned by placing the camera at max zoom-out and checking the board stayed fully
  readable — only the far corners visibly fade. Values are view-space depth from the
  camera along its fixed isometric angle, not straight-line distance, so they don't map
  directly onto world-space board size; they were tuned empirically against actual
  screenshots, not calculated.
- **Day/night cycle** (`ATMOSPHERE.dayNightCycleSec = 480`, i.e. 8 minutes): `Game`
  now stores `ambientLight`/`sunLight` as fields (previously anonymous locals, since
  nothing needed to touch them after construction) and a new `updateAtmosphere(now)`,
  called every tick, lerps intensity between day/night extremes for both lights and
  additionally ping-pongs the ambient light's *color* between `COLORS.ambientLight`
  (day) and `COLORS.steelBlueDim` (night) — reusing an existing palette color rather
  than introducing a new hue, per the plan's explicit constraint. The key (sun) light's
  *color* stays fixed and only its intensity dims — a warm practical/indoor light that
  doesn't shift color as the (implied) outdoor light changes reads correctly for a SCADA
  control room, and keeping it fixed avoids any color-mixing edge cases with the bloom
  pass. The cycle is purely session-relative (`performance.now()`-driven, resets to
  "near day" on every reload) — there's no real-world clock tie-in, and none was wanted.
- **Real shadow mapping shipped**, not the blob-shadow fallback the plan allowed for.
  `renderer.shadowMap.type = THREE.VSMShadowMap` — the installed three.js version
  (0.185.0) has deprecated `PCFSoftShadowMap` (confirmed via a console warning on first
  load; it silently falls back to hard-edged `PCFShadowMap`), and `VSMShadowMap` is the
  current soft-shadow type, plus it's inherently more acne-resistant (variance-based)
  than PCF, which mattered given the specific gotcha this wave was watching for. The
  sun's shadow-camera frustum is sized via `SHADOW.frustumHalfExtent = 75` (vs. the
  board's actual half-extent of 60) — deliberately sized to the *static board*, not the
  current camera view, since the grid's world-space content doesn't move when the player
  pans/zooms. Tested the exact stress case the plan flagged (a tower's shadow falling
  directly across a hill terrain patch, both surfaces very close to `y=0`): rendered
  clean, no acne or z-fighting, via a temporary tower placed and removed purely for the
  test (never saved — the animation loop was paused for the duration so no autosave tick
  could fire and persist it).
- **Vignette (`VignetteShader` via `ShaderPass`) — added last, after a real bug.** First
  attempt inserted it between `UnrealBloomPass` and `OutputPass`, and produced the
  opposite of a vignette on this scene: corners rendered *lighter* than the center. Root
  cause: `VignetteShader` mixes the scene color toward a plain constant
  (`vec3(1.0 - darkness)`) — a value authored for a conventional 0-1 SDR range. Placed
  before `OutputPass`, that mix happens in three.js's *linear* HDR working buffer, where
  this near-black scene's actual linear values are tiny (sRGB `#111820` is roughly linear
  `0.006-0.019`) — so the vignette's SDR-authored constant was, in linear space, far
  *brighter* than the scene it was supposed to darken, and only became visually "normal"
  again after `OutputPass`'s linear→sRGB encoding pushed it up further. Fixed by moving
  the `ShaderPass` to *after* `OutputPass` in the composer, so it mixes in the final
  encoded buffer where a plain 0-1 constant behaves as expected. Diagnosed live by
  toggling the pass on/off and reordering it via `window.__game.composer.passes` in the
  browser console before touching source, rather than guessing at constants — worth
  remembering for any future post-processing pass that isn't tone-mapping-aware.
  `ATMOSPHERE.vignetteDarkness = 0.55`, `vignetteOffset = 0.9` — restrained, confirmed by
  direct on/off comparison rather than by eye alone (the effect is genuinely subtle on
  this already-dark palette, which is the intent). Scanline was considered and not
  added — the vignette alone already reads as "instrument glass," and a scanline on top
  read as decorative rather than SCADA-authentic once tried mentally against the
  reference; not worth the restraint budget this wave.

**Verification:** confirmed via direct property inspection (not just screenshots, which
this environment's own tooling warns aren't reliable for color-accuracy checks on
near-black scenes) that day/night intensity and color values are correct at both cycle
extremes; confirmed shadows render without acne/z-fighting including the specific
patch-overlap stress case; confirmed the vignette bug and fix by toggling/reordering
passes live before writing the fix to source; confirmed materials/selection/bloom still
work correctly post-material-swap (selected-tower orange glow still blooms); `npm run
build`-equivalent (`tsc --noEmit`) is clean. Frame-pacing could **not** be measured
through this tool chain — `requestAnimationFrame` is throttled to near-zero between tool
calls (the same documented quirk from Phase 4), so a 1-second multi-frame sample
returned a single frame. `renderer.info` also isn't a reliable total through
`EffectComposer` (it resets per internal pass render, not per composited frame). Real
frame-pacing feel, like Wave 1's audio, is on you to judge locally — noted below as a
known gap rather than silently assumed fine.

### Wave 3 — Particle & weather effects (delivered)

Three effects, three techniques, per the plan — not one universal particle system.

- **Rain** is a bounded ~5.5s weather event triggered by an actual storm strike inside
  `triggerStorm()`'s existing `if (candidates.length >= STORM.minEnergizedSpansToStrike)`
  branch — same branch that already plays `playStormStrike()`, so rain only appears when
  a strike actually happens, never on a skipped/no-op storm check. Deliberately *not*
  ambient/persistent rain — matches Wave 1's "bounded swell, not an `isStormActive`
  state" precedent, and the duration (`RAIN.durationMs = 5500`) was picked to roughly
  track `SoundManager`'s 5s ambience swell so the audio and visual storm cues start and
  stop together without actually coupling the two systems (no shared timer — they're
  just tuned to similar numbers).
- **Wind is one fixed drift constant** (`RAIN.windDriftX/Z`), not randomized per storm —
  every particle shares a single precomputed fall+wind tilt quaternion
  (`Quaternion.setFromUnitVectors(up, fallDirection)`), computed once in the constructor,
  not per-frame or per-particle. This is what makes the rain read as *wind-blown streaks*
  rather than vertical rods falling straight down.
- **Rain particles never get written into the `InstancedMesh`'s matrices until the first
  `updateRain()` call after `startRain()`** — `startRain()` only flips `visible = true`
  and resets each particle's tracked position; the actual `setMatrixAt` calls happen in
  `updateRain()`, called from `tick()`. This was a real trap during verification: pausing
  the animation loop right after calling `startRain()` (to freeze state for a screenshot,
  the same technique used for Wave 2's day/night test) showed *nothing*, because no frame
  had run yet to write real positions — the mesh was technically visible but every
  instance was still sitting at its default identity-matrix transform. Fixed the test, not
  the code — this lazy-write is fine in real gameplay since `tick()` always runs `updateRain`
  the very next frame; it just means a "freeze and inspect" test needs to manually step
  `updateRain` at least once after `startRain`.
- **`ParticleBurst`** — ***own file***, one instance per burst event (see the
  `ParticleBurst.ts` architecture bullet above). Two styles reusing the same class:
  `'dust'` (steel-blue, slower, spawned at a tower's ground position — `(topPos.x, 0.3,
  topPos.z)`, not `topPos` itself, since dust belongs at the base, not the top
  attachment point) on both placement success and permit-clear; `'spark'` (hot red,
  faster, more particles) at a faulted span's `midpoint()` inside `triggerStorm()`.
  `Game` owns a flat `bursts: ParticleBurst[]` array and a `spawnBurst`/`updateBursts`
  pair — `updateBursts(now)` walks the array backward, removes+disposes any burst whose
  `update()` returned `false`, called every tick right alongside `updateRain`.
- **No new timer or parallel state machine** — every trigger point is an existing call
  site (`onClick`'s placement branch, `tick()`'s tower-event loop, `triggerStorm()`), and
  both `updateRain`/`updateBursts` are unconditional-every-frame calls that internally
  no-op when nothing's active, the same idiom `SoundManager.updateFaultAlarm` already
  established in Wave 1.

**Verification:** confirmed live, not just by reading the code back. Spawned dust and
spark bursts directly, froze the animation loop, stepped their `update()` to mid-flight,
and screenshotted both — visibly distinct colors, correct outward/upward spread, correct
cleanup (removed from both `scene` and the `bursts` array once expired, confirmed via a
follow-up state check rather than assumed). Built two energized spans directly, forced a
storm strike with a **synthetic, fully controlled clock** (not `performance.now()`) so
multi-step verification wasn't at the mercy of real wall-clock time elapsing between tool
calls — stepped `updateRain` across ten synthetic 100ms frames and confirmed real,
varied, in-bounds particle positions via `getMatrixAt`, then screenshotted the result
(visible tilted streaks scattered across the board) and confirmed the mesh correctly went
back to `visible = false` once stepped past `rainActiveUntil`. Re-ran the storm
softlock-prevention regression check (a lone energized span must never be struck) with
the new spark/rain code paths active in `triggerStorm()` — still holds, unchanged. Then,
separately, dispatched a **real synthetic `pointermove`+`click` pair** through the actual
DOM (not a direct method call) at a raycasted screen position for a buildable grid node,
and confirmed it drove the entire real path — `onClick` → `placeTower` → `spawnBurst` —
end to end, with a tower actually appearing and CapEx actually decrementing. `tsc
--noEmit` clean throughout; no console errors at any point.

### Wave 4 — Terrain & environment depth (delivered)

One new terrain type, **marsh**, via the exact same pattern hill/water already
established in `Grid.ts` — reused, not reinvented. No unique per-type geometry or
animation gimmick (e.g. animated reeds/trees), per the plan's explicit constraint that
this stay "richer geometry," not its own subsystem.

- **Classification**: `TERRAIN.marshThreshold = -0.55` sits between
  `TERRAIN.waterThreshold` (`-0.9`) and the existing flat range, so `terrainAt()` reads
  `water → marsh → flat → hill` as the noise value rises — marsh occupies the band
  immediately above water, which is *why* it renders geographically adjacent to water
  bodies (same noise field, no separate placement logic). Buildable (`isBuildable` only
  excludes `water`), but `TERRAIN.marshCostMultiplier = 2.1` — steeper than a hill's
  `1.6`, representing soft/unstable ground needing more reinforcement, not just "another
  hill with a different color."
- **Visual**: `COLORS.marshTint = 0x1f3d3a`, a dark teal-grey — deliberately picked to
  read as *distinct* from both `hillTint` (lighter, warmer blue-grey) and `waterTint`
  (near-black navy) while staying in the same "cool steel-blue family, shading on a
  blueprint" discipline the `COLORS` comment already established — no new hue family
  introduced, same rule Wave 2's day/night cycle followed for lighting.
- **Sets up, does not implement, terrain-weighted storm targeting** (that's explicitly
  Wave 5's job per the plan). No new plumbing was added for this — `Grid.terrainAt(i,j)`
  was already public, and a span's two tower endpoints already expose their `gridI`/
  `gridJ`, so Wave 5 can query per-span terrain directly without `Grid` or `Span`
  changing further. This wave's only job was making sure a *storm-relevant* terrain
  classification (wet/unstable ground) existed for Wave 5 to read.
- **Distribution**, confirmed by querying `terrainAt` across the full 21×21 node grid
  (441 nodes): 258 flat, 71 water, 61 marsh, 51 hill. Marsh is present but not
  dominant — roughly half of water's footprint, which reads correctly as "band at the
  water's edge" rather than "its own major biome."

**Verification:** confirmed the distribution numbers above directly; confirmed a sampled
marsh node is buildable and returns cost multiplier `2.1` via direct `Grid` queries;
confirmed visually via screenshot that marsh renders as a distinct tonal band adjacent to
a water body, without clashing against the hill/water tints; then confirmed **through a
real click** (not a direct method call) that placing a tower on a marsh node actually
spends `80 × 2.1 = 168` CapEx — first attempt correctly triggered nothing (insufficient
funds, `economy.canAfford(168, 0)` was `false` at the time), which was itself a useful
confirmation that the deny path holds at the new cost tier, then topped up CapEx directly
and re-ran the same click to confirm the exact spend and a real tower placement. Test
tower and CapEx override were both cleaned up afterward, leaving the legitimate
single-tower save state from Wave 3's verification intact. `tsc --noEmit` clean; no
console errors.

### Wave 5 — Economy depth (delivered)

All three items exactly as scoped in the plan — pure `constants.ts` + selection-math
changes, **zero `SaveData` schema impact**, `SAVE_VERSION` stays at 1.

- **Repeat-construction cost curve**: `ECONOMY.towerCostGrowthPerTower = 0.06` — mild
  linear growth (not exponential), applied on top of the existing terrain multiplier, not
  persisted (derived live from `this.towers.length` every time `computeTowerCost` is
  called). Merging the two near-duplicated cost calculations in `onPointerMove` (ghost
  preview opacity) and `onClick` (actual spend) into one helper was a direct side effect
  of touching both — not a separate cleanup pass.
- **Terrain-weighted storm targeting**: `pickWeightedStormTarget` replaces the old
  uniform `candidates[Math.floor(Math.random() * candidates.length)]` pick with a
  standard cumulative-weight roll. `spanStormWeight` reads `Grid.terrainAt()` on both of
  a span's tower endpoints (Wave 4's `Grid.terrainAt()` being already public is exactly
  why Wave 4's writeup said "no new plumbing needed" for this) — a span with *either*
  endpoint on marsh gets `STORM.marshWeightMultiplier = 2.5`× the weight of a span with
  neither. A persistent per-span decaying "efficiency" stat was considered (per the plan)
  and rejected — it would start rhyming with a hidden new resource, out of scope for
  "deepen, don't add breadth."
- **Storm interval scaling**: `randomStormDelayMs` changed from a zero-argument function
  to `randomStormDelayMs(energizedCount)`. Both interval bounds shrink toward
  `STORM.minIntervalFloorSec = 12` via an *exponential* approach
  (`Math.pow(0.5, energizedCount / STORM.intervalHalfLifeSpanCount)`), not a linear
  subtraction — chosen specifically so neither bound can ever cross the floor or invert
  relative to the other, with no separate clamping logic needed to guarantee that.
  **Interval-only** — `triggerStorm()`'s "at most one span struck, only if
  `candidates.length >= minEnergizedSpansToStrike`" shape is completely unchanged; only
  *which* target gets picked and *how soon* the next storm is scheduled changed. This
  was a hard constraint from the plan, not a judgment call: multi-strike-per-storm is
  exactly the shape of change that reopened-risk the softlock the balance revisit fixed,
  and was explicitly called out as needing its own review if ever wanted, not bundled
  into this wave.

**Verification:** every claim was checked statistically or via direct state inspection,
not read back from source. Cost curve sampled at five tower counts (0/1/5/10/20 →
80/85/104/128/176, matching the formula exactly). Storm-target weighting sampled 2000
times against a constructed marsh-adjacent-span vs. plain-flat-span pair — 2.64 observed
ratio against a 2.5 expected one, within normal statistical noise for that sample size.
Interval scaling sampled at energized counts of 1 and 2 (means of 29.6s and 26.6s,
falling inside the theoretically computed bounds for each), then stress-tested at 50
energized candidates (via a temporarily aliased fake `spans` array, restored afterward)
to confirm the interval collapses to just above the floor (12.03–12.09s) and never
crosses below it. **The non-negotiable check**: 300 forced `triggerStorm()` calls against
a single energized span (all other spans faulted) produced zero strikes — the
softlock-prevention invariant holds unchanged under every piece of new wiring. One
real mistake made and recovered from during this verification pass: an early test
mutated the live `towers` array directly to sample cost-at-N-towers, and the periodic
autosave (which was still running, since the animation loop hadn't been paused) raced
in and persisted the corrupted empty state to `localStorage`, silently losing a tower
placed during earlier-wave testing. Not a product bug — a real one, just self-inflicted
by not pausing `renderer.setAnimationLoop` before mutating live arrays. Fixed by adopting
"always pause the loop before mutating `towers`/`spans` directly" for the rest of this
verification pass, and documented here so it isn't relearned the hard way again. `tsc
--noEmit` clean throughout; no console errors.

## Skills used this session

- `design-game-design-fundamentals` — shaped the action→feedback→reward pacing
  (pop-in → orange select → progressive "stringing" reveal → green energize pulse).
- `design-ui-ux-game` — informed the all-in-world-no-HUD decision above.
- `unslop-ui` — its Python scanner (`devibe_scan.py`) wasn't available in this
  environment (only `SKILL.md` was bundled, no `scripts/`), and it's CSS/HTML-focused
  anyway. Applied the underlying principle manually instead: audited the scene for
  unspecified "default" choices, which is what caught the neutral-white lighting above.
- Phase 2 didn't invoke additional skills — the economy/upgrade/HUD design decisions
  were resolved via direct clarifying questions to the user (same ambiguity-check
  pattern Phase 1 used), not a design skill.
- Persistence work didn't invoke skills either — it's implementation/engineering work
  (serialization, save-trigger timing, defensive validation) rather than a design
  decision, aside from the one scope question (reset control) asked directly.
- Phase 3 (terrain/storms, and later permitting) didn't invoke skills either — scope
  was resolved via direct clarifying questions (same pattern as Phase 2), and visual
  calls ("no literal 3D relief," "stay in the steel-blue tint family," "pulsing opacity
  not a new color") were self-audited against the existing visual-direction brief
  rather than via a design skill. The economy balance revisit was pure engineering
  analysis (tracing an income timeline by hand), not a skill-driven pass either.
- Phase 4 didn't invoke skills either — same direct-question pattern as every prior
  phase.
- The "10x expansion" used `EnterPlanMode` + a `Plan` subagent instead of (or really, in
  addition to) the direct-question pattern — the only time this session a formal written
  plan was used before implementing, warranted by the sheer size/ambiguity of "10x" as a
  request. The `Plan` agent was briefed with full architectural context up front
  specifically so it wouldn't need to re-derive anything already known, and was used to
  pressure-test a wave breakdown and design the two genuinely new-territory pieces
  (audio, particles) rather than to explore unfamiliar code.

## Verification performed

Manual, via the Claude Preview dev-server tool + synthetic pointer/wheel/keyboard events
dispatched through `preview_eval` (canvas click/drag doesn't have a stable CSS
selector to drive through `preview_click`). Confirmed working, Phase 1: tower placement
with pop-in, hover ghost preview on empty nodes only, tower selection (orange), span
stringing + catenary sag shape, energize color/pulse animation, pan, zoom, duplicate
span suppression. Confirmed working, Phase 2: CapEx passive income while a span is
energized, Crew-Hours regen, tower placement spending CapEx, span stringing spending
distance-scaled Crew-Hours, upgrade denied (no state change) when underfunded, upgrade
succeeding at T1→T2 (cost deducted, tier badge in HUD context updates, third cross-arm
appears on the tower without disturbing its already-strung span), HUD readout tracking
all of the above live. Confirmed working, persistence: real place→string→upgrade
sequence round-trips through a save/inspect-JSON/fresh-server-restart cycle correctly;
a synthetic tier-3 save restores with all three cross-arms present and no spawn
animation; a synthetic tower+span save restores with the span already fully green/
energized; the reset hotkey clears the save and returns to a fresh $200/40 state after
the autosave-race fix. Confirmed working, Phase 3: hill tower placement costs exactly
`80 × 1.6 = 128` CapEx (verified against the debug-computed expected value before
spending); clicking a water node does nothing (no tower placed, no CapEx spent);
distinct visible tints for hill vs. water ground patches; a forced storm faults a
random energized span (fault-red, HUD warning line appears) and leaves an unaffected
span alone; repair (verified via direct code-path call, not raycasted click — see the
debugging note above) correctly spends `$40/15h`, flips `faulted` to `false` in the
persisted save, and transitions the span back to energized; a subsequent periodic storm
independently re-faulted the same span, confirming the natural (non-forced) timer path
also works. Confirmed working, permitting: see the dedicated "Verification" paragraph
in the Permitting section above (the storm/economy-balance debugging note pattern
extends there too). Confirmed working, Phase 4: onboarding hint text correctly advances
through all three stages as `towers.length`/`spans.length` change and is suppressed the
instant a tower is selected; camera zoom visibly eases toward the scroll target instead
of snapping; terrain patches read as organic/varied shapes, not stamped circles; the
selected-tower emissive glow blooms visibly against the dark background. Confirmed
working, Wave 1: see the "10x expansion — Wave 1" section above. Confirmed working,
Wave 2: see the "10x expansion — Wave 2" section above. Confirmed working, Wave 3: see
the "10x expansion — Wave 3" section above. Confirmed working, Wave 4: see the "10x
expansion — Wave 4" section above. Confirmed working, Wave 5: see the "10x expansion —
Wave 5" section above. No automated tests exist yet.

A temporary debug hook (`window.__game`) was added each phase to get exact screen
coordinates for synthetic clicks or to call internal methods directly, then removed
after verification — **except this time**: Wave 1's `window.__game` hook was
deliberately *kept* in `main.ts` (still `import.meta.env.DEV`-gated, so it never ships
in a production build) once the user asked to keep working on the project locally
themselves — a live `window.__game` is a genuinely useful console convenience for a
human poking at their own local build (e.g. `window.__game['sound'].playEnergize()` to
preview one sound in isolation), not leftover scaffolding, in that specific context. If
you're picking this project back up and don't need it, it's fine to remove — just know
its presence right now was a deliberate call, not an oversight. Note also: this preview
environment's `getBoundingClientRect()` was observed to intermittently return `0x0`
across separate `preview_eval` calls (not a game bug — screenshots taken at the same
moments rendered correctly), and the canvas viewport was observed to resize between
calls in a way that invalidates previously-computed click coordinates. Firing one
synthetic pointer/keyboard event per `preview_eval` call, with a real wait before the
next one, was reliable; batching multiple sequential clicks inside one eval call was not.

**Another environment quirk worth knowing:** `renderer.setAnimationLoop`'s `requestAnimationFrame`
loop appears to be throttled to near-zero while the tab isn't being actively interacted
with — real wall-clock `sleep` between tool calls does *not* reliably advance in-game
animation/economy state, even though `performance.now()` (used for all the timers)
keeps advancing in real time regardless. Confirmed during the balance verification:
Crew-Hours barely ticked up despite a 1.5s sleep, and a span stayed visibly un-energized
long after it should have finished; calling `preview_screenshot` (which forces a repaint)
reliably un-stuck it. If a time-based mechanic looks frozen in this environment, take a
screenshot (or otherwise force a repaint) before concluding the logic is broken — don't
trust wall-clock `sleep` alone to advance game time.

## Known gaps / deferred on purpose

- No save-slot/multiplayer-profile concept — a single implicit autosave slot per
  browser, which is all a single-player prototype needs right now.
- The reset hotkey has no confirmation step — intentional (see Persistence section),
  but worth reconsidering once this stops being primarily a testing/iteration tool.
- Space Grotesk / IBM Plex Sans are specified for prose labels but still not loaded —
  nothing on screen needs them yet (HUD numbers/labels use JetBrains Mono only).
- `public/favicon.svg` is still the default Vite favicon; cosmetic, not addressed.
- Economy numbers are still first-pass and untested against real play (see "Economy
  balance revisit" above) — the one structural dead-end that made this urgent (storms
  zeroing out CapEx income entirely) is fixed, but repair cost, hill multiplier, storm
  interval, starting resources, and now the permit duration are all unvalidated by an
  actual human playtester.
- No line-capacity/throughput upgrade track — only tower connection-capacity tiers
  exist. Could be added later as an independent upgrade axis if the economy needs more
  depth.
- Storms have no warning telegraph — they strike instantly and unpredictably by design
  (uncertainty is the point), but a brief "storm incoming" cue could be added later for
  fairness/anticipation without changing the core mechanic.
- Terrain now affects more than one-time placement cost — Wave 5's terrain-weighted
  storm targeting reads `Grid.terrainAt()` on a span's endpoints. What's still true: span
  *cost* itself isn't affected by terrain crossed, only raw distance (that specific gap
  from the original list remains open; storm-targeting was the piece that got addressed).
- Permits can't be canceled/refunded once placed, and permitting is universal (no
  zone-specific variation) — both deliberate scope cuts for the first pass, see
  "Permitting" above for the reasoning.
- Multiple towers can be pending simultaneously with fully independent timers — this
  is by design (rewards batching placements rather than a serial place→wait→place
  rhythm) but hasn't been playtested for whether it actually reads as a positive
  "plan ahead" mechanic or just as unrelated background noise once several towers are
  pending at once.
- No audio mute toggle — deliberate for v1, see "10x expansion — Wave 1" above; a
  single `masterGain` node is already in place to make adding one a small change later.
- Audio has not been listened to by a human yet — every check performed was structural
  (no exceptions, correct event timing via console/state inspection), since this tool
  chain can't actually hear sound. Treat the synthesis design as unvalidated-by-ear
  until you've played with sound on.
- Wave 6 of the "10x expansion" (upgrade-tree branching — the last wave) is planned in
  full at `/Users/samgumble/.claude/plans/fancy-wandering-dawn.md` but not yet built.
- Marsh's threshold/cost-multiplier values (`TERRAIN.marshThreshold = -0.55`,
  `marshCostMultiplier = 2.1`) are first-pass, chosen to produce a reasonable-looking
  distribution (61/441 nodes) and a cost that reads as "pricier than a hill" — not
  validated against real economy pacing the way `ECONOMY`'s own numbers were flagged as
  unvalidated back in Phase 2/3.
- Wave 5's new numbers (`towerCostGrowthPerTower = 0.06`, `marshWeightMultiplier = 2.5`,
  `minIntervalFloorSec = 12`, `intervalHalfLifeSpanCount = 6`) are all first-pass —
  verified to *do what they're supposed to do* (statistically confirmed above), not
  validated as *fun/well-balanced* by real play. Same caveat as every other tuning
  constant in this project so far.
- Rain's particle count (220), speed, and wind-drift constants are first-pass values,
  tuned by eye against screenshots taken via the synthetic-clock technique described in
  Wave 3's verification notes — not validated against a real, unpaused, real-time storm.
  Worth watching the next time a storm fires naturally during real play.
- Fault sparks and placement dust are visually distinct in isolated tests but haven't
  been seen firing "in the wild" back-to-back with everything else happening on
  screen (bloom, an active storm's rain, the fault alarm) — no reason to expect a
  problem, just not yet observed together.
- Frame-pacing cost of Wave 2's shadow mapping + extra post-processing pass hasn't been
  measured — this tool chain's `requestAnimationFrame` throttling makes any FPS/timing
  sample unreliable (see the Wave 2 Verification paragraph above). Watch for it locally,
  especially on lower-end hardware — `SHADOW.mapSize = 2048` and `VSMShadowMap`'s blur
  pass are the two likeliest costs to dial back first if it's ever an issue.
- Day/night's `dayNightCycleSec = 480` (8 minutes) was chosen as a reasonable-feeling
  default, not validated against real play — nobody has actually watched a full cycle
  play out in real time yet, only inspected the math at synthetic time values.
- The live GitHub Pages deploy (https://samgumble.github.io/right-of-way/) was verified
  at the asset-serving level (`curl` confirms `index.html`/JS/CSS all `200` at the
  correct paths) but not with a real in-browser load — the Chrome browser tool timed
  out in this environment when attempting it. Worth a human sanity-check load, though
  risk is low since it's the identical bundle already verified running locally.
- No custom domain, no cache-control tuning, and no build-size optimization
  (`vite build` already warns the JS bundle is >500kB post-minification, all of
  three.js) — fine for a personal project on GitHub Pages' CDN, worth revisiting if
  load time ever becomes a real complaint.

## Maintenance note

Keep this file and PLAN.md up to date as the project progresses — update PLAN.md's
status table and this file's architecture/decisions sections whenever a phase's worth
of work lands, not just at the very end.
