import type { MockAsset, ShareDraft } from "./types";

const STORAGE_KEY = "huizhi-redbook-share-state";

export interface SavedShareState {
  draft: ShareDraft | null;
  asset: MockAsset | null;
}

const emptyState: SavedShareState = {
  draft: null,
  asset: null,
};

export function loadSavedShareState(): SavedShareState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    return { ...emptyState, ...JSON.parse(raw) };
  } catch {
    return emptyState;
  }
}

export function saveShareState(nextState: Partial<SavedShareState>) {
  const current = loadSavedShareState();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...nextState }));
}

export function clearShareState() {
  window.localStorage.removeItem(STORAGE_KEY);
}
