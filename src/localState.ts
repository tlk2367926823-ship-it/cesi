import type { MockAsset, ShareDraft, SharePlatform } from "./types";

const STORAGE_KEY = "taotian-share-state";

function scopedKey(scope = "default") {
  return `${STORAGE_KEY}:${encodeURIComponent(scope || "default")}`;
}

export interface SavedShareState {
  draft: ShareDraft | null;
  asset: MockAsset | null;
  platform?: SharePlatform;
  savedAt?: number;
}

const emptyState: SavedShareState = {
  draft: null,
  asset: null,
};

export function loadSavedShareState(scope = "default"): SavedShareState {
  try {
    const raw = window.localStorage.getItem(scopedKey(scope));
    if (!raw) return emptyState;
    const saved = JSON.parse(raw) as SavedShareState;
    if (typeof saved.savedAt !== "number" || !Number.isFinite(saved.savedAt) ||
        saved.savedAt <= 0 || saved.savedAt > Date.now() ||
        Date.now() - saved.savedAt > 24 * 60 * 60 * 1000) return emptyState;
    if (!saved.draft || !saved.asset || typeof saved.draft.title !== "string" ||
        typeof saved.draft.body !== "string" || !Array.isArray(saved.draft.tags) ||
        !saved.draft.tags.every(tag => typeof tag === "string") ||
        typeof saved.asset.url !== "string" ||
        !["redbook", "meituan", "dianping"].includes(saved.platform || "")) return emptyState;
    return { ...emptyState, ...saved };
  } catch {
    return emptyState;
  }
}

export function saveShareState(nextState: Partial<SavedShareState>, scope = "default") {
  const current = loadSavedShareState(scope);
  try {
    window.localStorage.setItem(scopedKey(scope), JSON.stringify({ ...current, ...nextState, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearShareState(scope = "default") {
  try {
    window.localStorage.removeItem(scopedKey(scope));
  } catch {
    // The in-memory draft remains usable when browser storage is unavailable.
  }
}
