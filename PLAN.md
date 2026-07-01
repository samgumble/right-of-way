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
| — | Plant/Substation/Neighborhood redesign — real purpose/win condition (out-of-roadmap) | **Done** — all 8 waves, see below |
| — | "10x pass" — deepening Plants/Neighborhoods/N-1 + graphics/animation polish (out-of-roadmap) | **Done** — all 11 waves, see below |
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

**Both the plant/neighborhood/N-1 "real purpose" redesign (8 waves) and the follow-up
"10x pass" deepening it (11 more waves) are now fully delivered.** The game has a real,
industry-grounded win condition — connect a Power Plant to a Neighborhood through a real
transmission/distribution network, hold N-1 redundancy, complete a milestone, with a new
one always waiting after — and that system now has real depth on top: multiple
concurrent milestones as you progress, a daily demand cycle, generation variability
(solar/wind output that actually moves), a running fuel cost for dispatchable plants,
Substation upgrade tiers, and a matching graphics/animation pass (spinning wind turbines,
a bigger milestone payoff, an escalated blackout cue, lit Neighborhood windows). Final
plans live at `/Users/samgumble/.claude/plans/fancy-wandering-dawn.md` (both the
original 8-wave design and the 10x pass, in that order in the same file); wave-by-wave
delivery detail is below and in HANDOVER.md's matching "architecture additions"
subsections.

Real bugs were caught and fixed during required verification across both passes, not
left for later: an N-1 redundancy edge case and a markdown paragraph-merging gap (both
in the original 8-wave redesign, see those sections) plus, this pass, a genuinely
load-bearing discovery about this project's own *test methodology* — see the 10x pass's
Wave 4 section for the `beforeunload`-triggered autosave race that was silently defeating
`localStorage.clear()`-based test resets, and how it's now reliably avoided.

The same "real playtest before adding more" recommendation still applies, now more than
ever. This 10x pass explicitly acknowledged that trade-off going in (see the plan file's
own "Explicitly acknowledged trade-off" note) and proceeded anyway per direct
instruction — the tuning-constant surface has grown substantially again (every `PLANT`/
`NEIGHBORHOOD`/`SUBSTATION`/`MILESTONE_PULSE`/`BLACKOUT_PULSE`/`WIND_TURBINE` constant
from this pass, on top of everything already listed for the original redesign), all
verified *correct* via direct state inspection and formula matching, none yet validated
as *fun* by an actual human playing continuously. Phase 6's original stretch goals
(procedural regions, a rival AI utility) remain open-ended and not currently scoped. See
HANDOVER.md's "Known gaps" section for the full, honest list — a real playtest remains
unambiguously the highest-leverage next step, more than any single additional feature.

## Plant/Neighborhood/Substation redesign — Wave 1 (delivered)

New entities exist on the board and are fully click-selectable, but don't do anything
functionally yet — that's later waves. See HANDOVER.md for full architecture.

1. **`PowerPlant`** — one hardcoded gas plant spawns automatically each game (fixed,
   deterministic location). Click to see fuel type, nameplate MW, and effective
   (capacity-factor-adjusted) MW. Six fuel types exist in code (`coal`/`gas`/`nuclear`/
   `hydro`/`solar`/`wind`), each with a distinct low-poly silhouette (geometry only, no
   new colors) — only `gas` is spawned yet; the rest activate once objective spawning
   (Wave 6) picks fuel types semi-randomly.
2. **`Neighborhood`** — one hardcoded neighborhood (a jittered house cluster) spawns
   opposite the plant. Click to see its MW demand. Fixed for now; grows over time
   starting Wave 7.
3. **`Substation`** — player-placed via **`Shift`+click** on buildable ground (same
   cost/terrain-gating/permitting flow as a Tower, distinct fenced-yard silhouette, no
   tier/branch upgrade system). Persisted like a Tower. Functionally inert until Wave 2
   wires up the connect-to-Neighborhood action.

Both `Plant`/`Neighborhood` spawn at deterministic board corners via a small outward
search for the nearest flat, buildable, unoccupied node; `Substation` is fully persisted
since it costs real CapEx.

## Plant/Neighborhood/Substation redesign — Wave 2 (delivered)

The plan's own Wave 2 scope (voltage tiers + the Substation→Neighborhood distribution
connect action) turned out to need one necessary addition discovered during
implementation: without a way to also link Towers/Plants to Substations on the
transmission side, Substations would be permanently unreachable islands and the whole
feature would be untestable — so general transmission-node linking (any pair of
Tower/Substation/Plant, via the existing select-then-click flow) shipped as part of this
wave too.

1. **Voltage tiers.** `Span` gained a `voltageTier: 'transmission' | 'distribution'`
   field (default `'transmission'`, zero behavior change for every existing/new plain
   span). Distribution spans get a fixed, visibly-thinner base tube radius (0.045 vs.
   transmission's 0.09 — not multiplier-scaled off the same base) and a tighter catenary
   sag ratio (0.05 vs. 0.12) — verified exactly via direct tube-geometry inspection at
   both throughput tiers.
2. **Transmission-node linking.** Select a Tower, Substation, or Plant, then click
   another one of any of those three kinds — strings a transmission span between them,
   reusing `tryStringSpan`'s exact cost-gating shape via a new sibling method
   (`tryLinkTransmission`), kept deliberately separate so the original, heavily-verified
   Tower-Tower path is untouched. New `transmissionLinks` array (separate from the
   original Tower-only `spans` array) holds these.
3. **Distribution connect action.** Select a Substation, click an unconnected
   Neighborhood — strings a distribution span (`tryStringDistributionSpan`), at most one
   per Neighborhood. New `distributionSpans` array.
4. **Persistence, expanded.** Since links can now reference a Plant/Neighborhood by
   identity, Plant/Neighborhood are now persisted too (deferring this to Wave 6 as
   originally sketched would have let a persisted link silently point at nothing, or the
   wrong entity, after a reload). `transmissionLinks`/`distributionSpans` persist
   additively, same as everything else — `SAVE_VERSION` stays at 1.
5. **Storms deliberately don't reach the new span types yet** — `triggerStorm()` is
   untouched, still Tower-Tower-only. Wiring storms (and eventually blackouts) into
   transmission/distribution links is explicitly deferred to Wave 5, where it's in scope
   and gets the softlock-invariant scrutiny that change deserves.

Verified: real dispatched clicks (not just direct method calls) for both new link flows;
tube radii confirmed exactly 0.09/0.045 (tier 1) and 0.135/0.06075 (tier 2, after a real
click-driven throughput upgrade); a real click-driven repair on a faulted transmission
link spent exactly `STORM.repairCost.capEx`; full persistence round-trip (all four new
arrays); a legacy pre-Wave-2 save (only `towers`/`spans`/`substations`) loads with zero
errors and correctly falls back to a fresh deterministic Plant/Neighborhood pair.

## Plant/Neighborhood/Substation redesign — Wave 3 (delivered)

The plan's one explicitly high-risk wave — the network capacity/N-1 algorithm. New
`src/game/network.ts`: pure functions, no Three.js/scene dependency, matching
`catenary.ts`'s precedent.

1. **`computeMaxBottleneck(graph, sourceIds)`** — multi-source widest-path
   (maximum-bottleneck-path) from every Plant simultaneously. A Neighborhood is *served*
   iff its computed bottleneck ≥ its current demand.
2. **`isSubstationRedundant(graph, substationId)`** — substation-disjoint two-path
   search (two BFS passes, the second excluding both the substations *and the edges* the
   first pass used). Computed once per Substation, shared by every Neighborhood hanging
   off it.
3. **New `ECONOMY.spanCapacityMW = [50, 90, 140]`** — a span's MW graph-edge capacity per
   throughput tier, deliberately a separate table from the existing income-multiplier
   table (same tier number, two independent meanings that coexist on one span).
4. **`Game.buildNetworkGraph()`/`recomputeNetworkState()`** — the only place that
   translates live entities into `network.ts`'s plain graph shape. Called from inside
   `save()` itself (not threaded through every individual call site) — since `save()`
   already runs at exactly the right set of trigger points, this is simpler and can't
   miss a call site by accident. `Neighborhood` gained `setNetworkState`/`isServed`/
   `isRedundant` — pure internal state, no visual/economy consequence yet (that's
   Waves 4/5).

**A real bug was caught and fixed during the required synthetic-topology verification**:
the initial N-1 implementation only excluded *substations* used by the first path in the
second BFS pass, which incorrectly reported "redundant" for a Substation with only one
physical edge to a Plant and zero intermediate substations (nothing to exclude, so the
second pass just re-found the identical single edge). Fixed by also excluding the first
path's *edges*, not just its substations — verified via the exact failing case, then
re-confirmed all five required topologies pass. **A second real issue was caught**: the
original `NEIGHBORHOOD.startingDemandMW = 60` exceeded `spanCapacityMW[0] = 50`, meaning
the very first objective would have been mathematically impossible to serve without a
mandatory pre-upgrade — lowered to 40 (see `constants.ts`'s comment for the reasoning).

Verified: all five required synthetic topologies pass exactly (single sufficient path;
two disjoint paths; two paths sharing one substation — the disjointness-specific case
that caught the bug above; insufficient bottleneck; fault-the-sole-path); a 57-node
synthetic graph stays sub-millisecond for both algorithms; a real end-to-end chain built
through actual `Game` entities (Plant→Tower→Substation→Neighborhood, all via the real
Wave 2 methods) correctly reports served/not-served through a real fault→repair cycle,
including via the automatic `save()`-triggered recompute path, not just manual calls;
pure Tower-Tower sandbox play confirmed completely unaffected (decision #7).

## Plant/Neighborhood/Substation redesign — Wave 4 (delivered)

Demand-based revenue — the additive model resolved during planning (see this plan's
"Design decisions resolved" section): legacy `Span.incomeRate()` keeps paying
unconditionally for every energized span, sandbox-wide; a fully independent second
stream pays a served Neighborhood `demandMW * OBJECTIVE.capExPerMWServedPerSec` per
second (new `OBJECTIVE` constants group, `capExPerMWServedPerSec = 0.08`). A cliff at the
served boundary, not partial credit — a not-served Neighborhood earns nothing. Redundancy
doesn't gate this rate (that's a Wave 5 blackout-risk/Wave 6 completion-gate concern, not
a revenue one). `Game.tick()` sums both streams and hands `Economy.tick()` one combined
rate, same "dumb accumulator" pattern used since Phase 2.

Verified precisely against the real `tick()` code path (not just the formula in
isolation): a served Neighborhood's income matched `demandMW * 0.08` exactly via a
directly-measured CapEx delta; the combined rate (legacy span income + objective income)
matched exactly through a real end-to-end chain; a not-served Neighborhood (sole
transmission link faulted) contributed exactly zero while its legacy span income
(unrelated spans) was unaffected; and — the regression-critical check for decision #7 —
a plain sandbox span with no Plant/Neighborhood ever involved earned exactly the same
rate it did before this wave, with zero objective income leaking in.

## Plant/Neighborhood/Substation redesign — Wave 5 (delivered)

Blackout state, derived and purely reactive — never a new independent trigger, per
decision #6 and section 1.4's explicit constraint. `Neighborhood.setNetworkState`
detects the specific transition (was served + at-risk, now not-served) and flips
`blackedOut`, returning a `'blackoutStarted'`/`'blackoutCleared'` event; clears the
instant a later recompute finds it served again. Visual: a whole-cluster fault-red pulse
(reusing `Span`'s fault-pulse timing/shape) — served Neighborhoods also got a first
visual state of their own (a small warm glow) for this to actually read as "worse than,"
since nothing distinguished served from not-served visually before. New HUD line
(`.hud-note--fault`'s blinking style, blackout count) sits above the existing fault line.

**Storms were expanded to reach transmission links and distribution spans** — the piece
explicitly deferred from Wave 2, now landing here because it's the one thing that makes
blackouts reachable at all (a storm faulting a Tower-Tower-only pool could never take
down a Neighborhood's sole path). `triggerStorm`'s candidate pool, `spanStormWeight`, and
`pickWeightedStormTarget` all generalized to read across all three span-bearing arrays;
the original Tower-Tower-only behavior is a strict subset of the new pool, not replaced.

**The storm softlock-prevention invariant was re-verified explicitly, as required**:
`STORM.minEnergizedSpansToStrike = 2` now counts across the expanded candidate pool, and
300 forced storm attempts against a topology with exactly one total energized span
(tested both as a plain Tower-Tower span and, separately, as a lone distribution span)
produced zero strikes in both cases — the invariant generalizes cleanly because it's
span-*count*-based, not span-*type*-based. Global CapEx income can never hit zero from a
single blackout either: the legacy per-span stream keeps paying regardless (unconditional
per the Wave 2 revenue-model resolution), and a blackout only zeroes the affected
Neighborhood's own objective-income stream.

Verified: a real at-risk topology (served, not redundant), storm-faulting its sole
serving span, confirmed the blackout fires exactly on that transition, objective income
for that Neighborhood drops to exactly zero, the whole-cluster visual pulse renders
distinctly from a single faulted line, and a real repair clears it; the HUD correctly
shows both a blackout line and a fault line simultaneously with distinct text; the
softlock regression re-check (above); a spot-check confirming storm-weight calculation
doesn't crash on non-Tower endpoints (Substation/Plant/Neighborhood) and that strikes
still occur normally once 2+ energized spans exist.

## Plant/Neighborhood/Substation redesign — Wave 6 (delivered)

The first wave verifiable end-to-end as "the actual thing the user asked for" — a real
Plant-to-Neighborhood chain, built via real clicks, completing a milestone.

1. **Objective model** — `{ id, plant, neighborhood, targetDemandMW, completedAt }`.
   Completion requires all three: `demandMW >= targetDemandMW`, served, and redundant
   (decisions #1 and #6). `targetDemandMW` stays fixed at `NEIGHBORHOOD.startingDemandMW`
   for every objective this wave (not escalating yet) — since demand growth doesn't
   exist until Wave 7, an escalating target would make every objective after the first
   mathematically unwinnable; Wave 7 is what makes a real, achievable escalation possible.
2. **Completion** — checked from `save()` right after `recomputeNetworkState()`. Fires a
   fanfare (`SoundManager.playMilestoneComplete()` — a three-note ascending triad,
   distinct from the two-tone upgrade sweep), a `'celebrate'` `ParticleBurst` variant
   (brighter/wider than dust/spark), and a persistent HUD acknowledgment (a MILESTONES
   counter in the main panel, not a vanishing toast).
3. **Respawn** — `OBJECTIVE.respawnDelaySec = 25` after completion, a new Plant+
   Neighborhood pair spawns at a fresh (randomized, not the fixed starting corners)
   location with a semi-randomly weighted fuel type (new `pickRandomFuelType()`,
   weighted so nuclear/coal aren't the *only* thing that ever spawns).
4. **HUD** — new green `.hud-note--objective` line showing the active objective's live
   MW-served/target and served/redundant status; a MILESTONES row in the main panel.
5. **Persistence, with backward-compat synthesis** — `objectives[]` persists by
   Plant/Neighborhood *id*, not position. A pre-Wave-6 save (Plant/Neighborhood exist,
   no `objectives` key at all) synthesizes one active objective wrapping the existing
   pair on load, rather than losing an existing player's progress or leaving them with
   no objective at all.

Verified end-to-end via real game methods (not synthetic state): built a genuinely
redundant chain (one Substation with two independent transmission routes to the Plant,
via two different Towers — the correct way to achieve redundancy under the "one
Substation per Neighborhood" topology, not two Substations), confirmed the objective
completed automatically through the real `save()` pipeline, confirmed the fanfare/HUD
counter fire exactly once even across repeated recomputes, confirmed a new objective
spawned after the delay at a new location with a real weighted-random fuel type, full
persistence round-trip (including a completed + two active objectives), backward-compat
synthesis from a simulated pre-Wave-6 save, and free-build elsewhere on the board
confirmed completely unaffected (decision #7).

## Plant/Neighborhood/Substation redesign — Wave 7 (delivered)

Demand growth and the capacity warning telegraph — the closing mechanical piece.

1. **Continuous demand growth** — `NEIGHBORHOOD.demandGrowthMWPerSec = 0.05`, applied in
   `Neighborhood.update(now, dt)` (which gained a `dt` parameter this wave), capped at
   `demandGrowthCapMW = 130` (comfortably under a maxed-out tier-3 span's 140 MW ceiling,
   so a fully-upgraded chain can always eventually catch up). Growth applies to every
   Neighborhood continuously, including ones with an already-completed objective — a
   milestone isn't a permanent trophy the underlying Neighborhood stops evolving after.
2. **Capacity warning telegraph** — reuses the storm-warning shape (`NEIGHBORHOOD.
   demandWarningLeadSec = 30`, a new `SoundManager.playCapacityWarning()` tonally
   distinct rising tone vs. the storm's descending rumble, a new steady HUD line). A
   `bottleneckMW` field cached on `Neighborhood` (set alongside `served`/`redundant` by
   `setNetworkState`, now taking a third parameter) lets the projection run every tick
   via cheap arithmetic, without re-running the graph algorithm. Fires once per approach
   (`checkCapacityWarning`, mirroring `Game`'s `lastStormWarningFor` dedup pattern but
   scoped per-Neighborhood) and resets once no longer approaching, so a later approach
   can fire again.

Verified via the same synthetic-clock methodology already used for `STORM.
warningLeadSec`: growth rate matched the formula exactly via a large synthetic `dt`; the
cap held exactly at an extreme synthetic elapsed time; the warning fired exactly once at
a controlled tight margin, stayed silent at a comfortable margin, correctly declined to
fire for an already-not-served Neighborhood (that's a different, already-handled
problem), and correctly reset/re-fired after returning to a tight margin; the real
`tick()` wiring confirmed to call `playCapacityWarning()` and update `Neighborhood`'s
live warning state correctly. Pure sandbox play reconfirmed unaffected.

## Plant/Neighborhood/Substation redesign — Wave 8 (delivered)

Docs and a final regression pass. **This closes out the redesign — all 8 waves are now
delivered.**

1. **`GUIDE.md`** — the opening paragraph now states the game's real purpose (connecting
   Plants to Neighborhoods, holding redundancy, completing milestones) instead of only
   describing the free-build sandbox mechanics, which had gone stale relative to what
   the game actually is now. Every mechanic from Waves 1-7 already had its own
   incremental `GUIDE.md` update as it shipped (per the standing "keep the guide
   current" instruction) — this pass was a coherence read-through, not a rewrite.
2. **A real bug found and fixed during that read-through**: `markdown.ts`'s renderer
   never merged consecutive plain-text lines into one paragraph — every line became its
   own `<p>`, unlike standard Markdown's soft-wrap semantics. Invisible until now because
   every prior paragraph in `GUIDE.md` happened to be written as a single long line; the
   new intro paragraph (written with natural sentence-wrapped line breaks) exposed it
   immediately. Fixed properly in the parser (accumulate lines into a buffer, flush as
   one `<p>` on a blank line/header/bullet/EOF) rather than just reflowing the one
   paragraph that triggered it — the more robust fix, since any future multi-line
   paragraph edit would otherwise hit the same gap again.
3. **Final regression pass**: a synthetic legacy save predating the *entire* redesign
   (pure pre-Wave-1 shape — `towers`/`spans`/`camera` only, no
   `substations`/`plants`/`neighborhoods`/`objectives`/`transmissionLinks`/
   `distributionSpans` keys at all, including a tier-3 branched tower and a faulted span)
   loads with zero errors, fully restores the old sandbox network, and remains fully
   playable (a new tower placed on it after load succeeds) — decision #7's sandbox
   compatibility promise held at the oldest possible save format, not just the
   immediately-prior wave's. A comprehensive full-feature save (2 towers, a Tower-Tower
   span, 2 substations, 2 plants with non-default fuel types, 2 neighborhoods with
   distinct demand values, 2 transmission links, 2 distribution spans — one faulted, one
   not — and 2 objectives — one completed, one active) round-trips through every field
   correctly. `tsc --noEmit` clean throughout.

Verified: the markdown fix confirmed visually (before/after screenshot of the same
paragraph) and via the accessibility snapshot (full guide content, all headers/lists/
bold spans/paragraphs, reads correctly end-to-end); both regression saves confirmed with
zero console errors; a final live screenshot after a real `Shift+R` reset shows a clean,
healthy fresh-game state with the correct starting HUD (`MILESTONE · 40/40 MW · NOT
SERVED`, `MILESTONES: 0`).

## "10x pass" — deepening Plants/Neighborhoods/N-1 + graphics/animation polish (delivered — all 11 waves)

Not a numbered roadmap phase — after the 8-wave redesign above shipped, you asked to
"10x the mechanics and gameplay"; an `AskUserQuestion` round confirmed the direction as
deepening the Plants/Neighborhoods/N-1 system specifically (not the original sandbox
again, not new breadth like procedural regions/rival AI). You then separately asked to
also "polish the graphics and animations," mirroring the original "10x expansion"
precedent of combining a graphics dimension and a mechanics dimension into one staged
pass. Two background Plan agents designed each half; both were synthesized into one
combined, dependency-ordered 11-wave plan (mechanics waves sequenced ahead of the
graphics waves that read their new signals), with several judgment calls made and
documented directly in the plan file: growing-N objective concurrency, an
aggregate-count HUD shape, fuel cost simplified from exact flow-attribution to a cheap
existence check, and two graphics-agent signal choices (wind rotation, window
brightness) revised to read the richer continuous mechanics signals instead of simpler
placeholders. Full plan at `/Users/samgumble/.claude/plans/fancy-wandering-dawn.md`
(appended above the preserved original 8-wave plan in the same file).

1. **Multi-objective structural core.** Concurrency grows from 1 (identical to the
   original single-objective experience) to a cap of 3, one slot every 3 completions.
   `pendingRespawns: number[]` replaced a single `nextObjectiveSpawnAt` slot — the exact
   latent bug the planning pass caught (two simultaneous completions would have silently
   clobbered each other's scheduled respawn under the old single-slot design) was
   reproduced and confirmed fixed: two forced simultaneous completions each got an
   independent respawn entry, and both correctly spawned separate replacements.
   `targetDemandMW` escalates mildly per objective, capped well under both the demand
   growth ceiling and the top span tier's capacity. HUD shows an aggregate count +
   single most-urgent detail line, matching the existing fault/blackout-count precedent.
2. **Daily demand cycling.** A cosine multiplier on top of the existing linear growth,
   reusing the day/night cycle's exact phase convention (zero new timer), phase-shifted
   toward evening. `Neighborhood` now caches a raw base (what persistence writes) and a
   cycled effective value (what everything else reads) — verified the formula matches
   exactly at several cycle points, and that a save/reload round-trips the *raw* value
   without compounding the cycle on top of itself.
3. **Bloom review.** Verify-first, per the plan — reviewed via a real forced fault +
   blackout with both pulses near-peak simultaneously; the existing bloom baseline
   already handles it without blowout (the blackout pulse shares its intensity ceiling
   with the pre-existing fault pulse it's modeled after). No constant changed.
4. **Milestone visual escalation.** `bloomPass`/`vignettePass` promoted to `Game` fields;
   a new `updateMilestonePulse` briefly boosts bloom and opens the vignette on
   completion, easing back to whatever the live baseline is. Verified the pulse peaks at
   the exact expected boosted values and returns to the *exact* pre-pulse baseline with
   no permanent drift. Bigger `celebrate` particle burst (34/1100ms, up from 22/750).
5. **Generation variability.** `PowerPlant.outputMultiplier` — solar phase-locked to the
   day/night cycle with a night floor, wind via a slow layered-sine walk (same hand-
   rolled technique as terrain noise) phase-offset per-plant so multiple wind plants
   drift independently. Coal/gas/nuclear/hydro confirmed byte-for-byte unchanged
   (multiplier stays exactly 1). A new periodic network recompute (independent of the
   discrete-action-triggered ones and the 3s autosave) closes the staleness window this
   continuously-changing input would otherwise leave — verified live end-to-end: a
   simulated generation collapse, with zero discrete action taken, correctly flipped a
   Neighborhood to not-served and triggered a real blackout within about a second.
6. **Wind turbine rotation.** The wind fuel type's blade meshes now live in a pivot
   group at the mast-top hub, rotating at a rate that reads `outputMultiplier` live
   every tick — verified the rotation delta over a fixed time window scales
   proportionally with the multiplier at both a low- and high-wind sample.
7. **Storm/blackout visual escalation.** A new `blackout` particle-burst style (bigger/
   longer than the existing `spark`, same fault-red hue) replaces `spark` at the
   blackout-started event site; a second, inverted pulse (vignette *tightens* instead of
   opening, reusing wave 4's exact pattern) plays alongside it. Verified via a real
   forced-storm blackout that both fire correctly and the vignette pulse eases back to
   the exact baseline.
8. **Neighborhood window detail.** A second shared material drives 2 window meshes per
   house (8 across the 4-house cluster, confirmed by exact traversal count), brightness
   reading the cycled demand fraction, hard-suppressed to fully dark whenever not served
   or blacked out — verified both the brightness formula (exact match at multiple demand
   fractions) and the suppression override (a high-demand Neighborhood with no power
   still renders fully dark windows).
9. **Fuel cost (simplified).** Per the plan's own resolved decision, simplified from
   exact per-Neighborhood flow attribution (would have required extending
   `computeMaxBottleneck`, the largest net-new algorithmic surface in the whole pass) to
   a cheap existence check: a Plant with at least one currently-energized outgoing link
   accrues `effectiveCapacityMW() * fuelCostPerMW[fuelType] * assumedUtilizationFraction`
   per second, subtracted only at the final `Economy.tick()` combination point — never
   netted into a Neighborhood's income upstream. Verified a disconnected plant costs
   exactly zero, and that coal vs. wind plants of identical effective capacity produce
   measurably different net income rates in the correct direction (wind's fuel cost is
   zero).
10. **Substation upgrade tiers.** A 2-tier system (not Tower's 3 — no second axis exists
    to justify a branch choice), `maxConnectionsByTier`/`capacityMWByTier` sharing one
    table so the two numbers can't drift apart. `U` upgrades a selected Substation the
    same way it upgrades a tier-1 tower. Verified exact insulator-nub counts at both
    tiers (3 and 5), that a real click-driven upgrade immediately updates the live
    network graph's capacity, and that a legacy pre-Wave-10 save (no `tier` field at
    all) correctly defaults to tier 1 and stays upgradeable.
11. **Docs & final regression.** This section, plus the `GUIDE.md` updates alongside it.
    `tsc --noEmit` stayed clean after every wave; `SAVE_VERSION` stayed at 1 — the only
    new persisted field across the entire 11-wave pass is `substations[].tier?`,
    everything else is purely live/derived.

**One real, load-bearing discovery during this pass's own verification, not a code bug
but a testing-methodology one**: `window.location.reload()` calls issued mid-session
were repeatedly, silently failing to produce a genuinely fresh game — `localStorage.
clear()` followed immediately by `reload()` left a window where the page's own
`beforeunload` listener (registered in `Game`'s constructor, calling `save()`) fired
during navigation and re-wrote the *current* dirty in-memory state back to storage,
undoing the clear before the new page ever read it. Confirmed via a page-global marker
that did NOT survive the reload (proving navigation itself was real) while game state
DID survive (proving the save, not a failed reload, was the cause). Fixed for all
verification from Wave 4 onward by removing the `beforeunload`/`visibilitychange`
listeners and pausing the render loop (`renderer.setAnimationLoop(null)`) immediately
before every test-driven `localStorage.clear()` + reload. This is the same *category* of
race as the reset-hotkey and Wave-6 issues already documented above, but a new concrete
instance of it — worth remembering for any future session that resets state mid-test via
raw browser calls rather than the game's own `Shift+R` hotkey.

Verified per-wave as listed above, plus: `tsc --noEmit` clean after every wave; every
numeric formula (demand cycling, solar/wind output, milestone/blackout pulse curves,
wind rotation, window brightness, fuel cost) matched a hand-computed reference exactly,
not just eyeballed; the storm softlock-prevention invariant re-confirmed untouched after
every storm-adjacent wave (1, 5, 7) by diffing the session's changes against
`triggerStorm`/`minEnergizedSpansToStrike`/candidate-selection code, none of which this
pass touched.
