const STORAGE_KEY = 'right-of-way-save';
const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  capEx: number;
  crewHours: number;
  towers: { i: number; j: number; tier: number; pendingMs?: number; branch?: 'capacity' | 'resilience' }[];
  /** Tower-to-tower transmission spans only — unchanged shape/meaning since Phase 1. */
  spans: { a: [number, number]; b: [number, number]; faulted?: boolean; throughputTier?: number }[];
  /** Player-placed, so these must persist — a Substation costs real CapEx.
   * `connections` is deliberately not stored here: like towers, it's re-derived by
   * replaying span connections on load. `tier` is the only new field the Wave 10
   * 2-tier upgrade system needs — everything else about it stays purely live/derived.
   * Absent on every pre-Wave-10 save; resolved to tier 1 on load. */
  substations?: { i: number; j: number; pendingMs?: number; tier?: number }[];
  /** Game-spawned (never player-placed), but persisted starting Wave 2: once spans can
   * reference a Plant/Neighborhood by identity (`transmissionLinks`/`distributionSpans`
   * below), that identity has to survive a reload — a fresh deterministic respawn each
   * load is only safe as long as nothing else references it, which stopped being true
   * once links exist. */
  plants?: { id: string; i: number; j: number; fuelType: string }[];
  neighborhoods?: { id: string; i: number; j: number; demandMW: number }[];
  /** Any transmission-tier span touching a Substation and/or PowerPlant on at least one
   * end (Tower-Tower spans stay in `spans` above, unchanged). Endpoints are stored as
   * `[i, j]` grid coordinates — safe to resolve against a combined tower+substation+
   * plant lookup on load since no two entities ever share a cell. */
  transmissionLinks?: { a: [number, number]; b: [number, number]; faulted?: boolean; throughputTier?: number }[];
  /** Substation-to-Neighborhood distribution spans — one per Neighborhood by design (see
   * PLAN.md's topology decision), referenced by Substation coordinates + Neighborhood id
   * (ids are stable and don't need a coordinate-uniqueness assumption to resolve). */
  distributionSpans?: { substation: [number, number]; neighborhoodId: string; faulted?: boolean; throughputTier?: number }[];
  /** Milestone lifecycle (Wave 6) — references Plant/Neighborhood by their stable `id`,
   * not position, so objective bookkeeping survives whatever `spawnNextObjective` picks
   * next. `completedAt` presence means completed; its absence means still active —
   * matches the existing `pendingMs`-absent-means-cleared convention `Tower`/`Substation`
   * already use. */
  objectives?: { id: string; plantId: string; neighborhoodId: string; targetDemandMW: number; completedAt?: number }[];
  camera?: { x: number; z: number; zoom: number };
}

export function saveGame(data: Omit<SaveData, 'version'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SAVE_VERSION, ...data }));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — not critical, skip silently.
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData;
    if (parsed.version !== SAVE_VERSION || !Array.isArray(parsed.towers) || !Array.isArray(parsed.spans)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
