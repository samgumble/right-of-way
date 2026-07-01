export const COLORS = {
  background: 0x111820,
  ground: 0x0d1319,
  steelBlue: 0x3e6e8e,
  steelBlueDim: 0x2a4a5e,
  safetyOrange: 0xe8720c,
  energizedGreen: 0x4c9a6e,
  faultRed: 0xc0453a,
  ambientLight: 0x7e9ebf,
  keyLight: 0xfff1de,
  /** Terrain tints stay in the cool steel-blue family — shading on a blueprint, not a literal green/blue map. */
  hillTint: 0x4a7691,
  waterTint: 0x0a141d,
  marshTint: 0x1f3d3a,
} as const;

export const GRID = {
  cells: 20,
  cellSize: 6,
} as const;

export const TOWER_HEIGHT = 9;

export const ECONOMY = {
  startingCapEx: 200,
  startingCrewHours: 40,
  crewHoursMax: 100,
  crewHoursRegenPerSec: 4,
  capExIncomePerSpanPerSec: 3,
  towerCost: 80,
  /** Mild linear growth per already-placed tower — expansion gets steadily pricier
   * without being exponentially punishing. Applied on top of terrain cost multipliers,
   * not persisted (derived live from `towers.length`). */
  towerCostGrowthPerTower: 0.06,
  spanCostBase: 10,
  spanCostPerUnitDistance: 0.6,
  /** Span cost multiplier when either endpoint tower sits on rough terrain — stringing
   * a line across a hill or marsh takes more labor, not just more distance. Distinct
   * from (and deliberately smaller than) `TERRAIN.hillCostMultiplier`/
   * `marshCostMultiplier`, since those apply to a flat one-time CapEx cost while these
   * apply to a variable, already distance-scaled Crew-Hours cost. If a span's two
   * endpoints sit on different terrain, the higher multiplier applies — not stacked. */
  spanHillMultiplier: 1.25,
  spanMarshMultiplier: 1.4,
  towerMaxTier: 3,
  /** Connection capacity per tier, indexed by (tier - 1). Tier 3's value here is the
   * Resilience-branch (and pre-Wave-6) capacity; the Capacity branch adds
   * `tier3CapacityBonus` on top. */
  towerTierCapacity: [2, 4, 6] as const,
  tier3CapacityBonus: 2,
  /** Tier 1→2 stays universal ("linear"). Tier 2→3 requires picking a branch — see
   * `Tower.TowerBranch` and `Game`'s `U`/`I` handlers. Costs differ slightly per
   * branch (Resilience trades a little CapEx for more Crew-Hours, reflecting bracing
   * labor vs. hardware) but neither branch's cost is a "trap" option. */
  towerUpgradeCost: {
    linear: { capEx: 150, crewHours: 30 },
    capacity: { capEx: 300, crewHours: 60 },
    resilience: { capEx: 260, crewHours: 70 },
  },
  /** A line's throughput can be upgraded independently of the towers it connects —
   * click a healthy (energized, non-faulted) span to try, same directness as clicking
   * a faulted one to repair. Indexed by (throughputTier - 1); tier 1 is the untouched
   * base rate. Mostly CapEx-funded (a capital investment in future CapEx income),
   * unlike tower upgrades which lean more Crew-Hours — reinforcing an existing line is
   * closer to buying better cable than it is to a construction labor job. */
  spanThroughputMultiplier: [1, 1.6, 2.2] as const,
  spanThroughputMaxTier: 3,
  /** Cost to upgrade FROM tier (index + 1) TO the next tier. */
  spanThroughputCost: [
    { capEx: 150, crewHours: 20 },
    { capEx: 320, crewHours: 45 },
  ],
  /** MW capacity a span contributes as a graph edge (Wave 3's network algorithm),
   * indexed by (throughputTier - 1) — a deliberately separate table from
   * `spanThroughputMultiplier` above. Same tier number, two independent meanings (legacy
   * income rate vs. graph capacity) that happen to coexist on the same span, not the
   * same array reused for two different units. */
  spanCapacityMW: [50, 90, 140] as const,
} as const;

export const DENY_SHAKE_DURATION_MS = 260;

export const TERRAIN = {
  hillCostMultiplier: 1.6,
  /** Marsh sits between water and flat — soft, unstable ground, buildable but pricier
   * than a hill. Also the terrain storm-target weighting reads from
   * (`STORM.marshWeightMultiplier`, Wave 5) — wet/unstable ground skews more
   * storm-prone. */
  marshCostMultiplier: 2.1,
  /** Below this noise value a node is water (unbuildable). */
  waterThreshold: -0.9,
  /** Between waterThreshold and this value, a node is marsh. */
  marshThreshold: -0.55,
  /** Above this value, a node is a hill. */
  hillThreshold: 0.9,
} as const;

export const STORM = {
  /** No storm at all before this much time has passed — lets a new player establish a network first. */
  firstStrikeDelaySec: 60,
  minIntervalSec: 22,
  maxIntervalSec: 40,
  repairCost: { capEx: 40, crewHours: 15 },
  /** A strike is skipped if fewer than this many spans are currently energized, so CapEx
   * income (which only comes from energized spans) can never be knocked to zero with no
   * way to recover — repairing itself costs CapEx. */
  minEnergizedSpansToStrike: 2,
  /** Storm interval scaling (Wave 5): both interval bounds shrink toward this floor as
   * the energized-span count grows — a bigger network draws storms more often. Scaling
   * is interval-only; a storm still ever strikes at most one span, never more. Multi-
   * strike-per-storm would risk reopening the softlock the balance revisit fixed — if
   * ever wanted later, it needs its own explicit review, not folded into this wave. */
  minIntervalFloorSec: 12,
  /** Energized-span count at which the interval has closed half the remaining gap to
   * the floor (exponential approach, so bounds can never cross or go below the floor). */
  intervalHalfLifeSpanCount: 6,
  /** Storm-target weighting (Wave 5): a span with at least one endpoint on marsh
   * (wet/unstable ground — see Wave 4) is this many times more likely to be picked as
   * the storm's target than a span with no marsh endpoint. */
  marshWeightMultiplier: 2.5,
  /** Storm-target weighting (Wave 6): a span with at least one Resilience-branch
   * tier-3 tower endpoint has its weight multiplied by this (< 1 — less likely to be
   * struck). Applied multiplicatively alongside marshWeightMultiplier, not instead of
   * it — a resilient tower on marsh is safer than average but not fully immune. */
  resilienceWeightMultiplier: 0.4,
  /** How long before a storm check to fire a warning cue (audio + a HUD note) — a
   * heads-up that weather is rolling in, not a promise a strike will actually land
   * (candidates for the strike itself aren't picked until the check fires, so the
   * warning can't target a specific span in advance). */
  warningLeadSec: 4,
} as const;

export const PERMIT = {
  /** Every new tower spends this long in a pending state before it can be selected/wired. */
  pendingDurationSec: 10,
} as const;

export const OBJECTIVE = {
  /** A served Neighborhood earns `demandMW * capExPerMWServedPerSec` per second — a
   * cliff at the served boundary (not a partial-credit ramp), matching the binary
   * "is this objective currently being met" framing. Fully additive on top of the
   * legacy per-span income (`Span.incomeRate()`), which keeps paying unconditionally
   * for every energized span regardless of path membership — see PLAN.md's revenue
   * model decision. Redundancy does NOT gate this rate; it's purely a Wave 6
   * completion-gate and a Wave 5 blackout-risk factor. */
  capExPerMWServedPerSec: 0.08,
  /** Breathing room after a milestone completes before the next Plant+Neighborhood pair
   * spawns — a completion gets a moment to land rather than being instantly buried
   * under the next thing. First-pass pacing, same caveat as every other tuning
   * constant here. */
  respawnDelaySec: 25,
} as const;

export const ATMOSPHERE = {
  /** Fog uses view-space depth from the camera, tuned so only the far board corners
   * ever fade — the whole 120×120 board must stay readable at any zoom level. */
  fogNear: 140,
  fogFar: 270,
  /** One full day/night cycle, in seconds. Slow by design — background motion, not a clock. */
  dayNightCycleSec: 480,
  dayAmbientIntensity: 0.6,
  nightAmbientIntensity: 0.22,
  dayKeyIntensity: 0.85,
  nightKeyIntensity: 0.18,
  vignetteOffset: 0.9,
  vignetteDarkness: 0.55,
} as const;

export const SHADOW = {
  mapSize: 2048,
  /** Frustum half-extent for the sun's shadow camera — must cover the full board
   * (half=60 at default GRID settings) regardless of where the player has panned. */
  frustumHalfExtent: 75,
  bias: -0.0015,
  normalBias: 0.02,
  /** Blur kernel for VSMShadowMap — soft edges without the acne PCF needs bias-tuning for. */
  radius: 3,
} as const;

export const RAIN = {
  count: 220,
  /** How far past the board edge particles can spawn — a little overscan so the field
   * doesn't visibly "start" at the boundary as the camera pans. */
  spawnHalfExtent: 70,
  spawnHeight: 32,
  fallSpeed: 34,
  /** Constant horizontal drift applied to every particle — one fixed wind direction,
   * not randomized per storm, matching the "no gameplay coupling" constraint. */
  windDriftX: -9,
  windDriftZ: 4,
  streakLength: 1.1,
  streakRadius: 0.035,
  opacity: 0.3,
  /** Matches SoundManager's stormAmbienceSwell duration (5s) plus a short fade tail,
   * so the visual and audio storm cues start and end together. */
  durationMs: 5500,
} as const;

export const PARTICLE_BURST = {
  dust: { color: COLORS.steelBlue, count: 10, durationMs: 500, speed: 2.2, size: 0.14 },
  spark: { color: COLORS.faultRed, count: 14, durationMs: 420, speed: 4.5, size: 0.09 },
  /** Milestone completion — brighter/wider spread than dust/spark, a real celebration
   * beat, not another utility-work cue. */
  celebrate: { color: COLORS.energizedGreen, count: 22, durationMs: 750, speed: 3.6, size: 0.17 },
} as const;

export const PLANT = {
  /** Real-world-informed relative sizing: nuclear/coal have the largest and steadiest
   * nameplate capacity; renewables have a materially lower capacity factor reflecting
   * real intermittency. `effectiveCapacityMW` (nameplate × factor) — not nameplate
   * alone — is what the Wave 3 network algorithm actually reads, so fuel type is a real
   * gameplay difficulty lever even though plants are never purchased/upgraded. First-pass
   * numbers, tunable like every other ECONOMY/STORM constant. */
  fuelSpecs: {
    coal: { nameplateCapacityMW: 300, capacityFactor: 0.85 },
    gas: { nameplateCapacityMW: 200, capacityFactor: 0.9 },
    nuclear: { nameplateCapacityMW: 500, capacityFactor: 0.93 },
    hydro: { nameplateCapacityMW: 150, capacityFactor: 0.75 },
    solar: { nameplateCapacityMW: 100, capacityFactor: 0.25 },
    wind: { nameplateCapacityMW: 120, capacityFactor: 0.35 },
  },
} as const;

export const SUBSTATION = {
  /** Placement CapEx cost — pricier than a base tower, reflecting bigger infrastructure.
   * Terrain-multiplied on top, same as tower cost. */
  cost: 220,
  /** Connection-slot count — governs the insulator-nub visual on its transmission side,
   * same "visual quantity = real capacity" discipline as Tower. Small and fixed: a
   * Substation is a single fixed-capacity purchase, not an upgradeable lattice tower. */
  maxConnections: 3,
  /** MW throughput ceiling the Wave 3 network algorithm reads. Sourced from this same
   * constant group as `maxConnections` so there's exactly one place either number could
   * drift from the other, not a separate upgrade-tier table. */
  capacityMW: 220,
  /** Crew-Hours cost to connect a Substation to a Neighborhood (a distribution span) —
   * same distance-scaled shape as `ECONOMY.spanCostBase`/`spanCostPerUnitDistance`, kept
   * as its own (smaller) pair since a short local feeder costs less labor than a
   * transmission span of the same length. */
  distributionSpanCostBase: 15,
  distributionSpanCostPerUnitDistance: 0.5,
} as const;

export const NEIGHBORHOOD = {
  /** Fixed starting demand for the Wave 1 hardcoded objective. Deliberately kept below
   * `ECONOMY.spanCapacityMW[0]` (50) — a fresh player stringing an all-tier-1 chain must
   * be *able* to serve the very first objective without a mandatory pre-upgrade; demand
   * growth (Wave 7) is what's supposed to force future upgrades, not day-one blocking. */
  startingDemandMW: 40,
  /** Continuous, not stepped — a creeping number that can flip "served" to "not served"
   * at any moment, organic pressure rather than an artificial cliff at a fixed mark
   * (PLAN.md's Wave 7 pacing decision). At this rate, crossing from the starting 40 MW
   * to a tier-1 span's 50 MW capacity ceiling takes ~200s — long enough to notice and
   * react to the warning telegraph below, not an ambush. */
  demandGrowthMWPerSec: 0.05,
  /** Soft ceiling so growth doesn't run away unboundedly — kept comfortably under a
   * maxed-out tier-3 span's 140 MW capacity so a fully-upgraded single-path chain can
   * always eventually catch up, rather than every Neighborhood inevitably outgrowing
   * what any topology could ever serve. */
  demandGrowthCapMW: 130,
  /** Lead time for the capacity warning telegraph — longer than the storm warning's 4s
   * since reacting means a real deliberate upgrade decision, not a quick glance. */
  demandWarningLeadSec: 30,
} as const;
