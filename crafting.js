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

export const ORE_KEYS = ['coal', 'iron', 'frostite', 'gold', 'obsidian', 'mithril', 'sunstone'];

export const ORE_INFO = {
    coal: { label: '석탄', color: '#9aa3b2', power: 1 },
    iron: { label: '철광석', color: '#cfd8e3', power: 3 },
    frostite: { label: '빙정석', color: '#8ceeff', power: 11 },
    gold: { label: '금광석', color: '#ffd873', power: 7 },
    obsidian: { label: '흑요석', color: '#b875ff', power: 22 },
    mithril: { label: '미스릴', color: '#9ff3e0', power: 15 },
    sunstone: { label: '태양석', color: '#ffbd68', power: 28 }
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
        id: 'frost_scepter', name: '빙결 지팡이', icon: '🧊', slot: 'weapon',
        blurb: '빙정석을 깎아 만든 차가운 지팡이. 안정적인 치명타를 냅니다.',
        dominant: 'frostite', minMass: 0,
        stats: { attack: 1.25, crit: 0.07, hp: 5 }
    },
    {
        id: 'frost_lance', name: '서리 창', icon: '❄️', slot: 'weapon',
        blurb: '고밀도 빙정석 창끝이 적의 움직임을 꿰뚫습니다.',
        dominant: 'frostite', minMass: 78,
        stats: { attack: 1.5, crit: 0.1, hp: 9 }
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
    {
        id: 'obsidian_axe', name: '흑요석 도끼', icon: '🪓', slot: 'weapon',
        blurb: '공허의 균열을 머금은 묵직한 도끼.',
        dominant: 'obsidian', minMass: 0,
        stats: { attack: 1.6, crit: 0.03, hp: 9 }
    },
    {
        id: 'void_maul', name: '공허 망치', icon: '🔨', slot: 'weapon',
        blurb: '흑요석을 한계까지 압축한 파괴 병기.',
        dominant: 'obsidian', minMass: 115,
        stats: { attack: 1.95, crit: 0.04, hp: 16 }
    },
    {
        id: 'sunblade', name: '태양검', icon: '☀️', slot: 'weapon',
        blurb: '태양석의 열기를 품은 눈부신 검.',
        dominant: 'sunstone', minMass: 0,
        stats: { attack: 1.5, crit: 0.13, hp: 5 }
    },
    {
        id: 'dawn_halberd', name: '여명의 할버드', icon: '🌅', slot: 'weapon',
        blurb: '태양석을 대량으로 박아 넣은 지상 돌파용 무기.',
        dominant: 'sunstone', minMass: 145,
        stats: { attack: 1.9, crit: 0.17, hp: 11 }
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
        id: 'frost_mail', name: '빙정 갑옷', icon: '🥶', slot: 'armor',
        blurb: '빙정석 조각을 엮어 붙인 서늘한 갑옷.',
        dominant: 'frostite', minMass: 0,
        stats: { defense: 1.0, hp: 9 }
    },
    {
        id: 'rime_plate', name: '서리 결정 갑주', icon: '❄️', slot: 'armor',
        blurb: '두터운 서리 결정이 충격을 통째로 얼려버립니다.',
        dominant: 'frostite', minMass: 78,
        stats: { defense: 1.35, hp: 15 }
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
    {
        id: 'obsidian_plate', name: '흑요석 갑옷', icon: '🖤', slot: 'armor',
        blurb: '공허의 균열을 두른 묵직한 흑요석 판금.',
        dominant: 'obsidian', minMass: 0,
        stats: { defense: 1.45, hp: 16 }
    },
    {
        id: 'void_bastion', name: '공허 파쇄 갑주', icon: '🌑', slot: 'armor',
        blurb: '흑요석을 한계까지 압축한 최상급 방벽.',
        dominant: 'obsidian', minMass: 115,
        stats: { defense: 1.85, hp: 26 }
    },
    {
        id: 'sun_plate', name: '태양 갑옷', icon: '🔆', slot: 'armor',
        blurb: '태양석의 열기가 스며들어 은은히 빛나는 갑옷.',
        dominant: 'sunstone', minMass: 0,
        stats: { defense: 1.6, hp: 18 }
    },
    {
        id: 'dawn_bulwark', name: '여명의 갑주', icon: '🌅', slot: 'armor',
        blurb: '태양석을 대량으로 두른, 지상의 빛을 두른 최상급 갑주.',
        dominant: 'sunstone', minMass: 145,
        stats: { defense: 2.05, hp: 30 }
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
        id: 'frost_amulet', name: '서리 부적', icon: '🧿', slot: 'accessory',
        blurb: '차가운 빙정석 조각을 엮은 부적.',
        dominant: 'frostite', minMass: 0,
        stats: { luck: 0.9, crit: 0.02, hp: 4 }
    },
    {
        id: 'rime_seal', name: '빙결의 인장', icon: '❄️', slot: 'accessory',
        blurb: '서릿발 같은 정밀함을 벼려낸 인장.',
        dominant: 'frostite', minMass: 78,
        stats: { luck: 1.3, crit: 0.03, hp: 6 }
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
    },
    {
        id: 'obsidian_ring', name: '흑요석 반지', icon: '🩸', slot: 'accessory',
        blurb: '공허의 균열을 삼킨 갈증의 반지.',
        dominant: 'obsidian', minMass: 0,
        stats: { lifesteal: 0.08, hp: 5 }
    },
    {
        id: 'void_signet', name: '심연의 흑요석 인장', icon: '🌑', slot: 'accessory',
        blurb: '흑요석에 새겨진 갈증과 정밀함의 문양.',
        dominant: 'obsidian', minMass: 115,
        stats: { lifesteal: 0.13, crit: 0.04, hp: 8 }
    },
    {
        id: 'sun_necklace', name: '태양 목걸이', icon: '📿', slot: 'accessory',
        blurb: '태양석의 빛이 스며든 목걸이.',
        dominant: 'sunstone', minMass: 0,
        stats: { crit: 0.09, luck: 0.5, hp: 5 }
    },
    {
        id: 'dawn_relic', name: '여명의 성물', icon: '🌅', slot: 'accessory',
        blurb: '지상의 빛을 한데 모은 최상급 성물.',
        dominant: 'sunstone', minMass: 145,
        stats: { crit: 0.14, luck: 1.0, lifesteal: 0.04, hp: 10 }
    }
];

/**
 * Curated starting points for a player who doesn't want to guess ratios from
 * scratch. These are not a separate guaranteed-outcome system — loading one
 * just fills the ore sliders, and the usual dominant-ore/mass/tier rules
 * still decide what actually comes out of the forge.
 */
export const DEFAULT_RECIPES = [
    {
        id: 'starter_weapon',
        slot: 'weapon',
        label: '초급 무기 조합',
        note: '철을 주재료로 삼은 안정적인 첫 검.',
        mix: { coal: 30, iron: 20, gold: 0, mithril: 0 }
    },
    {
        id: 'advanced_weapon',
        slot: 'weapon',
        label: '상급 무기 조합',
        note: '철을 대량으로 쏟아붓는 고위험 고보상 조합.',
        mix: { coal: 100, iron: 500, gold: 5, mithril: 0 }
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
        expectedStats: buildItemStats(archetype, tier, score),
        // The exact bonus rolls only lock in at craft time — this is just
        // how many the blend's natural tier would grant.
        optionCount: getOptionCount(tier.id),
        hasSpecialOption: tier.id === 'legendary'
    };
}

export function buildItemName(archetype, tier) {
    return tier.prefix ? `${tier.prefix} ${archetype.name}` : archetype.name;
}

/**
 * Bonus option rolls layered on top of an item's base archetype stats.
 * Higher tiers roll more of them, and the top tier always adds one
 * guaranteed pick from a stronger, slot-specific special pool — a unique
 * effect rather than just a bigger number. Only stat keys the gameplay code
 * actually reads for that slot are used here, so nothing rolls dead.
 */
const OPTION_POOLS = {
    weapon: [
        { id: 'atk', key: 'attack', roll: (scale) => Math.max(1, Math.round(scale * 0.16)), label: (v) => `공격력 +${v}` },
        { id: 'crit', key: 'crit', roll: () => (2 + Math.floor(Math.random() * 4)) / 100, label: (v) => `치명타 확률 +${Math.round(v * 100)}%` },
        { id: 'hp', key: 'hp', roll: (scale) => Math.max(2, Math.round(scale * 0.35)), label: (v) => `최대 체력 +${v}` }
    ],
    armor: [
        { id: 'def', key: 'defense', roll: (scale) => Math.max(1, Math.round(scale * 0.14)), label: (v) => `방어력 +${v}` },
        { id: 'hp', key: 'hp', roll: (scale) => Math.max(3, Math.round(scale * 0.45)), label: (v) => `최대 체력 +${v}` }
    ],
    accessory: [
        { id: 'luck', key: 'luck', roll: () => 1 + Math.floor(Math.random() * 3), label: (v) => `행운 +${v}` },
        { id: 'crit', key: 'crit', roll: () => (2 + Math.floor(Math.random() * 4)) / 100, label: (v) => `치명타 확률 +${Math.round(v * 100)}%` },
        { id: 'lifesteal', key: 'lifesteal', roll: () => (2 + Math.floor(Math.random() * 4)) / 100, label: (v) => `흡혈 확률 +${Math.round(v * 100)}%` },
        { id: 'hp', key: 'hp', roll: (scale) => Math.max(2, Math.round(scale * 0.3)), label: (v) => `최대 체력 +${v}` }
    ]
};

const SPECIAL_OPTIONS = {
    weapon: [
        { id: 'spell_proc', key: 'spellProcChance', value: 0.05, label: '5% 확률로 마법 폭발 발동' },
        { id: 'vampiric', key: 'lifesteal', value: 0.15, label: '흡혈 확률 +15%' }
    ],
    armor: [
        { id: 'fortress', key: 'blockChance', value: 0.15, label: '피격 시 15% 확률로 피해 무효' },
        { id: 'colossus', key: 'hp', value: 30, label: '최대 체력 +30' }
    ],
    accessory: [
        { id: 'fortune', key: 'luck', value: 6, label: '행운 +6' },
        { id: 'precision', key: 'crit', value: 0.1, label: '치명타 확률 +10%' }
    ]
};

/** How many random bonus options a tier rolls, before any guaranteed special. */
export function getOptionCount(tierId) {
    return { crude: 0, normal: 0, fine: 1, rare: 2, epic: 3, legendary: 3 }[tierId] || 0;
}

/** Rolls this item's bonus options for the forge — see OPTION_POOLS above. */
function rollItemOptions(slot, tierId, score) {
    const pool = OPTION_POOLS[slot] || [];
    const count = Math.min(pool.length, getOptionCount(tierId));
    const scale = Math.pow(Math.max(1, score), 0.62);

    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, count).map((option) => {
        const value = option.roll(scale);
        return { key: option.key, value, label: option.label(value) };
    });

    if (tierId === 'legendary') {
        const specialPool = SPECIAL_OPTIONS[slot] || [];
        if (specialPool.length > 0) {
            const special = specialPool[Math.floor(Math.random() * specialPool.length)];
            picks.push({ key: special.key, value: special.value, label: special.label, special: true });
        }
    }

    return picks;
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
    const baseStats = buildItemStats(archetype, tier, score);
    const options = rollItemOptions(archetype.slot, tier.id, score);
    const stats = { ...baseStats };
    options.forEach((option) => {
        stats[option.key] = Math.round(((stats[option.key] || 0) + option.value) * 1000) / 1000;
    });

    const item = {
        id: `${archetype.id}-${tier.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        archetypeId: archetype.id,
        slot: archetype.slot,
        name: buildItemName(archetype, tier),
        icon: archetype.icon,
        blurb: archetype.blurb,
        tierId: tier.id,
        score,
        stats,
        options: options.map((option) => ({ label: option.label, special: !!option.special })),
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
        + (s.lifesteal || 0) * 100
        + (s.spellProcChance || 0) * 200
        + (s.blockChance || 0) * 150;
}
