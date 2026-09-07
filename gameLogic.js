import * as THREE from 'three';
import { TRAITS, TRAIT_CATEGORIES, RARITY_INFO, rollTraits, buildTraitEffects, getTraitById } from './traits.js';
import { getProfileId, loadProgress, saveProgress, clearProgress } from './saveGame.js';
import {
    ORE_KEYS,
    ORE_INFO,
    QUALITY_TIERS,
    recipeKey,
    previewCraft,
    forgeItem,
    getItemPower,
    getTierById
} from './crafting.js';
import {
    ENEMY_TYPES,
    getWaveComposition,
    scaleEnemyStats,
    createWeaponMesh,
    createFistMesh,
    CombatFX
} from './combat.js';

/** Floor height of the mine. All contact correction resolves to this plane. */
const GROUND_Y = 0;

/** Scratch box reused by the contact pass so no per-frame garbage is created. */
const _contactBox = new THREE.Box3();

/**
 * Measures a model's real bounding box at a given scale and returns the Y offset
 * that puts its lowest point exactly on the floor. The generated GLBs each have
 * their own arbitrary origin, so a hardcoded lift makes some models float and
 * sinks others into the ground.
 */
function computeGroundOffset(model, scale = 1) {
    const probe = model.clone();
    probe.position.set(0, 0, 0);
    probe.rotation.set(0, 0, 0);
    probe.scale.setScalar(scale);
    probe.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(probe);
    if (!isFinite(box.min.y) || box.isEmpty()) return 0;

    // Lift by however far the model's bottom sits below its own origin.
    return -box.min.y;
}

/**
 * Universal contact correction. Runs once per frame AFTER every animation has
 * written its transform, measuring the object's true world-space lowest point
 * and shifting it so that point rests exactly on the floor.
 *
 * This is authoritative: squash, lean, bob, lunge, knockdown, and revive can all
 * move the body freely, and whatever they do the silhouette still lands on the
 * ground. `lift` lets an action be deliberately airborne (a jump or lunge hop)
 * without fighting the correction.
 *
 * Children flagged `userData.ignoreContact` (health bars, held weapons, pickaxes)
 * are excluded, since they would otherwise drag the measured bounds around.
 */
function applyGroundContact(object, lift = 0) {
    if (!object) return;

    object.updateWorldMatrix(true, true);

    // Hide non-body attachments so they cannot influence the measured bounds.
    const hidden = [];
    object.traverse((child) => {
        if (child.userData?.ignoreContact && child.visible) {
            child.visible = false;
            hidden.push(child);
        }
    });

    _contactBox.setFromObject(object);
    hidden.forEach((child) => { child.visible = true; });

    if (_contactBox.isEmpty() || !isFinite(_contactBox.min.y)) return;

    // Positive when the body has sunk below the floor, negative when floating.
    const penetration = GROUND_Y + lift - _contactBox.min.y;
    if (Math.abs(penetration) > 0.0005) {
        object.position.y += penetration;
    }
}

export class Game {
    constructor(app) {
        this.app = app;
        this.scene = app.scene;
        this.camera = app.camera;
        this.assets = app.assets;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.nodes = [];
        this.workers = [];
        this.enemies = [];
        
        this.inventory = {
            coal: 0,
            iron: 0,
            gold: 0,
            mithril: 0
        };

        this.attackPower = 10;
        // Forged equipment: the currently wielded item plus every recipe the
        // player has personally invented.
        this.equipped = null;
        this.recipeBook = [];
        this.craftLog = null;
        this.squadCommand = 'mine';
        this.elapsed = 0;
        this.baseMaxHp = 100;
        this.maxPlayerHp = 100;
        // Real-time auto-combat state.
        this.combatFX = null;
        this.wave = 0;
        this.groundOffsets = {};
        this.waveActive = false;
        this.autoCombat = true;
        this.playerAttackTimer = 0;
        this.playerTarget = null;
        this.combatFeed = [];
        this.lastCombatMoment = 0;
        this.regenTimer = 0;
        this.deathTimer = 0;
        this.isDown = false;
        this.enemySpawnTimer = null;
        this.miningHitTimer = 0;
        this.quest = {
            stage: 'coal',
            coalGoal: 10
        };

        // Leader stats: strength lowers the swings needed per ore, speed shortens
        // the swing interval, and luck improves the rare-ore roll.
        this.stats = {
            strength: 1,
            speed: 1,
            luck: 1
        };

        // Each ore vein keeps yielding items; rarer ore needs far more swings.
        this.oreConfig = {
            coal: { label: '석탄', baseSwings: 10, scale: 2.6, rarity: 0 },
            iron: { label: '철광석', baseSwings: 16, scale: 2.8, rarity: 1 },
            gold: { label: '금광석', baseSwings: 24, scale: 3.0, rarity: 2 },
            mithril: { label: '미스릴', baseSwings: 52, scale: 3.2, rarity: 3 }
        };

        // ------------------------------------------------------------ depth
        // The run starts buried at B30F and works upward toward daylight. Rock
        // near the surface is older and far denser, so every floor climbed makes
        // veins tougher; in exchange each floor carries a bigger seam count.
        this.startDepth = 30;
        this.depth = this.startDepth;
        this.floorNodesCleared = 0;
        this.deepestReached = this.startDepth;
        this.ascending = false;

        // ----------------------------------------------------- wave rewards
        // Clearing a defence wave hands the player a choice rather than a
        // handout, so victory rolls straight into the next operational call:
        // stock up ore, grow the leader, or sharpen the worker squad.
        this.boons = {
            workerAttackMult: 1,
            workerSwingMult: 1,
            reservesBonus: 0
        };
        this.rewardPending = null;
        
        // Per-player mine progression. A saved run restores the leader's innate
        // traits, ore, stat levels, attack power, HP, quest stage and workers.
        this.profileId = getProfileId();
        this.saved = loadProgress(this.profileId);
        this.saveTimer = 0;
        this.pendingWorkerCount = 0;
        this.hasSavedRun = false;

        // Innate traits are rolled once per leader and drive real gameplay
        // modifiers; a returning leader keeps the traits it was born with.
        this.traits = this.restoreTraits(this.saved);
        this.traitEffects = buildTraitEffects(this.traits);
        this.maxPlayerHp += this.traitEffects.maxHpBonus;

        if (this.saved) {
            this.applySavedProgress(this.saved);
        } else {
            Object.entries(this.traitEffects.startingBonus).forEach(([ore, amount]) => {
                if (amount > 0) this.inventory[ore] += amount;
            });
        }

        // Equipment HP is part of the max, so recompute once state is loaded.
        this.maxPlayerHp = this.baseMaxHp + this.traitEffects.maxHpBonus + (this.equipped?.stats.hp || 0);

        this.playerData = {
            id: this.app.multiplayer.playerId,
            pos: new THREE.Vector3(0, 0, 0),
            targetPos: new THREE.Vector3(0, 0, 0),
            miningTarget: null,
            hp: this.savedHp !== undefined
                ? Math.min(this.maxPlayerHp, Math.max(1, this.savedHp))
                : this.maxPlayerHp,
            traits: this.traits.map((trait) => trait.name)
        };

        this.combatFX = new CombatFX(this.scene, this.camera);

        this.initWorld();
        this.initPlayer();
        this.initControls();

        // Re-recruit the workers that were part of the squad on the last visit.
        for (let i = 0; i < this.pendingWorkerCount; i++) {
            this.addWorker();
        }
        this.setSquadCommand(this.savedCommand || this.squadCommand);

        this.app.ui.setResetHandler(() => this.resetProgress());
        this.app.ui.showProgressNotice(this.getProgressNotice());
        // A reward left unclaimed at the last save is offered again on return.
        if (this.rewardPending) {
            setTimeout(() => this.offerWaveReward(this.rewardPending.wave), 800);
        }
        this.persist();

        // Save before the tab closes so nothing is lost mid-session.
        window.addEventListener('beforeunload', () => this.persist());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.persist();
        });

        // Multiplayer sync
        this.app.multiplayer.subscribeToPlayers((peers) => this.syncPlayers(peers));
    }

    // Innate traits are stored by id, so a returning leader is exactly the same
    // slime. Unknown ids (from an older catalog) are simply skipped.
    restoreTraits(saved) {
        const ids = Array.isArray(saved?.traitIds) ? saved.traitIds : null;
        if (ids && ids.length > 0) {
            const restored = ids.map((id) => getTraitById(id)).filter(Boolean);
            if (restored.length > 0) return restored;
        }
        return rollTraits(3);
    }

    applySavedProgress(saved) {
        this.hasSavedRun = true;

        Object.keys(this.inventory).forEach((ore) => {
            const amount = Number(saved.inventory?.[ore]);
            if (Number.isFinite(amount) && amount > 0) this.inventory[ore] = Math.floor(amount);
        });

        ['strength', 'speed', 'luck'].forEach((stat) => {
            const level = Number(saved.stats?.[stat]);
            if (Number.isFinite(level) && level >= 1) this.stats[stat] = Math.floor(level);
        });

        const attack = Number(saved.attackPower);
        if (Number.isFinite(attack) && attack > 0) this.attackPower = attack;

        const maxHp = Number(saved.maxPlayerHp);
        if (Number.isFinite(maxHp) && maxHp > 0) this.maxPlayerHp = Math.max(this.maxPlayerHp, maxHp);

        const hp = Number(saved.hp);
        if (Number.isFinite(hp) && hp > 0) this.savedHp = hp;

        if (['coal', 'recruit', 'complete'].includes(saved.quest?.stage)) {
            this.quest.stage = saved.quest.stage;
        }
        const coalGoal = Number(saved.quest?.coalGoal);
        if (Number.isFinite(coalGoal) && coalGoal > 0) this.quest.coalGoal = Math.floor(coalGoal);

        const workerCount = Number(saved.workerCount);
        if (Number.isFinite(workerCount)) this.pendingWorkerCount = Math.max(0, Math.min(6, Math.floor(workerCount)));

        if (['mine', 'attack', 'defend'].includes(saved.squadCommand)) {
            this.savedCommand = saved.squadCommand;
        }

        // Restore the forged loadout and every recipe the player invented.
        if (saved.equipped && saved.equipped.stats) this.equipped = saved.equipped;
        if (Array.isArray(saved.recipeBook)) {
            this.recipeBook = saved.recipeBook.filter((entry) => entry && entry.key && entry.mix);
        }

        const wave = Number(saved.wave);
        if (Number.isFinite(wave) && wave > 0) this.wave = Math.floor(wave);
        if (typeof saved.autoCombat === 'boolean') this.autoCombat = saved.autoCombat;

        // Which floor of the shaft the leader had climbed to.
        const depth = Number(saved.depth);
        if (Number.isFinite(depth) && depth >= 0 && depth <= this.startDepth) {
            this.depth = Math.floor(depth);
        }
        const cleared = Number(saved.floorNodesCleared);
        if (Number.isFinite(cleared) && cleared >= 0) this.floorNodesCleared = Math.floor(cleared);
        const deepest = Number(saved.deepestReached);
        this.deepestReached = Number.isFinite(deepest) ? Math.floor(deepest) : this.depth;

        // Permanent bonuses picked from wave reward cards.
        Object.keys(this.boons).forEach((key) => {
            const value = Number(saved.boons?.[key]);
            if (Number.isFinite(value)) this.boons[key] = value;
        });

        // A reward the player never got around to choosing is still owed.
        const pending = saved.rewardPending;
        if (pending && Array.isArray(pending.choices) && pending.choices.length > 0) {
            this.rewardPending = pending;
        }

        this.savedAt = Number(saved.savedAt) || null;
        this.totalOreMined = Number(saved.totalOreMined) || 0;
        this.totalCrafted = Number(saved.totalCrafted) || 0;
    }

    // Snapshot of everything that defines the leader's growth.
    getSaveSnapshot() {
        return {
            profileId: this.profileId,
            traitIds: this.traits.map((trait) => trait.id),
            inventory: { ...this.inventory },
            stats: { ...this.stats },
            attackPower: this.attackPower,
            maxPlayerHp: this.maxPlayerHp,
            hp: this.playerData ? this.playerData.hp : this.maxPlayerHp,
            quest: { stage: this.quest.stage, coalGoal: this.quest.coalGoal },
            workerCount: this.workers.length,
            squadCommand: this.squadCommand,
            totalOreMined: this.totalOreMined || 0,
            equipped: this.equipped,
            recipeBook: this.recipeBook,
            totalCrafted: this.totalCrafted || 0,
            wave: this.wave,
            autoCombat: this.autoCombat,
            depth: this.depth,
            floorNodesCleared: this.floorNodesCleared,
            deepestReached: this.deepestReached,
            boons: { ...this.boons },
            // An unclaimed reward survives a reload so a win is never lost.
            rewardPending: this.rewardPending
        };
    }

    persist() {
        saveProgress(this.profileId, this.getSaveSnapshot());
    }

    getProgressNotice() {
        if (!this.hasSavedRun) {
            return {
                fresh: true,
                title: '새로운 광부의 탄생',
                lines: [
                    `태생 특성 ${this.traits.length}개를 가지고 광산에 들어섭니다.`,
                    '진행 상황은 자동으로 저장됩니다.'
                ]
            };
        }

        const ore = Object.values(this.inventory).reduce((sum, amount) => sum + amount, 0);
        const questLabel = this.getQuestData().title;
        const gear = this.equipped
            ? `${this.equipped.icon} ${this.equipped.name}`
            : '없음';
        return {
            fresh: false,
            title: '모험을 이어갑니다',
            lines: [
                `힘 ${this.stats.strength} · 속도 ${this.stats.speed} · 행운 ${this.stats.luck} · 공격력 ${Math.round(this.getTotalAttack())}`,
                `보유 광석 ${ore}개 · 워커 ${this.pendingWorkerCount}명 · 목표: ${questLabel}`,
                `장비 ${gear} · 합성법 ${this.recipeBook.length}종 기록됨`
            ]
        };
    }

    resetProgress() {
        clearProgress(this.profileId);
        window.location.reload();
    }

    // Luck used by ore rolls already includes trait bonuses.
    getEffectiveLuck() {
        return this.stats.luck + this.traitEffects.luckBonus;
    }

    getTraitData() {
        return {
            owned: this.traits.map((trait) => ({
                id: trait.id,
                name: trait.name,
                category: trait.category,
                rarity: trait.rarity,
                description: trait.description
            })),
            catalog: TRAITS.map((trait) => ({
                id: trait.id,
                name: trait.name,
                category: trait.category,
                rarity: trait.rarity,
                description: trait.description,
                owned: this.traits.some((owned) => owned.id === trait.id)
            })),
            categories: TRAIT_CATEGORIES,
            rarities: RARITY_INFO,
            total: TRAITS.length
        };
    }

    initWorld() {
        // Floor
        const floorGeo = new THREE.PlaneGeometry(50, 50);
        const floorMat = new THREE.MeshStandardMaterial({ 
            map: this.assets.floor,
            color: 0xb59ab9,
            roughness: 0.8,
            metalness: 0.05
        });
        this.assets.floor.wrapS = this.assets.floor.wrapT = THREE.RepeatWrapping;
        this.assets.floor.repeat.set(10, 10);
        
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);
        this.floor = floor;

        const grid = new THREE.GridHelper(48, 24, 0x9c7eaa, 0x3e304a);
        grid.position.y = 0.015;
        grid.material.transparent = true;
        grid.material.opacity = 0.32;
        this.scene.add(grid);

        // Lights
        const ambientLight = new THREE.AmbientLight(0x8f7aa8, 4.5);
        this.scene.add(ambientLight);
        this.ambientLight = ambientLight;

        const fillLight = new THREE.HemisphereLight(0xcab5df, 0x3a244b, 3.2);
        this.scene.add(fillLight);

        const caveLight = new THREE.PointLight(0x8d63c7, 12, 24, 2);
        caveLight.position.set(0, 7, 0);
        this.scene.add(caveLight);
        this.caveLight = caveLight;

        const dirLight = new THREE.DirectionalLight(0xffe4c2, 5);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.camera.left = -25;
        dirLight.shadow.camera.right = 25;
        dirLight.shadow.camera.top = 25;
        dirLight.shadow.camera.bottom = -25;
        this.scene.add(dirLight);

        // 첫 퀘스트를 안정적으로 진행할 수 있도록 석탄 노드를 충분히 배치합니다.
        // 이미 석탄 퀘스트를 마친 복귀 플레이어는 일반 광맥 위주로 배치합니다.
        // 층이 올라갈수록 광맥 수도 함께 늘어납니다.
        const totalNodes = this.getFloorNodeCount();
        const coalNodes = this.quest.stage === 'coal' ? 6 : 2;
        for (let i = 0; i < coalNodes; i++) {
            this.spawnNode('coal', { minDistance: 5 });
        }
        for (let i = 0; i < Math.max(0, totalNodes - coalNodes); i++) {
            this.spawnNode();
        }
        this.applyDepthAtmosphere();

        // 복귀 시 진행 중이던 퀘스트에 맞는 몬스터를 다시 배치합니다.
        if (this.quest.stage === 'recruit') {
            this.wave = Math.max(1, this.wave);
            this.waveEnemyTotal = 2;
            this.spawnEnemy('crawler', { distance: 13, isQuestEnemy: true });
            this.spawnEnemy('crawler', { distance: 15, isQuestEnemy: true });
        } else if (this.quest.stage === 'complete') {
            // Waves are opt-in, so a returning player simply lands in peacetime
            // and starts the next defence run whenever they choose.
            this.waveActive = false;
        }
    }

    // Which vein appears in the world. The vein only sets the general ore band.
    rollOreType() {
        const luck = this.getEffectiveLuck();
        const rareBonus = this.traitEffects.rareVeinBonus;
        // Mithril is meant to be a genuine find, not a routine vein. Luck and
        // traits still move the needle, but the base rate is deliberately tiny.
        const weights = {
            coal: 70,
            iron: 23 + luck * 1.4 + rareBonus,
            gold: 6 + luck * 1.8 + rareBonus * 1.2,
            mithril: 0.5 + luck * 0.55 + rareBonus * 0.6
        };
        return this.pickWeighted(weights, 'coal');
    }

    pickWeighted(weights, fallback) {
        const total = Object.values(weights).reduce((sum, weight) => sum + Math.max(0, weight), 0);
        if (total <= 0) return fallback;
        let roll = Math.random() * total;
        for (const [key, weight] of Object.entries(weights)) {
            roll -= Math.max(0, weight);
            if (roll <= 0) return key;
        }
        return fallback;
    }

    // What the vein actually drops on this pull. A vein is only a bias, not a
    // guarantee: any vein can yield other ore, and luck pushes the roll upward.
    rollMinedOre(veinType) {
        const config = this.oreConfig[veinType] || this.oreConfig.coal;
        const luck = this.getEffectiveLuck();
        const weights = {};

        Object.entries(this.oreConfig).forEach(([oreType, oreConfig]) => {
            const rarityGap = oreConfig.rarity - config.rarity;
            if (rarityGap === 0) {
                // The vein's own ore stays the most common result.
                weights[oreType] = 58;
            } else if (rarityGap > 0) {
                // Better ore than the vein: genuinely scarce. The steeper falloff
                // means striking mithril out of a lesser vein is a real event.
                weights[oreType] = (7 / Math.pow(3.4, rarityGap - 1)) + luck * (1.5 / rarityGap);
            } else {
                // Worse ore than the vein: common filler, reduced slightly by luck.
                weights[oreType] = Math.max(2, (20 / Math.pow(1.6, -rarityGap - 1)) - luck * 1.4);
            }
        });

        return this.pickWeighted(weights, veinType);
    }

    // ------------------------------------------------------------- depth
    // Floors are counted from B30F upward. `climbed` is how far the leader has
    // already risen, and it drives both hardness and vein count.

    /** 0 at B30F, 29 at B1F, 30 at the surface. */
    getFloorsClimbed() {
        return Math.max(0, this.startDepth - this.depth);
    }

    /** Deep rock is loose; the crust near the surface is compressed and old. */
    getDepthHardness() {
        // 1.00x at B30F rising to about 3.9x just under the surface.
        return 1 + this.getFloorsClimbed() * 0.1;
    }

    /** Veins to clear before the shaft up opens. Bigger the higher you climb. */
    getFloorQuota() {
        return 8 + Math.round(this.getFloorsClimbed() * 1.4);
    }

    /** Simultaneous veins standing in the mine on this floor. */
    getFloorNodeCount() {
        return Math.min(34, 18 + Math.round(this.getFloorsClimbed() * 0.55));
    }

    getFloorLabel(depth = this.depth) {
        return depth <= 0 ? '지상' : `지하 ${depth}층`;
    }

    /** True once the last seam on this floor has been emptied. */
    isFloorCleared() {
        return this.floorNodesCleared >= this.getFloorQuota();
    }

    /**
     * The floor is stripped: collapse it and climb one level toward daylight.
     * Every remaining vein is removed and the next floor is seeded fresh with
     * denser rock and more seams.
     */
    ascendFloor() {
        if (this.depth <= 0 || this.ascending) return;
        this.ascending = true;

        const from = this.depth;
        this.depth = Math.max(0, this.depth - 1);
        this.floorNodesCleared = 0;

        // Clear the stripped floor.
        this.nodes.forEach((node) => this.scene.remove(node));
        this.nodes = [];
        this.playerData.miningTarget = null;

        if (this.depth > 0) {
            const count = this.getFloorNodeCount();
            for (let i = 0; i < count; i++) this.spawnNode();
            this.app.ui.showBanner(
                `▲ ${this.getFloorLabel()}`,
                `광맥이 더 단단해집니다 · 목표 ${this.getFloorQuota()}광맥`,
                '#8fe4ff'
            );
            this.pushCombatFeed(
                `${this.getFloorLabel(from)}의 광맥을 모두 캐냈습니다. ${this.getFloorLabel()}으로 올라갑니다.`,
                '#8fe4ff'
            );
        } else {
            // Daylight. Nothing left above, so the mine stops generating.
            this.app.ui.showBanner('☀ 지상 도달', '30개 층을 모두 뚫고 올라왔습니다', '#ffe39a');
            this.pushCombatFeed('☀ 마침내 지상에 도달했습니다!', '#ffe39a');
        }

        this.applyDepthAtmosphere();
        this.persist();
        this.ascending = false;
    }

    /**
     * Lighting warms and brightens as the leader nears the surface, so the climb
     * is readable at a glance without any text.
     */
    applyDepthAtmosphere() {
        const t = Math.min(1, this.getFloorsClimbed() / this.startDepth);
        if (this.ambientLight) {
            this.ambientLight.intensity = 4.5 + t * 3.5;
            this.ambientLight.color.setHSL(0.72 - t * 0.62, 0.28 - t * 0.14, 0.55 + t * 0.18);
        }
        if (this.caveLight) {
            this.caveLight.color.setHSL(0.74 - t * 0.62, 0.5 - t * 0.22, 0.55 + t * 0.15);
        }
        if (this.floor?.material) {
            this.floor.material.color.setHSL(0.78 - t * 0.68, 0.16 + t * 0.06, 0.66 + t * 0.06);
        }
    }

    // Strength reduces required swings, but rare ore keeps a hard floor so it
    // always stays meaningfully harder to mine.
    getSwingsRequired(oreType) {
        const config = this.oreConfig[oreType] || this.oreConfig.coal;
        const reduction = (this.stats.strength - 1) * (1 + config.rarity * 0.55);
        // Traits that specialise in one ore apply their bonus only to that ore.
        let traitMult = 1;
        this.traits.forEach((trait) => {
            const modifiers = trait.modifiers || {};
            if (typeof modifiers.swingsRequiredMult !== 'number') return;
            if (modifiers.oreAffinity && modifiers.oreAffinity !== oreType) return;
            traitMult *= modifiers.swingsRequiredMult;
        });
        // Depth hardness is applied after strength, so climbing always costs the
        // leader real effort no matter how much muscle it has banked.
        const hardness = this.getDepthHardness();
        const base = Math.max(1, config.baseSwings - reduction) * traitMult * hardness;
        const floor = Math.max(2, Math.round(config.baseSwings * 0.3 * hardness));
        return Math.max(floor, Math.round(base));
    }

    // Speed shortens the interval between pickaxe swings, with a sane minimum.
    getSwingInterval() {
        const base = 0.46 - (this.stats.speed - 1) * 0.03;
        return Math.max(0.1, base / this.traitEffects.swingSpeedMult);
    }

    spawnNode(type, options = {}) {
        const nodeType = type || this.rollOreType();
        const config = this.oreConfig[nodeType] || this.oreConfig.coal;
        const model = this.assets[nodeType].clone();
        const angle = Math.random() * Math.PI * 2;
        const distance = options.minDistance !== undefined
            ? options.minDistance + Math.random() * 14
            : 5 + Math.random() * 17;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        // Bigger, chunkier veins so ore reads clearly on the isometric map.
        const scale = config.scale * (0.92 + Math.random() * 0.2);
        model.position.set(x, 0, z);
        model.scale.setScalar(scale);
        model.rotation.y = Math.random() * Math.PI * 2;
        model.userData = {
            type: 'node',
            oreType: nodeType,
            baseScale: scale,
            swingsRequired: this.getSwingsRequired(nodeType),
            swings: 0,
            // Reserves define how many items the vein yields before it is depleted.
            // Rare veins run dry fast, so a mithril seam is a brief opportunity
            // rather than a standing supply.
            reserves: Math.max(
                1,
                Math.round(
                    (3 + Math.floor(Math.random() * 4) + Math.max(0, 2 - config.rarity))
                    * (config.rarity >= 3 ? 0.4 : 1)
                ) + this.traitEffects.reservesBonus
            ),
            basePosition: new THREE.Vector3(x, 0, z)
        };
        model.traverse((child) => {
            child.userData.type = 'nodePart';
            child.castShadow = true;
        });

        this.scene.add(model);
        this.nodes.push(model);
        return model;
    }

    // Floating bar that hovers above a monster and always faces the camera.
    createHealthBar(width = 1.4, color = 0xff4d55) {
        const group = new THREE.Group();

        const backing = new THREE.Sprite(new THREE.SpriteMaterial({
            color: 0x120a12,
            transparent: true,
            opacity: 0.82,
            depthTest: false,
            depthWrite: false
        }));
        backing.scale.set(width, 0.16, 1);
        group.add(backing);

        const fill = new THREE.Sprite(new THREE.SpriteMaterial({
            color,
            transparent: true,
            depthTest: false,
            depthWrite: false
        }));
        fill.scale.set(width - 0.06, 0.1, 1);
        fill.position.z = 0.01;
        group.add(fill);

        group.renderOrder = 998;
        group.userData.fill = fill;
        group.userData.width = width - 0.06;
        return group;
    }

    updateHealthBar(bar, ratio) {
        if (!bar) return;
        const fill = bar.userData.fill;
        const width = bar.userData.width;
        const clamped = Math.max(0, Math.min(1, ratio));
        fill.scale.x = Math.max(0.001, width * clamped);
        // Anchor the shrinking bar to its left edge instead of its center.
        fill.position.x = -(width - fill.scale.x) * 0.5;
        fill.material.color.setHex(clamped > 0.5 ? 0x54d67a : clamped > 0.25 ? 0xffc861 : 0xff4d55);
    }

    /**
     * Spawns a typed monster from the archetype table. Options let the caller
     * override distance (quest enemies come in close, wave spawns come from the
     * edge of the mine).
     */
    spawnEnemy(typeId = 'crawler', options = {}) {
        const config = ENEMY_TYPES[typeId] || ENEMY_TYPES.crawler;
        const source = this.assets[config.asset];
        if (!source) return null;

        const enemy = source.clone();
        const scaled = scaleEnemyStats(config, Math.max(1, this.wave));
        const angle = options.angle !== undefined ? options.angle : Math.random() * Math.PI * 2;
        const distance = options.distance !== undefined ? options.distance : 17 + Math.random() * 7;
        const origin = options.origin || this.player.position;

        // Derive the grounding offset from the real GLB bounds (cached per type)
        // so no monster is buried in or hovering over the mine floor.
        if (this.groundOffsets[config.id] === undefined) {
            this.groundOffsets[config.id] = computeGroundOffset(source, config.scale);
        }
        const groundY = this.groundOffsets[config.id];

        enemy.position.set(
            origin.x + Math.cos(angle) * distance,
            groundY,
            origin.z + Math.sin(angle) * distance
        );
        enemy.scale.setScalar(config.scale);
        enemy.rotation.y = Math.random() * Math.PI * 2;
        enemy.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                // Clone materials so per-enemy hit flashes never bleed across clones.
                if (child.material) {
                    child.material = child.material.clone();
                    child.userData.baseEmissive = child.material.emissive
                        ? child.material.emissive.clone()
                        : null;
                }
            }
        });

        const barWidth = 1.1 + config.scale * 0.32;
        const bar = this.createHealthBar(barWidth, config.tint);
        // Floating UI must not affect the body's ground-contact measurement.
        bar.userData.ignoreContact = true;
        bar.position.y = (groundY + config.scale * 0.62) / config.scale;
        bar.scale.setScalar(1 / config.scale);
        enemy.add(bar);

        enemy.userData = {
            type: 'enemy',
            typeId: config.id,
            name: config.name,
            hp: scaled.hp,
            maxHp: scaled.hp,
            damage: scaled.damage,
            attackInterval: config.attackInterval * this.traitEffects.enemyIntervalMult,
            attackTimer: 0.7 + Math.random() * 0.8,
            range: config.range,
            moveSpeed: config.moveSpeed,
            keepDistance: config.keepDistance || 0,
            style: config.style,
            baseY: groundY,
            baseScale: config.scale,
            tint: config.tint,
            elite: config.elite,
            xp: config.xp,
            isQuestEnemy: !!options.isQuestEnemy,
            healthBar: bar,
            bob: Math.random() * Math.PI * 2,
            windup: 0,
            hitFlash: 0,
            deathTimer: 0
        };

        this.scene.add(enemy);
        this.enemies.push(enemy);

        // Arrival puff so monsters do not simply pop into existence.
        this.combatFX.spawnBurst(enemy.position, { color: config.tint, radius: 0.6, expand: 2.6 });
        return enemy;
    }

    // ------------------------------------------------------------------ waves
    startWave(wave) {
        this.wave = wave;
        this.waveActive = true;
        const composition = getWaveComposition(wave);
        let index = 0;
        const total = composition.reduce((sum, [, count]) => sum + count, 0);

        composition.forEach(([typeId, count]) => {
            for (let i = 0; i < count; i++) {
                const angle = (index / Math.max(1, total)) * Math.PI * 2 + Math.random() * 0.5;
                this.spawnEnemy(typeId, { angle, distance: 15 + Math.random() * 6 });
                index += 1;
            }
        });

        this.pushCombatFeed(`웨이브 ${wave} 시작! 몬스터 ${total}마리가 몰려옵니다.`, '#ff9c9c');
        this.app.ui.showWaveBanner(wave, total);
        this.persist();
    }

    pushCombatFeed(text, color = '#ded0e9') {
        this.combatFeed.unshift({ text, color, time: this.elapsed });
        if (this.combatFeed.length > 5) this.combatFeed.pop();
    }

    createWorkerPickaxe() {
        const pickaxe = new THREE.Group();
        const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x7b452c, roughness: 0.8 });
        const headMaterial = new THREE.MeshStandardMaterial({ color: 0xc6d4dc, metalness: 0.75, roughness: 0.28 });

        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.72, 6), handleMaterial);
        handle.position.y = 0.05;
        handle.rotation.z = -0.35;
        handle.castShadow = true;
        pickaxe.add(handle);

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.075, 0.075), headMaterial);
        head.position.set(0.12, 0.34, 0);
        head.rotation.z = -0.12;
        head.castShadow = true;
        pickaxe.add(head);

        pickaxe.position.set(0.34, 0.38, 0.18);
        pickaxe.rotation.z = -0.65;
        return pickaxe;
    }

    initPlayer() {
        this.player = this.assets.leader.clone();
        // Measure the actual model so the slime's underside rests on the floor
        // instead of sinking into it during movement and mining.
        this.player.userData.baseY = computeGroundOffset(this.assets.leader, 1.25);
        this.player.position.set(0, this.player.userData.baseY, 0);
        this.player.scale.setScalar(1.25);
        this.player.traverse((child) => {
            child.castShadow = true;
        });
        this.player.userData.baseScale = 1.25;
        this.player.userData.miningClock = Math.random() * Math.PI * 2;
        this.player.userData.isMining = false;
        this.player.userData.pickaxe = this.createWorkerPickaxe();
        this.player.userData.pickaxe.scale.setScalar(1.18);
        this.player.userData.pickaxe.position.set(0.4, 0.42, 0.2);
        // Held tools swing below the body mid-arc; excluding them keeps contact
        // correction driven by the slime itself, not the pickaxe tip.
        this.player.userData.pickaxe.userData.ignoreContact = true;
        this.player.add(this.player.userData.pickaxe);

        // The weapon arm is a pivot at the shoulder so swings rotate correctly.
        this.weaponArm = new THREE.Group();
        this.weaponArm.userData.ignoreContact = true;
        this.weaponArm.position.set(0.42, 0.32, 0.12);
        this.player.add(this.weaponArm);
        this.refreshWeaponMesh();

        this.scene.add(this.player);

        // 워커는 시작 시 보유하지 않으며, 몬스터 전투 보상으로 영입합니다.
    }

    // Rebuilds the held weapon so forged gear is visible on the character.
    refreshWeaponMesh() {
        if (!this.weaponArm) return;

        if (this.weaponMesh) {
            this.weaponArm.remove(this.weaponMesh);
            this.weaponMesh.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    child.material?.dispose();
                }
            });
        }

        this.weaponMesh = this.equipped
            ? createWeaponMesh(this.equipped.archetypeId, getTierById(this.equipped.tierId).color)
            : createFistMesh();
        this.weaponMesh.scale.setScalar(0.9);
        this.weaponArm.add(this.weaponMesh);
        this.weaponArm.rotation.set(-0.35, 0, -0.5);
    }

    addWorker() {
        if (this.workers.length >= 6) return false;

        const index = this.workers.length;
        const worker = this.assets.worker.clone();
        const angle = (index / 6) * Math.PI * 2;
        worker.userData.baseY = computeGroundOffset(this.assets.worker, 0.9);
        worker.position.set(
            this.player.position.x + Math.cos(angle) * 1.4,
            worker.userData.baseY,
            this.player.position.z + Math.sin(angle) * 1.4
        );
        worker.scale.setScalar(0.9);
        worker.userData.baseScale = 0.9;
        worker.userData.miningClock = Math.random() * Math.PI * 2;
        worker.userData.isMining = false;
        worker.userData.squadRole = this.squadCommand;
        worker.userData.attackCooldown = 0;
        worker.traverse((child) => {
            child.castShadow = true;
        });
        worker.userData.pickaxe = this.createWorkerPickaxe();
        worker.userData.pickaxe.userData.ignoreContact = true;
        worker.add(worker.userData.pickaxe);
        this.scene.add(worker);
        this.workers.push(worker);
        return true;
    }

    initControls() {
        this.canvas = this.app.renderer.domElement;
        this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
        this.app.ui.setCommandHandler((command) => this.setSquadCommand(command));
        this.app.ui.setStatHandler((stat) => this.upgradeStat(stat));
        this.app.ui.setAutoCombatHandler(() => this.toggleAutoCombat());
        // Mine defence waves are launched by the player from the combat menu.
        this.app.ui.setWaveStartHandler(() => {
            const result = this.startDefenceWave();
            if (!result.ok) this.pushCombatFeed(result.reason, '#ff9c9c');
            return result;
        });
        // Post-victory reward card selection.
        this.app.ui.setWaveRewardHandler((choiceId) => this.claimWaveReward(choiceId));
        // Crafting workshop: the UI owns the mix, gameLogic owns the forge.
        this.app.ui.setCraftHandlers({
            preview: (mix) => this.getCraftData(mix),
            craft: (mix) => {
                const result = this.craft(mix);
                return { result, data: this.getCraftData(mix) };
            },
            equip: (item) => {
                this.equipItem(item);
                return this.getCraftData(this.app.ui.craftMix);
            }
        });
    }

    setSquadCommand(command) {
        if (this.workers.length === 0) return;
        if (!['mine', 'attack', 'defend'].includes(command)) return;
        this.squadCommand = command;
        if (command !== 'mine') {
            this.playerData.miningTarget = null;
        }
        this.workers.forEach((worker) => {
            worker.userData.squadRole = command;
            worker.userData.attackCooldown = 0;
        });
    }

    onPointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;
        if (this.app.ui.craftOpen || this.isDown) return;

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Clicking a monster focuses auto-combat on it instead of opening a menu.
        const intersectsEnemies = this.raycaster.intersectObjects(this.enemies, true);
        if (intersectsEnemies.length > 0) {
            let target = intersectsEnemies[0].object;
            while (target.parent && !this.enemies.includes(target)) target = target.parent;
            if (this.enemies.includes(target) && !target.userData.dying) {
                this.playerTarget = target;
                this.firstStrikeUsed = false;
                this.playerData.miningTarget = null;
                this.autoCombat = true;
            }
            return;
        }

        const intersectsNodes = this.raycaster.intersectObjects(this.nodes, true);
        if (intersectsNodes.length > 0) {
            let target = intersectsNodes[0].object;
            while (target.parent && !this.nodes.includes(target)) target = target.parent;

            if (this.nodes.includes(target)) {
                this.playerData.miningTarget = target;
                this.playerData.targetPos.copy(this.getMiningStandPosition(target));
                this.miningHitTimer = 0;
                return;
            }
        }

        const intersectsFloor = this.raycaster.intersectObject(this.floor, false);
        if (intersectsFloor.length > 0) {
            this.playerData.targetPos.copy(intersectsFloor[0].point);
            this.playerData.targetPos.y = 0;
            this.playerData.miningTarget = null;
            this.miningHitTimer = 0;
        }
    }

    getMiningStandPosition(node) {
        // Stand beside the ore, on the camera-facing side, so the slime is never
        // hidden inside or behind the node while mining.
        const nodePosition = node.userData.basePosition || node.position;
        const approach = new THREE.Vector3()
            .subVectors(this.player.position, nodePosition)
            .setY(0);
        if (approach.lengthSq() < 0.04) approach.set(1, 0, 1);
        approach.normalize();
        return nodePosition.clone().add(approach.multiplyScalar(2.35));
    }

    getQuestData() {
        if (this.quest.stage === 'coal') {
            return {
                stage: 'coal',
                title: '첫 채굴',
                description: '석탄을 10개 모으세요.',
                progress: Math.min(this.inventory.coal, this.quest.coalGoal),
                target: this.quest.coalGoal,
                accent: '#b7f3ff'
            };
        }
        if (this.quest.stage === 'recruit') {
            return {
                stage: 'recruit',
                title: '새 동료를 찾아서',
                description: '몰려오는 몬스터를 처치하고 워커 슬라임을 구하세요.',
                progress: Math.max(0, 1 - this.enemies.length),
                target: 1,
                accent: '#ffcf8a'
            };
        }
        return {
            stage: 'complete',
            title: `광산 방어 · 웨이브 ${Math.max(1, this.wave)}`,
            description: this.waveActive
                ? `남은 몬스터 ${this.enemies.length}마리를 정리하세요.`
                : '자유롭게 채굴하세요. 준비되면 메뉴에서 광산 방어를 시작합니다.',
            progress: this.waveActive
                ? Math.max(0, this.waveEnemyTotal - this.enemies.length)
                : this.waveEnemyTotal || 1,
            target: Math.max(1, this.waveEnemyTotal || 1),
            accent: this.waveActive ? '#ff9c9c' : '#b7f3ff'
        };
    }

    completeCoalQuest() {
        if (this.quest.stage !== 'coal' || this.inventory.coal < this.quest.coalGoal) return;
        this.quest.stage = 'recruit';
        this.playerData.miningTarget = null;
        this.wave = 1;
        this.waveEnemyTotal = 2;
        this.spawnEnemy('crawler', { distance: 12, isQuestEnemy: true });
        this.spawnEnemy('crawler', { distance: 13, isQuestEnemy: true });
        this.pushCombatFeed('굴착충이 몰려옵니다! 자동 전투가 시작됩니다.', '#ff9c9c');
        this.app.ui.showWaveBanner(1, 2);
        this.persist();
    }

    // =================================================================
    // Real-time auto-combat
    // =================================================================

    toggleAutoCombat() {
        this.autoCombat = !this.autoCombat;
        return this.autoCombat;
    }

    getPlayerAttackInterval() {
        // Speed shortens the gap between strikes; weapons stay readable.
        const base = 1.05 - (this.stats.speed - 1) * 0.035;
        return Math.max(0.34, base / this.traitEffects.swingSpeedMult);
    }

    getPlayerRange() {
        const archetype = this.equipped?.archetypeId;
        if (archetype === 'sunspear') return 3.4;
        if (archetype === 'greatsword' || archetype === 'void_reaver') return 3.1;
        if (archetype === 'dagger') return 2.1;
        return 2.6;
    }

    // Closest living enemy inside an optional leash radius.
    acquireTarget(position, maxDistance = Infinity) {
        let best = null;
        let bestDistance = maxDistance;
        this.enemies.forEach((enemy) => {
            if (enemy.userData.dying) return;
            const distance = position.distanceTo(enemy.position);
            if (distance < bestDistance) {
                best = enemy;
                bestDistance = distance;
            }
        });
        return best;
    }

    /** Applies damage to a monster with full visual feedback. */
    damageEnemy(enemy, rawDamage, options = {}) {
        if (!enemy || enemy.userData.dying) return 0;

        const damage = Math.max(1, Math.round(rawDamage));
        enemy.userData.hp -= damage;
        enemy.userData.hitFlash = 1;
        // Knockback reads as physical force on lighter monsters.
        const push = new THREE.Vector3()
            .subVectors(enemy.position, options.from || this.player.position)
            .setY(0);
        if (push.lengthSq() > 0.001) {
            push.normalize().multiplyScalar(options.knockback ?? (0.42 / Math.max(0.6, enemy.userData.baseScale * 0.5)));
            enemy.position.add(push);
        }

        const color = options.crit ? '#fff3a8' : options.color || '#ffe0a0';
        this.combatFX.spawnDamageNumber(enemy.position, damage, {
            color,
            text: options.crit ? `${damage}!` : `${damage}`,
            scale: options.crit ? 1.45 : 1
        });
        this.combatFX.spawnSparks(enemy.position, {
            color: options.crit ? 0xfff3a8 : 0xffd166,
            count: options.crit ? 20 : 11,
            speed: options.crit ? 7.5 : 5,
            height: enemy.userData.baseY * 0.9
        });
        this.combatFX.spawnBurst(enemy.position, {
            color: 0xd8324a,
            radius: 0.34,
            expand: 2.2,
            height: enemy.userData.baseY * 0.9
        });
        this.combatFX.spawnFlash(enemy.position, options.crit ? 0xfff3a8 : 0xffb066, options.crit ? 34 : 18, 0.2);

        if (options.crit) this.app.addShake(0.32);
        else this.app.addShake(0.1);

        if (enemy.userData.hp <= 0) this.killEnemy(enemy);
        return damage;
    }

    killEnemy(enemy) {
        if (enemy.userData.dying) return;
        enemy.userData.dying = true;
        enemy.userData.deathTimer = 0.55;

        this.combatFX.spawnShockwave(enemy.position, {
            color: enemy.userData.elite ? 0xff7a4a : 0xff5a5a,
            scale: enemy.userData.elite ? 9 : 5
        });
        this.combatFX.spawnSparks(enemy.position, {
            color: enemy.userData.tint,
            count: 26,
            speed: 8,
            life: 0.7,
            height: enemy.userData.baseY
        });
        this.combatFX.spawnBurst(enemy.position, {
            color: enemy.userData.tint,
            radius: 0.85,
            expand: 3.4,
            life: 0.55,
            height: enemy.userData.baseY
        });
        this.combatFX.spawnFlash(enemy.position, enemy.userData.tint, 40, 0.35);
        this.app.addShake(enemy.userData.elite ? 0.85 : 0.34);

        if (enemy.userData.healthBar) enemy.userData.healthBar.visible = false;
        this.playSound('slime-squish');
        this.grantKillReward(enemy);
    }

    /** Ore + recruit rewards for a slain monster. */
    grantKillReward(enemy) {
        const xp = enemy.userData.xp || 5;
        const oreRoll = Math.random();
        let reward;
        if (enemy.userData.elite) {
            this.inventory.mithril += 2;
            this.inventory.gold += 3;
            reward = '미스릴 2 · 금광석 3';
        } else if (oreRoll < 0.14) {
            this.inventory.gold += 1;
            reward = '금광석 1';
        } else if (oreRoll < 0.5) {
            this.inventory.iron += 1 + Math.floor(Math.random() * 2);
            reward = '철광석';
        } else {
            const coal = 1 + Math.floor(Math.random() * 3);
            this.inventory.coal += coal;
            reward = `석탄 ${coal}`;
        }

        this.attackPower += Math.max(0, Math.round(xp * 0.06));
        this.pushCombatFeed(`${enemy.userData.name} 처치! ${reward} 획득`, '#8fd9a8');

        // Recruiting a worker is the reward for clearing the first quest fight.
        if (this.quest.stage === 'recruit' && this.enemies.filter((e) => !e.userData.dying).length <= 1) {
            if (this.addWorker()) {
                this.quest.stage = 'complete';
                this.pushCombatFeed('워커 슬라임이 합류했습니다!', '#ffe39a');
            }
        } else if (this.quest.stage === 'complete' && Math.random() < 0.22) {
            if (this.addWorker()) {
                this.pushCombatFeed(`워커 슬라임 합류! 현재 ${this.workers.length}명`, '#ffe39a');
            }
        }
    }

    /** The leader's automatic melee strike: real arc, real weapon, real impact. */
    playerStrike(target) {
        const facing = new THREE.Vector3().subVectors(target.position, this.player.position).setY(0);
        if (facing.lengthSq() < 0.0001) facing.set(0, 0, 1);
        facing.normalize();

        let damage = this.getTotalAttack() * this.traitEffects.attackMult;
        if (!this.firstStrikeUsed) {
            damage += this.traitEffects.firstStrikeBonus;
            this.firstStrikeUsed = true;
        }

        const critChance = 1 - (1 - this.traitEffects.critChance) * (1 - this.getEquipmentCrit());
        const isCrit = Math.random() < critChance;
        if (isCrit) damage *= this.traitEffects.critMult;

        // Kick off the visible swing animation on the weapon arm.
        this.swingTime = 0;
        this.swingDuration = Math.min(0.4, this.getPlayerAttackInterval() * 0.62);
        this.swingActive = true;

        const arcColor = this.equipped
            ? getTierById(this.equipped.tierId).color
            : '#9ff3e0';
        const arcOrigin = this.player.position.clone().addScaledVector(facing, 1.1);
        this.combatFX.spawnSlashArc(arcOrigin, facing, {
            color: arcColor,
            radius: isCrit ? 1.75 : 1.3,
            height: 0.7
        });

        const dealt = this.damageEnemy(target, damage, { crit: isCrit, from: this.player.position });
        this.playSound('mining-hit');

        if (dealt > 0 && Math.random() < this.traitEffects.lifestealChance) {
            const healed = Math.max(1, Math.round(dealt * 0.3));
            this.playerData.hp = Math.min(this.maxPlayerHp, this.playerData.hp + healed);
            this.combatFX.spawnDamageNumber(this.player.position, healed, { color: '#8fd9a8', text: `+${healed}` });
        }
    }

    /** Animates the weapon arm through its swing / idle guard poses. */
    updateWeaponPose(delta, inCombat) {
        if (!this.weaponArm) return;

        if (this.swingActive) {
            this.swingTime += delta;
            const t = Math.min(1, this.swingTime / this.swingDuration);
            // Wind up behind the shoulder, then whip forward and settle.
            const windup = Math.min(1, t / 0.32);
            const strike = Math.max(0, (t - 0.32) / 0.68);
            const angle = -2.15 * windup + 3.5 * Math.pow(strike, 0.55);
            this.weaponArm.rotation.z = -0.5 + angle;
            this.weaponArm.rotation.x = -0.35 - Math.sin(t * Math.PI) * 0.55;
            this.weaponArm.rotation.y = Math.sin(t * Math.PI) * 0.45;
            if (t >= 1) this.swingActive = false;
            return;
        }

        // Combat guard stance vs relaxed carry.
        const targetZ = inCombat ? -0.95 : -0.5;
        const targetX = inCombat ? -0.6 : -0.35;
        const idleBob = Math.sin(this.elapsed * (inCombat ? 5.5 : 2.4)) * (inCombat ? 0.09 : 0.05);
        this.weaponArm.rotation.z = THREE.MathUtils.damp(this.weaponArm.rotation.z, targetZ + idleBob, 9, delta);
        this.weaponArm.rotation.x = THREE.MathUtils.damp(this.weaponArm.rotation.x, targetX, 9, delta);
        this.weaponArm.rotation.y = THREE.MathUtils.damp(this.weaponArm.rotation.y, 0, 9, delta);
    }

    /** Damage applied to the leader, with hit feedback and death handling. */
    damagePlayer(amount, source) {
        if (this.isDown) return;
        const damage = Math.max(1, Math.round(amount * this.traitEffects.damageTakenMult));
        this.playerData.hp = Math.max(0, this.playerData.hp - damage);

        this.combatFX.spawnDamageNumber(this.player.position, damage, { color: '#ff7d6b', text: `-${damage}` });
        this.combatFX.spawnBurst(this.player.position, { color: 0xff5a5a, radius: 0.45, expand: 2.6 });
        this.combatFX.spawnFlash(this.player.position, 0xff5a5a, 22, 0.22);
        this.app.ui.flashDamageVignette();
        this.app.addShake(0.42);
        this.regenTimer = 5;

        if (source) {
            this.pushCombatFeed(`${source.userData.name}의 공격! ${damage} 피해`, '#ff9c9c');
        }

        if (this.playerData.hp <= 0) this.downPlayer();
    }

    /** The leader is knocked out: enemies scatter and a short revive plays. */
    downPlayer() {
        this.isDown = true;
        this.deathTimer = 3;
        this.playerData.miningTarget = null;
        this.combatFX.spawnShockwave(this.player.position, { color: 0x6ab7ff, scale: 8 });
        this.combatFX.spawnBurst(this.player.position, { color: 0x6ab7ff, radius: 1, expand: 3.6, life: 0.6 });
        this.app.addShake(0.9);
        this.pushCombatFeed('리더가 쓰러졌습니다… 잠시 후 부활합니다.', '#ff7d6b');

        // Enemies lose interest and drift away while the leader recovers.
        this.enemies.forEach((enemy) => {
            enemy.userData.attackTimer = 2.5;
        });
    }

    revivePlayer() {
        this.isDown = false;
        this.playerData.hp = Math.round(this.maxPlayerHp * 0.6);
        this.playerData.targetPos.copy(this.player.position);
        // Undo the knockdown squash so the leader stands at full height again;
        // the contact pass then re-seats it on the floor at the new scale.
        const baseScale = this.player.userData.baseScale || 1.25;
        this.player.scale.setScalar(baseScale);
        this.player.rotation.z = 0;
        this.combatFX.spawnShockwave(this.player.position, { color: 0x8fd9a8, scale: 6 });
        this.combatFX.spawnFlash(this.player.position, 0x8fd9a8, 34, 0.4);
        this.pushCombatFeed('리더가 다시 일어섰습니다!', '#8fd9a8');
    }

    /** Per-frame monster brain: approach, keep range, wind up, strike. */
    updateEnemy(enemy, delta) {
        const data = enemy.userData;

        // Death dissolve.
        if (data.dying) {
            data.deathTimer -= delta;
            const t = Math.max(0, data.deathTimer / 0.55);
            enemy.scale.setScalar(data.baseScale * t * (0.7 + t * 0.3));
            enemy.position.y = data.baseY * t;
            enemy.rotation.z += delta * 5;
            if (data.deathTimer <= 0) {
                this.scene.remove(enemy);
                this.enemies = this.enemies.filter((entry) => entry !== enemy);
            }
            return;
        }

        // Hit flash fades on the cloned materials.
        if (data.hitFlash > 0) {
            data.hitFlash = Math.max(0, data.hitFlash - delta * 4.5);
            enemy.traverse((child) => {
                if (child.isMesh && child.material?.emissive && child.userData.baseEmissive) {
                    child.material.emissive.copy(child.userData.baseEmissive)
                        .lerp(new THREE.Color(0xffffff), data.hitFlash * 0.85);
                }
            });
        }

        data.bob += delta * (data.style === 'melee' ? 5.5 : 3.4);
        const target = this.isDown ? null : this.player;
        const toPlayer = target
            ? new THREE.Vector3().subVectors(target.position, enemy.position).setY(0)
            : new THREE.Vector3();
        const distance = target ? toPlayer.length() : Infinity;

        if (target && distance > 0.01) {
            toPlayer.normalize();
            enemy.lookAt(enemy.position.x + toPlayer.x, enemy.position.y, enemy.position.z + toPlayer.z);
        }

        // Movement: melee closes in, ranged keeps its preferred spacing.
        let moving = false;
        if (target) {
            const preferred = data.keepDistance > 0 ? data.keepDistance : data.range * 0.82;
            if (distance > preferred + 0.35) {
                enemy.position.addScaledVector(toPlayer, data.moveSpeed * delta);
                moving = true;
            } else if (data.keepDistance > 0 && distance < preferred - 1.4) {
                enemy.position.addScaledVector(toPlayer, -data.moveSpeed * 0.8 * delta);
                moving = true;
            }
        }

        // Bobbing gait so nothing slides around rigidly.
        // Always a non-negative lift so no bob phase pushes a monster underground.
        const gait = moving
            ? Math.abs(Math.sin(data.bob)) * 0.14
            : Math.abs(Math.sin(data.bob * 0.5)) * 0.05;
        enemy.position.y = data.baseY + gait;
        enemy.scale.setScalar(data.baseScale * (1 + Math.sin(data.bob) * (moving ? 0.03 : 0.015)));

        // Health bar always faces the camera plane.
        if (data.healthBar) {
            this.updateHealthBar(data.healthBar, data.hp / data.maxHp);
        }

        // Attacking.
        if (!target || this.isDown) return;
        data.attackTimer -= delta;

        // Telegraph: rear back briefly before the blow lands.
        if (data.attackTimer < 0.35 && data.attackTimer > 0 && distance <= data.range + 0.6) {
            data.windup = 1 - data.attackTimer / 0.35;
            enemy.position.addScaledVector(toPlayer, -data.windup * delta * 1.4);
            enemy.scale.setScalar(data.baseScale * (1 + data.windup * 0.14));
        }

        if (data.attackTimer <= 0 && distance <= data.range + 0.4) {
            data.attackTimer = data.attackInterval * (0.85 + Math.random() * 0.3);
            data.windup = 0;

            if (data.style === 'ranged') {
                // Archers loose a real arrow that flies across the mine.
                const from = enemy.position.clone();
                from.y += data.baseY * 0.8;
                this.combatFX.fireArrow(from, () => (this.isDown ? null : this.player.position.clone()), {
                    color: data.tint,
                    speed: 22,
                    onHit: (impact) => {
                        this.combatFX.spawnSparks(impact, { color: data.tint, count: 10, speed: 4, height: 0 });
                        this.damagePlayer(data.damage, enemy);
                    }
                });
                this.pushCombatFeed(`${data.name}이(가) 화살을 쏩니다!`, '#8fe4ff');
            } else {
                // Melee: lunge into the leader with a visible slash.
                const lunge = toPlayer.clone().multiplyScalar(0.55);
                enemy.position.add(lunge);
                this.combatFX.spawnSlashArc(
                    enemy.position.clone().addScaledVector(toPlayer, 0.9),
                    toPlayer,
                    { color: `#${data.tint.toString(16).padStart(6, '0')}`, radius: 1.1, height: data.baseY * 0.9 }
                );
                this.damagePlayer(data.damage, enemy);
            }
        }
    }

    /** Leader auto-combat: pick a target, close in, and strike on cooldown. */
    updatePlayerCombat(delta) {
        this.playerAttackTimer = Math.max(0, this.playerAttackTimer - delta);

        if (this.isDown) {
            this.deathTimer -= delta;
            if (this.deathTimer <= 0) this.revivePlayer();
            this.updateWeaponPose(delta, false);
            return false;
        }

        // Out-of-combat regeneration keeps the loop forgiving between waves.
        this.regenTimer = Math.max(0, this.regenTimer - delta);
        if (this.regenTimer <= 0 && this.playerData.hp < this.maxPlayerHp) {
            this.playerData.hp = Math.min(this.maxPlayerHp, this.playerData.hp + delta * 6);
        }

        if (!this.autoCombat) {
            this.playerTarget = null;
            this.updateWeaponPose(delta, false);
            return false;
        }

        // Engage anything that comes close; a wider leash while already fighting.
        const leash = this.playerTarget && this.enemies.includes(this.playerTarget) ? 15 : 11;
        let target = this.playerTarget;
        if (!target || !this.enemies.includes(target) || target.userData.dying
            || this.player.position.distanceTo(target.position) > leash) {
            target = this.acquireTarget(this.player.position, 11);
            this.playerTarget = target;
            if (target) this.firstStrikeUsed = false;
        }

        if (!target) {
            this.updateWeaponPose(delta, false);
            return false;
        }

        const range = this.getPlayerRange();
        const toTarget = new THREE.Vector3().subVectors(target.position, this.player.position).setY(0);
        const distance = toTarget.length();

        if (distance > 0.01) {
            toTarget.normalize();
            this.player.lookAt(this.player.position.clone().add(toTarget));
        }

        if (distance > range) {
            // Chase: override the click destination while a fight is live.
            const step = Math.min(delta * 5.4 * this.traitEffects.moveSpeedMult, distance - range * 0.7);
            this.player.position.addScaledVector(toTarget, Math.max(0, step));
            this.player.position.y = this.player.userData.baseY || 0.5;
            this.playerData.targetPos.copy(this.player.position);
        } else if (this.playerAttackTimer <= 0) {
            this.playerStrike(target);
            this.playerAttackTimer = this.getPlayerAttackInterval();
        }

        this.updateWeaponPose(delta, true);
        return true;
    }

    /**
     * Runs after all animation so the leader, every worker, and every monster
     * touches the mine floor exactly, in every state: walking, mining, striking,
     * being hit, knocked down, and reviving.
     *
     * Animations keep full freedom of motion (squash, lean, bob, lunge); this
     * pass only removes the residual error between the body's real lowest point
     * and the ground, so the movement still reads as animated, never as clipping.
     */
    applyContactCorrections() {
        // The leader. `airborne` is set by actions that intentionally leave the
        // floor, and is honoured as a lift rather than being flattened.
        if (this.player) {
            applyGroundContact(this.player, this.player.userData.airborne || 0);
        }

        this.workers.forEach((worker) => {
            applyGroundContact(worker, worker.userData.airborne || 0);
        });

        this.enemies.forEach((enemy) => {
            const data = enemy.userData;
            // A dying monster sinks away on purpose as it dissolves.
            if (data.dying) return;
            applyGroundContact(enemy, data.airborne || 0);
        });
    }

    /**
     * Waves are opt-in. Nothing spawns on a timer any more: the player chooses
     * when to start a defence run from the menu, so mining time is never
     * interrupted by an ambush they did not ask for.
     */
    updateWaves(delta) {
        if (this.quest.stage !== 'complete' && this.quest.stage !== 'recruit') return;
        if (!this.waveActive) return;

        const living = this.enemies.filter((enemy) => !enemy.userData.dying).length;
        if (living === 0) {
            if (this.quest.stage === 'recruit') return;
            this.waveActive = false;
            this.pushCombatFeed(`웨이브 ${this.wave} 격퇴! 보상을 선택하세요.`, '#8fd9a8');
            // Lock the next wave right away, then let the clear banner land
            // before the reward cards slide in.
            const clearedWave = this.wave;
            this.rewardPending = { wave: clearedWave, choices: this.buildRewardChoices(clearedWave) };
            setTimeout(() => this.offerWaveReward(clearedWave), 1400);
            this.app.ui.showWaveCleared(this.wave);
            this.persist();
        }
    }

    // ------------------------------------------------------- wave rewards
    // Victory is not a payout, it is a decision. Three cards are offered and
    // each one answers a different question the player is already asking:
    // "can I afford the next forge?", "can I survive deeper rock?", "can my
    // squad carry the next wave?".

    /**
     * Builds the three reward cards, scaled to the wave that was just cleared
     * and to the floor the leader is currently working.
     */
    buildRewardChoices(wave) {
        const tier = Math.max(1, wave);
        const hardness = this.getDepthHardness();

        // 1) Ore bundle — immediate crafting/upgrade fuel.
        const coal = 14 + tier * 6;
        const iron = 7 + tier * 4;
        const gold = Math.max(1, Math.floor(tier * 1.6));
        const mithril = tier >= 4 ? Math.max(1, Math.floor(tier / 4)) : 0;
        const oreParts = [`석탄 ${coal}`, `철 ${iron}`, `금 ${gold}`];
        if (mithril > 0) oreParts.push(`미스릴 ${mithril}`);

        // 2) Leader growth — one free stat level plus a permanent HP bump.
        const statKey = ['strength', 'speed', 'luck'][Math.floor(Math.random() * 3)];
        const statLabel = { strength: '힘', speed: '속도', luck: '행운' }[statKey];
        const statBenefit = {
            strength: `암반 경도 x${hardness.toFixed(1)}인 지금, 광맥당 곡괭이질이 즉시 줄어듭니다.`,
            speed: '곡괭이 간격이 짧아져 층 목표를 더 빨리 비웁니다.',
            luck: '고급 광석이 더 자주 나와 미스릴 확보가 쉬워집니다.'
        }[statKey];
        const hpGain = 12 + tier * 3;

        // 3) Worker squad upgrade — pays off in the next defence run.
        const workerAtk = 0.18;
        const workerMine = 0.12;

        return [
            {
                id: 'ore',
                icon: '⛏',
                color: '#b7f3ff',
                title: '광석 묶음',
                summary: oreParts.join(' · '),
                benefit: '지금 바로 대장간에 넣거나 스탯 강화 비용으로 씁니다. 다음 층으로 올라가기 전에 장비를 한 번 더 굴려볼 수 있습니다.',
                payload: { coal, iron, gold, mithril }
            },
            {
                id: 'growth',
                icon: '🧬',
                color: '#ffd08a',
                title: '리더 성장 재료',
                summary: `${statLabel} +1 · 최대 HP +${hpGain}`,
                benefit: `${statBenefit} 늘어난 체력은 다음 웨이브에서 그대로 버티는 힘이 됩니다.`,
                payload: { stat: statKey, hp: hpGain }
            },
            {
                id: 'squad',
                icon: '🛡',
                color: '#c7a3ef',
                title: '워커 강화 효과',
                summary: `워커 공격력 +${Math.round(workerAtk * 100)}% · 채굴 속도 +${Math.round(workerMine * 100)}% (영구)`,
                benefit: `워커 ${this.workers.length}명이 더 세게 때리고 더 빨리 캡니다. 방어 명령으로 두고 채굴하면 다음 전투가 훨씬 안전해집니다.`,
                payload: { attack: workerAtk, mine: workerMine }
            }
        ];
    }

    /**
     * Presents the three cards. Gameplay keeps running underneath. The offer is
     * usually already locked in by updateWaves, so reuse it rather than
     * re-rolling the cards the player is about to see.
     */
    offerWaveReward(wave) {
        if (!this.rewardPending || this.rewardPending.wave !== wave) {
            this.rewardPending = { wave, choices: this.buildRewardChoices(wave) };
        }
        this.app.ui.showWaveReward({
            wave,
            choices: this.rewardPending.choices.map((choice) => ({
                id: choice.id,
                icon: choice.icon,
                color: choice.color,
                title: choice.title,
                summary: choice.summary,
                benefit: choice.benefit
            }))
        });
    }

    /** Applies the picked card immediately and closes the offer. */
    claimWaveReward(choiceId) {
        if (!this.rewardPending) return { ok: false };
        const choice = this.rewardPending.choices.find((entry) => entry.id === choiceId);
        if (!choice) return { ok: false };
        this.rewardPending = null;

        if (choice.id === 'ore') {
            Object.entries(choice.payload).forEach(([ore, amount]) => {
                if (amount > 0) this.inventory[ore] += amount;
            });
            this.pushCombatFeed(`보상 획득: ${choice.summary}`, '#b7f3ff');
        } else if (choice.id === 'growth') {
            this.stats[choice.payload.stat] += 1;
            this.maxPlayerHp += choice.payload.hp;
            this.playerData.hp = Math.min(this.maxPlayerHp, this.playerData.hp + choice.payload.hp);
            // Swing counts are cached on each vein, so refresh them now.
            this.nodes.forEach((node) => {
                node.userData.swingsRequired = this.getSwingsRequired(node.userData.oreType);
            });
            this.pushCombatFeed(`보상 획득: ${choice.summary}`, '#ffd08a');
        } else if (choice.id === 'squad') {
            this.boons.workerAttackMult += choice.payload.attack;
            this.boons.workerSwingMult += choice.payload.mine;
            this.pushCombatFeed(`보상 획득: ${choice.summary}`, '#c7a3ef');
        }

        this.persist();
        return { ok: true };
    }

    /**
     * Player-initiated mine defence. Returns a result object so the UI can
     * explain why a run could not start.
     */
    startDefenceWave(waveOverride = null) {
        if (this.quest.stage !== 'complete' && this.quest.stage !== 'recruit') {
            return { ok: false, reason: '아직 광산 방어를 시작할 수 없습니다. 퀘스트를 먼저 진행하세요.' };
        }
        if (this.waveActive) {
            return { ok: false, reason: '이미 방어전이 진행 중입니다.' };
        }
        if (this.isDown) {
            return { ok: false, reason: '리더가 쓰러져 있습니다. 부활을 기다리세요.' };
        }
        if (this.rewardPending) {
            return { ok: false, reason: '먼저 지난 웨이브의 보상을 선택하세요.' };
        }

        const nextWave = waveOverride ?? (Math.max(0, this.wave) + 1);
        this.waveEnemyTotal = getWaveComposition(nextWave).reduce((sum, [, count]) => sum + count, 0);
        this.startWave(nextWave);
        return { ok: true, wave: nextWave };
    }

    /** Highest wave the player may jump straight to (cleared waves + 1). */
    getMaxSelectableWave() {
        return Math.max(1, this.wave + 1);
    }

    getCombatData() {
        const target = this.playerTarget && this.enemies.includes(this.playerTarget) && !this.playerTarget.userData.dying
            ? this.playerTarget
            : null;
        return {
            auto: this.autoCombat,
            isDown: this.isDown,
            reviveIn: this.isDown ? Math.max(0, this.deathTimer) : 0,
            wave: Math.max(0, this.wave),
            waveActive: this.waveActive,
            // Menu state: waves are opt-in, so the UI needs to know whether a
            // defence run can be launched right now and which wave is next.
            canStartWave: !this.waveActive && !this.isDown && !this.rewardPending
                && (this.quest.stage === 'complete' || this.quest.stage === 'recruit'),
            rewardPending: !!this.rewardPending,
            waveUnlocked: this.quest.stage === 'complete' || this.quest.stage === 'recruit',
            nextWave: Math.max(0, this.wave) + 1,
            maxSelectableWave: this.getMaxSelectableWave(),
            enemiesLeft: this.enemies.filter((enemy) => !enemy.userData.dying).length,
            attackInterval: this.getPlayerAttackInterval(),
            target: target
                ? {
                    name: target.userData.name,
                    hp: Math.max(0, target.userData.hp),
                    maxHp: target.userData.maxHp,
                    elite: target.userData.elite
                }
                : null,
            feed: this.combatFeed.slice(0, 4)
        };
    }

    // ------------------------------------------------------------ crafting
    // The player designs the recipe themselves by choosing ore amounts. Craft
    // cost traits shave ore off the bill, and luck improves the success roll.
    getCraftCost(mix) {
        const mult = this.traitEffects.craftCostMult;
        const cost = {};
        ORE_KEYS.forEach((ore) => {
            const requested = Math.max(0, Math.floor(mix?.[ore] || 0));
            cost[ore] = requested > 0 ? Math.max(1, Math.round(requested * mult)) : 0;
        });
        return cost;
    }

    canAffordMix(mix) {
        const cost = this.getCraftCost(mix);
        return ORE_KEYS.every((ore) => this.inventory[ore] >= cost[ore]);
    }

    // Total attack including the forged weapon so combat reads one number.
    getTotalAttack() {
        return this.attackPower + (this.equipped?.stats.attack || 0);
    }

    getEquipmentCrit() {
        return this.equipped?.stats.crit || 0;
    }

    // Recompute max HP from base + traits + equipment so re-equipping is safe.
    refreshMaxHp() {
        const previousMax = this.maxPlayerHp;
        this.maxPlayerHp = this.baseMaxHp + this.traitEffects.maxHpBonus + (this.equipped?.stats.hp || 0);
        if (this.playerData) {
            const delta = this.maxPlayerHp - previousMax;
            this.playerData.hp = Math.max(1, Math.min(this.maxPlayerHp, this.playerData.hp + Math.max(0, delta)));
        }
    }

    // Every distinct ore ratio the player has ever forged is remembered.
    recordRecipe(mix, result) {
        const key = recipeKey(mix);
        let entry = this.recipeBook.find((recipe) => recipe.key === key);
        if (!entry) {
            entry = {
                key,
                mix: { ...result.item.mix },
                archetypeId: result.item.archetypeId,
                name: result.item.name,
                icon: result.item.icon,
                bestTierId: result.item.tierId,
                bestStats: { ...result.item.stats },
                crafts: 0,
                successes: 0,
                discoveredAt: Date.now()
            };
            this.recipeBook.push(entry);
            entry.isNew = true;
        } else {
            entry.isNew = false;
        }

        entry.crafts += 1;
        if (result.success) entry.successes += 1;

        const bestPower = getItemPower({ stats: entry.bestStats });
        if (getItemPower(result.item) > bestPower) {
            entry.bestTierId = result.item.tierId;
            entry.bestStats = { ...result.item.stats };
            entry.name = result.item.name;
        }

        return entry;
    }

    craft(mix) {
        const cost = this.getCraftCost(mix);
        const total = ORE_KEYS.reduce((sum, ore) => sum + cost[ore], 0);
        if (total <= 0) {
            this.craftLog = { ok: false, message: '광석을 하나 이상 넣어야 합니다.' };
            return this.craftLog;
        }
        if (!this.canAffordMix(mix)) {
            this.craftLog = { ok: false, message: '광석이 부족합니다.' };
            return this.craftLog;
        }

        ORE_KEYS.forEach((ore) => {
            this.inventory[ore] -= cost[ore];
        });

        const result = forgeItem(mix, this.getEffectiveLuck());
        // Craft-power traits add a flat bonus to whatever comes out of the forge.
        if (this.traitEffects.craftPowerBonus > 0) {
            result.item.stats.attack += Math.round(this.traitEffects.craftPowerBonus);
        }

        const entry = this.recordRecipe(mix, result);
        this.totalCrafted = (this.totalCrafted || 0) + 1;

        // Auto-equip only when the new piece is genuinely better.
        const upgraded = getItemPower(result.item) > getItemPower(this.equipped);
        if (upgraded) {
            this.equipped = result.item;
            this.refreshMaxHp();
            // The held weapon mesh must match the newly equipped item.
            this.refreshWeaponMesh();
        }

        const tier = getTierById(result.item.tierId);
        let message;
        if (result.critical) {
            message = `대성공! ${tier.label} 등급 ${result.item.name}을(를) 벼려냈습니다!`;
        } else if (result.success) {
            message = `${tier.label} 등급 ${result.item.name} 제작 성공!`;
        } else {
            message = `제작 실패… ${result.item.name}이(가) 나왔습니다.`;
        }
        if (entry.isNew) message += ' 새 합성법이 기록되었습니다.';
        if (upgraded) message += ' 장착했습니다!';

        this.playSound(result.success ? 'mining-hit' : 'slime-squish');
        this.persist();

        this.craftLog = {
            ok: true,
            success: result.success,
            critical: result.critical,
            item: result.item,
            tierId: result.item.tierId,
            equipped: upgraded,
            newRecipe: entry.isNew,
            message
        };
        return this.craftLog;
    }

    equipItem(item) {
        if (!item || !item.stats) return false;
        this.equipped = item;
        this.refreshMaxHp();
        this.refreshWeaponMesh();
        this.persist();
        return true;
    }

    // Everything the crafting workshop UI needs to render.
    getCraftData(mix) {
        const safeMix = {};
        ORE_KEYS.forEach((ore) => {
            safeMix[ore] = Math.max(0, Math.floor(mix?.[ore] || 0));
        });

        const preview = previewCraft(safeMix, this.getEffectiveLuck());
        const cost = this.getCraftCost(safeMix);

        return {
            ores: ORE_KEYS.map((ore) => ({
                key: ore,
                label: ORE_INFO[ore].label,
                color: ORE_INFO[ore].color,
                owned: this.inventory[ore],
                cost: cost[ore]
            })),
            tiers: QUALITY_TIERS.filter((tier) => Number.isFinite(tier.min) || tier.id === 'crude'),
            preview,
            affordable: this.canAffordMix(safeMix) && preview.mass > 0,
            equipped: this.equipped,
            baseAttack: this.attackPower,
            totalAttack: this.getTotalAttack(),
            recipes: this.recipeBook
                .slice()
                .sort((a, b) => getItemPower({ stats: b.bestStats }) - getItemPower({ stats: a.bestStats }))
                .map((entry) => ({
                    key: entry.key,
                    mix: entry.mix,
                    name: entry.name,
                    icon: entry.icon,
                    bestTierId: entry.bestTierId,
                    bestStats: entry.bestStats,
                    crafts: entry.crafts,
                    successes: entry.successes,
                    affordable: this.canAffordMix(entry.mix)
                })),
            log: this.craftLog
        };
    }

    getStatCost(stat) {
        const level = this.stats[stat] || 1;
        const mult = this.traitEffects.upgradeCostMult;
        return {
            coal: Math.max(1, Math.round((6 + (level - 1) * 4) * mult)),
            iron: Math.max(0, Math.round((level - 1) * 3 * mult))
        };
    }

    getStatsData() {
        return {
            strength: this.stats.strength,
            speed: this.stats.speed,
            luck: this.stats.luck,
            costs: {
                strength: this.getStatCost('strength'),
                speed: this.getStatCost('speed'),
                luck: this.getStatCost('luck')
            },
            swingInterval: this.getSwingInterval(),
            swingsPerOre: {
                coal: this.getSwingsRequired('coal'),
                iron: this.getSwingsRequired('iron'),
                gold: this.getSwingsRequired('gold'),
                mithril: this.getSwingsRequired('mithril')
            }
        };
    }

    // Spend ore to permanently improve mining performance.
    upgradeStat(stat) {
        if (!['strength', 'speed', 'luck'].includes(stat)) return false;
        const cost = this.getStatCost(stat);
        if (this.inventory.coal < cost.coal || this.inventory.iron < cost.iron) return false;

        this.inventory.coal -= cost.coal;
        this.inventory.iron -= cost.iron;
        this.stats[stat] += 1;

        if (stat === 'strength') {
            // Existing veins immediately benefit from the new strength value.
            this.nodes.forEach((node) => {
                node.userData.swingsRequired = this.getSwingsRequired(node.userData.oreType);
                node.userData.swings = Math.min(node.userData.swings, node.userData.swingsRequired - 1);
            });
        }

        this.playSound('mining-hit');
        this.persist();
        return true;
    }

    findNearestNode(position) {
        let nearest = null;
        let nearestDistance = Infinity;
        this.nodes.forEach((node) => {
            const distance = position.distanceTo(node.position);
            if (distance < nearestDistance) {
                nearest = node;
                nearestDistance = distance;
            }
        });
        return nearest;
    }

    getNearestEnemy(position, maxDistance = Infinity) {
        let nearest = null;
        let nearestDistance = maxDistance;
        this.enemies.forEach((enemy) => {
            const distance = position.distanceTo(enemy.position);
            if (distance < nearestDistance) {
                nearest = enemy;
                nearestDistance = distance;
            }
        });
        return nearest;
    }

    moveWorker(worker, target, delta, speed = 4) {
        const direction = new THREE.Vector3().subVectors(target, worker.position);
        direction.y = 0;
        const distance = direction.length();
        if (distance <= 0.18) return false;
        direction.normalize();
        const step = Math.min(speed * delta, distance);
        worker.position.add(direction.multiplyScalar(step));
        worker.position.y = worker.userData.baseY || 0.5;
        worker.lookAt(worker.position.clone().add(direction));
        return true;
    }

    animateWorkerMining(worker, isMining, delta) {
        worker.userData.miningClock = (worker.userData.miningClock || 0) + delta * (isMining ? 8.5 : 3.5);
        const clock = worker.userData.miningClock;
        const baseScale = worker.userData.baseScale || 0.9;
        const baseY = worker.userData.baseY || 0.5;
        const pickaxe = worker.userData.pickaxe;

        if (isMining) {
            const impact = Math.max(0, Math.sin(clock));
            const anticipation = Math.max(0, Math.sin(clock - 0.9));
            const squash = impact * 0.075;
            worker.scale.set(
                baseScale * (1 + squash * 0.72),
                baseScale * (1 - squash),
                baseScale * (1 + squash * 0.72)
            );
            // Only the anticipation hop is expressed here; the contact pass
            // resolves the squash against the floor after animation.
            worker.position.y = baseY + anticipation * 0.06;
            worker.rotation.z = Math.sin(clock * 0.5) * 0.055;
            if (pickaxe) {
                pickaxe.rotation.z = -0.65 + anticipation * 1.95 - impact * 0.48;
                pickaxe.rotation.x = Math.sin(clock) * 0.08;
            }
        } else {
            worker.scale.setScalar(baseScale);
            worker.position.y = THREE.MathUtils.damp(worker.position.y, baseY, 10, delta);
            worker.rotation.z = THREE.MathUtils.damp(worker.rotation.z, 0, 10, delta);
            if (pickaxe) {
                pickaxe.rotation.z = THREE.MathUtils.damp(pickaxe.rotation.z, -0.65, 10, delta);
                pickaxe.rotation.x = THREE.MathUtils.damp(pickaxe.rotation.x, 0, 10, delta);
            }
        }
        worker.userData.isMining = isMining;
    }

    animatePlayerMining(isMining, delta) {
        const player = this.player;
        // Swing animation speed follows the speed stat so faster mining looks faster.
        const swingRate = Math.PI / Math.max(0.16, this.getSwingInterval());
        player.userData.miningClock = (player.userData.miningClock || 0) + delta * (isMining ? swingRate : 3.2);
        const clock = player.userData.miningClock;
        const baseScale = player.userData.baseScale || 1.25;
        const baseY = player.userData.baseY || 0.5;
        const pickaxe = player.userData.pickaxe;

        if (isMining) {
            const impact = Math.max(0, Math.sin(clock));
            const anticipation = Math.max(0, Math.sin(clock - 0.9));
            const squash = impact * 0.06;
            player.scale.set(
                baseScale * (1 + squash * 0.72),
                baseScale * (1 - squash),
                baseScale * (1 + squash * 0.72)
            );
            // Only the anticipation hop is expressed here; the contact pass
            // resolves the squash against the floor after animation.
            player.position.y = baseY + anticipation * 0.06;
            player.rotation.z = Math.sin(clock * 0.5) * 0.045;
            if (pickaxe) {
                pickaxe.rotation.z = -0.65 + anticipation * 1.85 - impact * 0.5;
                pickaxe.rotation.x = Math.sin(clock) * 0.08;
            }
        } else {
            player.scale.x = THREE.MathUtils.damp(player.scale.x, baseScale, 10, delta);
            player.scale.y = THREE.MathUtils.damp(player.scale.y, baseScale, 10, delta);
            player.scale.z = THREE.MathUtils.damp(player.scale.z, baseScale, 10, delta);
            player.position.y = THREE.MathUtils.damp(player.position.y, baseY, 10, delta);
            player.rotation.z = THREE.MathUtils.damp(player.rotation.z, 0, 10, delta);
            if (pickaxe) {
                pickaxe.rotation.z = THREE.MathUtils.damp(pickaxe.rotation.z, -0.65, 10, delta);
                pickaxe.rotation.x = THREE.MathUtils.damp(pickaxe.rotation.x, 0, 10, delta);
            }
        }
        player.userData.isMining = isMining;
    }

    // Workers swing their pickaxes at monsters with the same visual language
    // as the leader, just smaller and faster.
    workerAttack(worker, enemy, delta) {
        if (!this.enemies.includes(enemy) || enemy.userData.dying) return;
        worker.userData.attackCooldown = Math.max(0, (worker.userData.attackCooldown || 0) - delta);
        if (worker.userData.attackCooldown > 0) return;

        worker.userData.attackCooldown = 0.75;
        worker.userData.swingFx = 0.3;

        const facing = new THREE.Vector3().subVectors(enemy.position, worker.position).setY(0);
        if (facing.lengthSq() > 0.0001) {
            facing.normalize();
            this.combatFX.spawnSlashArc(
                worker.position.clone().addScaledVector(facing, 0.85),
                facing,
                { color: '#b7f3ff', radius: 0.85, height: 0.6 }
            );
        }

        const damage = 4 * this.traitEffects.workerAttackMult * this.boons.workerAttackMult
            * (1 + (this.stats.strength - 1) * 0.18);
        this.damageEnemy(enemy, damage, { from: worker.position, color: '#b7f3ff', knockback: 0.16 });
    }

    // Short weapon-swing flourish while a worker is fighting.
    animateWorkerCombat(worker, delta) {
        const pickaxe = worker.userData.pickaxe;
        worker.userData.swingFx = Math.max(0, (worker.userData.swingFx || 0) - delta);
        const t = worker.userData.swingFx / 0.3;
        if (pickaxe) {
            const swing = t > 0 ? Math.sin(t * Math.PI) : 0;
            pickaxe.rotation.z = -0.65 + swing * 2.2;
            pickaxe.rotation.x = swing * 0.4;
        }
        const baseScale = worker.userData.baseScale || 0.9;
        worker.scale.setScalar(baseScale * (1 + (t > 0 ? Math.sin(t * Math.PI) * 0.1 : 0)));
        worker.position.y = worker.userData.baseY || 0.5;
    }

    updateWorker(worker, index, delta) {
        const formationAngle = (index / Math.max(1, this.workers.length)) * Math.PI * 2;
        let destination = this.player.position.clone();
        let enemy = null;
        let isMining = false;

        if (this.squadCommand === 'mine') {
            const node = this.playerData.miningTarget && this.nodes.includes(this.playerData.miningTarget)
                ? this.playerData.miningTarget
                : this.findNearestNode(this.player.position);
            if (node) {
                const offset = new THREE.Vector3(Math.cos(formationAngle), 0, Math.sin(formationAngle)).multiplyScalar(1.35);
                destination = node.position.clone().add(offset);
                const workerDistance = Math.hypot(
                    worker.position.x - node.position.x,
                    worker.position.z - node.position.z
                );
                if (workerDistance < 3.1) {
                    isMining = true;
                    worker.userData.swingTimer = (worker.userData.swingTimer || 0) - delta;
                    if (worker.userData.swingTimer <= 0) {
                        this.swingAtNode(node);
                        worker.userData.swingTimer = 0.72
                            / (this.traitEffects.workerSwingMult * this.boons.workerSwingMult);
                    }
                }
            }
        } else if (this.squadCommand === 'attack') {
            enemy = this.acquireTarget(worker.position, 20);
            if (enemy) {
                // Fan out around the monster so workers do not stack up.
                const flank = new THREE.Vector3(Math.cos(formationAngle), 0, Math.sin(formationAngle))
                    .multiplyScalar(1.5);
                destination = enemy.position.clone().add(flank);
                if (worker.position.distanceTo(enemy.position) < 2.6) {
                    this.workerAttack(worker, enemy, delta);
                }
            } else {
                const offset = new THREE.Vector3(Math.cos(formationAngle), 0, Math.sin(formationAngle)).multiplyScalar(1.8);
                destination = this.player.position.clone().add(offset);
            }
        } else {
            // 방어 명령: 리더 주변을 순찰하다가 가까이 온 적을 요격합니다.
            enemy = this.acquireTarget(this.player.position, 8);
            if (enemy) {
                const flank = new THREE.Vector3(Math.cos(formationAngle), 0, Math.sin(formationAngle))
                    .multiplyScalar(1.5);
                destination = enemy.position.clone().add(flank);
                if (worker.position.distanceTo(enemy.position) < 2.6) {
                    this.workerAttack(worker, enemy, delta);
                }
            } else {
                const patrolAngle = formationAngle + this.elapsed * 0.45;
                destination = this.player.position.clone().add(
                    new THREE.Vector3(Math.cos(patrolAngle), 0, Math.sin(patrolAngle)).multiplyScalar(2.4)
                );
            }
        }

        this.moveWorker(worker, destination, delta, this.squadCommand === 'defend' ? 3.5 : 4);
        // Fighting workers use the combat flourish; mining workers keep the
        // existing pickaxe loop.
        if (enemy) {
            this.animateWorkerCombat(worker, delta);
        } else {
            this.animateWorkerMining(worker, isMining, delta);
        }
    }

    update(delta) {
        this.elapsed += delta;

        // Periodic autosave keeps progression safe without hammering storage.
        this.saveTimer -= delta;
        if (this.saveTimer <= 0) {
            this.persist();
            this.saveTimer = 5;
        }

        this.updateWaves(delta);
        this.nodes.forEach((node) => {
            const pulse = node.userData.hitPulse || 0;
            node.userData.hitPulse = Math.max(0, pulse - delta * 8);
            if (node.userData.lastYieldTimer > 0) {
                node.userData.lastYieldTimer = Math.max(0, node.userData.lastYieldTimer - delta);
            }
            const basePosition = node.userData.basePosition || node.position;
            const shake = node.userData.hitPulse * 0.09;
            node.position.copy(basePosition);
            node.position.x += Math.sin(this.elapsed * 72) * shake;
            node.position.z += Math.cos(this.elapsed * 66) * shake;
            const baseScale = node.userData.baseScale || 2.6;
            node.scale.setScalar(baseScale * (1 + node.userData.hitPulse * 0.07));
        });

        // Auto-combat takes priority: while a monster is engaged the leader
        // chases and fights instead of walking to a click destination.
        const inCombat = this.updatePlayerCombat(delta);

        if (!inCombat && !this.isDown) {
            // Move the leader on the XZ plane and clamp the last step so it never
            // overshoots the selected ore node.
            const moveDir = new THREE.Vector3().subVectors(this.playerData.targetPos, this.player.position);
            moveDir.y = 0;
            const moveDistance = moveDir.length();
            if (moveDistance > 0.06) {
                moveDir.normalize();
                const step = Math.min(delta * 5 * this.traitEffects.moveSpeedMult, moveDistance);
                this.player.position.add(moveDir.multiplyScalar(step));
                this.player.position.y = this.player.userData.baseY || 0.5;
                this.player.lookAt(this.player.position.clone().add(moveDir));
            } else {
                this.player.position.y = this.player.userData.baseY || 0.5;
            }
        }

        // Monster AI: approach, keep range, telegraph, and strike.
        this.enemies.slice().forEach((enemy) => this.updateEnemy(enemy, delta));

        // Mining logic: stop at the node, visibly swing the pickaxe, and apply
        // one clear impact every few tenths of a second instead of relying on a
        // tiny per-frame damage value. Fighting always interrupts mining.
        let isPlayerMining = false;
        const miningTarget = this.playerData.miningTarget;
        if (!inCombat && !this.isDown && miningTarget && this.nodes.includes(miningTarget)) {
            const dx = this.player.position.x - miningTarget.position.x;
            const dz = this.player.position.z - miningTarget.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 3.1) {
                isPlayerMining = true;
                this.miningHitTimer -= delta;
                if (this.miningHitTimer <= 0) {
                    this.swingAtNode(miningTarget);
                    this.miningHitTimer = this.getSwingInterval();
                }
            }
        } else {
            this.miningHitTimer = 0;
        }
        this.animatePlayerMining(isPlayerMining, delta);

        // Knocked-out leader slumps to the floor until the revive lands.
        if (this.isDown) {
            const baseScale = this.player.userData.baseScale || 1.25;
            // Just express the slump; the contact pass seats the flattened body
            // on the floor for us, at whatever height the squash produces.
            this.player.scale.set(baseScale * 1.25, baseScale * 0.45, baseScale * 1.25);
        }

        // 선택한 명령에 따라 워커의 목적지와 행동을 갱신합니다.
        this.workers.forEach((worker, index) => this.updateWorker(worker, index, delta));

        // Advance all transient combat visuals.
        this.combatFX.update(delta);

        // Authoritative contact pass. Every animation above has finished writing
        // its transform, so this is the single place that guarantees no body
        // clips through the floor or hovers above it, whatever it was doing.
        this.applyContactCorrections();

        // Sync with multiplayer
        this.app.multiplayer.updatePlayer({
            pos: this.player.position,
            targetPos: this.playerData.targetPos
        });

        // Update UI
        this.app.ui.update(
            this.inventory,
            this.playerData.traits,
            this.squadCommand,
            this.workers.length,
            this.playerData.hp,
            this.maxPlayerHp,
            this.getQuestData(),
            this.getStatsData(),
            this.getMiningProgress(),
            this.getTraitData(),
            this.getEquipmentData(),
            this.getCombatData(),
            this.getDepthData()
        );
    }

    // Compact loadout summary for the HUD.
    getEquipmentData() {
        return {
            equipped: this.equipped,
            tier: this.equipped ? getTierById(this.equipped.tierId) : null,
            baseAttack: Math.round(this.attackPower),
            totalAttack: Math.round(this.getTotalAttack()),
            recipeCount: this.recipeBook.length
        };
    }

    // One pickaxe swing. The vein only yields an item once enough swings land,
    // and it keeps producing until its reserves run out.
    swingAtNode(node) {
        if (!node || !this.nodes.includes(node)) return;

        node.userData.hitPulse = 1;
        node.userData.swings = (node.userData.swings || 0) + 1;

        if (node.userData.swings < node.userData.swingsRequired) return;

        node.userData.swings = 0;
        node.userData.reserves -= 1;

        const minedOre = this.rollMinedOre(node.userData.oreType);
        // Trait-driven bonus pulls stack on top of the base single ore.
        let amount = 1;
        if (Math.random() < this.traitEffects.yieldBonusChance) amount += 1;
        if (Math.random() < this.traitEffects.doubleOreChance) amount *= 2;
        this.inventory[minedOre] += amount;
        this.totalOreMined = (this.totalOreMined || 0) + amount;
        node.userData.lastYieldAmount = amount;
        node.userData.lastYield = minedOre;
        node.userData.lastYieldTimer = 2.2;
        // A drop rarer than the vein itself is a lucky strike worth calling out.
        const veinRarity = (this.oreConfig[node.userData.oreType] || this.oreConfig.coal).rarity;
        node.userData.lastYieldLucky = (this.oreConfig[minedOre]?.rarity || 0) > veinRarity;

        // Mithril is scarce enough that finding any at all deserves a callout.
        if (minedOre === 'mithril') {
            this.pushCombatFeed(`✦ 미스릴 ${amount}개를 캐냈습니다!`, '#8fe4ff');
            this.combatFX.spawnFlash(node.position, 0x8fe4ff, 30, 0.45);
        }

        this.completeCoalQuest();
        this.playSound('mining-hit');

        if (node.userData.reserves <= 0) {
            this.scene.remove(node);
            this.nodes = this.nodes.filter((entry) => entry !== node);
            if (this.playerData.miningTarget === node) this.playerData.miningTarget = null;

            // Emptying a seam is progress toward stripping this floor bare.
            this.floorNodesCleared += 1;
            if (this.depth > 0 && this.isFloorCleared()) {
                this.ascendFloor();
            } else if (this.depth > 0) {
                // Replace it so the floor always has something left to work.
                this.spawnNode();
            }
        } else {
            // A partially mined vein visibly shrinks but stays minable.
            node.userData.baseScale *= 0.93;
            node.userData.swingsRequired = this.getSwingsRequired(node.userData.oreType);
        }
    }

    /** Everything the HUD needs to show the climb from B30F to the surface. */
    getDepthData() {
        const quota = this.getFloorQuota();
        return {
            depth: this.depth,
            startDepth: this.startDepth,
            label: this.getFloorLabel(),
            climbed: this.getFloorsClimbed(),
            cleared: Math.min(this.floorNodesCleared, quota),
            quota,
            hardness: this.getDepthHardness(),
            surface: this.depth <= 0
        };
    }

    getMiningProgress() {
        const node = this.playerData.miningTarget;
        if (!node || !this.nodes.includes(node)) return null;
        const config = this.oreConfig[node.userData.oreType] || this.oreConfig.coal;
        const lastYield = node.userData.lastYieldTimer > 0 ? node.userData.lastYield : null;
        return {
            label: config.label,
            swings: node.userData.swings || 0,
            swingsRequired: node.userData.swingsRequired,
            reserves: node.userData.reserves,
            lastYieldLabel: lastYield ? (this.oreConfig[lastYield]?.label || lastYield) : null,
            lastYieldAmount: lastYield ? (node.userData.lastYieldAmount || 1) : 0,
            lastYieldLucky: lastYield ? !!node.userData.lastYieldLucky : false
        };
    }

    playSound(name) {
        const audio = new Audio(`assets/audio/${name}.mp3`);
        audio.volume = 0.5;
        audio.play().catch(() => {});
    }

    syncPlayers(peers) {
        // Simple visualization of other players would go here
    }
}
