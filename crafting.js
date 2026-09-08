/**
 * Free-form forge / alchemy crafting.
 *
 * The player invents their own recipes: they choose how much coal, iron, gold
 * and mithril to throw into the forge, and the result is derived from the mix
 * itself. Nothing is hard-coded as a "known recipe" up front — the blend
 * determines the equipment archetype, the total investment determines the
 * quality tier, and a failed craft still produces a shoddy version of the item
 * rather than eating the ore for nothing.
 *
 * A recipe is identified by its exact ore ratio, so once a player finds a good
 * blend it is recorded in their recipe book and can be re-forged with one click.
 */

export const ORE_KEYS = ['coal', 'iron', 'gold', 'mithril'];

export const ORE_INFO = {
    coal: { label: '석탄', color: '#9aa3b2', power: 1 },
    iron: { label: '철광석', color: '#cfd8e3', power: 3 },
    gold: { label: '금광석', color: '#ffd873', power: 7 },
    mithril: { label: '미스릴', color: '#9ff3e0', power: 15 }
};

// Quality bands. `min` is the minimum craft score needed to reach the tier.
export const QUALITY_TIERS = [
    { id: 'crude', label: '조악한', color: '#8e8a95', min: -Infinity, powerMult: 0.55, prefix: '질 나쁜' },
    { id: 'normal', label: '노멀', color: '#d8d2e2', min: 18, powerMult: 1, prefix: '' },
    { id: 'fine', label: '고급', color: '#8fd9ff', min: 46, powerMult: 1.35, prefix: '정교한' },
    { id: 'rare', label: '희귀', color: '#d5a3ff', min: 92, powerMult: 1.8, prefix: '희귀한' },
    { id: 'epic', label: '영웅', color: '#ff9c6b', min: 175, powerMult: 2.4, prefix: '영웅급' },
    { id: 'legendary', label: '전설', color: '#ffcf6b', min: 300, powerMult: 3.3, prefix: '전설의' }
];

/**
 * Equipment archetypes. Each one is chosen by which ore dominates the mix and
 * how heavy the total charge is, so the player can reason about their blends.
 */
export const ITEM_ARCHETYPES = [
    {
        id: 'dagger', name: '단검', icon: '🗡️', slot: 'weapon',
        blurb: '가볍고 빠른 칼. 치명타에 특화됩니다.',
        dominant: 'coal', minMass: 0,
        stats: { attack: 0.7, crit: 0.05, hp: 0 }
    },
    {
        id: 'club', name: '곤봉', icon: '🏏', slot: 'weapon',
        blurb: '거칠게 벼려낸 둔기. 순수 화력이 높습니다.',
        dominant: 'coal', minMass: 26,
        stats: { attack: 1.05, crit: 0, hp: 4 }
    },
    {
        id: 'shortsword', name: '단검형 장검', icon: '⚔️', slot: 'weapon',
        blurb: '철을 주재료로 벼려낸 균형 잡힌 검.',
        dominant: 'iron', minMass: 0,
        stats: { attack: 1, crit: 0.03, hp: 2 }
    },
    {
        id: 'longsword', name: '장검', icon: '⚔️', slot: 'weapon',
        blurb: '묵직한 철검. 안정적인 공격력을 제공합니다.',
        dominant: 'iron', minMass: 30,
        stats: { attack: 1.2, crit: 0.04, hp: 5 }
    },
    {
        id: 'greatsword', name: '대검', icon: '🗡️', slot: 'weapon',
        blurb: '양손으로 휘두르는 거대한 철괴.',
        dominant: 'iron', minMass: 80,
        stats: { attack: 1.45, crit: 0.03, hp: 8 }
    },
    {
        id: 'gilded_blade', name: '황금 검', icon: '🌟', slot: 'weapon',
        blurb: '금으로 벼린 화려한 검. 치명타율이 뛰어납니다.',
        dominant: 'gold', minMass: 0,
        stats: { attack: 1.1, crit: 0.1, hp: 3 }
    },
    {
        id: 'sunspear', name: '태양창', icon: '🔱', slot: 'weapon',
        blurb: '금빛 창. 첫 일격과 치명타에 강합니다.',
        dominant: 'gold', minMass: 70,
        stats: { attack: 1.3, crit: 0.14, hp: 4 }
    },
    {
        id: 'mithril_edge', name: '미스릴 검', icon: '💠', slot: 'weapon',
        blurb: '미스릴을 벼려낸 신비한 검날.',
        dominant: 'mithril', minMass: 0,
        stats: { attack: 1.5, crit: 0.08, hp: 6 }
    },
    {
        id: 'void_reaver', name: '공허 절단검', icon: '🌌', slot: 'weapon',
        blurb: '미스릴을 아낌없이 쏟아부은 절대 병기.',
        dominant: 'mithril', minMass: 120,
        stats: { attack: 1.85, crit: 0.12, hp: 12 }
    },

    // ---------------------------------------------------------------- armor
    // Damage reduction (stats.defense) plus a little max HP. Defense converts
    // to a diminishing-returns damage multiplier in gameLogic, so there is no
    // hard cap to itemize around — heavier armor always helps a bit more.
    {
        id: 'rags', name: '누더기 갑옷', icon: '🧥', slot: 'armor',
        blurb: '겨우 몸을 가리는 수준의 넝마.',
        dominant: 'coal', minMass: 0,
        stats: { defense: 0.5, hp: 6 }
    },
    {
        id: 'padded_coat', name: '누빔 갑옷', icon: '🧵', slot: 'armor',
        blurb: '두툼하게 누빈 천 갑옷. 가볍고 은근히 튼튼합니다.',
        dominant: 'coal', minMass: 26,
        stats: { defense: 0.75, hp: 10 }
    },
    {
        id: 'chainmail', name: '사슬 갑옷', icon: '⛓️', slot: 'armor',
        blurb: '철을 엮어 짠 사슬 갑옷.',
        dominant: 'iron', minMass: 0,
        stats: { defense: 0.9, hp: 8 }
    },
    {
        id: 'plate_armor', name: '판금 갑옷', icon: '🛡️', slot: 'armor',
        blurb: '두꺼운 철판을 덧댄 중갑.',
        dominant: 'iron', minMass: 30,
        stats: { defense: 1.2, hp: 14 }
    },
    {
        id: 'gilded_mail', name: '황금 갑주', icon: '✨', slot: 'armor',
        blurb: '금박을 입힌 화려한 갑주. 보기와 달리 제법 단단합니다.',
        dominant: 'gold', minMass: 0,
        stats: { defense: 0.85, hp: 10 }
    },
    {
        id: 'radiant_plate', name: '찬란한 갑주', icon: '👑', slot: 'armor',
        blurb: '순금에 가까운 광채가 흐르는 갑주.',
        dominant: 'gold', minMass: 70,
        stats: { defense: 1.05, hp: 16 }
    },
    {
        id: 'mithril_mail', name: '미스릴 갑옷', icon: '💠', slot: 'armor',
        blurb: '가볍지만 강철보다 단단한 미스릴 갑옷.',
        dominant: 'mithril', minMass: 0,
        stats: { defense: 1.3, hp: 12 }
    },
    {
        id: 'abyssal_bulwark', name: '심연 방벽 갑주', icon: '🌌', slot: 'armor',
        blurb: '미스릴을 아낌없이 두른 최상급 방벽.',
        dominant: 'mithril', minMass: 120,
        stats: { defense: 1.7, hp: 22 }
    },

    // ------------------------------------------------------------ accessory
    // Small utility bonuses layered on top of traits: luck feeds the same
    // rare-ore roll as traits' luckBonus, crit/lifesteal combine additively
    // with the weapon/trait versions in gameLogic.
    {
        id: 'lucky_charm', name: '행운의 목각 부적', icon: '🍀', slot: 'accessory',
        blurb: '소박하지만 은근히 운이 따르는 부적.',
        dominant: 'coal', minMass: 0,
        stats: { luck: 1.0, hp: 2 }
    },
    {
        id: 'gleaming_charm', name: '빛나는 행운의 부적', icon: '🌟', slot: 'accessory',
        blurb: '반들반들 윤이 나는 부적. 운이 한층 더 따릅니다.',
        dominant: 'coal', minMass: 26,
        stats: { luck: 1.6, hp: 3 }
    },
    {
        id: 'iron_leech_ring', name: '흡혈의 철 반지', icon: '🩸', slot: 'accessory',
        blurb: '차가운 철에 새겨진 갈증의 문양.',
        dominant: 'iron', minMass: 0,
        stats: { lifesteal: 0.06, hp: 3 }
    },
    {
        id: 'steel_thirst_ring', name: '갈증의 강철 반지', icon: '🩸', slot: 'accessory',
        blurb: '더 깊이 새겨진 갈증의 문양.',
        dominant: 'iron', minMass: 30,
        stats: { lifesteal: 0.1, hp: 5 }
    },
    {
        id: 'gold_earring', name: '황금 귀걸이', icon: '👂', slot: 'accessory',
        blurb: '치명적인 순간을 노리는 화려한 장신구.',
        dominant: 'gold', minMass: 0,
        stats: { crit: 0.05, hp: 2 }
    },
    {
        id: 'radiant_necklace', name: '찬란한 황금 목걸이', icon: '📿', slot: 'accessory',
        blurb: '보는 순간 빈틈을 파고들게 만드는 목걸이.',
        dominant: 'gold', minMass: 70,
        stats: { crit: 0.08, hp: 3 }
    },
    {
        id: 'mithril_talisman', name: '미스릴 부적', icon: '💠', slot: 'accessory',
        blurb: '운과 정밀함을 함께 벼려낸 미스릴 세공품.',
        dominant: 'mithril', minMass: 0,
        stats: { luck: 0.8, crit: 0.03, hp: 4 }
    },
    {
        id: 'abyssal_seal', name: '심연의 인장', icon: '🔮', slot: 'accessory',
        blurb: '운·치명타·흡혈을 한데 두른 최상급 인장.',
        dominant: 'mithril', minMass: 120,
        stats: { luck: 1.2, crit: 0.04, lifesteal: 0.05, hp: 6 }
    }
];

/** Normalised ratio key so the same blend always maps to the same recipe. */
export function recipeKey(mix) {
    return ORE_KEYS.map((ore) => `${ore}:${Math.max(0, Math.floor(mix[ore] || 0))}`).join('|');
}

export function getMixMass(mix) {
    return ORE_KEYS.reduce((sum, ore) => sum + Math.max(0, Math.floor(mix[ore] || 0)), 0);
}

/** Raw material value of a blend. Rarer ore contributes far more power. */
export function getMixScore(mix) {
    return ORE_KEYS.reduce(
        (sum, ore) => sum + Math.max(0, Math.floor(mix[ore] || 0)) * ORE_INFO[ore].power,
        0
    );
}

export function getDominantOre(mix) {
    let best = 'coal';
    let bestValue = -1;
    ORE_KEYS.forEach((ore) => {
        const value = Math.max(0, Math.floor(mix[ore] || 0)) * ORE_INFO[ore].power;
        if (value > bestValue) {
            bestValue = value;
            best = ore;
        }
    });
    return best;
}

export const EQUIP_SLOTS = ['weapon', 'armor', 'accessory'];

/** Which item this blend forges for the chosen slot, before quality is rolled. */
export function resolveArchetype(mix, slot = 'weapon') {
    const dominant = getDominantOre(mix);
    const score = getMixScore(mix);
    const pool = ITEM_ARCHETYPES.filter((item) => item.slot === slot);
    const candidates = pool.filter((item) => item.dominant === dominant && score >= item.minMass);
    if (candidates.length === 0) {
        return pool.find((item) => item.dominant === dominant) || pool[0] || ITEM_ARCHETYPES[0];
    }
    return candidates[candidates.length - 1];
}

export function getTierForScore(score) {
    let tier = QUALITY_TIERS[0];
    QUALITY_TIERS.forEach((entry) => {
        if (score >= entry.min) tier = entry;
    });
    return tier;
}

export function getTierById(id) {
    return QUALITY_TIERS.find((tier) => tier.id === id) || QUALITY_TIERS[0];
}

/**
 * Blend purity. A focused recipe (mostly one ore) forges cleanly; a chaotic
 * dump of everything is more likely to come out crude. Adding a small amount of
 * a rarer ore as a "flux" is rewarded, so experimenting has a real payoff.
 */
export function getBlendQuality(mix) {
    const mass = getMixMass(mix);
    if (mass <= 0) return { purity: 0, flux: 0, balance: 0 };

    const dominant = getDominantOre(mix);
    const dominantCount = Math.max(0, Math.floor(mix[dominant] || 0));
    const purity = dominantCount / mass;

    // Flux bonus: a minority of ore rarer than the dominant one refines the item.
    const dominantPower = ORE_INFO[dominant].power;
    let fluxMass = 0;
    ORE_KEYS.forEach((ore) => {
        if (ORE_INFO[ore].power > dominantPower) fluxMass += Math.max(0, Math.floor(mix[ore] || 0));
    });
    const fluxRatio = fluxMass / mass;
    // Around 20% flux is ideal; too much destabilises the alloy.
    const flux = Math.max(0, 1 - Math.abs(fluxRatio - 0.2) / 0.35);

    const balance = purity * 0.62 + flux * 0.38;
    return { purity, flux, balance };
}

/**
 * Success odds for hitting (or beating) the blend's natural quality tier.
 * Luck helps, chaotic blends hurt, and the odds are never 0 or 1.
 */
export function getSuccessChance(mix, luck = 1) {
    const { balance } = getBlendQuality(mix);
    const mass = getMixMass(mix);
    const score = getMixScore(mix);
    if (mass <= 0) return 0;

    // Very large charges are harder to control.
    const massPenalty = Math.min(0.3, Math.max(0, (mass - 16) * 0.011));

    // Ambitious blends fight back: the more valuable the alloy the player is
    // reaching for, the less likely it is to survive the forge. This is what
    // makes a high-tier weapon feel earned rather than simply bought with ore.
    const ambitionPenalty = Math.min(0.34, Math.pow(Math.max(0, score) / 260, 0.85) * 0.34);

    // Forging is a gamble by default; skill (a clean, well-fluxed blend) and
    // luck pull it back up, but never to a sure thing.
    const chance = 0.06 + balance * 0.46 + Math.min(0.14, luck * 0.016)
        - massPenalty - ambitionPenalty;
    return Math.max(0.04, Math.min(0.82, chance));
}

/** Preview shown in the workshop before the player commits the ore. */
export function previewCraft(mix, luck = 1, slot = 'weapon') {
    const mass = getMixMass(mix);
    const score = getMixScore(mix);
    const archetype = resolveArchetype(mix, slot);
    const tier = getTierForScore(score);
    const blend = getBlendQuality(mix);
    const chance = getSuccessChance(mix, luck);

    return {
        valid: mass > 0,
        mass,
        score,
        archetype,
        tier,
        blend,
        chance,
        expectedName: buildItemName(archetype, tier),
        expectedStats: buildItemStats(archetype, tier, score)
    };
}

export function buildItemName(archetype, tier) {
    return tier.prefix ? `${tier.prefix} ${archetype.name}` : archetype.name;
}

// Stat keys that scale with the mix's raw material score, the same way a
// weapon's attack does. Everything else (crit/luck/lifesteal) is a gentler,
// mostly tier-driven percentage-style bonus.
const SCALED_STAT_KEYS = new Set(['attack', 'defense']);

export function buildItemStats(archetype, tier, score) {
    const scale = Math.pow(Math.max(1, score), 0.62);
    const stats = {};
    Object.entries(archetype.stats).forEach(([key, base]) => {
        if (key === 'hp') {
            stats.hp = Math.round(base * tier.powerMult);
        } else if (SCALED_STAT_KEYS.has(key)) {
            stats[key] = Math.max(1, Math.round(scale * base * tier.powerMult));
        } else {
            // crit / luck / lifesteal etc: gentle, tier-driven percentages.
            stats[key] = Math.round(base * tier.powerMult * 1000) / 1000;
        }
    });
    return stats;
}

/**
 * Perform the craft. Returns the forged item plus whether the roll succeeded.
 * A failure drops the result one or two tiers but never returns nothing.
 */
export function forgeItem(mix, luck = 1, slot = 'weapon') {
    const score = getMixScore(mix);
    const archetype = resolveArchetype(mix, slot);
    const naturalTier = getTierForScore(score);
    const chance = getSuccessChance(mix, luck);
    const roll = Math.random();
    const success = roll < chance;

    const naturalIndex = QUALITY_TIERS.indexOf(naturalTier);
    let tierIndex = naturalIndex;

    if (success) {
        // A strong roll can even push one tier above the blend's natural grade.
        const critical = roll < chance * 0.16;
        if (critical) tierIndex = Math.min(QUALITY_TIERS.length - 1, naturalIndex + 1);
    } else {
        // Failure bites harder now: a near miss still costs a full tier, and a
        // badly botched pour can collapse the alloy by three. The ore is never
        // lost, so the sting is the wasted grade, not a wasted trip.
        const severity = (roll - chance) / Math.max(0.05, 1 - chance);
        const drop = severity > 0.72 ? 3 : severity > 0.38 ? 2 : 1;
        tierIndex = Math.max(0, naturalIndex - drop);
    }

    const tier = QUALITY_TIERS[tierIndex];
    const item = {
        id: `${archetype.id}-${tier.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        archetypeId: archetype.id,
        slot: archetype.slot,
        name: buildItemName(archetype, tier),
        icon: archetype.icon,
        blurb: archetype.blurb,
        tierId: tier.id,
        score,
        stats: buildItemStats(archetype, tier, score),
        mix: ORE_KEYS.reduce((acc, ore) => {
            acc[ore] = Math.max(0, Math.floor(mix[ore] || 0));
            return acc;
        }, {})
    };

    return {
        item,
        success,
        critical: success && tierIndex > naturalIndex,
        naturalTierId: naturalTier.id,
        chance
    };
}

/** Total combat value used to compare two pieces of equipment (same-slot only). */
export function getItemPower(item) {
    if (!item || !item.stats) return 0;
    const s = item.stats;
    return (s.attack || 0)
        + (s.defense || 0) * 1.4
        + (s.crit || 0) * 120
        + (s.hp || 0) * 0.6
        + (s.luck || 0) * 15
        + (s.lifesteal || 0) * 100;
}
