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
  spanCostBase: 10,
  spanCostPerUnitDistance: 0.6,
  towerMaxTier: 3,
  /** Connection capacity per tier, indexed by (tier - 1). */
  towerTierCapacity: [2, 4, 6] as const,
  /** Cost to upgrade FROM tier (index + 1) TO the next tier. */
  towerUpgradeCost: [
    { capEx: 150, crewHours: 30 },
    { capEx: 300, crewHours: 60 },
  ],
} as const;

export const DENY_SHAKE_DURATION_MS = 260;

export const TERRAIN = {
  hillCostMultiplier: 1.6,
  /** Below this noise value a node is water (unbuildable); above the upper one, a hill. */
  waterThreshold: -0.9,
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
} as const;

export const PERMIT = {
  /** Every new tower spends this long in a pending state before it can be selected/wired. */
  pendingDurationSec: 10,
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
} as const;
