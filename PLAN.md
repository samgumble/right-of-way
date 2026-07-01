# Right of Way (working title) — Plan

2.5D transmission-line grid builder. Warcraft 3's resource/build/upgrade cadence +
Power Grid's network expansion, isometric utility-sandbox presentation.

Standalone project — separate from the GTA-style Three.js/Rapier construction sandbox.

## Stack

Three.js + OrthographicCamera (true 2.5D isometric), Vite, TypeScript. No backend, no
auth, no payments — single-player, fully client-side, state saved to localStorage
(autosave, see Persistence scope below). No physics engine; conductor sag is a
hand-written catenary function, not Rapier.

## Visual direction

- Reference: real utility SCADA control-room dashboards + engineering blueprint
  drafting, not generic game UI.
- Colors: `#111820` charcoal-navy (background), `#3E6E8E` steel blue (grid/schematic
  lines, idle towers/lines), `#E8720C` safety orange (active/selected), `#4C9A6E`
  energized green (live lines), `#C0453A` fault red (storm-struck spans, in use since
  Phase 3). Terrain uses tinted variants of the steel-blue family (`#4A7691` hill,
  `#0A141D` water) rather than new hues — shading on a blueprint, not a literal map.
- Type: JetBrains Mono for HUD numbers and labels (loaded via Google Fonts, in use since
  Phase 2's resource readout). Space Grotesk or IBM Plex Sans for prose labels — still
  not in use, no prose text on screen yet.
- Geometry: simple low-poly primitives (boxes, cylinders) for towers and terrain, same
  approach as the excavator/bulldozer sims. No external 3D models. Terrain uses a
  hand-written layered-sine noise field (no external noise library), same "hand-write
  the math" precedent as the catenary function.

## Roadmap

| Phase | Description | Status |
|---|---|---|
| 0 | Concept locked | Done |
| 1 | Core loop vertical slice | **Done** — see [HANDOVER.md](HANDOVER.md) |
| 2 | Economy: CapEx + Crew-Hours resources, upgrade tiers | **Done** — see [HANDOVER.md](HANDOVER.md) |
| — | localStorage persistence (out-of-roadmap, done between Phase 2 and 3) | **Done** — see [HANDOVER.md](HANDOVER.md) |
| 3 | Map & pacing: terrain, storms, permitting | **Done** — see [HANDOVER.md](HANDOVER.md) |
| 4 | Visual/UI polish, HUD, onboarding | **Done** — see [HANDOVER.md](HANDOVER.md) |
| — | "10x expansion" (out-of-roadmap, six-wave plan) | **Done** — all 6 waves, see below |
| 5 | Deploy to hosting | **Done** — GitHub Pages, see below (superseded the original "Cloudflare Pages" placeholder) |
| — | Player guide (in-game) + upgraded pole visuals (out-of-roadmap) | **Done** — see below |
| — | More depth: span terrain cost, storm warning, line throughput (out-of-roadmap) | **Done** — see below |
| — | Camera rotation hotkey (out-of-roadmap) | **Done** — see below |
| — | Plant/Substation/Neighborhood redesign — real purpose/win condition (out-of-roadmap) | **In progress** — plan drafted, see "Up next" below |
| 6 | Stretch: procedural regions, rival AI utility | Not started (audio and upgrade branching were pulled into the 10x expansion; procedural regions/rival AI remain open stretch goals) |

## Phase 1 scope (delivered)

1. Scaffold Vite + TypeScript + Three.js, orthographic camera, a flat ground plane.
2. Click to place a tower on a grid.
3. Select two placed towers to string a span between them, rendered as a real
   catenary sag curve, not a straight line.
4. Span energizes on completion — the line visibly lights up.
5. Nothing else — no resources, no cost, no menus, no terrain variation. Goal: place →
   place → string → energize feels satisfying within 30 seconds.

Decisions locked in for Phase 1 (carry forward unless a later phase overrides them):
pan + zoom camera (no rotation), context-sensitive click model (no explicit place/string
mode toggle), bounded 20×20 grid with visible overlay. Full rationale in HANDOVER.md.

## Phase 2 scope (delivered)

1. CapEx (capital) accrues passively from every energized span, at a fixed rate per
   span per second — ties the economy directly to the Phase 1 core loop instead of a
   separate income mechanic.
2. Crew-Hours (labor) regenerates on a fixed timer up to a capped pool, independent of
   CapEx — a pacing throttle distinct from money.
3. Placing a tower costs CapEx (flat). Stringing a span costs Crew-Hours, scaled by the
   span's real-world distance (longer spans cost more labor).
4. Towers have upgrade tiers (1–3) raising their span-connection capacity. Select a
   tower and press `U` to upgrade it, if affordable — no menu, matches the "no menus"
   interaction language from Phase 1.
5. A minimal SCADA-style corner readout (CapEx / Crew-Hours, JetBrains Mono) plus a
   contextual one-line hint when a tower is selected — the first HUD element in the
   project, deliberately kept to a meter, not a panel of controls.
6. Insufficient funds / capacity give shake feedback (motion, not a new color) rather
   than reusing fault-red, which stays reserved for storms in Phase 3.

Decisions locked in for Phase 2 (see HANDOVER.md for full rationale): income tied to
energized-span count rather than a flat timer; Crew-Hours as a capped regenerating pool
rather than a purchasable resource; upgrades apply to tower capacity, not line
throughput; upgrade triggered by keyboard while a tower is selected, not a UI button.

## Persistence scope (delivered)

Not a numbered roadmap phase — picked up between Phase 2 and 3 once real economy/tier
state made "everything resets on reload" a genuine gap rather than a deferred nice-to-have.

1. Autosave to `localStorage`: immediately after every discrete action (place tower,
   string span, upgrade tower), on a 3-second throttle for the continuous CapEx/Crew-Hours
   ticking, and as a safety net on `visibilitychange`/`beforeunload`.
2. On load, towers/spans/economy/camera restore instantly — no replaying spawn,
   stringing, or energize animations, since a restore isn't a new placement.
3. A reset hotkey (`Shift+R`) wipes the save and reloads to a fresh game, per your call
   to add one now rather than relying on devtools during balance iteration.
4. Save data is validated on load (grid coordinates, tiers) — malformed/out-of-range
   entries are silently dropped rather than crashing or corrupting the scene.

Full rationale, the two bugs this work surfaced (a `NaN`-coordinate corruption path and
a reload/autosave race that could silently undo the reset hotkey), and their fixes are
in HANDOVER.md — worth reading before touching `Game.ts`'s save/load/reset paths again.

## Phase 3 scope (partially delivered)

Scoped via an explicit ambiguity check before implementation — the roadmap only named
"terrain, storms, permitting" with no detail. All three answers were the recommended
option: terrain affects cost/placement (not decorative), storms are a real fault/repair
mechanic (not atmospheric-only), and permitting is deferred to a later pass.

1. **Terrain.** Each grid node is classified `flat` / `hill` / `water` via a fixed,
   deterministic noise field (no seed — regenerates identically every load, so nothing
   about terrain needs to be persisted). Hills cost 1.6× CapEx to build a tower on;
   water is unbuildable entirely. Rendered as tinted ground patches in the steel-blue
   family, not new map-style colors.
2. **Storms.** A periodic timer (every 22–40s, randomized) strikes a random *energized*
   span, putting it in a faulted state (fault-red, blinking alarm pulse, a bright
   strike-flash on impact) that stops it generating CapEx income. Click a faulted span
   to repair it for a flat CapEx + Crew-Hours cost — reuses and extends the click
   raycasting/HUD-context patterns from Phase 2's tower selection. Fault state persists
   across reloads.
3. **Permitting.** Delivered after the economy balance revisit, in a follow-up pass.
   Every new tower spends 10 real seconds in a pending state (a distinct pulsing
   translucent look) before it can be selected or wired into a span — clicking a
   pending tower shakes it (denied) rather than selecting it. Purely a placement-side
   friction, universal (every tower, no zone exceptions), gated on real elapsed time
   rather than cost. Remaining pending time persists across reloads.

Full architecture, decisions, and a debugging note about a testing-tool artifact that
looked like a click-precision bug but wasn't, are in HANDOVER.md.

## Economy balance revisit (delivered)

Not a numbered phase — you asked to revisit balance now that terrain cost and storm
repair interact with the Phase 2 numbers, before finishing Phase 3 with permitting.

Paper analysis (income timeline, not a numeric tuning pass) surfaced one real
**softlock**, not just a feel issue: `Economy` only earns CapEx from energized spans,
and storms could fault *any* energized span including a player's only one. If that
happened while CapEx was near zero (very plausible early on, since starting funds get
spent fast on expansion), income would drop to exactly zero with no way to ever recover
— repairing itself costs CapEx that could no longer be earned. Fixed structurally, not
by retuning numbers: storms now only strike when at least 2 spans are energized
(`STORM.minEnergizedSpansToStrike`), so a strike can never zero out the whole network,
plus a 60-second grace period (`STORM.firstStrikeDelaySec`) before any storm can occur
at all, giving a new player room to establish that safety margin first. All other
numbers (repair cost, hill multiplier, starting resources, storm interval) were
reviewed and left as-is — reasoning in HANDOVER.md. Verified via the real
`triggerStorm` code path: a lone energized span survives a forced storm attempt
untouched; the grace period timer holds for a fresh game.

## Phase 4 scope (delivered)

Scoped via an explicit ambiguity check — "visual/UI polish, HUD, onboarding" was even
vaguer than Phase 3's "terrain, storms, permitting." Direction locked in: onboarding
stays in-world/minimal (no tutorial overlay, no modal — matches "no menus"); visual
polish covers lighting/glow, camera feel, and HUD typography, plus a modest geometry
detail pass; the HUD gets refined, not expanded with new info.

1. **Bloom post-processing** — `EffectComposer` + `UnrealBloomPass` + `OutputPass`, so
   energized-green, selected-orange, and fault-red emissive elements actually glow
   against the dark background, matching the "control-room instrument glow" the SCADA
   reference implies. No new dependency — bundled in `three/addons/postprocessing/*`.
2. **Camera zoom easing** — scroll-wheel zoom now eases toward a target instead of
   snapping instantly (`CameraRig.update()`, called every tick). Pan stays direct/1:1
   on purpose — easing an active drag would feel laggy, not smooth.
3. **HUD refinement** — the fault/context/hint status lines were unified under one
   shared `.hud-note` base style (previously near-duplicated per-variant CSS) with
   color-only modifiers, plus in-world **onboarding hints**: derived (not persisted)
   text guiding the first few actions — "place a tower," "place a second," "string a
   span" — that stops matching and disappears forever once the core loop is learned.
4. **Geometry detail pass** — small insulator-string details at the tower cross-arm
   tips (where a real conductor would attach), and deterministic per-instance
   rotation/scale jitter on terrain patches so hill/water read as organic shapes
   rather than a grid of identical stamped circles.

Full rationale and verification notes in HANDOVER.md — including a lesson on this
environment's `requestAnimationFrame` throttling between tool calls (wall-clock `sleep`
doesn't reliably advance in-game time; forcing a repaint via a screenshot does).

## "10x expansion" (delivered — all six waves)

Not a numbered roadmap phase — you asked to "10x the graphics and mechanics," a
deliberately large, open-ended request. Direction was confirmed explicitly before any
design work (see HANDOVER.md for the full reasoning): graphics go **deeper within** the
established SCADA/blueprint low-poly style, not a stylistic pivot; mechanics **deepen
existing systems** (economy, terrain, storms, upgrades), not new breadth (no new
building types, rival AI, or multiplayer this round); the work ships in **six staged
waves with checkpoints**; **audio** — genuinely untouched territory — is included,
pulled forward from the Phase 6 stretch list. The full plan (wave-by-wave breakdown,
technical design for the two new-territory pieces — audio and particles — and the
economy/upgrade-tree specifics) is preserved in HANDOVER.md's "10x expansion" section.

**Wave 1 — Audio foundation: delivered.** New `SoundManager.ts`, procedural Web Audio
(oscillators + filtered noise, no audio asset files — extends the "hand-write the math"
precedent from the catenary solver and terrain noise into a new domain). Every existing
interaction now has a sound: place, permit-clear, select, deny (shared across every
denial reason), energize, storm-strike (plus a bounded ambience swell), repair, upgrade,
and an aggregate fault alarm tick (one shared tick regardless of how many spans are
faulted, not one per span). `Tower.update()`/`Span.update()` now return a small
event-union type so `Game.tick()` can detect phase transitions (permit-clear,
energize-complete) it previously couldn't see mid-call — a small, additive,
non-breaking signature change to two already-well-understood methods.

**Wave 2 — Lighting, materials & atmosphere depth: delivered.** `Tower`/`Grid` materials
upgraded from `MeshLambertMaterial` to `MeshStandardMaterial` (matching `Span`'s
material already) so directional lighting produces real specular response instead of
flat diffuse shading. `scene.fog` added, tuned so only the board's far corners fade —
the whole 120×120 grid stays readable at any zoom. A slow (8-minute) day/night cycle
animates the existing ambient/key lights' intensity and color, ping-ponging the ambient
light's color between two colors already in the palette (`ambientLight` / `steelBlueDim`)
rather than introducing a new hue. Real shadow mapping shipped (not the blob-shadow
fallback) — `VSMShadowMap` (the current soft-shadow type; `PCFSoftShadowMap` is
deprecated in the installed three.js version), a shadow-camera frustum sized to the
full static board regardless of camera pan/zoom, and a stress test placing a tower so
its shadow falls directly across a hill patch, which rendered clean with no acne or
z-fighting. A restrained vignette (`VignetteShader`) was added last, after finding and
fixing a real bug — see HANDOVER.md's Wave 2 section for the color-space explanation.

Waves 3–6 (particles/weather, terrain depth, economy depth, upgrade branching) are
planned but not yet built — see HANDOVER.md for the full per-wave breakdown before
starting the next one.

**Wave 3 — Particle & weather effects: delivered.** Three effects, three techniques, per
the plan. **Rain**: an `InstancedMesh` of 220 thin tilted streaks, a bounded ~5.5s weather
event tied to an actual storm strike (not persistent, not ambient) — same "bounded swell,
not a state machine" shape as Wave 1's audio ambience, and timed to roughly match its
5s duration. Wind is one fixed drift constant (not randomized per storm), baked into a
single precomputed tilt quaternion shared by every particle. **Placement dust / fault
sparks**: a new `ParticleBurst.ts` (short one-shot outward-radiating bursts, own class per
event, self-pruning once its duration elapses) — steel-blue dust at a tower's base on
placement and on permit-clear, hot red sparks at a faulted span's midpoint (`Span` gained
a `midpoint()` accessor for this, without exposing its internal points array). Everything
hooks the existing storm timer and Wave 1's `update()`-return-value protocol — no new
timer or parallel state machine. Verified live: a real click-driven placement (not just
direct method calls) correctly fires a dust burst through the actual `onClick` path, and
the storm softlock-prevention invariant (`STORM.minEnergizedSpansToStrike`) was
regression-checked and still holds with the new spark/rain wiring in `triggerStorm()`.

Waves 4–6 (terrain depth, economy depth, upgrade branching) are planned but not yet
built — see HANDOVER.md for the full per-wave breakdown before starting the next one.

**Wave 4 — Terrain & environment depth: delivered.** One new terrain type, **marsh** —
via the exact same `terrainAt`/`InstancedMesh`-patch pattern already in `Grid.ts`, reused
not reinvented. Sits at the noise band just above `TERRAIN.waterThreshold` (before it
rises into `flat`), so it renders geographically adjacent to water bodies — buildable
(unlike water) but costs 2.1× (steeper than a hill's 1.6×), representing soft/unstable
ground. Visually a distinct dark teal-grey tint, still within the existing cool
steel-blue palette discipline rather than a new hue family. On the current board this
produces a healthy mix (258 flat / 71 water / 61 marsh / 51 hill nodes out of 441) —
present but not dominant. This also sets up (does not yet implement — that's Wave 5)
terrain influencing storm-target *selection*: no new plumbing was needed, since
`Grid.terrainAt()` is already public and queryable per-span by its two tower endpoints;
Wave 5 just needs to read it.

Waves 5–6 (economy depth, upgrade branching) are planned but not yet built — see
HANDOVER.md for the full per-wave breakdown before starting the next one.

**Wave 5 — Economy depth: delivered.** All three items, exactly as scoped — pure
`constants.ts` + selection-math changes, zero `SaveData` schema impact.

1. **Repeat-construction cost curve** — `ECONOMY.towerCostGrowthPerTower = 0.06` adds
   mild linear growth per already-placed tower on top of the terrain multiplier (e.g.
   $80 base → $176 at 20 towers on flat ground). The two near-duplicated cost
   calculations in `onPointerMove`/`onClick` were also merged into one
   `computeTowerCost()` helper while making this change.
2. **Terrain-weighted storm targeting** — a span with at least one endpoint on Wave 4's
   marsh terrain is `STORM.marshWeightMultiplier = 2.5`× more likely to be picked as a
   storm's target than a span with none, via a new weighted-random selection
   (`pickWeightedStormTarget`) replacing the old uniform pick.
3. **Storm interval scaling** — both interval bounds shrink toward a hard
   `STORM.minIntervalFloorSec = 12` floor as the energized-span count grows (an
   exponential approach, not a subtraction, so the bounds can't cross or invert). Still
   strikes at most one span per storm — interval-only scaling, exactly as the plan
   required to avoid reopening the softlock the balance revisit fixed.

Verified live and statistically, not just read back from source: the cost curve at five
sampled tower counts; storm-target weighting via 2000 forced samples (2.64 observed
ratio against a 2.5 expected one); interval scaling at low and high energized-span
counts, including confirming it approaches but never crosses the 12s floor; and — the
non-negotiable one — 300 forced storm attempts against a single energized span with zero
strikes, confirming the softlock-prevention invariant holds under all the new wiring.

**Wave 6 — Upgrade tree branching: delivered. This completes the "10x expansion" —
all six waves are now done.** Tier 1→2 stays universal (`U`). At tier 2, the player
picks a branch: `U` continues to mean **Capacity** (extends `towerTierCapacity` by
`tier3CapacityBonus = 2`, so 8 connections instead of the flat 6), or the new `I` key
means **Resilience** (that tower's spans get their storm-target weight multiplied by
`STORM.resilienceWeightMultiplier = 0.4`, applied on top of Wave 5's marsh weighting,
not instead of it). No picker UI — `Game.updateHud()`'s existing single context string
just lists both options with their costs while a tier-2 tower is selected, same pattern
already used for every other upgrade-context line. Visually, Capacity gets one wide
cross-arm, Resilience gets two stacked ones — geometry-only differentiation, no new
colors, same discipline as terrain tints. Schema gained one optional field,
`towers[].branch?: 'capacity' | 'resilience'`, meaningful only at tier 3 and safely
absent on every pre-Wave-6 save — `SAVE_VERSION` stays at 1.

As the plan flagged in advance, `Tower.canUpgrade()`'s restructuring was the one
genuinely non-trivial piece — a new `Game.handleUpgradeKey()` now branches on tier to
decide what `U`/`I` actually do, rather than `canUpgrade()` alone being enough to gate
the single old `U` handler.

Verified thoroughly, including catching and correctly diagnosing several test-setup
false alarms along the way (none were real bugs — see HANDOVER.md's Wave 6 section for
the full account, including a `beforeunload`-save race very similar to the one already
documented for the reset hotkey): fresh-tower capacity confirmed exactly 8 (Capacity)
vs. 6 (Resilience); mesh counts confirmed 8 vs. 9 (matching the 1-arm vs. 2-arm visual
design); the Resilience storm-weight reduction confirmed at 2.44:1 (expected 2.5:1) over
3000 samples on verified-clean terrain; the softlock-prevention invariant re-confirmed
(300 forced attempts, zero strikes) on a verified single-energized-span state; a full
persistence round-trip (tier 3, Resilience branch) confirmed correct after a real page
reload; and — the specific case the plan called out — a synthetic pre-Wave-6 save (a
tier-3 tower with no `branch` field at all) loads without error, degrading gracefully to
a minimal visual rather than crashing.

## Phase 5 scope (delivered)

You asked to figure out storage/hosting. Save-data storage was already solved
(`localStorage`, client-side, no action needed — the game has no backend and no
cross-device sync requirement). Hosting was the open question: `PLAN.md` had
provisionally named Cloudflare Pages, but that was never confirmed with you directly,
and `gh` was already authenticated to your GitHub account with no Cloudflare CLI/config
present — so you picked **GitHub Pages** instead, on a public repo (private-repo Pages
needs a paid GitHub plan, and there's nothing sensitive in this repo).

1. Created [github.com/samgumble/right-of-way](https://github.com/samgumble/right-of-way)
   (public) and pushed the existing history to it.
2. `vite.config.ts` sets `base: '/right-of-way/'` only under CI (`GITHUB_ACTIONS` env var)
   — GitHub Pages project sites serve from `/<repo-name>/`, so built asset URLs need that
   prefix, but the local dev server should keep running at root.
3. `.github/workflows/deploy.yml` builds and deploys to Pages on every push to `main`
   (and via manual `workflow_dispatch`).
4. Enabled Pages via `gh api ... -f build_type=workflow` (required once, before the
   workflow's deploy step can succeed — the first push actually raced ahead of this and
   failed with a 404, which is how the ordering requirement was confirmed).

**Live at:** https://samgumble.github.io/right-of-way/

## Player guide + upgraded pole visuals (delivered)

Two requests after the 10x expansion closed out: a real user guide reachable in-game,
and pole models that visually show more lines as they upgrade.

1. **`GUIDE.md`** (repo root, same placement convention as `PLAN.md`/`HANDOVER.md`) is
   the single source of truth for the player-facing guide — core loop, economy, terrain,
   storms/repairs, permitting, upgrade branches, camera controls, hotkeys, HUD reference.
   A new `?` button (top-right, matching the HUD's visual language) opens a scrollable
   overlay panel rendering it. No separate in-game copy: `Guide.ts` imports `GUIDE.md`
   directly at build time via Vite's `?raw` import, run through a new tiny hand-rolled
   markdown renderer (`markdown.ts` — headers, bullet lists, bold, inline code,
   paragraphs; no dependency added, extending the project's existing "hand-write it"
   precedent). **This needs to stay in sync going forward** — any mechanics change
   should update `GUIDE.md` alongside the code and alongside `PLAN.md`/`HANDOVER.md`.
   Gameplay hotkeys are fully suppressed while the guide is open (verified with a real
   selected, upgradeable tower — `U` did nothing while the panel was up), so reading the
   guide can never accidentally trigger an upgrade or the reset hotkey.
2. **Upgraded pole visuals**: every tier-upgrade arm now hangs the same insulator-nub
   detail the top arm already had (Phase 4), with the insulator *count* on each arm set
   to exactly the capacity gained at that step — so a tower's total visible insulator
   count always equals its real connection capacity (2 / 4 / 8 for Capacity branch / 6
   for Resilience branch), verified exactly via direct capacity-fill tests at all four
   tier/branch combinations. Also fixed a latent gap from Wave 6: tier-upgrade arm
   meshes added after construction never got `castShadow` set (the constructor's
   shadow traversal only runs once, before any upgrades happen) — now set explicitly
   per mesh as each arm is built.

## More depth on existing systems (delivered)

You asked to keep building out the game; given the roadmap's only remaining item
(Phase 6 stretch goals) was flagged as open-ended new-breadth work rather than a scoped
next step, this picked two concrete, already-documented gaps to close instead —
deepening terrain and storms, not adding new systems.

1. **Terrain-weighted span cost.** Previously only tower *placement* cost was
   terrain-aware; stringing a line across rough terrain cost the same as flat ground.
   Now a span with either endpoint on a hill or marsh costs more Crew-Hours to string
   (`ECONOMY.spanHillMultiplier = 1.25`, `spanMarshMultiplier = 1.4` — deliberately
   smaller than the placement multipliers, since these scale an already distance-based
   Crew-Hours cost rather than a flat one-time CapEx cost). If the two endpoints differ,
   the higher multiplier applies — not stacked. Verified exactly against the real spend
   through `tryStringSpan`, not just the multiplier function in isolation.
2. **Storm warning telegraph.** Storms previously struck with zero warning. Now a low
   audio rumble plus a steady (non-blinking, to stay visually distinct from an active
   fault) HUD line reading "STORM ROLLING IN" fires once, `STORM.warningLeadSec = 4`
   seconds before each storm check — a heads-up that weather is approaching, not a
   promise a strike will land, since candidates for the actual strike still aren't
   picked until the check itself fires. Verified with a synthetic clock (avoiding real
   wall-clock waits): correctly silent outside the window, fires exactly once per storm
   cycle (not every frame), and correctly clears the instant the check resolves.

3. **Line throughput upgrade.** CapEx income per span was previously flat regardless of
   anything — now clicking a healthy (energized, non-faulted) line tries to upgrade its
   throughput tier, same directness as clicking a faulted one to repair (no separate
   select step). Three tiers (`ECONOMY.spanThroughputMultiplier = [1, 1.6, 2.2]`),
   mostly CapEx-funded (`spanThroughputCost`), boosting that specific span's CapEx/sec
   contribution — a real "invest now, earn more later" decision per line. Visually, the
   conductor tube itself gets thicker per tier (`TUBE_RADIUS_MULTIPLIER = [1, 1.35,
   1.75]`) — literal, not decorative, same discipline as the pole-visuals insulator
   count. `Economy.tick()`'s signature changed from a flat energized-span *count* to a
   pre-summed CapEx/sec *rate*, since income now varies per span — `Economy` itself
   stays a dumb accumulator, unaware spans or tiers exist. New optional
   `SaveData.spans[].throughputTier` field, defaulting to 1 for pre-feature saves.
   Verified exactly (cost, income rate, and tube radius all matched formula predictions
   precisely) through both direct calls and a real dispatched click, plus a full
   persistence round-trip including a synthetic legacy save with no `throughputTier`
   field at all.

Both `GUIDE.md` and the docs here were updated alongside the code, per the standing
"keep the guide/docs current" instructions.

## Camera rotation hotkey (delivered)

A quick, unrelated interruption: sometimes a pole occludes what's behind it. `Q`/`E`
now rotate the camera 90° at a time (eased, same pattern as the existing zoom easing),
always at the same isometric elevation — just from a different compass corner.
`IsoCameraRig`'s `ISO_DIR` constant became a `BASE_ISO_DIR` + eased `rotationAngle`;
`panRight`/`panForward` are recomputed on every rotation change so panning stays
screen-relative regardless of orientation. Not persisted — every session starts back at
the default orientation. Verified live: eases smoothly through all 4 orientations and a
full 360° returns to the exact original camera position; a real raycasted click still
correctly selects a tower after rotating; rotation is suppressed while the guide is
open, matching every other hotkey.

## Up next

**A major redesign is now in progress**, prompted by the user asking for a real
purpose/win-condition for the game — "realistic, industry-specific, and detailed,"
citing "connecting a plant to a neighborhood" as the framing. Through two rounds of
clarifying questions, the confirmed direction is: milestone objectives (discrete,
completable goals, game continues after each); Power Plant and Neighborhood/Load-Center
as new fixed-location anchor node types (not player-placed); a Substation as a new
player-placed voltage-step-down node between them; full realism — N-1 redundancy
(hard requirement, a real NERC-style standard), generation mix (multiple fuel types),
demand growth over time; revenue tied to actually meeting neighborhood demand rather
than the current flat/tiered per-span income; distinct distribution-pole visuals for the
neighborhood-local leg vs. the existing lattice transmission towers; and the existing
free-build sandbox stays exactly as it is, with objectives layered on top.

A Plan agent has completed a detailed technical design (network-capacity/N-1 algorithm,
entity architecture, revenue model, staged wave breakdown) — see
`/Users/samgumble/.claude/plans/fancy-wandering-dawn-agent-a8e9fa7bd67d6e453.md`. It
flagged one real tension needing explicit confirmation before implementation starts:
decision "revenue tied to demand met" conflicts with the just-shipped flat/tiered span
income system, and recommends an additive/layered model (new demand-based income
coexists with the existing span income for non-objective spans) rather than a full
replacement — this and the agent's other open questions need review before work begins.

Once that redesign ships, the same "real playtest before adding more" recommendation
from before still applies — a real, growing list of tuning constants (marsh thresholds,
cost curve, storm weighting, branch costs, span/warning/throughput numbers) are verified
*correct* but not yet validated as *fun*, and audio has never been heard by a human.
Phase 6's original stretch goals (procedural regions, a rival AI utility) remain
open-ended and not currently scoped. See HANDOVER.md's "Known gaps" section for the full
list — it's getting long enough that a real playtest is the highest-leverage thing to do
next, more than any single additional feature.
