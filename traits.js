/**
 * Innate trait catalog for the leader slime.
 *
 * The leader carries exactly one trait for the whole run, so each entry is a
 * build-defining pick, not a stat sliver: five traits per category, each with
 * one unmistakable headline effect (roughly 1.5x-2x on a single stat) instead
 * of a pile of small, hard-to-parse bonuses. Categories:
 *   mining  - ore yield, swing speed, vein reserves, rare-ore luck
 *   combat  - damage, crit, defense
 *   craft   - crafting cost, upgrade cost, ore value
 *   special - worker squad power, mobility, starting resources
 *
 * Modifier keys (all optional, defaults are neutral):
 *   swingSpeedMult      multiplies pickaxe swing rate (higher = faster)
 *   swingsRequiredMult  multiplies swings needed per ore (lower = easier)
 *   luckBonus           flat bonus added to the effective luck stat
 *   doubleOreChance     chance to double the whole pull
 *   reservesBonus       extra reserves on newly spawned veins
 *   rareVeinBonus       extra weight toward rarer veins spawning
 *   attackMult          multiplies leader battle damage
 *   critChance          chance to deal critical damage
 *   critMult            critical damage multiplier
 *   damageTakenMult     multiplies incoming damage (lower = tankier)
 *   maxHpBonus          flat max HP bonus
 *   lifestealChance     chance to heal on a landed hit
 *   upgradeCostMult     multiplies stat upgrade ore cost (lower = cheaper)
 *   craftCostMult       multiplies crafting cost (lower = cheaper)
 *   craftPowerBonus     extra attack power gained per craft
 *   oreValueMult        multiplies ore gained from crafting refunds
 *   moveSpeedMult       multiplies leader movement speed
 *   workerSwingMult     multiplies worker mining rate
 *   workerAttackMult    multiplies worker attack damage
 *   startingBonus       ore granted at run start
 */

export const TRAIT_CATEGORIES = {
    mining: { label: '채광', color: '#b7f3ff' },
    combat: { label: '전투', color: '#ff9c9c' },
    craft: { label: '제작', color: '#ffe39a' },
    special: { label: '특수', color: '#d5b3ff' }
};

export const TRAITS = [
    // ---------------------------------------------------------------- mining
    { id: 'mining_zealot', name: '채굴의 화신', category: 'mining', rarity: 'rare', description: '광석당 필요한 곡괭이질이 50% 줄어 채굴 속도가 사실상 2배가 됩니다.', modifiers: { swingsRequiredMult: 0.5 } },
    { id: 'relentless_arm', name: '멈추지 않는 팔', category: 'mining', rarity: 'rare', description: '곡괭이를 휘두르는 속도가 2배로 빨라집니다.', modifiers: { swingSpeedMult: 2.0 } },
    { id: 'golden_eye', name: '황금의 눈', category: 'mining', rarity: 'epic', description: '행운이 10 증가해 금·미스릴 같은 고급 광석이 훨씬 자주 나옵니다.', modifiers: { luckBonus: 10 } },
    { id: 'twin_hands', name: '쌍둥이 손', category: 'mining', rarity: 'legendary', description: '광석을 캘 때마다 100% 확률로 두 배로 얻습니다.', modifiers: { doubleOreChance: 1.0 } },
    { id: 'vein_prophet', name: '대광맥의 예언자', category: 'mining', rarity: 'common', description: '광맥의 매장량이 8 늘고, 고급 광맥이 훨씬 자주 나타납니다.', modifiers: { reservesBonus: 8, rareVeinBonus: 5 } },

    // ---------------------------------------------------------------- combat
    { id: 'berserk_soul', name: '광폭한 영혼', category: 'combat', rarity: 'legendary', description: '무기 공격력이 2배가 됩니다.', modifiers: { attackMult: 2.0 } },
    { id: 'diamond_skin', name: '금강 피부', category: 'combat', rarity: 'epic', description: '받는 피해가 50% 감소합니다.', modifiers: { damageTakenMult: 0.5 } },
    { id: 'executioner_soul', name: '처형자의 혼', category: 'combat', rarity: 'rare', description: '치명타 확률 35%, 치명타 피해 2.5배.', modifiers: { critChance: 0.35, critMult: 2.5 } },
    { id: 'undying_core', name: '불멸의 핵', category: 'combat', rarity: 'rare', description: '최대 HP가 60 증가합니다.', modifiers: { maxHpBonus: 60 } },
    { id: 'vampiric_soul', name: '흡혈의 영혼', category: 'combat', rarity: 'common', description: '50% 확률로 공격이 적중할 때 체력을 회복합니다.', modifiers: { lifestealChance: 0.5 } },

    // ----------------------------------------------------------------- craft
    { id: 'legendary_smith', name: '전설의 대장장이', category: 'craft', rarity: 'legendary', description: '모든 제작 비용이 50% 감소합니다.', modifiers: { craftCostMult: 0.5 } },
    { id: 'alloy_master', name: '합금의 대가', category: 'craft', rarity: 'epic', description: '제작할 때마다 공격력이 +10 추가로 상승합니다.', modifiers: { craftPowerBonus: 10 } },
    { id: 'forge_savant', name: '연마의 대가', category: 'craft', rarity: 'rare', description: '스탯 강화 비용이 50% 감소합니다.', modifiers: { upgradeCostMult: 0.5 } },
    { id: 'ore_alchemist', name: '광석 연금술사', category: 'craft', rarity: 'rare', description: '광석의 가치가 2배가 됩니다.', modifiers: { oreValueMult: 2.0 } },
    { id: 'frugal_master', name: '알뜰한 대장인', category: 'craft', rarity: 'common', description: '제작 비용과 강화 비용이 각각 25% 감소합니다.', modifiers: { craftCostMult: 0.75, upgradeCostMult: 0.75 } },

    // --------------------------------------------------------------- special
    { id: 'dragon_blood', name: '용의 피', category: 'special', rarity: 'legendary', description: '무기 공격력과 워커 공격력이 모두 50% 증가하고, 최대 HP가 30 늘어납니다.', modifiers: { attackMult: 1.5, workerAttackMult: 1.5, maxHpBonus: 30 } },
    { id: 'warlord_king', name: '전쟁군주', category: 'special', rarity: 'epic', description: '워커 슬라임의 공격력이 2배가 됩니다.', modifiers: { workerAttackMult: 2.0 } },
    { id: 'foreman_king', name: '현장의 왕', category: 'special', rarity: 'rare', description: '워커 슬라임의 채굴량이 2배가 됩니다.', modifiers: { workerSwingMult: 2.0 } },
    { id: 'royal_heir', name: '왕가의 후예', category: 'special', rarity: 'rare', description: '시작할 때 석탄 20개, 철광석 10개를 지니고 시작합니다.', modifiers: { startingBonus: { coal: 20, iron: 10 } } },
    { id: 'swift_wanderer', name: '질풍 방랑자', category: 'special', rarity: 'common', description: '이동 속도가 50% 빨라집니다.', modifiers: { moveSpeedMult: 1.5 } }
];

export const RARITY_INFO = {
    common: { label: '일반', color: '#c9c2d6', weight: 58 },
    rare: { label: '희귀', color: '#8fd9ff', weight: 28 },
    epic: { label: '영웅', color: '#d5a3ff', weight: 11 },
    legendary: { label: '전설', color: '#ffcf6b', weight: 3 }
};

export function getTraitById(id) {
    return TRAITS.find((trait) => trait.id === id) || null;
}

/** Rarity-weighted draw of unique traits for a new leader. */
export function rollTraits(count = 3) {
    const pool = [...TRAITS];
    const picked = [];

    while (picked.length < count && pool.length > 0) {
        const total = pool.reduce((sum, trait) => sum + (RARITY_INFO[trait.rarity]?.weight || 1), 0);
        let roll = Math.random() * total;
        let index = 0;
        for (let i = 0; i < pool.length; i++) {
            roll -= RARITY_INFO[pool[i].rarity]?.weight || 1;
            if (roll <= 0) {
                index = i;
                break;
            }
        }
        picked.push(pool[index]);
        pool.splice(index, 1);
    }

    return picked;
}

const MULTIPLIER_KEYS = [
    'swingSpeedMult', 'swingsRequiredMult', 'attackMult', 'damageTakenMult',
    'enemyIntervalMult', 'upgradeCostMult', 'craftCostMult', 'oreValueMult',
    'moveSpeedMult', 'workerSwingMult', 'workerAttackMult', 'critMult'
];

const ADDITIVE_KEYS = [
    'luckBonus', 'reservesBonus', 'rareVeinBonus', 'maxHpBonus',
    'firstStrikeBonus', 'craftPowerBonus'
];

const CHANCE_KEYS = ['yieldBonusChance', 'doubleOreChance', 'critChance', 'lifestealChance'];

/** Collapses a trait list into one effect object gameplay code can read. */
export function buildTraitEffects(traits) {
    const effects = {
        swingSpeedMult: 1,
        swingsRequiredMult: 1,
        attackMult: 1,
        damageTakenMult: 1,
        enemyIntervalMult: 1,
        upgradeCostMult: 1,
        craftCostMult: 1,
        oreValueMult: 1,
        moveSpeedMult: 1,
        workerSwingMult: 1,
        workerAttackMult: 1,
        critMult: 1.5,
        luckBonus: 0,
        reservesBonus: 0,
        rareVeinBonus: 0,
        maxHpBonus: 0,
        firstStrikeBonus: 0,
        craftPowerBonus: 0,
        yieldBonusChance: 0,
        doubleOreChance: 0,
        critChance: 0,
        lifestealChance: 0,
        startingBonus: { coal: 0, iron: 0, frostite: 0, gold: 0, obsidian: 0, mithril: 0, sunstone: 0 }
    };

    let critMultOverridden = false;

    traits.forEach((trait) => {
        const modifiers = trait?.modifiers || {};

        MULTIPLIER_KEYS.forEach((key) => {
            if (typeof modifiers[key] === 'number') {
                if (key === 'critMult') {
                    // Keep the strongest crit multiplier rather than stacking them.
                    effects.critMult = critMultOverridden
                        ? Math.max(effects.critMult, modifiers[key])
                        : modifiers[key];
                    critMultOverridden = true;
                } else {
                    effects[key] *= modifiers[key];
                }
            }
        });

        ADDITIVE_KEYS.forEach((key) => {
            if (typeof modifiers[key] === 'number') effects[key] += modifiers[key];
        });

        CHANCE_KEYS.forEach((key) => {
            if (typeof modifiers[key] === 'number') {
                // Diminishing stack keeps combined chances below 100%.
                effects[key] = 1 - (1 - effects[key]) * (1 - modifiers[key]);
            }
        });

        if (modifiers.startingBonus) {
            Object.entries(modifiers.startingBonus).forEach(([ore, amount]) => {
                effects.startingBonus[ore] = (effects.startingBonus[ore] || 0) + amount;
            });
        }
    });

    return effects;
}
