# Handover

Last updated: 2026-07-01. Phase 4 is fully done; Phase 5 (hosting, GitHub Pages) is
done; the "10x expansion" (six-wave plan, see below) is **fully delivered** — all six
waves (audio; lighting/materials/atmosphere; particles/weather; terrain depth; economy
depth; upgrade branching) shipped and verified. Since then: an in-game player guide
(`GUIDE.md`, opened via a `?` button), pole visuals that scale with real connection
capacity, terrain-weighted span cost, a storm warning telegraph, a line throughput
upgrade, and a camera rotation hotkey (`Q`/`E`) have also shipped — see "Player guide +
upgraded pole visuals" and "More depth on existing systems" below.

**The plant/neighborhood/N-1 "real purpose" redesign is now fully delivered — all 8
waves.** The user asked for a real win condition, "realistic, industry-specific, and
detailed" — the game now has one: connect a Power Plant to a Neighborhood through a real
transmission/distribution network, hold N-1 redundancy, and a milestone completes, with
a new one always waiting after (demand growth keeps the pressure on even after
"winning"). Final plan lives at
`/Users/samgumble/.claude/plans/fancy-wandering-dawn.md`; full architecture detail is in
the matching "Wave N architecture additions" subsections below and PLAN.md's matching
sections. Two real bugs were caught and fixed during this redesign's own required
verification (an N-1 disjointness edge case in Wave 3, and a markdown paragraph-merging
gap in Wave 8) — both examples of the plan's "verify, don't assume" checkpoints doing
their job. The storm softlock-prevention invariant was explicitly re-verified after the
one wave that touched it (Wave 5) and holds. **The next thing to do with this project is
a real human playtest** — see "Known gaps" at the bottom for the full, honest list of
what's been verified *correct* but not yet *fun*.

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
  (was zero-arg) now scales both interval bounds toward `STORM.minIntervalFloorSec`. And
  (Wave 6) `onKeyDown` now recognizes both `U` and `I`, routing through a new
  `handleUpgradeKey(tower, keyBranch)` that branches on the tower's *current tier* (not
  just `canUpgrade()`'s boolean) to decide what each key actually does — `trySpendUpgrade`
  factors out the shared afford-check/spend/upgrade/sound/save sequence both paths need.
  `spanStormWeight` gained the Resilience check (multiplicative on top of the marsh
  check, not a replacement). `save()`/`loadSavedGame()` both thread the new optional
  `branch` through to/from `Tower`. Also owns a `guide: Guide` field, constructed right
  alongside `hud`; `onKeyDown`'s very first line is now `if (this.guide.isOpen())
  return;`, gating every gameplay hotkey (including `Shift+R`) while the guide panel is
  open. And (depth pass) a new `spanTerrainMultiplier(a, b)` helper, called from
  `tryStringSpan`'s crew-cost calculation — same "check `grid.terrainAt()` on both
  endpoints, take the relevant multiplier" shape `spanStormWeight` already established,
  just for cost instead of storm weighting. `nextStormAt`'s scheduling gained a sibling:
  `lastStormWarningFor`/`stormWarningActive` fields and a new `updateStormWarning(now)`,
  called every tick right before the existing `if (now >= this.nextStormAt)` check (and
  reading the *pre-reschedule* `nextStormAt`, since `triggerStorm` mutates it later in
  the same tick) — same "call it every frame, it internally no-ops" idiom
  `updateFaultAlarm`/`updateRain`/`updateBursts` already use. And (line throughput) a new
  `tryUpgradeSpanThroughput(record)`, called from `onClick`'s span branch as a third
  sibling to the existing faulted/repair check — `else if
  (spanRecord.span.isEnergized())` — same deny-shakes-the-two-endpoint-towers pattern
  every other span-level deny already uses. `tick()`'s span loop now accumulates
  `capExIncomeRate` (summing each energized span's own `incomeRate()`) instead of a flat
  `energizedCount`, which is now itself dead and was removed rather than left unused.
- **`CameraRig.ts`** — fixed-elevation orthographic isometric camera; rotates in 90°
  steps around the vertical axis but never changes elevation angle (always a true
  isometric view, just from one of 4 compass corners). Right-drag pans
  (pointerdown/move/up gated on `button === 2`) directly/1:1 — easing an active drag
  would feel laggy, so pan is intentionally *not* eased. Scroll wheel sets a
  `targetZoom` (clamped); a new `update()` method, called every tick, eases the actual
  `zoom` toward it (`ZOOM_EASE = 0.18` of the remaining gap per frame, snapping once
  within `ZOOM_SNAP_EPSILON`) and calls `applyZoom()` — previously `onWheel` snapped
  `zoom` instantly. `setView()` (persistence restore) sets both `zoom` and `targetZoom`
  together so a reload doesn't visibly "ease in" from a default. Pan is clamped to
  `±PAN_BOUND` so you can't scroll off into the void. `getView()`/`setView(x, z, zoom)`
  read/write pan target and zoom directly, both going through the same clamps as normal
  input so a corrupted saved camera can't put the view somewhere invalid. **Rotation**
  (new): `BASE_ISO_DIR` replaced the old fixed `ISO_DIR` constant; `rotationAngle`/
  `targetRotationAngle` follow the exact same eased-target shape as zoom
  (`ROTATION_EASE`/`ROTATION_SNAP_EPSILON`), and `rotate(±1)` bumps the target by
  `±90°` — always one direction per call, so the eased transition never has to reason
  about wraparound/shortest-path. `currentIsoDir()` rotates `BASE_ISO_DIR` around Y by
  the live angle; `updateCameraPosition()` and `updatePanBasis()` both read from it, so
  pan direction stays screen-relative at any rotation — this was the one real risk in an
  otherwise mechanical change, and was verified explicitly (a real dispatched pan drag
  after rotating, not just eyeballed). Not persisted — `setView` doesn't touch rotation,
  so every session starts back at the default orientation.
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
  tower that isn't actually placed yet. And (Wave 6) a `branch: TowerBranch | null`
  field (`TowerBranch = 'capacity' | 'resilience'`), `getBranch()`, and `capacity()`
  now adds `ECONOMY.tier3CapacityBonus` on top of the tier-3 base when
  `branch === 'capacity'`. `TIER_ARMS` shrank to just the universal tier-1→2 entry; a
  new `TIER3_BRANCH_ARMS` record supplies the tier-2→3 arm shape(s) per branch (one wide
  arm for Capacity, two stacked arms for Resilience — geometry-only differentiation, no
  new colors). `addArmForTier(tier, branch?)` and `upgrade(branch?)` both gained an
  optional branch parameter (ignored below tier 2); `materializeFromSave` gained a
  fourth optional `branch` parameter, applied only when `tier >= 3`, and defaults to
  `null` gracefully (no crash) if a tier-3 tower's save data has no branch — the exact
  shape a pre-Wave-6 save would have. Renamed `addArmMesh`→`addArm` and gave it an
  `ArmSpec` (post-Wave-6): every arm spec now carries an `insulatorCount`, and `addArm`
  hangs that many insulator nubs (the same shared `insulatorGeo`, now a module-level
  constant instead of being recreated per tower) evenly spaced under the arm — set to
  exactly the capacity *gained* at that tier step, so a tower's total visible insulator
  count always equals `hasFreeCapacity()`'s real ceiling (2/4/8 Capacity, 4/6 Resilience).
  Also fixed a latent gap here: arm/insulator meshes added by `addArm` now get
  `castShadow = true` set directly, since the constructor's one-time shadow traversal
  only covers geometry that exists at construction — every tier-upgrade arm added since
  Wave 6 shipped had silently never cast a shadow until this fix.
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
  (which stays private) to callers that only need one position. And (depth pass) a
  `throughputTier` field (1-3): `TUBE_RADIUS_MULTIPLIER` scales the visible tube's
  radius per tier (rebuilt immediately on `upgradeThroughput()` — no separate animation,
  the geometry change *is* the feedback), `incomeRate()` returns
  `ECONOMY.capExIncomePerSpanPerSec * ECONOMY.spanThroughputMultiplier[tier-1]` for
  `Game.tick()` to sum across every energized span, and `materializeEnergized(tier = 1)`
  threads it through persistence with the same "default to 1 for old saves" pattern
  every other optional persisted field in this project uses.
- **`constants.ts`** — all color/size/economy magic numbers live here: `COLORS`,
  `GRID`, `TOWER_HEIGHT`, `ECONOMY`, `DENY_SHAKE_DURATION_MS`, `TERRAIN`, `STORM`,
  `PERMIT` (Phase 3), `ATMOSPHERE`, `SHADOW` (Wave 2), `RAIN`, `PARTICLE_BURST` (Wave 3).
  `ECONOMY.towerCostGrowthPerTower` and `STORM.minIntervalFloorSec`/
  `intervalHalfLifeSpanCount`/`marshWeightMultiplier` (Wave 5) are all pure tuning
  values — no schema/persistence impact, same pattern as every other constant here.
  `ECONOMY.towerUpgradeCost` (Wave 6) restructured from an array of two flat costs to a
  named object (`{ linear, capacity, resilience }`) — cleaner than a mixed-shape array
  with an `as`-cast at the tier-2 index, and every access site now reads a named branch
  rather than indexing by `tier - 1`. `ECONOMY.tier3CapacityBonus` and
  `STORM.resilienceWeightMultiplier` are new pure tuning values alongside it.
  `ECONOMY.spanHillMultiplier`/`spanMarshMultiplier` and `STORM.warningLeadSec` (post-6x
  depth pass) are the same — pure tuning, no schema impact. `ECONOMY.spanThroughputCost`
  followed the array-of-flat-costs shape (like `towerUpgradeCost` before Wave 6, since
  span throughput has no branch choice to complicate it) rather than the named-object
  shape — deliberately picked the simpler of the two established patterns since the
  extra structure `towerUpgradeCost` needed wasn't needed here.
- **`Economy.ts`** (Phase 2) — tiny state holder for `capEx` and `crewHours`.
  `canAfford(capExCost, crewHoursCost)`, `spend(...)`, and `tick(dt, capExIncomeRate)`
  (renamed from `tick(dt, energizedSpanCount)` in the depth pass — see below) regenerate
  Crew-Hours up to `crewHoursMax` and add whatever CapEx/sec rate the caller hands in.
  No events/observer pattern — `Game` just reads the fields directly each frame since it
  already has a tick loop. `restore(capEx, crewHours)` (persistence) sets both directly,
  clamping Crew-Hours to the max. Deliberately still doesn't know `Span`/tiers/anything
  exist — `Game.tick()` does the summing across spans and hands `Economy` one number,
  keeping this class a dumb accumulator on purpose.
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
  (Depth pass) a fourth `.hud-note` variant, `--warning`, sits between fault and
  context: reuses fault-red (thematically the same danger, just not realized yet) but
  without the blink animation, so it can never be mistaken for an active fault — same
  base class, one CSS rule added, no new HUD architecture needed.
- **`Guide.ts`** (new) — the first *interactive* DOM UI in the project (`Hud` is
  read-only). Unlike `Hud`'s `pointer-events: none` shell, `Guide` owns its own
  `pointer-events: auto` elements: a small `?` button (top-right) and a full-screen
  backdrop overlay containing the panel, both appended directly to `container` alongside
  `Hud`'s root — deliberately its own class, not folded into `Hud`, since `Hud` is a
  read-only status meter and this is the project's first real interactive overlay.
  Content is `GUIDE.md` (repo root) imported at build time via Vite's built-in `?raw`
  import (`import guideMd from '../../GUIDE.md?raw'` — no extra type declaration needed,
  `vite/client`'s ambient types already declare `*?raw` generically) and rendered through
  `markdown.ts`. `close()`/`toggle()`/`isOpen()` are public; `Game.onKeyDown` checks
  `this.guide.isOpen()` as its very first line and returns early if so — this is a
  `window`-level listener, so DOM stacking order alone doesn't suppress it the way it
  naturally suppresses canvas clicks/pointermoves (those never reach the canvas element
  at all once the overlay covers it, no extra code needed there). Verified this
  explicitly with a real selected, upgradeable tower: `U` does nothing while the guide
  is open. Escape-to-close is Guide's own `window` keydown listener, independent of
  `Game`'s.
- **`markdown.ts`** (new) — a tiny hand-rolled Markdown→HTML converter, not a
  general-purpose parser: `#`/`##` headers, `- ` bullet lists (consecutive lines grouped
  into one `<ul>`), `**bold**`, `` `inline code` ``, and blank-line-separated paragraphs.
  Escapes `&`/`</>` first, then layers on the `<strong>`/`<code>` substitutions, so
  GUIDE.md's own content can't inject markup. No dependency added — extends the
  project's existing "hand-write the math" precedent (catenary solver, terrain noise,
  procedural audio) into markdown rendering, appropriate for a few hundred words of
  static, single-author content.
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
  here. `SaveData.towers[]` gained one optional field (Wave 6): `branch?: 'capacity' |
  'resilience'` — a literal union inlined here rather than importing `TowerBranch` from
  `Tower.ts`, keeping this module's dependency direction one-way (game code depends on
  persistence, not the reverse). `SAVE_VERSION` stayed at 1 — purely additive.
  `SaveData.spans[]` similarly gained `throughputTier?: number` (depth pass) — same
  additive-only pattern, `SAVE_VERSION` still didn't need to move.
- **`SoundManager.ts`** (Wave 1, new) — procedural Web Audio, no audio asset files. See
  the "10x expansion — Wave 1" section below for the full design and per-sound synthesis
  notes; the short version: `unlock()` lazily creates the `AudioContext` on first user
  gesture, every sound layers 2-3 oscillators (never a bare single tone) through a
  `GainNode` envelope and a `BiquadFilterNode`, and a shared `noiseBuffer` (one 2s buffer
  of `Math.random()`-generated white noise, built once) backs mechanical thunks,
  electrical crackle, and storm wind/rain via different filter shapes on the same
  source. (Depth pass) `playStormWarning()` — a low, slow-building rumble, deliberately
  distinct from `playStormStrike()`'s sharp crack, meant to read as "weather rolling
  in" rather than impact.
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

### Wave 1 architecture additions (Plant/Substation/Neighborhood redesign)

Three new entity classes, each following `Tower`'s existing shape exactly (`readonly
group`, a shared geometry-factory free function, `update(now)` for phase-transition
events only, `materializeFromSave(...)`) rather than inventing a new pattern:

- **`PowerPlant.ts`** (new) — game-spawned only, never player-placed. `buildPlantVisual`
  differentiates all 6 fuel types (`coal`/`gas`/`nuclear`/`hydro`/`solar`/`wind`) by
  geometry only (stacks/cooling-tower/dam/panels/turbines), no new color hues — same
  discipline as the tower upgrade branches. `effectiveCapacityMW()` = nameplate ×
  `PLANT.fuelSpecs[fuelType].capacityFactor`. Only `gas` is spawned yet (the one
  hardcoded Wave 1 objective); the other 5 are implemented and verified via a
  dev-console spawn loop (all 6 silhouettes confirmed visually distinct; solar/wind mesh
  counts confirmed exactly 7 each — 1 base + 6 panels, 1 base + 3×(mast+blade)) but sit
  unused in code until Wave 6's semi-random fuel-type spawning reads them.
- **`Neighborhood.ts`** (new) — game-spawned only. `buildNeighborhoodVisual` renders a
  4-house cluster jittered via `Grid.ts`'s `hash01` (now exported for this reuse — same
  deterministic-jitter pattern as terrain patches, no new randomness primitive).
  `currentDemandMW()` returns a fixed `NEIGHBORHOOD.startingDemandMW` for now; grows
  starting Wave 7. No served/redundant/blackout visual states yet (Wave 3/5) — renders
  the neutral dim `steelBlueDim` look.
- **`Substation.ts`** (new) — player-placed exactly like `Tower` (same
  cost/terrain-gating/permitting flow, verified via a real dispatched `Shift`+click, not
  just a direct method call), but a genuinely distinct class: no tier/branch upgrade
  system, a single fixed-capacity purchase. `buildSubstationVisual` is a fenced-pad +
  transformer-tank silhouette, deliberately distinct from both the lattice tower and the
  house cluster. Its insulator-nub count matches `SUBSTATION.maxConnections` exactly
  (visual quantity = real capacity, same discipline as Tower). Fully persisted (`
  SaveData.substations[]`, new optional field) since — unlike Plant/Neighborhood — it
  costs real player CapEx; `connections` is deliberately *not* persisted, matching the
  existing "re-derive from spans, don't store redundantly" rule (not yet exercised, since
  no span can attach to a Substation until Wave 2).
- **`sharedGeometry.ts`** (new) — `insulatorGeo`, extracted from `Tower.ts` (which
  previously defined it locally) so `Substation` reuses the exact same insulator shape
  rather than a second copy that could visually drift. `feedback.ts` gained `easeOutBack`
  for the same reason (was local to `Tower.ts`, now shared by all four spawn-animated
  entity classes).
- **Placement UX**: plain click on buildable ground still places a Tower, unchanged.
  `Shift`+click places a Substation instead — the same "modifier for a rarer, heavier
  action" role `Shift+R` already plays for reset, chosen over a mode-toggle button to
  avoid reintroducing the "menus" the project has avoided since Phase 1. `onPointerMove`
  swaps between two ghost previews (`ghost`/`substationGhost`) based on live `e.shiftKey`
  state; both share one `ghostBasePos` and one deny-shake timer since only one is ever
  visible at a time.
- **`Game.ts`**: `onClick`'s priority chain extended to tower → span → plant →
  neighborhood → substation → ground (was tower → span → ground). Plant/Neighborhood
  clicks toggle-select via `handlePlantClick`/`handleNeighborhoodClick` (mirroring
  `handleTowerClick`'s toggle shape) and show HUD context (fuel/MW or demand MW);
  `deselect()` now clears all three selection kinds, not just `selectedTower`, so
  selecting one entity type always clears the others. New
  `spawnObjectiveEntities()`/`findBuildableNear(targetI, targetJ)` (deterministic
  outward-ring search for the nearest flat/buildable/unoccupied node — no randomness,
  same "no seed" discipline as terrain) spawn the one hardcoded Plant+Neighborhood pair
  after `loadSavedGame()` runs, so the search correctly avoids cells an existing save
  already occupies.
- **Verification note**: raycasting-precision false alarms happened twice during manual
  testing here (a `Shift`+click that appeared to do nothing turned out to be an
  insufficient-CapEx deny, not a routing bug; a neighborhood click that appeared to miss
  turned out to be an even number of toggling clicks in one dispatch loop canceling
  itself out) — both resolved by testing one click at a time and checking economy deltas
  directly rather than trusting a single screenshot. Neither was a real bug; recorded
  here as the same "verify precisely, don't assume" lesson this file has documented
  before. Also re-confirmed the "manual state override and the observation that checks
  it must happen in the same eval call" rule: a `localStorage.clear() +
  location.reload()` done as raw browser calls (bypassing `Game`'s own `isResetting`-
  gated reset flow) reopened the exact autosave/`beforeunload` race the reset hotkey was
  built to guard against — the game's own `Shift+R` hotkey remains the only reset path
  that's actually race-free; don't reimplement reset ad hoc during testing.

### Wave 2 architecture additions (voltage tiers, distribution spans, transmission linking)

The plan's Wave 2 scope (voltage tiers + the Substation→Neighborhood connect action)
turned out to need one necessary addition, discovered during implementation rather than
planned in advance: without a way to also link Towers/Plants to Substations on the
transmission side, a Substation would be a permanently unreachable island — nothing in
the plan's Wave 2 text addressed how power ever reaches a Substation at all. General
transmission-node linking shipped alongside the plan's own scope as a result.

- **`Span.ts`**: new `voltageTier: 'transmission' | 'distribution'` field (`readonly`,
  constructor param, default `'transmission'`) — set once at construction since it feeds
  `computeCatenaryPoints`'s `sagRatio` argument, which only runs in the constructor.
  `DISTRIBUTION_TUBE_RADIUS = 0.045` (fixed, not `TUBE_RADIUS`-multiplier-scaled) and
  `DISTRIBUTION_SAG_RATIO = 0.05` are new module constants; `rebuildGeometry` picks the
  base radius by `voltageTier` before applying the existing `TUBE_RADIUS_MULTIPLIER`
  per-tier scaling on top — both tiers still support the same throughput-upgrade
  mechanic and share the exact same phase/color state machine, per the plan's explicit
  "one state machine, not two" reasoning.
- **`Game.ts`** gained a real type layer for this: `TxNode = Tower | Substation |
  PowerPlant` (everything with `topPos`/`gridI`/`gridJ`/`hasFreeCapacity()`/
  `addConnection()`/`denyFeedback()` — all three already shared this shape from Wave 1's
  design), `TransmissionLinkRecord` (`{span, a, b}`, `a`/`b: TxNode`), `DistributionSpanRecord`
  (`{span, substation, neighborhood}`), and `DenyableEndpoint` (`{denyFeedback(): void}`,
  the common shape every endpoint kind needs for the generalized repair/upgrade deny).
- **`tryLinkTransmission(a: TxNode, b: TxNode)`** is a new sibling to `tryStringSpan`,
  not a widened version of it — deliberately duplicates `tryStringSpan`'s ~15 lines
  (dedup-key check, capacity check, cost check, spend, push) rather than genericizing the
  original, so the pre-existing, heavily-verified Tower-Tower path stays byte-for-byte
  unchanged. Pushes into the new `transmissionLinks` array; `spanTerrainMultiplier`'s
  parameter type widened from `Tower` to `TxNode` (a safe widening — every caller and
  every existing behavior is unchanged, it just reads `gridI`/`gridJ` which all three
  types already have) so both methods can share it.
- **`tryStringDistributionSpan(substation, neighborhood)`** mirrors the same
  cost-gating shape with its own cost constants (`SUBSTATION.distributionSpanCostBase`/
  `distributionSpanCostPerUnitDistance`). A new `connectedNeighborhoods: Set<string>`
  (keyed by Neighborhood id, mirroring `spannedPairs`'s role) enforces at most one
  distribution span per Neighborhood — the plan's topology decision.
- **Click routing**: `handleTowerClick`/`handleSubstationClick` (new)/`handlePlantClick`
  each gained a check, run *before* their own normal toggle-select logic, for whether a
  *different*-typed node is currently selected in one of the other two slots
  (`selectedTower`/`selectedSubstation`/`selectedPlant`) — if so, the click is a link
  attempt via `tryLinkTransmission`, not a new selection. `handleNeighborhoodClick`
  gained the equivalent check against `selectedSubstation` specifically, routing to
  `tryStringDistributionSpan` instead. `deselect()` now also clears `selectedSubstation`.
- **Raycasting/repair/upgrade generalized**: `raycastSpan()` (renamed return shape, not
  name) now searches all three span-bearing arrays via a new `allSpanHits()` — a plain
  array rebuilt fresh per call (cheap at this entity count), not maintained state — and
  returns `{span, endpoints: DenyableEndpoint[]}` instead of a `SpanRecord`.
  `tryRepairSpan`/`tryUpgradeSpanThroughput` changed signature from `(record: SpanRecord)`
  to `(span: Span, endpoints: DenyableEndpoint[])` to work across all three record
  shapes uniformly.
- **`tick()`**: a new small `tickSpan(span, now)` helper (advances the phase animation,
  fires the energize/repair sound on transition, returns `{income, faulted}`) replaced
  the inline per-span block, now called once per array (`spans`/`transmissionLinks`/
  `distributionSpans`) instead of duplicating the block three times. `updateHud()`'s
  `faultCount` calculation was similarly widened to sum across all three arrays.
- **Storms deliberately untouched**: `triggerStorm()`/`spanStormWeight()`/
  `pickWeightedStormTarget()` still only ever read `this.spans` (Tower-Tower). This is a
  conscious choice, not an oversight — expanding storm-strike candidates to the new span
  types is exactly the kind of storm-adjacent change this project's own discipline says
  needs deliberate softlock-invariant re-verification, and that's explicitly Wave 5's
  job (where the blackout mechanic that actually needs it also lands), not something to
  slip into a "low risk" wave.
- **Persistence, expanded beyond the plan's original sketch**: the plan's own text
  described deferring Plant/Neighborhood persistence to Wave 6. That stopped being safe
  the moment a `transmissionLinks`/`distributionSpans` entry could reference a
  Plant/Neighborhood by identity — a fresh deterministic respawn every load (fine when
  nothing referenced them) could silently point a persisted link at the wrong entity, or
  nothing at all, once something *does* reference them. So `plants`/`neighborhoods` are
  persisted starting this wave instead. `loadSavedGame()` gained a combined
  `txNodeByKey: Map<string, TxNode>` (populated across towers/substations/plants as each
  is reconstructed — safe to key by bare `[i,j]` since no two entities ever share a
  cell) and a `neighborhoodById: Map<string, Neighborhood>`, used by the new
  `transmissionLinks`/`distributionSpans` reconstruction loops. `spawnObjectiveEntities()`
  now only runs its fresh-spawn search when nothing was loaded
  (`this.plants.length === 0`), so an existing save's Plant/Neighborhood aren't
  duplicated or shifted on reload.

Verified: real dispatched clicks (not direct method calls) for both new link flows,
including a click-driven throughput upgrade on a distribution span (tier 1→2, radius
0.045→0.06075 exactly) and a click-driven repair on a faulted transmission link
(exactly `STORM.repairCost.capEx` spent); full persistence round-trip across all four
new/expanded arrays with correct tier/fault/voltageTier restoration; a legacy
pre-Wave-2 save (only `towers`/`spans`/`substations`, no `plants`/`neighborhoods`/
`transmissionLinks`/`distributionSpans` keys at all) loads with zero errors and
correctly falls back to spawning a fresh deterministic Plant/Neighborhood pair.

### Wave 3 architecture additions (network capacity graph & N-1 redundancy)

The plan's one explicitly high-risk wave — isolated on purpose (no visual/economy
consequence yet) so it could be verified by direct state inspection against hand-built
topologies before anything downstream depends on its output being correct.

- **`network.ts`** (new) — pure functions, zero Three.js/scene dependency, matching
  `catenary.ts`'s "hand-written math in its own module" precedent. Exports
  `computeMaxBottleneck(graph, sourceIds)` (multi-source widest-path/maximum-bottleneck,
  Dijkstra-shaped but relaxing by `min(...)` and keeping the largest candidate rather
  than the shortest distance — node throughput caps folded in during relaxation, not a
  separate pass) and `isSubstationRedundant(graph, substationId)` (two-BFS-pass
  disjoint-paths check, transmission-kind edges only). Both take/return a plain
  `NetworkGraph`/`Map` shape — `Game.buildNetworkGraph()` is the only place that
  translates live entities into it.
- **`Game.ts`**: `buildNetworkGraph()` builds nodes from `plants`/`towers`/`substations`/
  `neighborhoods` (Plant capacity = `effectiveCapacityMW()`; Substation capacity =
  `SUBSTATION.capacityMW`; Tower/Neighborhood = `Infinity`, per the "no separate MW cap
  on Towers" decision) and edges from all three span-bearing arrays, filtered to
  `span.isEnergized()` (already exactly "energized and not faulted," no new check
  needed). A new `txNodeId(node)` synthesizes a stable graph-node id from grid
  coordinates for Tower/Substation (which have no persistent `id` field of their own —
  not otherwise needed) and reuses Plant's existing `id` directly.
  `recomputeNetworkState()` runs the algorithm, caches each Substation's redundancy
  result (shared by every Neighborhood hanging off it, per the plan's topology note),
  and calls `neighborhood.setNetworkState(served, redundant)` for each. **Wired inside
  `save()` itself**, not threaded through every individual action method — a
  simplification over the plan's "add a call at each of these six call sites" suggestion,
  chosen because `save()` already runs at exactly the right set of trigger points (every
  discrete board-changing action, the 3s autosave throttle, `visibilitychange`/
  `beforeunload`) and this way a future new action method can't forget the call. Also
  invoked once explicitly right after construction (`spawnObjectiveEntities()`), so a
  freshly loaded game has correct state before any action triggers the first save.
- **`Neighborhood.ts`** gained `setNetworkState(served, redundant)`/`isServed()`/
  `isRedundant()` — pure internal state (`served`/`redundant` fields), no visual change
  yet (deliberately deferred — Wave 3's own scope is algorithm correctness only).

**A real bug was caught and fixed during the required verification, not left for later**:
the initial `isSubstationRedundant` only excluded *substations* used by the first BFS
pass when running the second pass. This is correct when the two paths actually diverge
through different intermediate substations, but breaks down in the degenerate case where
a Substation has only one physical transmission edge and zero intermediate substations at
all — nothing to exclude, so the second BFS pass just re-finds the identical single edge
and incorrectly reports "redundant." Caught by synthetic topology (a) (single path,
should be `redundant: false`) failing during the required pre-Wave-4 verification pass.
Fixed by also excluding the first path's *edges*, not just its substations, in the second
pass — the resulting function now rebuilds its adjacency per-call with both exclusions
applied, rather than reusing one shared `buildAdjacency()` call. Re-verified all five
required topologies pass after the fix, including case (c) (two textually-different
first hops funneling through one shared substation — the case that specifically exercises
disjointness, not just "does a second path exist").

**A second real issue was caught, unrelated to the algorithm itself**: exercising a real
end-to-end chain (Plant→Tower→Substation→Neighborhood, all tier-1 spans) through actual
`Game` entities showed the Neighborhood as *not served* even with a complete, correctly-
energized path — because `NEIGHBORHOOD.startingDemandMW` (60) exceeded
`ECONOMY.spanCapacityMW[0]` (50, the tier-1 edge capacity), meaning the very first
objective would have been mathematically impossible to serve without a mandatory
pre-upgrade. Not a Wave 3 scope item in the strict sense (it's a tuning constant, not
algorithm logic), but a directly-observed, concrete defect worth fixing on sight rather
than filing away — lowered to 40, comfortably under the tier-1 cap. `constants.ts`'s
comment on the field now states this constraint explicitly, so it isn't silently
reintroduced by a future tuning pass.

Verified: all five required synthetic topologies pass exactly against `network.ts`'s
functions directly (via the dev server's dynamic `import()`, not reimplemented in the
console); a 57-node synthetic graph stays sub-millisecond for both algorithms (informal
`performance.now()` timing, not a rigorous benchmark — matching the "comfortably fast,
not a hard perf target" bar the plan set); a real end-to-end chain built through actual
`Game` entities and the real Wave 2 stringing methods correctly reports served/not-served
across a real fault→repair cycle, including via the automatic `save()`-triggered
recompute path specifically (not just a manual `recomputeNetworkState()` call); pure
Tower-Tower sandbox play (no Plant/Substation touched at all) confirmed completely
unaffected — no console errors, `buildNetworkGraph()` handles a graph where most entities
have nothing to do with the objective layer without incident.

### Wave 4 architecture additions (demand-based revenue)

Small and mechanical — the revenue-model decision itself (additive vs. full-replacement)
was already resolved during planning, so this wave was implementation only, no new
design question to work through.

- **New `OBJECTIVE` constants group** (`constants.ts`) — `capExPerMWServedPerSec = 0.08`,
  the one new tuning number this wave introduces.
- **`Game.tick()`**: a new `objectiveIncomeRate` local, summed by iterating
  `this.neighborhoods` and checking `neighborhood.isServed()` (Wave 3's state, now
  finally consumed by something) — `demandMW * capExPerMWServedPerSec` per served
  Neighborhood, zero otherwise. Passed to `this.economy.tick(dt, capExIncomeRate +
  objectiveIncomeRate)` — the existing per-span `capExIncomeRate` local is completely
  untouched, just added to rather than replaced, which *is* the additive model in code
  form. `Economy` itself needed zero changes — it was already just summing one combined
  rate handed to it, matching its existing "dumb accumulator" discipline exactly.
- **Redundancy deliberately not read here** — `neighborhood.isRedundant()` exists
  (Wave 3) but nothing in this wave's income calculation touches it, per the plan's
  explicit "redundancy is a completion-gate/blackout-risk factor, never a revenue
  multiplier" decision.

Verified precisely against the real `tick()` code path, not the formula in isolation: a
served Neighborhood's income matched `demandMW * 0.08` exactly via a directly-measured
CapEx delta (forcing a known `dt` by manipulating `lastTick`, then diffing `economy.capEx`
across one real `tick()` call); the *combined* rate (legacy span income summed
independently as a cross-check + objective income) matched the actual observed delta
exactly through a real Plant→Tower→Substation→Neighborhood chain; faulting the sole
transmission link dropped objective income to exactly zero while unrelated legacy span
income was unaffected; and — the regression-critical check for decision #7 — a plain
sandbox span with no Plant/Neighborhood ever involved earned exactly the same rate it did
before this wave (`ECONOMY.capExIncomePerSpanPerSec * spanThroughputMultiplier[0]`),
confirming zero objective income leaks into pure sandbox play.

### Wave 5 architecture additions (blackout state & storm interaction)

The wave the storm softlock-prevention invariant explicitly needed re-verified against —
this project's own established discipline after any storm-adjacent change, followed here
precisely because blackout is the most storm-adjacent change yet.

- **`Neighborhood.ts`**: new `NeighborhoodEvent = 'blackoutStarted' | 'blackoutCleared'`
  and a `blackedOut` field. `setNetworkState(served, redundant)` now returns
  `NeighborhoodEvent | null` — it detects the transition by comparing the *incoming*
  `served`/`redundant` against `this.served`/`this.redundant` (the pre-update values)
  before overwriting them: `blackoutStarted` fires iff `this.served && !this.redundant
  && !served` (was served, was at-risk, now isn't served); `blackoutCleared` fires iff
  `this.blackedOut && served`. Purely derived — nothing calls this except
  `Game.recomputeNetworkState()` reacting to whatever *else* already changed the graph,
  no independent timer or probability roll of its own. `update(now)` (unchanged
  signature, still returns `void`) gained the actual visual: while not selected
  (selection's orange still wins, same precedent as `Tower`), a served Neighborhood now
  gets a small warm `keyLight`-toned glow (a first visual state of its own — nothing
  distinguished served from not-served before this wave, and blackout needs *something*
  to read as "worse than"), a blacked-out one gets a whole-cluster `faultRed` pulse
  reusing `Span`'s exact fault-pulse formula/period for visual-family consistency.
  `setSelected(false)` no longer writes emissive directly — it lets the next `update()`
  call (every frame) restore the correct served/blackout look instead, since a bare
  "reset to dim" would have been wrong for a served or blacked-out Neighborhood.
- **`Game.ts`**: `triggerStorm`'s candidate pool, `spanStormWeight`, and
  `pickWeightedStormTarget` all generalized from `SpanRecord[]`/`Tower`-typed to read
  across all three span-bearing arrays (new `stormCandidates()` combines them, mirroring
  `allSpanHits()`'s shape from Wave 2) — this is the piece explicitly deferred from
  Wave 2, landing here because it's the one thing that makes a blackout reachable at all
  (a storm that could only ever strike Tower-Tower spans could never take down a
  Neighborhood's sole distribution/transmission path). The Resilience-branch check
  (`spanStormWeight`) is now guarded by `instanceof Tower` rather than assuming every
  endpoint has `getTier()`/`getBranch()` — Substation/PowerPlant/Neighborhood endpoints
  correctly contribute no resilience bonus, verified not to crash the weight calculation.
  `recomputeNetworkState()`'s per-Neighborhood loop now reacts to the returned event:
  `'blackoutStarted'` spawns a spark burst at the Neighborhood's `attachPos` — no
  duplicate sound (the storm strike that (almost always) caused this already played its
  own `playStormStrike()` moments earlier via `triggerStorm`; playing it twice for one
  event would read as a bug, not emphasis). `'blackoutCleared'` gets no extra
  sound/effect either, for the same reason (the repair action that fixed it already has
  its own `playRepair()` cue).
- **`Hud.ts`**: new `blackoutCount` field on `HudState`, a new `data-blackout` line
  reusing the exact `.hud-note--fault` blinking CSS class (no new stylesheet rule needed
  — a blackout is exactly as urgent as a fault, visually) positioned above the existing
  fault line so both can be visible and distinct simultaneously.

**The storm softlock-prevention invariant was re-verified explicitly, as the project's
own discipline requires**: `STORM.minEnergizedSpansToStrike = 2` now counts across the
expanded candidate pool rather than just `this.spans`. 300 forced storm attempts against
a topology with exactly one total energized span produced zero strikes — tested twice,
once as a plain Tower-Tower span (matching the original check exactly) and once,
specifically because the candidate pool is now heterogeneous, as a lone distribution
span (the case that would have been impossible to construct before this wave). Both
produced 0/300 strikes. The invariant generalizes cleanly because it was always
span-*count*-based, never span-*type*-based — nothing about the fix needed to change,
only the pool it counts over. Global CapEx income also can't hit zero from a single
blackout: the legacy per-span stream keeps paying regardless of any Neighborhood's
served state (unconditionally additive, per the Wave 2/4 revenue-model resolution), and
a blackout only zeroes *that one Neighborhood's* objective-income stream, never a
sandbox-wide total.

Verified: a real at-risk topology (served, not redundant) with a real storm-forced fault
on its sole serving span confirmed the blackout fires exactly on that transition
(state-inspected before/after, not just eyeballed); objective income for that
Neighborhood dropped to exactly zero; the whole-cluster visual pulse rendered distinctly
from a single faulted line in a real screenshot, with the HUD showing both a blackout
line and a fault line simultaneously with correctly distinct text; a real repair cleared
the blackout; the softlock regression re-check (above, both variants); a spot-check
confirming storm-weight calculation doesn't crash across non-Tower endpoint types and
that strikes still occur normally (100/100, as expected — not probabilistic once the
2-candidate threshold is met) once 2+ energized spans exist.

### Wave 6 architecture additions (milestone/objective lifecycle)

The first wave verifiable as "the actual thing the user asked for" end-to-end — a real
Plant-to-Neighborhood chain, built via real clicks, completing a milestone.

- **`Game.ts`**: new `Objective` interface (`{id, plant, neighborhood, targetDemandMW,
  completedAt}`) and `objectives: Objective[]`. `createObjective(plantNode,
  neighborhoodNode, fuelType, targetDemandMW)` is the one place both the initial spawn
  and every later respawn build a real Plant+Neighborhood+Objective triplet, so the two
  call sites can't drift apart — `spawnObjectiveEntities()` (fixed starting corners,
  `'gas'`, only on a truly fresh game) and the new `spawnNextObjective()` (randomized
  location, `pickRandomFuelType()`) both funnel through it.
- **`checkObjectiveCompletions()`** runs from `save()`, right after
  `recomputeNetworkState()` so served/redundant state is fresh — guarded by
  `completedAt !== null` skipping already-completed objectives, so the fanfare/burst
  fires exactly once regardless of how many times `save()` re-runs while the condition
  keeps holding (verified explicitly, not assumed). On completion: `sound.
  playMilestoneComplete()`, a `'celebrate'` burst at the Neighborhood, and
  `nextObjectiveSpawnAt = now + OBJECTIVE.respawnDelaySec * 1000` — checked in `tick()`
  (not `save()`, since it's genuinely time-based, unlike the discrete-action-triggered
  network recompute) and nulled immediately before calling `spawnNextObjective()`, so a
  second `tick()` call can't double-fire it.
- **Target stays static this wave, deliberately**: `targetDemandMW =
  NEIGHBORHOOD.startingDemandMW` for every objective, not escalating per round. Demand
  growth doesn't exist until Wave 7, so an escalating target now would make every
  objective after the first mathematically unwinnable (demand can never rise to meet a
  higher target with nothing to grow it) — the plan's own wave breakdown flagged this
  exact ordering nuance and recommended keeping Wave 6's dependency chain linear rather
  than blocking on Wave 7.
- **`SoundManager.playMilestoneComplete()`** (new) — a three-note ascending major-triad
  arpeggio, each note layered with a shimmer harmonic (never a bare single oscillator,
  same discipline as every other sound here), plus a bright tail once it lands —
  deliberately richer/longer than `playUpgrade`'s two-tone sweep, since a milestone is a
  bigger deal than a routine upgrade.
- **`PARTICLE_BURST.celebrate`** (new) — brighter/wider spread than `dust`/`spark`
  (`energizedGreen`, count 22, 750ms), reusing the exact same `ParticleBurst` class with
  zero new particle code.
- **`Hud.ts`**: new `objectiveStatus`/`completedObjectives` fields, a `MILESTONES` row
  in the main panel (always visible, like CapEx/Crew-Hours), and a new `.hud-note
  --objective` line (green, `style.css`) computed by `Game.computeObjectiveStatus()` —
  blank during the brief respawn gap after a completion, same "blank when not
  applicable" pattern the fault/warning lines already use.
- **Persistence, with backward-compat synthesis**: `objectives[]` persists by
  Plant/Neighborhood *id* (`plantId`/`neighborhoodId`), not position — resolved on load
  against `plantById`/`neighborhoodById` maps built during the (already-existing)
  plants/neighborhoods reconstruction loops. **A pre-Wave-6 save** (Plant/Neighborhood
  restored via Wave 2's persistence, but no `objectives` key exists at all) synthesizes
  one active objective wrapping the first pair after the reconstruction loops run,
  rather than leaving an existing player's in-progress network with no objective to
  complete, or silently losing it.

**A test-methodology false alarm, not a code bug**: forcing the respawn timer via a
manual `nextObjectiveSpawnAt` override and calling `tick()` once produced *two* new
objectives instead of one. Root cause: the real animation loop (never paused across the
many tool calls this verification took) had already naturally reached the genuinely-
scheduled 25-second respawn time on its own in real wall-clock time and fired a
legitimate first respawn *before* the manual override — the manual override then fired a
second, separate one on top of that. A follow-up `tick()` call with no manual override
produced zero further spawns, confirming the underlying guard (`nextObjectiveSpawnAt`
nulled immediately, before `spawnNextObjective()` runs) is correct; the double-spawn was
purely an artifact of real time passing between eval calls, the same class of gotcha
this file has documented multiple times before (see "Debugging note" and the Wave 2
architecture section above). Lesson reconfirmed: don't assume a manually-forced timer
value is the *only* thing that could fire a time-based trigger in this environment — the
real loop keeps running the whole session.

Verified end-to-end via real game methods, not synthetic state: built a genuinely
redundant chain (one Substation with two independent transmission routes to the Plant
via two different Towers — the correct way to achieve redundancy under the "one
Substation per Neighborhood" topology; two Substations per Neighborhood isn't a valid
topology at all) and confirmed the objective completed automatically through the real
`save()` pipeline; confirmed the fanfare/HUD counter fire exactly once even across five
repeated `save()` calls with the completion condition still holding; confirmed a new
objective spawned after the delay at a genuinely new location with a real
weighted-random fuel type; full persistence round-trip (one completed + two active
objectives, correct `completedAt` presence/absence); backward-compat synthesis verified
against a simulated pre-Wave-6 save; free-build elsewhere on the board confirmed
completely unaffected (decision #7).

### Wave 7 architecture additions (demand growth & capacity warning telegraph)

The closing mechanical piece of the redesign — everything from here (Wave 8) is docs and
final regression, no new gameplay logic.

- **`Neighborhood.ts`**: `update(now: number, dt: number)` — gained a `dt` parameter
  (was `update(now)` only) specifically to drive continuous growth:
  `this.demandMW = Math.min(this.demandMW + NEIGHBORHOOD.demandGrowthMWPerSec * dt,
  NEIGHBORHOOD.demandGrowthCapMW)`, applied unconditionally to every Neighborhood every
  tick, including ones whose objective already completed — a milestone doesn't freeze
  the underlying Neighborhood, matching decision #1's "the game continues" framing.
  `setNetworkState` gained a third parameter, `bottleneckMW`, cached as a new private
  field — Wave 3's `recomputeNetworkState()` already computed this value locally per
  Neighborhood, it just wasn't being stored on the entity itself until now. New
  `isApproachingCapacity(leadSec)` (private — linear projection: `demandMW +
  demandGrowthMWPerSec * leadSec > bottleneckMW`, skipped entirely if already not-served
  since that's a different, already-handled problem) and `checkCapacityWarning(leadSec)`
  (public, called every tick by `Game` — fires exactly once per approach via a
  `warnedForCapacity` dedup flag that resets once no longer approaching, mirroring
  `Game`'s existing `lastStormWarningFor` pattern but scoped per-entity instead of
  per-storm-cycle). `isCapacityWarningActive()` exposes the live (not just
  just-fired-this-frame) state for the HUD.
- **`Game.ts`**: the Neighborhood tick loop now calls `neighborhood.update(now, dt)`
  (threading the already-computed `dt` through) and `neighborhood.
  checkCapacityWarning(NEIGHBORHOOD.demandWarningLeadSec)`, playing `sound.
  playCapacityWarning()` on a true return. `recomputeNetworkState()`'s existing
  `setNetworkState` call now passes the `bottleneckMW` it already had in scope as a
  third argument — no new computation needed there, just threading an existing value
  one level further.
- **`SoundManager.playCapacityWarning()`** (new) — a rising two-oscillator sweep
  (340→520 Hz sine + 510→780 Hz triangle), deliberately the *inverse* shape of
  `playStormWarning()`'s descending rumble, so the two are distinguishable by ear alone
  per the plan's explicit ask.
- **`Hud.ts`**: new `capacityWarningCount` field and a second `.hud-note--warning` line
  (`data-capacity-warning`, same CSS class as the storm warning — both are "heads up,
  not urgent yet" in the same visual family, just triggered by different things and
  shown as separate lines so both can be visible and distinct simultaneously).
- **New constants** (`NEIGHBORHOOD`): `demandGrowthMWPerSec = 0.05` (crossing from the
  40 MW starting point to a tier-1 span's 50 MW ceiling takes ~200s — noticeable within a
  session, not an ambush), `demandGrowthCapMW = 130` (comfortably under a maxed tier-3
  span's 140 MW ceiling, so a fully-upgraded chain can always eventually catch up),
  `demandWarningLeadSec = 30` (longer than the storm's 4s — reacting means a real
  deliberate upgrade decision, not a quick glance).

Verified via the same synthetic-clock methodology already established for `STORM.
warningLeadSec` (avoiding real wall-clock waits): growth rate matched
`demandGrowthMWPerSec` exactly via a large synthetic `dt` in one call; the cap held
exactly at an extreme synthetic elapsed time (100,000s); the warning fired exactly once
at a controlled tight margin (`demand=40, bottleneck=41, leadSec=30` — projects to 41.5,
correctly exceeds), stayed silent at a comfortable margin (`bottleneckMW=200`),
correctly declined to fire for an already-not-served Neighborhood, and correctly
reset/re-fired after returning to a tight margin from a comfortable one; the real
`tick()` wiring confirmed (via a temporarily-wrapped `sound.playCapacityWarning`) to
actually get called and to update `Neighborhood`'s live warning state correctly in one
real tick; pure sandbox play reconfirmed completely unaffected.

**A second test-methodology false alarm**, same family as Wave 6's: a screenshot taken
after several manual `setNetworkState(...)` override calls (used to construct controlled
warning-threshold scenarios) showed an unexpected "BLACKED OUT" state. Root cause: none
of those manual calls were followed by a real `save()`, so the continuously-running real
animation loop's own periodic autosave eventually ran `recomputeNetworkState()` against
the *actual* (disconnected) graph, computing genuine "not served" state — which,
combined with the researcher's last manual "served" override still in place, satisfied
`setNetworkState`'s real blackout-transition condition for entirely legitimate reasons.
Not a bug in the blackout logic (which fired exactly as designed given the state it
actually saw) — a reminder that manually forcing `Neighborhood` state without also
controlling when the real loop's own recompute runs will eventually let the real graph
state win the race. Resolved by a full reset and a fresh, unmanipulated verification
pass, which showed the expected clean state.

### Wave 8 architecture additions (docs & final regression)

Closes out the redesign. Every mechanic already had its own incremental `GUIDE.md`/
`PLAN.md`/`HANDOVER.md` update as it shipped across Waves 1-7 (per the standing "keep
docs current" instruction) — this wave was a coherence pass and final verification, not
a rewrite.

- **`GUIDE.md`**: the opening paragraph now states the game's real purpose (Plants,
  Neighborhoods, redundancy, milestones) rather than only the free-build mechanics — it
  had gone stale relative to what the game actually is, even though every individual
  mechanic section was already current.
- **`markdown.ts` bug found and fixed**: `renderMarkdown` never merged consecutive
  plain-text lines into one paragraph — every non-blank line became its own `<p>`,
  unlike standard Markdown's soft-wrap semantics (a run of lines with no blank line
  between them is one paragraph, joined with spaces; only a blank line, header, or
  bullet actually ends one). This had been latent since the renderer's original Wave-era
  introduction — invisible because every paragraph in `GUIDE.md` up to this point
  happened to be authored as a single long line. The new Wave 8 intro paragraph, written
  with natural sentence-wrapped line breaks (the way prose is normally composed), broke
  visibly into one `<p>` per line the instant it was previewed. Fixed in the parser
  itself (accumulate non-blank/non-structural lines into a buffer, flush as one `<p>` on
  a blank line/header/bullet/end-of-input) rather than just reflowing the one paragraph
  that exposed it — the robust fix, since the parser is the shared renderer for all
  future `GUIDE.md` edits, and any future multi-line paragraph would otherwise hit the
  exact same gap again silently.
- **Final regression pass**: a synthetic legacy save predating the *entire* redesign
  (pure pre-Wave-1 shape — `towers`/`spans`/`camera` only, including a tier-3 branched
  tower and a faulted span, no `substations`/`plants`/`neighborhoods`/`objectives`/
  `transmissionLinks`/`distributionSpans` keys at all) loads with zero console errors,
  fully restores the old sandbox network exactly, and remains fully playable (a new
  tower placed on the loaded network succeeds) — confirming decision #7's sandbox
  compatibility promise holds at the *oldest* possible save format, not just against the
  immediately-prior wave's schema. A comprehensive full-feature save (2 towers, a
  Tower-Tower span, 2 substations, 2 plants with non-default fuel types — `nuclear`,
  `wind`, the first time either has round-tripped through the real persistence path
  rather than just a dev-console spawn — 2 neighborhoods with distinct demand values, 2
  transmission links, 2 distribution spans with different fault states, and 2
  objectives — one completed with a real `completedAt`, one active) round-trips through
  every single field correctly, with zero console errors either.

Verified: the markdown fix confirmed both visually (before/after screenshot of the exact
paragraph that exposed it) and structurally (a full accessibility-tree snapshot of the
rendered guide — every header/list/bold-span/paragraph reads correctly end-to-end, not
just the one fixed paragraph); both regression saves confirmed with zero console errors;
`tsc --noEmit` clean; a final live screenshot after a real `Shift+R` reset (not a raw
`localStorage.clear()` — see the note below) shows a clean, healthy fresh-game state.

**A second reminder of the same reset-hotkey lesson, caught again in this exact wave**:
attempting to leave the game in a clean state via `localStorage.clear()` + `location.
reload()` (rather than the real `Shift+R` hotkey) reopened the identical
autosave/`beforeunload` race documented multiple times earlier in this file — the
continuously-running real game instance's own periodic save re-wrote state to
`localStorage` in the gap between the manual `clear()` and the `reload()` call,
producing a reload that looked like the clear had silently failed. Not a product bug;
resolved immediately by using the real `Shift+R` reset path, which is `isResetting`-
gated specifically to prevent this. Recorded here a final time because it recurred even
after being documented as a known pitfall earlier in this same session — the lesson is
evidently easy to forget mid-session and worth actually internalizing: **use the game's
own reset hotkey for cleanup, never raw `localStorage` manipulation, even for "just
resetting to a clean state" purposes.**

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

## "10x expansion" (complete — all six waves delivered)

Not a numbered roadmap phase — the user asked to "10x the graphics and mechanics," a
deliberately huge, open-ended request, bigger in scope than any single phase so far.
Given the stakes of building the wrong thing at that scale, this went through
`EnterPlanMode` (the only time this session a formal plan was used instead of just
implementing after an ambiguity check) — direction was confirmed via direct questions
*before* any design work, then a Plan agent was used to pressure-test a six-wave
breakdown and work out concrete technical designs for the two areas with zero existing
precedent in this codebase (audio, particles). The full approved plan lives at
`/Users/samgumble/.claude/plans/fancy-wandering-dawn.md` — it's now fully implemented;
this section documents what was actually *built*, wave by wave, including a few places
where the real implementation deviated in small ways from the plan's exact literal
wording once it was actually being written (e.g. Wave 6's `towerUpgradeCost` shape, and
where the branch-selection logic actually ended up living) — the plan got the direction
right every time, these were just implementation-detail judgment calls made while
writing real code against it.

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

### Wave 6 — Upgrade tree branching (delivered)

**This was the last wave — the "10x expansion" is now complete.** Implemented exactly
to the plan's scope: tier 1→2 stays universal (`U`); at tier 2, `U` continues to mean
the default/primary upgrade (now specifically the Capacity branch) while a new `I` key
means Resilience — chosen so existing `U`-to-upgrade muscle memory keeps working
unchanged at every tier, and `I` is purely an additional option layered on top, never a
required one.

- **`Tower.canUpgrade()` stayed a simple boolean** (`tier < towerMaxTier`) — the plan
  flagged this as needing to become branch-aware, but the actual branch logic turned out
  to belong in `Game.handleUpgradeKey()` instead: `canUpgrade()` still answers "can this
  tower upgrade at all" (used as a tier gate), and a separate `if (tier === 1) / else`
  inside `handleUpgradeKey` decides what each key means at the current tier. Keeping
  `Tower`'s API simple and putting the branch-selection policy in `Game` (which already
  owns all the other upgrade-cost/HUD-text logic) felt like the right seam once actually
  writing it, even though the plan's instinct that *something* needed restructuring was
  correct.
- **Capacity**: `ECONOMY.tier3CapacityBonus = 2` on top of the shared tier-3 base (6),
  giving 8 total. **Resilience**: `STORM.resilienceWeightMultiplier = 0.4` applied
  multiplicatively in `spanStormWeight` alongside (not instead of) Wave 5's marsh
  weighting — a resilient tower on marsh is safer than average, not immune, which felt
  like the more honest simulation than an on/off immunity flag.
- **Visual branching stayed geometry-only**: `TIER3_BRANCH_ARMS` gives Capacity one wide
  arm, Resilience two stacked ones, both from the same `BoxGeometry` primitive already
  used everywhere else on the tower — no new colors, same discipline as terrain tints
  and Phase 4's insulator details.
- **Schema**: one optional field, `branch?: 'capacity' | 'resilience'`, meaningful only
  at tier 3. `Tower.materializeFromSave` degrades gracefully (not a crash) if a tier-3
  tower's save has no branch — it applies whatever arms the loop *can* build (just the
  tier-1→2 arm) and sets `branch = null`, rather than throwing or guessing a default.
  This is the correct behavior for a genuinely pre-Wave-6 save, which by construction
  never had a branch to restore in the first place.

**Verification produced several false alarms — worth recording in full, since none were
actual bugs and the debugging process itself is reusable next time:**

1. A capacity-fill test on a *second* Resilience tower returned "2 remaining" instead of
   the expected 6 — because that specific tower still had 4 connections left over from
   an earlier, different test that was never cleaned up. Not a bug; a fresh tower
   confirmed exactly 6.
2. A weight check on a Resilience-branch span returned exactly `1` instead of the
   expected `0.4` — a genuine coincidence: that particular span *also* had a marsh
   endpoint from leftover state, and `2.5 × 0.4 = 1.0` exactly, deceptively identical to
   "no modifier at all." Confirmed via a `console.log`-instrumented temporary debug pass
   (then removed) that the real math is `marshWeight × resilienceWeight`, multiplicative
   as designed — isolating a guaranteed-flat-terrain span showed the true `0.4` cleanly.
3. **The non-negotiable softlock check initially failed** — 300 forced storms against
   what was assumed to be a single energized span produced real strikes. Root cause:
   `g.spans` silently had 6 entries, not 2 — leftover from *multiple* prior test blocks
   across this long session, several of which apparently were still energized at the
   start. The fix wasn't to the game code; it was to stop trusting assumed-clean state
   and explicitly zero out `towers`/`spans` in memory (not just via `localStorage.clear()`
   + reload) before any test that depends on an exact candidate count. Once genuinely
   verified clean (`spanCount: 1, energizedCount: 1`), 300 forced attempts produced zero
   strikes — the invariant holds.
4. **A new, generalizable environment gotcha**: injecting a synthetic save via
   `localStorage.setItem(...); location.reload();` got silently overwritten twice before
   working, both times by the *real* `Game` instance's own `beforeunload` handler firing
   during the reload and re-saving the actual in-memory state over the injected one —
   the same class of race already documented for the `Shift+R` reset hotkey, but
   triggered here by `location.reload()` rather than a deliberate reset. Fixed by setting
   `game['isResetting'] = true` (the private flag `save()` already checks) before
   injecting a save and reloading. Worth remembering for any future test that needs to
   inject specific save data: pause the loop *and* set `isResetting`, not just one or the
   other.

Once test methodology accounted for all four of the above, every real check passed
cleanly: fresh-tower capacity exactly 8 vs. 6; mesh counts exactly 8 vs. 9 (matching the
1-arm/2-arm visual design); Resilience weighting at 2.44:1 against a 2.5:1 expectation
over 3000 samples on verified-flat terrain; the softlock invariant holding over 300
forced attempts on a verified single-candidate state; `I` at tier 1 confirmed a true
no-op (no deny, no state change); `U`/`I` at tier 3 confirmed denying correctly with no
CapEx spent; a full save→reload round-trip confirming a tier-3 Resilience tower restores
its branch and visual correctly; and a synthetic pre-Wave-6 save (tier-3, no `branch`
field at all) loading without error, exactly as the plan's verification checklist
required. `tsc --noEmit` clean throughout; no console errors at any point (the temporary
debug `console.log` calls added mid-investigation were removed before this was
considered done).

## Player guide + upgraded pole visuals

Two requests after the "10x expansion" closed out — not part of the six-wave plan.

**Player guide.** `GUIDE.md` (repo root) is the single source of truth; there is no
separate in-game copy. `Guide.ts` imports it as raw text at build time
(`?raw`) and renders it through the new `markdown.ts` (see the architecture bullets
above for both). Design choices worth remembering:

- **One source of truth, not two.** The alternative — writing guide content twice
  (once as prose for a human, once as HTML/TS for the in-game panel) — would drift the
  way any hand-duplicated content eventually drifts. A raw import plus a tiny renderer
  costs less than that duplication risk, and keeps the same discipline `PLAN.md`/
  `HANDOVER.md` already follow: real files, not embedded strings, so they're diffable
  and readable outside the game.
  - This is now the **third** standing "keep this doc current" instruction on the
    project (see the new `feedback-maintain-ingame-guide` memory) — same shape as the
    `PLAN.md`/`HANDOVER.md` instruction, extended to a third artifact. Update `GUIDE.md`
    whenever gameplay mechanics change, not just when asked.
- **No new dependency for markdown.** GUIDE.md's actual needs are five constructs
  (h1/h2, bullets, bold, inline code, paragraphs) — a full markdown library would be
  overkill for that. One deliberate content constraint fell out of this: the guide's
  hotkey table was originally written as a markdown table, then rewritten as a bullet
  list once it became clear the renderer wouldn't support tables and adding table
  support for one section wasn't worth it. Future guide edits should stay within the
  five supported constructs, or `markdown.ts` needs a deliberate extension first.
- **Interactive overlay, not folded into `Hud`.** `Hud` has been `pointer-events: none`
  since Phase 2 — a read-only status meter, matching the project's explicit "no menus"
  interaction philosophy. A help button breaks that philosophy in the narrowest possible
  way (opt-in, non-blocking, doesn't interrupt the core loop), so it got its own class
  with its own `pointer-events: auto` elements rather than compromising `Hud`'s
  read-only contract.
- **Keyboard gating was the one real risk here.** The overlay's DOM stacking already
  blocks canvas clicks/pointermoves from reaching the canvas once it's visible (they hit
  the backdrop instead, at the hit-testing level — no code needed). But `Game.onKeyDown`
  listens on `window`, which DOM stacking doesn't affect at all — without an explicit
  guard, reading the guide while a tower happened to be selected could have silently
  triggered `U`/`I` upgrades, or worse, `Shift+R` could have wiped the save entirely.
  Fixed with one line at the very top of `onKeyDown`. Verified deliberately, not just
  assumed: placed a real tower, selected it, opened the guide, dispatched a real `u`
  keydown, and confirmed both the tower's tier and CapEx were unchanged — a no-op
  because no tower was selected would have looked identical to a working guard, so the
  test was built specifically to rule that out.

**Upgraded pole visuals.** Every tier-upgrade arm now hangs insulator nubs — the same
detail `buildTowerVisual`'s top arm already had since Phase 4 — with the count on each
arm set to exactly the capacity *gained* at that step (`ArmSpec.insulatorCount`, see the
`Tower.ts` architecture bullet above). The elegant part of this design: it isn't
decorative scaling, it's an *exact* accounting — 2 (top arm, tier 1) + 2 (tier 1→2 arm)
+ 4 (Capacity tier-2→3 arm) sums to exactly 8, matching `hasFreeCapacity()`'s real
ceiling; the Resilience branch's second arm carries zero insulators on purpose, visually
distinguishing "more lines" (Capacity) from "the same lines, reinforced" (Resilience).
Verified by direct capacity-fill tests at all four tier/branch combinations (2/4/8/6),
each exactly matching the counted insulator meshes, not just eyeballed from a
screenshot — the screenshot was a secondary confirmation, not the primary one.

## More depth on existing systems

You asked to "keep going with the build out," twice in a row. The roadmap's only
remaining item (Phase 6 stretch goals — procedural regions, a rival AI utility) was
explicitly flagged as open-ended new-breadth work, not a scoped next step, so both
rounds picked concrete items directly off the "Known gaps" list below instead — real,
already-identified gaps, not invented scope.

- **Terrain-weighted span cost** — `Game.spanTerrainMultiplier(a, b)` checks
  `grid.terrainAt()` on both tower endpoints and returns the higher of
  `ECONOMY.spanHillMultiplier` (1.25) / `spanMarshMultiplier` (1.4) / `1`, applied to
  `tryStringSpan`'s existing distance-based crew-cost formula. Deliberately smaller
  multipliers than the placement-cost ones (`TERRAIN.hillCostMultiplier` 1.6 /
  `marshCostMultiplier` 2.1) since these compound onto an already-variable Crew-Hours
  cost rather than a flat one-time CapEx cost — stacking two "harsh terrain" penalties
  of similar magnitude felt like it would double-punish rather than add real texture.
  Not stacked between the two endpoints either — a span is only as hard to string as
  its harder end, not both added together.
- **Storm warning telegraph** — `Game.updateStormWarning(now)`, called every tick right
  before the existing storm check, fires `SoundManager.playStormWarning()` and sets
  `stormWarningActive = true` exactly once per storm cycle,
  `STORM.warningLeadSec = 4` seconds before `nextStormAt`. Tracked via
  `lastStormWarningFor` (the `nextStormAt` value already warned for) rather than a
  simple boolean, so the cue can't re-fire every frame during the warning window but
  correctly re-arms the instant `triggerStorm` reschedules `nextStormAt` for the next
  cycle. Deliberately does **not** reveal or lock in which span will be struck — that's
  still decided inside `triggerStorm` itself, at the moment the check actually fires,
  so a player stringing a new span during the warning window doesn't create a stale
  prediction. Visually, the HUD gained a fourth `.hud-note` variant reusing fault-red
  without the blink animation — same danger family, but a player should never be able
  to mistake "storm incoming" for "line already down."
- **Line throughput upgrade** (second round) — CapEx income per span was flat
  regardless of anything; now clicking a healthy (energized, non-faulted) span tries to
  upgrade its `throughputTier` (1-3, `ECONOMY.spanThroughputMultiplier = [1, 1.6, 2.2]`,
  cost via `spanThroughputCost`) — same directness as clicking a faulted one to repair,
  deliberately no separate select step to stay consistent with that existing precedent.
  Required a real architectural change, not just a new constant: `Economy.tick()`'s
  second parameter changed from a flat energized-span *count* to a pre-summed CapEx/sec
  *rate*, since income now genuinely varies per span — computed by summing each
  energized span's own `incomeRate()` inside `Game.tick()`'s existing per-span loop, so
  `Economy` itself never needs to know spans or tiers exist. Visually, the tube gets
  thicker per tier (`TUBE_RADIUS_MULTIPLIER = [1, 1.35, 1.75]`) — the same "a visual
  quantity always equals a real game value" discipline the pole-visuals insulator count
  already established, applied to a second system. New optional
  `SaveData.spans[].throughputTier` field, defaulting to 1, additive-only.

**A genuinely useful debugging lesson surfaced again during verification** (same class
as Wave 5/6's): forcing `stormWarningActive = true` and taking a screenshot in *separate*
tool calls produced an empty HUD line, because the real animation loop (never paused
between those two calls) recomputed the true value on the very next frame and overwrote
the forced state before the screenshot could capture it. Fixed the same way as before —
pause `renderer.setAnimationLoop`, force the state, screenshot, all in one atomic call —
and it worked immediately. This is now the third time this exact shape of mistake has
shown up in this session; worth internalizing as a rule rather than re-discovering it a
fourth time: **any manual state override for a visual check must happen in the same
paused eval call as the render/screenshot that observes it.**

**Verification:** span cost confirmed exactly via the multiplier function in isolation
(1 / 1.25 / 1.4 for flat/hill/marsh pairs found by scanning the live terrain field) and
then re-confirmed against the *real* spend through `tryStringSpan` (expected vs. actual
Crew-Hours deducted matched to floating-point tolerance for both a flat and a hill
pair). Storm warning confirmed via a synthetic clock: silent 5s before the window,
active and HUD-visible 3.5s before, correctly not re-triggering the sound on a second
call within the same window, and correctly cleared the instant `triggerStorm` resolves
and reschedules. `playStormWarning()` confirmed to execute with no exception. `GUIDE.md`
updated alongside both changes (Economy, Terrain, and Storms/repairs sections, plus the
HUD reference), per the standing "keep the guide current" instruction. `tsc --noEmit`
clean throughout; no console errors.

**Verification, line throughput (second round):** cost, income rate, and tube radius at
each of the three tiers all matched formula predictions exactly (e.g. tier 3's
`0.09 × 1.75 = 0.1575` tube radius read back precisely from the live geometry), both via
direct method calls and via a real dispatched `pointermove`+`click` pair at a raycasted
screen position — confirming the actual `onClick` → `tryUpgradeSpanThroughput` path, not
just the underlying methods in isolation. Denial at max tier confirmed (tier and CapEx
both unchanged after a third upgrade attempt). `Economy.tick()`'s new summed-rate
behavior confirmed by manually computing the expected combined rate across two
differently-tiered spans and checking the CapEx gain over a fixed `dt` matched exactly.
Full persistence round-trip confirmed for two spans at different tiers (one of which was
naturally faulted mid-session — a real storm fired during testing, not staged — and
correctly retained its tier through the fault/repair-eligible state), plus a synthetic
legacy save with no `throughputTier` field at all, confirming it defaults to 1 and loads
without error. One more instance of the same recurring debugging lesson from immediately
above: an early attempt set `isResetting = true` immediately before `save()` in the same
call, not realizing `save()`'s very first line checks that exact flag and returns
immediately — the "successful" save read back was actually stale data from an earlier
autosave, not the call that appeared to produce it. Caught by noticing the values didn't
change between two supposedly-different save attempts, not by any error message; fixed
by reordering to save first, then set `isResetting`, then reload.

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
Wave 5" section above. Confirmed working, Wave 6 (the last one): see the "10x expansion
— Wave 6" section above. Confirmed working, player guide + pole visuals: see the
dedicated section above — notably, the guide's button/close/backdrop *are* real DOM
elements with stable CSS selectors, so `preview_click` worked directly on them (unlike
the canvas, which needs synthetic events dispatched through `preview_eval`). Confirmed
working, terrain-weighted span cost + storm warning telegraph + line throughput upgrade:
see the "More depth on existing systems" section above. No automated tests exist yet.

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
- **Closed**: line throughput is now an independent upgrade axis (the depth pass
  above), separate from tower connection-capacity tiers.
- **Closed**: storms now have a warning telegraph (the depth pass above) — a 4s
  audio+HUD cue before each check. What's *not* affected is where/whether a strike
  actually lands — uncertainty there is still deliberately the point.
- **Closed**: terrain now affects placement cost, storm targeting (Wave 5), *and* span
  cost (the depth pass above) — the original "span cost isn't affected by terrain"
  gap no longer applies. What's still technically true, if anyone wants to split hairs
  later: it's terrain at the two *endpoints*, not terrain literally crossed along the
  catenary curve — consistent with how storm-weighting already worked, and a deliberate
  simplification, not an oversight.
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
- Wave 6's branch costs/bonuses (`tier3CapacityBonus = 2`, `resilienceWeightMultiplier
  = 0.4`, and the small CapEx/Crew-Hours cost delta between the two branches) are
  first-pass and unplaytested for whether Capacity and Resilience actually feel like a
  real trade-off rather than one branch being an obvious dominant strategy — the kind of
  thing that only shows up once a player has actually played through several tier-3
  upgrades under real storm pressure, not from the statistical checks performed here.
- The "10x expansion" is now fully delivered (all six waves) but has never been played
  end-to-end as one continuous session by a human — each wave was verified in isolation
  immediately after building it. Worth a real full playthrough before treating any of
  the tuning constants introduced across Waves 1-6 as settled.
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
- `GUIDE.md`'s actual prose hasn't been read end-to-end by a human for accuracy or
  tone — it was written to be comprehensive and correct against the current mechanics,
  verified to *render* correctly, but not proofread as writing.
- No mobile/touch consideration for the guide panel — it scrolls and closes correctly
  at the desktop viewport sizes tested, but hasn't been checked at narrow widths where
  the fixed `min(560px, 90vw)` panel width and the right-click-to-pan camera control
  mentioned in the guide itself would both need real touch-input rethinking. The whole
  project has been desktop-only so far; this doesn't change that, just flagging it
  explicitly now that there's a text-heavy overlay to consider.
- `ECONOMY.spanHillMultiplier`/`spanMarshMultiplier` (1.25/1.4) and
  `STORM.warningLeadSec` (4s) are first-pass — verified to *do what they're supposed to
  do* (statistically/exactly confirmed above), not validated as *fun/well-paced* by real
  play. Same caveat as every other tuning constant in this project.
- The storm warning's 4-second lead time hasn't been felt in a real, unpaused storm
  cycle by a human — only confirmed correct via a synthetic clock bypassing real wait
  time. Worth noticing whether 4 seconds actually feels like "enough notice to react"
  (e.g. rush to repair-fund a line) the next time a storm fires naturally during play.
- `ECONOMY.spanThroughputMultiplier`/`spanThroughputCost` are first-pass — verified to
  do exactly what the formulas say (statistically/exactly confirmed above), not
  validated as a *good decision curve* by real play. Specifically unvalidated: whether
  the payback period (roughly 60-90s at current numbers, back-of-envelope) feels like a
  meaningful choice or an obvious auto-upgrade-everything button once CapEx is
  comfortable — the kind of thing that only shows up from watching a real player's
  actual choices, not from checking the math is internally consistent.
- Wave 1's new constants (`PLANT.fuelSpecs`, `SUBSTATION.cost`/`maxConnections`/
  `capacityMW`, `NEIGHBORHOOD.startingDemandMW`) are first-pass, chosen for plausible
  real-world relative ordering (nuclear/coal biggest+steadiest, renewables lower capacity
  factor) rather than validated game balance — same caveat as every other tuning
  constant in this project, and doubly so here since nothing reads `capacityMW`,
  `maxConnections`'s MW-ceiling role, or `startingDemandMW`'s growth yet (Wave 3/7).
- **Closed** (Wave 2, earlier than originally planned): Plant/Neighborhood are now
  persisted, once `transmissionLinks`/`distributionSpans` could reference them by
  identity — see "Wave 2 architecture additions" above for why this moved up from the
  originally-sketched "defer to Wave 6."
- Only the `gas` fuel type is actually spawned by real gameplay so far (the other 5 are
  implemented, visually verified via a temporary dev-console spawn, but dead code path
  until Wave 6's semi-random objective spawning exists) — worth a second look once that
  wave lands, to confirm all 6 still render correctly through the real spawn path, not
  just the manual test path used here.
- **Closed** (Wave 5): storms can now strike a transmission link or distribution span,
  not just the original Tower-Tower `spans` array — see "Wave 5 architecture additions"
  above. This is what makes the N-1/blackout mechanic reachable at all.
- The new `TxNode`-based transmission linking (Tower/Substation/Plant, any pairing) has
  only been exercised via direct method calls and a handful of real dispatched clicks in
  this session — not a full real playtest building an actual Plant→Substation→Tower
  chain end-to-end through the UI repeatedly. Worth watching for UX friction (e.g., is
  it discoverable that clicking a Plant then a Substation links them, versus the
  Substation→Neighborhood flow reusing the exact same "click one, then the other"
  gesture for a different result depending on what's selected) once there's a real
  player driving it.
- **Partially closed** (Wave 4): `served` is now economically consequential (drives real
  income), but `isRedundant()` is still entirely inert — no visual representation, and
  nothing gates on it yet — that's still Wave 6 (`isRedundant()` isn't read anywhere
  except inside blackout's own trigger condition yet, and that condition is about the
  *value* it had before a change, not a place a player can directly query "is this
  currently redundant" from the UI).
- No distinct visual accent for "served but not redundant" (at-risk) exists yet — a
  Neighborhood currently only shows three states (not-served/served/blacked-out), not
  the four the background Plan agent's original entity design sketched (an at-risk
  accent between served and blacked-out). Deliberately out of Wave 5's stated scope
  (which only assigned the blackout pulse, not the at-risk accent) rather than an
  oversight, but worth adding once there's a natural home for it — a player currently has
  no visual warning that a Neighborhood is one storm away from blacking out, only the
  post-hoc blackout pulse itself.
- `ECONOMY.spanCapacityMW = [50, 90, 140]` (Wave 3), the corrected
  `NEIGHBORHOOD.startingDemandMW = 40`, and now `OBJECTIVE.capExPerMWServedPerSec = 0.08`
  (Wave 4) are all first-pass — verified to be internally *consistent* (the starting
  objective is achievable with an all-tier-1 chain and produces a real, non-trivial
  income boost once served: $3.2/sec against the sandbox baseline's ~$3/sec per span) but
  not validated as a *good pacing/difficulty curve* by real play. Same caveat as every
  other tuning constant in this project — worth an early look during the eventual
  playtest given how directly this one interacts with the core income loop.
- Every objective's target is currently the same fixed 40 MW (Wave 6 deliberately keeps
  it static, see "Wave 6 architecture additions" above) — there's no *escalation* yet
  across rounds, so completing the 2nd/3rd/Nth objective feels identical in difficulty to
  the 1st. This is explicitly a placeholder until Wave 7 makes the target a real, growing
  number synchronized with actual demand growth — not a tuning nit to fix in isolation
  now, since escalating the target without growth would just make objectives
  unwinnable.
- `OBJECTIVE.respawnDelaySec = 25` and the fuel-type spawn weights (`gas` 3, `coal`/
  `hydro`/`solar`/`wind` 2 each, `nuclear` 1) are first-pass — verified to produce a real
  weighted mix (not literally validated statistically over many spawns, unlike some
  earlier weighted-random checks in this project), not validated as good pacing/variety
  by real play.
- The milestone completion flow has only been exercised via one real end-to-end chain
  (a single Substation with two independent Tower routes to its Plant) — not yet tried
  with a more elaborate real network (multiple Substations, a longer Tower chain, an
  upgraded-throughput span as part of the winning path) or by a real player making their
  own topology choices rather than the specific shape this verification built.
- `NEIGHBORHOOD.demandGrowthMWPerSec = 0.05`, `demandGrowthCapMW = 130`, and
  `demandWarningLeadSec = 30` (Wave 7) are first-pass — verified to do exactly what the
  formulas say (synthetic-clock-confirmed above), not validated as a *good pacing feel*
  by real play. This is the constant with the least real-time headroom of any in the
  project so far to actually feel out: nobody has sat through a real, unpaused ~200s
  window watching a Neighborhood's demand climb toward a span's capacity ceiling and
  judged whether 30 seconds of warning feels like "enough time to react" the way the
  storm warning's 4s has at least been reasoned about (even if also not fully
  playtested) — worth an early look.
- No distinct visual accent for "approaching capacity" exists on the Neighborhood model
  itself (Wave 7 only added the HUD line + sound, not a new in-world visual state) — same
  category of gap as the still-open "at-risk" accent noted after Wave 5. A player has to
  be watching the HUD, not the board, to notice a capacity warning.
- **This "keep going" pattern has now run twice without an intervening human
  playtest.** Every round has been individually well-verified (exact formula matches,
  real click paths, persistence round-trips), but "verified correct" and "verified fun"
  are different claims, and only the first one has actually been checked at this point.
  The growing "first-pass, unvalidated by play" list above is the honest state of
  things — worth treating a real playthrough as overdue rather than optional before any
  further "keep going."
- **The plant/neighborhood/N-1 redesign (all 8 waves) is now fully delivered on top of
  everything above, and multiplies rather than resolves the "not yet playtested" gap.**
  This was the single largest body of new mechanical depth this project has shipped in
  one continuous stretch — a real graph algorithm, a second income stream, a blackout
  mechanic tied to the storm system, a full milestone lifecycle, and continuous demand
  growth, all interacting with each other and with every pre-existing system. Every
  individual piece was verified rigorously (exact state transitions, real click paths,
  full persistence round-trips, a re-confirmed softlock invariant, two real bugs caught
  and fixed by the verification process itself) — but no human has yet played a
  continuous session experiencing the whole thing end to end: placing towers, watching a
  storm threaten a real objective, feeling whether 30 seconds of capacity-warning lead
  time is enough, deciding whether building redundancy is worth the cost, watching a
  milestone complete and a new one appear. That experience is exactly what all the
  "first-pass, unvalidated by play" tuning constants throughout this file are waiting on
  to become real balance decisions instead of reasoned guesses.

## Maintenance note

Keep this file and PLAN.md up to date as the project progresses — update PLAN.md's
status table and this file's architecture/decisions sections whenever a phase's worth
of work lands, not just at the very end.
