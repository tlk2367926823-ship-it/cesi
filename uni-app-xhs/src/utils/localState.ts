import type { MockAsset, ShareDraft } from "../types";

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
    const raw = uni.getStorageSync(STORAGE_KEY);
    if (!raw) return emptyState;
    return { ...emptyState, ...JSON.parse(raw) };
  } catch {
    return emptyState;
  }
}

export function saveShareState(nextState: Partial<SavedShareState>) {
  const current = loadSavedShareState();
  uni.setStorageSync(STORAGE_KEY, JSON.stringify({ ...current, ...nextState }));
}

export function clearShareState() {
  try {
    uni.removeStorageSync(STORAGE_KEY);
  } catch {}
}
