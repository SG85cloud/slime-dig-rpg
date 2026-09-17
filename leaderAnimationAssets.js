// V37 authored motion asset for the leader slime.
// These are presentation profiles, not skeletal clips: the current leader GLB
// is an unrigged static mesh, so the profiles drive its whole-body squash,
// bounce, lean and recovery while keeping gameplay transforms untouched.
export const LEADER_ANIMATION_PROFILES = Object.freeze({
    idle:   { speed: 2.15, squash: 0.014, bounce: 0.018, lean: 0.014, glow: 0.10 },
    walk:   { speed: 9.0,  squash: 0.052, bounce: 0.070, lean: 0.070, glow: 0.16 },
    mine:   { speed: 7.2,  squash: 0.100, bounce: 0.115, lean: 0.085, glow: 0.18 },
    attack: { speed: 11.5, squash: 0.075, bounce: 0.045, lean: 0.115, glow: 0.24 },
    hit:    { speed: 16.0, squash: 0.115, bounce: 0.025, lean: 0.14, glow: 0.28 },
    death:  { speed: 3.2,  squash: 0.48,  bounce: 0.0,   lean: 0.20, glow: 0.02 }
});

export function getLeaderAnimationProfile(state) {
    return LEADER_ANIMATION_PROFILES[state] || LEADER_ANIMATION_PROFILES.idle;
}
