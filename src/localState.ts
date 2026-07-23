import type { MockAsset, ShareDraft } from "./types";

const STORAGE_KEY = "taotian-share-state";

function scopedKey(scope = "default") {
  return `${STORAGE_KEY}:${encodeURIComponent(scope || "default")}`;
}

export interface SavedShareState {
  draft: ShareDraft | null;
  asset: MockAsset | null;
}

const emptyState: SavedShareState = {
  draft: null,
  asset: null,
};

export function loadSavedShareState(scope = "default"): SavedShareState {
  try {
    const raw = window.localStorage.getItem(scopedKey(scope));
    if (!raw) return emptyState;
    return { ...emptyState, ...JSON.parse(raw) };
  } catch {
    return emptyState;
  }
}

export function saveShareState(nextState: Partial<SavedShareState>, scope = "default") {
  const current = loadSavedShareState(scope);
  window.localStorage.setItem(scopedKey(scope), JSON.stringify({ ...current, ...nextState }));
}

export function clearShareState(scope = "default") {
  window.localStorage.removeItem(scopedKey(scope));
}
