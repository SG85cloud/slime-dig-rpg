/**
 * Innate trait catalog for the leader slime.
 *
 * Every trait declares plain-data modifiers that gameplay reads directly, so a
 * trait is never cosmetic. Categories:
 *   mining  - ore yield, swing speed, vein reserves, rare-ore luck
 *   combat  - damage, crit, defense, enemy attack pacing
 *   craft   - crafting cost, upgrade cost, ore value
 *   special - hybrid or rule-bending effects
 *
 * Modifier keys (all optional, defaults are neutral):
 *   swingSpeedMult      multiplies pickaxe swing rate (higher = faster)
 *   swingsRequiredMult  multiplies swings needed per ore (lower = easier)
 *   luckBonus           flat bonus added to the effective luck stat
 *   yieldBonusChance    chance to gain one extra ore per pull
 *   doubleOreChance     chance to double the whole pull
 *   reservesBonus       extra reserves on newly spawned veins
 *   rareVeinBonus       extra weight toward rarer veins spawning
 *   attackMult          multiplies leader battle damage
 *   critChance          chance to deal critical damage
 *   critMult            critical damage multiplier
 *   damageTakenMult     multiplies incoming damage (lower = tankier)
 *   enemyIntervalMult   multiplies enemy attack interval (higher = slower)
 *   maxHpBonus          flat max HP bonus
 *   lifestealChance     chance to heal on a landed hit
 *   firstStrikeBonus    bonus damage on the opening blow of a battle
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
    { id: 'swift_pick', name: '빠른 곡괭이', category: 'mining', rarity: 'common', description: '곡괭이 휘두르는 속도가 15% 빨라집니다.', modifiers: { swingSpeedMult: 1.15 } },
    { id: 'heavy_swing', name: '묵직한 일격', category: 'mining', rarity: 'common', description: '광석당 필요한 곡괭이질이 10% 줄어듭니다.', modifiers: { swingsRequiredMult: 0.9 } },
    { id: 'stone_reader', name: '암석 판독가', category: 'mining', rarity: 'common', description: '광맥의 매장량이 2 증가합니다.', modifiers: { reservesBonus: 2 } },
    { id: 'ore_sniffer', name: '광석 후각', category: 'mining', rarity: 'common', description: '행운이 2 증가해 고급 광석이 더 자주 나옵니다.', modifiers: { luckBonus: 2 } },
    { id: 'double_pull', name: '이중 채굴', category: 'mining', rarity: 'rare', description: '12% 확률로 광석을 두 배로 얻습니다.', modifiers: { doubleOreChance: 0.12 } },
    { id: 'chip_master', name: '파편 수집가', category: 'mining', rarity: 'common', description: '20% 확률로 광석을 하나 더 얻습니다.', modifiers: { yieldBonusChance: 0.2 } },
    { id: 'deep_digger', name: '심층 굴착자', category: 'mining', rarity: 'rare', description: '매장량이 4 늘고 곡괭이질이 5% 줄어듭니다.', modifiers: { reservesBonus: 4, swingsRequiredMult: 0.95 } },
    { id: 'tireless_arm', name: '지치지 않는 팔', category: 'mining', rarity: 'common', description: '곡괭이 속도가 22% 빨라집니다.', modifiers: { swingSpeedMult: 1.22 } },
    { id: 'coal_born', name: '석탄 태생', category: 'mining', rarity: 'common', description: '석탄 광맥에서 곡괭이질이 18% 줄어듭니다.', modifiers: { swingsRequiredMult: 0.82, oreAffinity: 'coal' } },
    { id: 'iron_born', name: '철 태생', category: 'mining', rarity: 'common', description: '철 계열 채굴에 능해 곡괭이질이 12% 줄어듭니다.', modifiers: { swingsRequiredMult: 0.88, oreAffinity: 'iron' } },
    { id: 'gold_touched', name: '황금 손길', category: 'mining', rarity: 'rare', description: '행운이 4 증가합니다.', modifiers: { luckBonus: 4 } },
    { id: 'mithril_dreamer', name: '미스릴 몽상가', category: 'mining', rarity: 'epic', description: '행운 5, 고급 광맥 등장 확률이 크게 증가합니다.', modifiers: { luckBonus: 5, rareVeinBonus: 6 } },
    { id: 'vein_whisperer', name: '광맥 속삭임', category: 'mining', rarity: 'rare', description: '고급 광맥이 더 자주 생성됩니다.', modifiers: { rareVeinBonus: 5 } },
    { id: 'quarry_veteran', name: '채석장 베테랑', category: 'mining', rarity: 'rare', description: '곡괭이질 8% 감소, 속도 10% 증가.', modifiers: { swingsRequiredMult: 0.92, swingSpeedMult: 1.1 } },
    { id: 'rock_breaker', name: '바위 분쇄자', category: 'mining', rarity: 'rare', description: '광석당 곡괭이질이 18% 줄어듭니다.', modifiers: { swingsRequiredMult: 0.82 } },
    { id: 'echo_sense', name: '메아리 감각', category: 'mining', rarity: 'common', description: '행운 1, 매장량 1 증가.', modifiers: { luckBonus: 1, reservesBonus: 1 } },
    { id: 'greedy_hands', name: '탐욕스러운 손', category: 'mining', rarity: 'rare', description: '추가 광석 확률 30%, 다만 방어가 약해집니다.', modifiers: { yieldBonusChance: 0.3, damageTakenMult: 1.1 } },
    { id: 'patient_miner', name: '끈기의 광부', category: 'mining', rarity: 'common', description: '매장량 3 증가, 곡괭이 속도 5% 감소.', modifiers: { reservesBonus: 3, swingSpeedMult: 0.95 } },
    { id: 'crystal_eye', name: '수정 안광', category: 'mining', rarity: 'epic', description: '행운 6으로 희귀 광석 확률이 크게 오릅니다.', modifiers: { luckBonus: 6 } },
    { id: 'dust_walker', name: '분진 보행자', category: 'mining', rarity: 'common', description: '이동 속도 12%, 곡괭이 속도 6% 증가.', modifiers: { moveSpeedMult: 1.12, swingSpeedMult: 1.06 } },
    { id: 'seam_splitter', name: '광맥 절단자', category: 'mining', rarity: 'rare', description: '곡괭이질 14% 감소.', modifiers: { swingsRequiredMult: 0.86 } },
    { id: 'lucky_chip', name: '행운의 파편', category: 'mining', rarity: 'common', description: '행운 2, 추가 광석 확률 10%.', modifiers: { luckBonus: 2, yieldBonusChance: 0.1 } },
    { id: 'mine_cart', name: '광차 운반', category: 'mining', rarity: 'common', description: '매장량 5 증가.', modifiers: { reservesBonus: 5 } },
    { id: 'hammer_rhythm', name: '망치 리듬', category: 'mining', rarity: 'rare', description: '곡괭이 속도 28% 증가.', modifiers: { swingSpeedMult: 1.28 } },
    { id: 'ore_magnet', name: '광석 자석', category: 'mining', rarity: 'epic', description: '이중 채굴 18%, 추가 광석 15%.', modifiers: { doubleOreChance: 0.18, yieldBonusChance: 0.15 } },
    { id: 'shale_skin', name: '혈암 피부', category: 'mining', rarity: 'common', description: '매장량 2, 받는 피해 5% 감소.', modifiers: { reservesBonus: 2, damageTakenMult: 0.95 } },
    { id: 'night_digger', name: '야간 굴착자', category: 'mining', rarity: 'common', description: '곡괭이 속도 18% 증가.', modifiers: { swingSpeedMult: 1.18 } },
    { id: 'fossil_hunter', name: '화석 사냥꾼', category: 'mining', rarity: 'rare', description: '행운 3, 매장량 2 증가.', modifiers: { luckBonus: 3, reservesBonus: 2 } },
    { id: 'granite_grip', name: '화강암 손아귀', category: 'mining', rarity: 'common', description: '곡괭이질 7% 감소.', modifiers: { swingsRequiredMult: 0.93 } },
    { id: 'prospector', name: '탐광가', category: 'mining', rarity: 'rare', description: '고급 광맥 확률 증가, 행운 2.', modifiers: { rareVeinBonus: 4, luckBonus: 2 } },
    { id: 'tunnel_rat', name: '터널 생쥐', category: 'mining', rarity: 'common', description: '이동 속도 20% 증가.', modifiers: { moveSpeedMult: 1.2 } },
    { id: 'ember_core', name: '잔불의 심장', category: 'mining', rarity: 'rare', description: '곡괭이 속도 12%, 공격력 8% 증가.', modifiers: { swingSpeedMult: 1.12, attackMult: 1.08 } },
    { id: 'salt_veins', name: '소금 광맥', category: 'mining', rarity: 'common', description: '매장량 3, 행운 1.', modifiers: { reservesBonus: 3, luckBonus: 1 } },
    { id: 'obsidian_edge', name: '흑요석 날', category: 'mining', rarity: 'epic', description: '곡괭이질 22% 감소.', modifiers: { swingsRequiredMult: 0.78 } },
    { id: 'stone_song', name: '암석의 노래', category: 'mining', rarity: 'rare', description: '곡괭이 속도 15%, 매장량 2.', modifiers: { swingSpeedMult: 1.15, reservesBonus: 2 } },
    { id: 'ore_gourmet', name: '광석 미식가', category: 'mining', rarity: 'rare', description: '행운 3, 이중 채굴 8%.', modifiers: { luckBonus: 3, doubleOreChance: 0.08 } },
    { id: 'sediment_sense', name: '퇴적 감각', category: 'mining', rarity: 'common', description: '고급 광맥 확률 3 증가.', modifiers: { rareVeinBonus: 3 } },
    { id: 'iron_lungs', name: '강철 폐', category: 'mining', rarity: 'common', description: '곡괭이 속도 10%, 최대 HP 10 증가.', modifiers: { swingSpeedMult: 1.1, maxHpBonus: 10 } },
    { id: 'bedrock_will', name: '기반암 의지', category: 'mining', rarity: 'rare', description: '곡괭이질 10% 감소, 받는 피해 8% 감소.', modifiers: { swingsRequiredMult: 0.9, damageTakenMult: 0.92 } },
    { id: 'glitter_eye', name: '반짝임의 눈', category: 'mining', rarity: 'epic', description: '행운 7.', modifiers: { luckBonus: 7 } },
    { id: 'relentless_dig', name: '멈추지 않는 굴착', category: 'mining', rarity: 'epic', description: '곡괭이 속도 35% 증가.', modifiers: { swingSpeedMult: 1.35 } },
    { id: 'ore_hoarder', name: '광석 수집벽', category: 'mining', rarity: 'rare', description: '매장량 6 증가.', modifiers: { reservesBonus: 6 } },
    { id: 'cavern_born', name: '동굴 태생', category: 'mining', rarity: 'common', description: '이동 속도 10%, 매장량 2.', modifiers: { moveSpeedMult: 1.1, reservesBonus: 2 } },
    { id: 'gemcutter_eye', name: '보석 세공안', category: 'mining', rarity: 'rare', description: '행운 4, 제작 비용 5% 감소.', modifiers: { luckBonus: 4, craftCostMult: 0.95 } },
    { id: 'quartz_heart', name: '석영 심장', category: 'mining', rarity: 'common', description: '매장량 2, 최대 HP 8.', modifiers: { reservesBonus: 2, maxHpBonus: 8 } },

    // ---------------------------------------------------------------- combat
    { id: 'sharp_fang', name: '날카로운 송곳니', category: 'combat', rarity: 'common', description: '전투 공격력이 15% 증가합니다.', modifiers: { attackMult: 1.15 } },
    { id: 'iron_hide', name: '강철 가죽', category: 'combat', rarity: 'common', description: '받는 피해가 12% 감소합니다.', modifiers: { damageTakenMult: 0.88 } },
    { id: 'quick_reflex', name: '민첩한 반사', category: 'combat', rarity: 'common', description: '적의 공격 간격이 15% 길어집니다.', modifiers: { enemyIntervalMult: 1.15 } },
    { id: 'critical_mind', name: '급소 감각', category: 'combat', rarity: 'rare', description: '치명타 확률 20%, 피해 1.8배.', modifiers: { critChance: 0.2, critMult: 1.8 } },
    { id: 'berserker', name: '광전사', category: 'combat', rarity: 'rare', description: '공격력 30% 증가, 받는 피해 15% 증가.', modifiers: { attackMult: 1.3, damageTakenMult: 1.15 } },
    { id: 'stone_wall', name: '돌벽', category: 'combat', rarity: 'rare', description: '받는 피해 22% 감소, 최대 HP 15.', modifiers: { damageTakenMult: 0.78, maxHpBonus: 15 } },
    { id: 'first_strike', name: '선제 타격', category: 'combat', rarity: 'common', description: '전투 첫 공격에 12의 추가 피해.', modifiers: { firstStrikeBonus: 12 } },
    { id: 'blood_slime', name: '흡혈 슬라임', category: 'combat', rarity: 'rare', description: '25% 확률로 공격 시 체력을 회복합니다.', modifiers: { lifestealChance: 0.25 } },
    { id: 'thick_core', name: '두꺼운 핵', category: 'combat', rarity: 'common', description: '최대 HP가 25 증가합니다.', modifiers: { maxHpBonus: 25 } },
    { id: 'battle_born', name: '전투 태생', category: 'combat', rarity: 'rare', description: '공격력 20%, 치명타 10%.', modifiers: { attackMult: 1.2, critChance: 0.1 } },
    { id: 'shield_bearer', name: '방패지기', category: 'combat', rarity: 'common', description: '받는 피해 10% 감소.', modifiers: { damageTakenMult: 0.9 } },
    { id: 'venom_touch', name: '맹독 접촉', category: 'combat', rarity: 'rare', description: '공격력 18%, 치명타 피해 2.0배.', modifiers: { attackMult: 1.18, critMult: 2.0 } },
    { id: 'duelist', name: '결투가', category: 'combat', rarity: 'rare', description: '치명타 확률 25%.', modifiers: { critChance: 0.25 } },
    { id: 'slow_time', name: '느려진 시간', category: 'combat', rarity: 'epic', description: '적 공격 간격이 30% 길어집니다.', modifiers: { enemyIntervalMult: 1.3 } },
    { id: 'giant_slayer', name: '거인 사냥꾼', category: 'combat', rarity: 'epic', description: '공격력 40% 증가.', modifiers: { attackMult: 1.4 } },
    { id: 'guardian_core', name: '수호의 핵', category: 'combat', rarity: 'epic', description: '최대 HP 40, 받는 피해 10% 감소.', modifiers: { maxHpBonus: 40, damageTakenMult: 0.9 } },
    { id: 'counter_stance', name: '반격 자세', category: 'combat', rarity: 'rare', description: '적 공격 간격 12%, 공격력 12% 증가.', modifiers: { enemyIntervalMult: 1.12, attackMult: 1.12 } },
    { id: 'adrenal_surge', name: '아드레날린', category: 'combat', rarity: 'common', description: '첫 공격 추가 피해 20.', modifiers: { firstStrikeBonus: 20 } },
    { id: 'hardened_shell', name: '경화 외피', category: 'combat', rarity: 'common', description: '받는 피해 8% 감소, 최대 HP 12.', modifiers: { damageTakenMult: 0.92, maxHpBonus: 12 } },
    { id: 'frenzy_pulse', name: '광란의 고동', category: 'combat', rarity: 'rare', description: '공격력 25%, 치명타 확률 8%.', modifiers: { attackMult: 1.25, critChance: 0.08 } },
    { id: 'stoic_mind', name: '흔들림 없는 정신', category: 'combat', rarity: 'common', description: '적 공격 간격 10% 증가.', modifiers: { enemyIntervalMult: 1.1 } },
    { id: 'vampire_king', name: '흡혈왕', category: 'combat', rarity: 'epic', description: '흡혈 확률 40%.', modifiers: { lifestealChance: 0.4 } },
    { id: 'executioner', name: '처형자', category: 'combat', rarity: 'epic', description: '치명타 확률 30%, 피해 2.2배.', modifiers: { critChance: 0.3, critMult: 2.2 } },
    { id: 'tough_gel', name: '질긴 젤리', category: 'combat', rarity: 'common', description: '최대 HP 18.', modifiers: { maxHpBonus: 18 } },
    { id: 'war_drum', name: '전쟁 북', category: 'combat', rarity: 'rare', description: '공격력 15%, 워커 공격력 25% 증가.', modifiers: { attackMult: 1.15, workerAttackMult: 1.25 } },
    { id: 'spiked_body', name: '가시 몸체', category: 'combat', rarity: 'common', description: '공격력 12%, 받는 피해 5% 감소.', modifiers: { attackMult: 1.12, damageTakenMult: 0.95 } },
    { id: 'battle_trance', name: '전투 무아지경', category: 'combat', rarity: 'rare', description: '첫 공격 추가 피해 15, 치명타 12%.', modifiers: { firstStrikeBonus: 15, critChance: 0.12 } },
    { id: 'unyielding', name: '불굴', category: 'combat', rarity: 'rare', description: '최대 HP 30, 적 공격 간격 8% 증가.', modifiers: { maxHpBonus: 30, enemyIntervalMult: 1.08 } },
    { id: 'razor_edge', name: '면도날', category: 'combat', rarity: 'common', description: '치명타 확률 15%.', modifiers: { critChance: 0.15 } },
    { id: 'iron_will', name: '강철 의지', category: 'combat', rarity: 'common', description: '받는 피해 14% 감소.', modifiers: { damageTakenMult: 0.86 } },
    { id: 'hunter_instinct', name: '사냥 본능', category: 'combat', rarity: 'rare', description: '공격력 22%, 이동 속도 10%.', modifiers: { attackMult: 1.22, moveSpeedMult: 1.1 } },
    { id: 'phalanx', name: '방진', category: 'combat', rarity: 'rare', description: '받는 피해 18% 감소, 워커 공격력 15%.', modifiers: { damageTakenMult: 0.82, workerAttackMult: 1.15 } },
    { id: 'savage_bite', name: '야만의 이빨', category: 'combat', rarity: 'common', description: '공격력 18% 증가.', modifiers: { attackMult: 1.18 } },
    { id: 'life_spring', name: '생명의 샘', category: 'combat', rarity: 'rare', description: '흡혈 20%, 최대 HP 15.', modifiers: { lifestealChance: 0.2, maxHpBonus: 15 } },
    { id: 'titan_core', name: '거인의 핵', category: 'combat', rarity: 'epic', description: '최대 HP 55.', modifiers: { maxHpBonus: 55 } },
    { id: 'shadow_step', name: '그림자 걸음', category: 'combat', rarity: 'rare', description: '적 공격 간격 20% 증가.', modifiers: { enemyIntervalMult: 1.2 } },
    { id: 'blade_dancer', name: '검무가', category: 'combat', rarity: 'rare', description: '치명타 18%, 공격력 10%.', modifiers: { critChance: 0.18, attackMult: 1.1 } },
    { id: 'pain_eater', name: '고통 포식자', category: 'combat', rarity: 'epic', description: '받는 피해 28% 감소.', modifiers: { damageTakenMult: 0.72 } },
    { id: 'ambusher', name: '매복자', category: 'combat', rarity: 'rare', description: '첫 공격 추가 피해 28.', modifiers: { firstStrikeBonus: 28 } },
    { id: 'steel_veins', name: '강철 혈관', category: 'combat', rarity: 'common', description: '최대 HP 20, 공격력 8%.', modifiers: { maxHpBonus: 20, attackMult: 1.08 } },

    // ----------------------------------------------------------------- craft
    { id: 'apprentice_smith', name: '견습 대장장이', category: 'craft', rarity: 'common', description: '제작 비용이 15% 감소합니다.', modifiers: { craftCostMult: 0.85 } },
    { id: 'master_smith', name: '숙련 대장장이', category: 'craft', rarity: 'rare', description: '제작 비용 25% 감소, 제작 공격력 +2.', modifiers: { craftCostMult: 0.75, craftPowerBonus: 2 } },
    { id: 'frugal_soul', name: '검소한 영혼', category: 'craft', rarity: 'common', description: '스탯 강화 비용이 12% 감소합니다.', modifiers: { upgradeCostMult: 0.88 } },
    { id: 'efficient_forge', name: '효율적인 대장간', category: 'craft', rarity: 'rare', description: '강화 비용 20%, 제작 비용 10% 감소.', modifiers: { upgradeCostMult: 0.8, craftCostMult: 0.9 } },
    { id: 'alloy_savant', name: '합금의 달인', category: 'craft', rarity: 'rare', description: '제작 시 공격력 +4 추가 상승.', modifiers: { craftPowerBonus: 4 } },
    { id: 'resource_planner', name: '자원 설계자', category: 'craft', rarity: 'common', description: '강화 비용 10% 감소.', modifiers: { upgradeCostMult: 0.9 } },
    { id: 'tool_tinkerer', name: '도구 수리공', category: 'craft', rarity: 'common', description: '제작 비용 10% 감소, 곡괭이 속도 8%.', modifiers: { craftCostMult: 0.9, swingSpeedMult: 1.08 } },
    { id: 'ore_appraiser', name: '광석 감정사', category: 'craft', rarity: 'rare', description: '광석 가치 25% 증가, 행운 2.', modifiers: { oreValueMult: 1.25, luckBonus: 2 } },
    { id: 'runesmith', name: '룬 대장장이', category: 'craft', rarity: 'epic', description: '제작 비용 30% 감소, 공격력 +5.', modifiers: { craftCostMult: 0.7, craftPowerBonus: 5 } },
    { id: 'salvager', name: '고철 수집가', category: 'craft', rarity: 'common', description: '광석 가치 15% 증가.', modifiers: { oreValueMult: 1.15 } },
    { id: 'guild_contact', name: '길드 연줄', category: 'craft', rarity: 'rare', description: '강화 비용 25% 감소.', modifiers: { upgradeCostMult: 0.75 } },
    { id: 'pattern_reader', name: '설계도 해독가', category: 'craft', rarity: 'common', description: '제작 공격력 +2.', modifiers: { craftPowerBonus: 2 } },
    { id: 'thrifty_hands', name: '알뜰한 손', category: 'craft', rarity: 'rare', description: '제작·강화 비용 각 15% 감소.', modifiers: { craftCostMult: 0.85, upgradeCostMult: 0.85 } },
    { id: 'furnace_heart', name: '용광로 심장', category: 'craft', rarity: 'rare', description: '제작 공격력 +3, 최대 HP 12.', modifiers: { craftPowerBonus: 3, maxHpBonus: 12 } },
    { id: 'trade_savvy', name: '거래 감각', category: 'craft', rarity: 'common', description: '광석 가치 20% 증가.', modifiers: { oreValueMult: 1.2 } },
    { id: 'blueprint_mind', name: '청사진 두뇌', category: 'craft', rarity: 'epic', description: '강화 비용 35% 감소.', modifiers: { upgradeCostMult: 0.65 } },
    { id: 'gear_grinder', name: '기어 연마사', category: 'craft', rarity: 'common', description: '제작 비용 8%, 강화 비용 8% 감소.', modifiers: { craftCostMult: 0.92, upgradeCostMult: 0.92 } },
    { id: 'artisan_soul', name: '장인의 혼', category: 'craft', rarity: 'epic', description: '제작 공격력 +6, 제작 비용 15% 감소.', modifiers: { craftPowerBonus: 6, craftCostMult: 0.85 } },
    { id: 'scrap_alchemy', name: '고철 연금술', category: 'craft', rarity: 'rare', description: '광석 가치 30% 증가.', modifiers: { oreValueMult: 1.3 } },
    { id: 'workshop_born', name: '공방 태생', category: 'craft', rarity: 'common', description: '제작 비용 12% 감소.', modifiers: { craftCostMult: 0.88 } },
    { id: 'hammer_lineage', name: '망치의 혈통', category: 'craft', rarity: 'rare', description: '제작 공격력 +3, 공격력 10%.', modifiers: { craftPowerBonus: 3, attackMult: 1.1 } },
    { id: 'material_sense', name: '재료 감각', category: 'craft', rarity: 'common', description: '광석 가치 12%, 행운 1.', modifiers: { oreValueMult: 1.12, luckBonus: 1 } },
    { id: 'quenching_art', name: '담금질 기법', category: 'craft', rarity: 'rare', description: '제작 공격력 +4, 받는 피해 5% 감소.', modifiers: { craftPowerBonus: 4, damageTakenMult: 0.95 } },
    { id: 'bulk_buyer', name: '대량 구매자', category: 'craft', rarity: 'rare', description: '강화 비용 18% 감소, 매장량 2.', modifiers: { upgradeCostMult: 0.82, reservesBonus: 2 } },
    { id: 'legendary_forge', name: '전설의 대장간', category: 'craft', rarity: 'legendary', description: '제작 비용 40% 감소, 공격력 +8.', modifiers: { craftCostMult: 0.6, craftPowerBonus: 8 } },

    // --------------------------------------------------------------- special
    { id: 'squad_leader', name: '분대장', category: 'special', rarity: 'rare', description: '워커의 채굴과 공격이 25% 강해집니다.', modifiers: { workerSwingMult: 1.25, workerAttackMult: 1.25 } },
    { id: 'foreman', name: '현장 감독', category: 'special', rarity: 'rare', description: '워커 채굴 속도 40% 증가.', modifiers: { workerSwingMult: 1.4 } },
    { id: 'warlord', name: '전쟁군주', category: 'special', rarity: 'rare', description: '워커 공격력 45% 증가.', modifiers: { workerAttackMult: 1.45 } },
    { id: 'silver_spoon', name: '은수저', category: 'special', rarity: 'common', description: '시작 시 석탄 10개를 지니고 시작합니다.', modifiers: { startingBonus: { coal: 10 } } },
    { id: 'iron_heir', name: '철의 후계자', category: 'special', rarity: 'rare', description: '시작 시 철광석 8개를 지니고 시작합니다.', modifiers: { startingBonus: { iron: 8 } } },
    { id: 'gold_heir', name: '황금 후계자', category: 'special', rarity: 'epic', description: '시작 시 금광석 5개를 지니고 시작합니다.', modifiers: { startingBonus: { gold: 5 } } },
    { id: 'wanderer', name: '방랑자', category: 'special', rarity: 'common', description: '이동 속도가 25% 빨라집니다.', modifiers: { moveSpeedMult: 1.25 } },
    { id: 'lucky_star', name: '행운의 별', category: 'special', rarity: 'epic', description: '행운 5, 이중 채굴 10%.', modifiers: { luckBonus: 5, doubleOreChance: 0.1 } },
    { id: 'jack_of_trades', name: '만능 재주꾼', category: 'special', rarity: 'rare', description: '채굴·전투·제작이 모두 소폭 향상됩니다.', modifiers: { swingSpeedMult: 1.08, attackMult: 1.08, craftCostMult: 0.92, luckBonus: 1 } },
    { id: 'phoenix_gel', name: '불사조 젤', category: 'special', rarity: 'legendary', description: '최대 HP 50, 흡혈 30%.', modifiers: { maxHpBonus: 50, lifestealChance: 0.3 } },
    { id: 'time_bender', name: '시간 왜곡자', category: 'special', rarity: 'legendary', description: '곡괭이 속도 30%, 적 공격 간격 25% 증가.', modifiers: { swingSpeedMult: 1.3, enemyIntervalMult: 1.25 } },
    { id: 'ore_king', name: '광석왕', category: 'special', rarity: 'legendary', description: '행운 8, 매장량 5, 이중 채굴 15%.', modifiers: { luckBonus: 8, reservesBonus: 5, doubleOreChance: 0.15 } },
    { id: 'twin_soul', name: '쌍둥이 영혼', category: 'special', rarity: 'epic', description: '이중 채굴 25%.', modifiers: { doubleOreChance: 0.25 } },
    { id: 'beast_tamer', name: '야수 조련사', category: 'special', rarity: 'rare', description: '워커 공격력 30%, 채굴 15% 증가.', modifiers: { workerAttackMult: 1.3, workerSwingMult: 1.15 } },
    { id: 'cave_guide', name: '동굴 안내자', category: 'special', rarity: 'common', description: '이동 속도 15%, 행운 1.', modifiers: { moveSpeedMult: 1.15, luckBonus: 1 } },
    { id: 'echo_twin', name: '메아리 분신', category: 'special', rarity: 'rare', description: '추가 광석 확률 35%.', modifiers: { yieldBonusChance: 0.35 } },
    { id: 'stargazer', name: '별을 보는 자', category: 'special', rarity: 'rare', description: '행운 4, 고급 광맥 확률 3.', modifiers: { luckBonus: 4, rareVeinBonus: 3 } },
    { id: 'iron_stomach', name: '무쇠 위장', category: 'special', rarity: 'common', description: '최대 HP 22, 받는 피해 5% 감소.', modifiers: { maxHpBonus: 22, damageTakenMult: 0.95 } },
    { id: 'dungeon_native', name: '던전 토박이', category: 'special', rarity: 'rare', description: '이동 속도 18%, 매장량 3.', modifiers: { moveSpeedMult: 1.18, reservesBonus: 3 } },
    { id: 'hoarder_king', name: '수집왕', category: 'special', rarity: 'epic', description: '시작 석탄 15, 매장량 4.', modifiers: { startingBonus: { coal: 15 }, reservesBonus: 4 } },
    { id: 'mirror_core', name: '거울 핵', category: 'special', rarity: 'epic', description: '받는 피해 20% 감소, 공격력 15%.', modifiers: { damageTakenMult: 0.8, attackMult: 1.15 } },
    { id: 'swarm_caller', name: '군체 소환자', category: 'special', rarity: 'epic', description: '워커 채굴·공격 50% 증가.', modifiers: { workerSwingMult: 1.5, workerAttackMult: 1.5 } },
    { id: 'void_touched', name: '공허 접촉', category: 'special', rarity: 'legendary', description: '공격력 35%, 치명타 20%, 받는 피해 10% 증가.', modifiers: { attackMult: 1.35, critChance: 0.2, damageTakenMult: 1.1 } },
    { id: 'ancient_blood', name: '고대의 피', category: 'special', rarity: 'legendary', description: '모든 능력이 고르게 강화됩니다.', modifiers: { swingSpeedMult: 1.15, swingsRequiredMult: 0.92, attackMult: 1.2, maxHpBonus: 25, luckBonus: 3 } },
    { id: 'gambler', name: '도박사', category: 'special', rarity: 'rare', description: '이중 채굴 30%, 매장량 2 감소.', modifiers: { doubleOreChance: 0.3, reservesBonus: -2 } },
    { id: 'slow_starter', name: '대기만성', category: 'special', rarity: 'common', description: '강화 비용 20% 감소, 곡괭이 속도 5% 감소.', modifiers: { upgradeCostMult: 0.8, swingSpeedMult: 0.95 } },
    { id: 'crown_bearer', name: '왕관의 계승자', category: 'special', rarity: 'legendary', description: '최대 HP 35, 공격력 25%, 행운 4.', modifiers: { maxHpBonus: 35, attackMult: 1.25, luckBonus: 4 } },
    { id: 'shard_collector', name: '파편 수집왕', category: 'special', rarity: 'rare', description: '추가 광석 25%, 광석 가치 15%.', modifiers: { yieldBonusChance: 0.25, oreValueMult: 1.15 } },
    { id: 'quiet_step', name: '고요한 발걸음', category: 'special', rarity: 'common', description: '이동 속도 14%, 적 공격 간격 6% 증가.', modifiers: { moveSpeedMult: 1.14, enemyIntervalMult: 1.06 } },
    { id: 'deep_bond', name: '깊은 유대', category: 'special', rarity: 'rare', description: '워커 채굴 30%, 최대 HP 15.', modifiers: { workerSwingMult: 1.3, maxHpBonus: 15 } }
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
        startingBonus: { coal: 0, iron: 0, gold: 0, mithril: 0 }
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
