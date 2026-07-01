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
| — | "10x expansion" (out-of-roadmap, six-wave plan, in progress) | **In progress** — see below |
| 5 | Deploy to hosting | **Done** — GitHub Pages, see below (superseded the original "Cloudflare Pages" placeholder) |
| 6 | Stretch: procedural regions, rival AI utility | Not started (audio pulled forward into the 10x expansion) |

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

## "10x expansion" (in progress)

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

## Up next

Wave 3 (particle & weather effects — rain, wind drift, placement dust, fault sparks) is
next per the approved 10x plan. Revisit HANDOVER.md's "10x expansion" section for the
exact scope before starting — it specifies `InstancedMesh`-based rain (not
`THREE.Points`), a new `ParticleBurst.ts` helper, and a new `Span.midpoint()` accessor
needed for fault-spark positioning.
