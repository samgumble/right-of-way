const STORAGE_KEY = 'right-of-way-save';
const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  capEx: number;
  crewHours: number;
  towers: { i: number; j: number; tier: number; pendingMs?: number; branch?: 'capacity' | 'resilience' }[];
  spans: { a: [number, number]; b: [number, number]; faulted?: boolean }[];
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
