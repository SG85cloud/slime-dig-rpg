/**
 * Per-player mine progression save/load.
 *
 * The whole growth state of a run — innate traits, ore stockpile, strength /
 * speed / luck levels, attack power, HP, quest stage and recruited workers —
 * is serialised into localStorage under a stable per-player key so that
 * re-entering the mine continues the same adventure instead of restarting.
 */

const SAVE_VERSION = 3;
const STORAGE_PREFIX = 'gothic-slime-mine:save';
const PROFILE_KEY = 'gothic-slime-mine:profile';
// Meta progression lives under its own key so it survives clearProgress() —
// a fresh leader still carries forward whatever the lineage has earned.
const META_PREFIX = 'gothic-slime-mine:meta';

// A stable per-browser player id. The multiplayer session id changes on every
// reload, so progression is keyed to this persistent profile id instead.
export function getProfileId() {
    try {
        let profileId = window.localStorage.getItem(PROFILE_KEY);
        if (!profileId) {
            profileId = `slime-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
            window.localStorage.setItem(PROFILE_KEY, profileId);
        }
        return profileId;
    } catch (error) {
        return 'slime-local';
    }
}

function storageKey(profileId) {
    return `${STORAGE_PREFIX}:${profileId}`;
}

export function loadProgress(profileId) {
    try {
        const raw = window.localStorage.getItem(storageKey(profileId));
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || data.version !== SAVE_VERSION) return null;
        return data;
    } catch (error) {
        console.warn('[save] 진행 상황을 불러오지 못했습니다.', error);
        return null;
    }
}

export function saveProgress(profileId, payload) {
    try {
        const data = {
            version: SAVE_VERSION,
            savedAt: Date.now(),
            ...payload
        };
        window.localStorage.setItem(storageKey(profileId), JSON.stringify(data));
        return true;
    } catch (error) {
        console.warn('[save] 진행 상황을 저장하지 못했습니다.', error);
        return false;
    }
}

export function clearProgress(profileId) {
    try {
        window.localStorage.removeItem(storageKey(profileId));
        return true;
    } catch (error) {
        return false;
    }
}

// --------------------------------------------------------------- meta
// A separate, permanent ledger: legacy points earned by past leaders and the
// one-time starting-bonus unlocks bought with them. Deliberately untouched by
// clearProgress() / resetProgress() so a fresh run still benefits from it.
export function loadMeta(profileId) {
    try {
        const raw = window.localStorage.getItem(`${META_PREFIX}:${profileId}`);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return {
            legacyPoints: Math.max(0, Number(data.legacyPoints) || 0),
            upgrades: {
                startingWorker: Math.max(0, Math.floor(Number(data.upgrades?.startingWorker) || 0)),
                startingTraitBonus: Math.max(0, Math.floor(Number(data.upgrades?.startingTraitBonus) || 0)),
                startingOreTier: Math.max(0, Math.floor(Number(data.upgrades?.startingOreTier) || 0))
            }
        };
    } catch (error) {
        console.warn('[save] 유산 정보를 불러오지 못했습니다.', error);
        return null;
    }
}

export function saveMeta(profileId, meta) {
    try {
        window.localStorage.setItem(`${META_PREFIX}:${profileId}`, JSON.stringify(meta));
        return true;
    } catch (error) {
        console.warn('[save] 유산 정보를 저장하지 못했습니다.', error);
        return false;
    }
}
