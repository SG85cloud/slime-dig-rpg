import * as THREE from 'three';
import { TRAITS, TRAIT_CATEGORIES, RARITY_INFO, rollTraits, buildTraitEffects, getTraitById } from './traits.js';
import { getProfileId, loadProgress, saveProgress, clearProgress, loadMeta, saveMeta } from './saveGame.js';
import {
    ORE_KEYS,
    ORE_INFO,
    QUALITY_TIERS,
    DEFAULT_RECIPES,
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
    isEliteWave,
    createWeaponMesh,
    createFistMesh,
    CombatFX
} from './combat.js';

/** Floor height of the mine. All contact correction resolves to this plane. */
const GROUND_Y = 0;

/** Scratch box reused by the contact pass so no per-frame garbage is created. */
const _contactBox = new THREE.Box3();

/**
 * Special floor concepts along the otherwise-continuous B30F -> surface climb.
 * Keyed by depth (the B-number). Picked to read as genuinely different without
 * new art assets: a distinct light/floor tint that overrides the usual smooth
 * gradient, plus an ore-weight nudge that matches the flavor.
 */
const FLOOR_THEMES = {
    20: {
        name: '얼음 갱도',
        desc: '서리 낀 벽면 사이로 광맥이 파랗게 빛납니다. 미스릴이 유독 잘 보입니다.',
        lightColor: new THREE.Color(0x8fd9ff),
        floorColor: new THREE.Color(0xcfeeff),
        oreBonus: { mithril: 2.4 }
    },
    10: {
        name: '용암 지대',
        desc: '뜨거운 열기 속에서 황금빛 광맥이 유독 많이 보입니다.',
        lightColor: new THREE.Color(0xff7a4a),
        floorColor: new THREE.Color(0xffcaa8),
        oreBonus: { gold: 2.2 }
    },
    // No ore here at all — see spawnTreasureRoom()/openChest(). The leader's
    // one innate trait is only ever awakened by opening a chest on this floor.
    25: {
        name: '드래곤의 둥지',
        desc: '흩어진 황금 상자 10개 중 하나를 선택해 여세요. 그 안에 태생 특성이 잠들어 있습니다.',
        lightColor: new THREE.Color(0xffd166),
        floorColor: new THREE.Color(0xe8c988),
        oreBonus: {}
    }
};

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
        // B25F's dragon hoard: ten golden chests replacing the usual veins.
        this.chests = [];
        // Other leaders sharing this room: id -> visual mesh.
        this.peerMeshes = {};
        
        this.inventory = {
            coal: 0,
            iron: 0,
            gold: 0,
            mithril: 0
        };

        this.attackPower = 10;
        // Forged equipment: the currently wielded item plus every recipe the
        // player has personally invented. `equipped` stays the weapon slot for
        // backward-compatible saves; armor/accessory are separate slots.
        this.equipped = null;
        this.equippedArmor = null;
        this.equippedAccessory = null;
        this.recipeBook = [];
        this.craftLog = null;
        this.squadCommand = 'mine';
        this.workerRoles = ['miner', 'fighter', 'guard', 'prospector'];
        this.pendingWorkerRoles = [];
        this.pendingWorkerPromotions = [];
        this.workerPromotionQueue = [];
        this.workerPromotionChoices = null;
        this.elapsed = 0;
        this.baseMaxHp = 100;
        this.maxPlayerHp = 100;
        // Real-time auto-combat state.
        this.combatFX = null;
        this.wave = 0;
        this.groundOffsets = {};
        this.waveActive = false;
        // v24: failed defence remains retryable at the same wave.
        this.waveFailed = false;
        // v16: formal defence is a dedicated survivor-style combat arena.
        this.arenaActive = false;
        this.arenaTime = 0;
        this.arenaDuration = 90;
        this.arenaKills = 0;
        this.arenaSpawnTimer = 0;
        this.arenaSpawnCount = 0;
        this.arenaSavedPosition = new THREE.Vector3();
        this.arenaSavedAutoMine = true;
        this.arenaSavedCommand = 'mine';
        this.arenaGroup = null;
        this.arenaFloor = null;
        this.arenaRing = null;
        this.arenaPillars = [];
        this.autoCombat = true;
        // When free (no manual target, not fighting), the leader keeps
        // heading for the nearest ore instead of standing idle.
        this.autoMine = true;
        this.playerAttackTimer = 0;
        this.playerTarget = null;
        // v12: active dodge turns enemy telegraphs into a real player decision.
        this.dodgeCooldown = 0;
        this.dodgeTimer = 0;
        this.dodgeVector = new THREE.Vector3();
        this.dodgeSpeed = 12;
        // v17: flashy active combat skills. Cooldowns are intentionally short so
        // the arena feels like a survivor-action game instead of pure auto-DPS.
        this.skillCooldowns = { lightning: 0, nova: 0, meteor: 0 };
        this.skillMaxCooldowns = { lightning: 8, nova: 12, meteor: 18 };
        // v19: survivor-style experience gems and level-up choices.
        this.skillLevels = { lightning: 1, nova: 1, meteor: 1 };
        this.skillCooldownMultiplier = 1;
        this.playerLevel = 1;
        this.playerXp = 0;
        this.playerXpNext = 24;
        this.xpGems = [];
        this.xpMagnetRadius = 3.2;
        this.levelUpPending = false;
        this.levelUpChoices = [];
        this.combatFeed = [];
        this.lastCombatMoment = 0;
        this.regenTimer = 0;
        this.deathTimer = 0;
        this.isDown = false;
        this.enemySpawnTimer = null;
        this.miningHitTimer = 0;
        // Shared mining pressure: the more aggressively the squad mines, the
        // more attention the mine draws. This creates a risk/reward loop without
        // requiring a separate wave UI.
        this.miningNoise = 0;
        this.miningDangerFlash = 0;
        this.retreatTimer = 0;
        // v9: choice-driven mine incidents. While an incident is open, mining pauses
        // and the player must trade safety, reward and worker risk.
        this.mineEvent = null;
        this.eventRareBoost = 0;
        this.eventRareCharges = 0;
        this.eventCooldown = 0;
        this.markedSeams = 0;
        this.mineEventStats = { triggered: 0, riskyChoices: 0, safeChoices: 0, workerChoices: 0 };
        this.quest = {
            stage: 'coal',
            coalGoal: 10,
            // Some tutorial steps stop just short of the next stage once their
            // condition is met, so the player claims the reward on purpose
            // instead of it firing silently in the background.
            rewardReady: false,
            // Craft count toward the 'craft3' step specifically.
            craftCount: 0,
            // v20 cleanup: repeatable 3-contract side quests removed.
            // Keep empty compatibility fields so old save data loads safely.
            contractStats: { kills: 0, oreMined: 0, greedSeams: 0, rescues: 0,
                retreats: 0, rareFinds: 0, floorAscends: 0 },
            contracts: []
        };

        // Leader stats: strength lowers the swings needed per ore, speed shortens
        // the swing interval, and luck improves the rare-ore roll.
        this.stats = {
            strength: 1,
            speed: 1,
            luck: 1
        };

        // Base-camp facility upgrades: a permanent, ore-sink alternative to the
        // forge — mining speed and squad size that never need re-equipping.
        this.facilities = {
            miningRig: 0,
            barracks: 0
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
        this.floorTheme = FLOOR_THEMES[this.depth] || null;
        if (!this.cycleModifier) this.cycleModifier = this.getCycleModifier();
        // Floor quota met, but ascending is now a deliberate click rather
        // than automatic — the player keeps mining leftovers until ready.
        this.floorReadyToAscend = false;
        // v7 greed loop: extra post-quota seams create optional high-value haul.
        this.unstableHaul = 0;
        this.greedSeams = 0;

        // ------------------------------------------------------ surface loop
        // Reaching daylight is a decisive battle, not a quiet stop: the mine's
        // surface garrison must be beaten before the shaft can reopen for a
        // fresh, slightly harder descent (a light NG+, on top of legacy points).
        this.finalBossActive = false;
        this.surfaceConquered = false;
        this.cycle = 0;
        // v15: boss relic choice persists across the run and defines the next cycle.
        this.bossRelics = [];
        this.bossRewardPending = null;
        this.cycleModifier = null;

        // Spent on rerollTrait() to swap the one innate trait for a fresh roll.
        this.traitRerollTickets = 0;

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
        // Legacy points/unlocks earned by past leaders — survives a reset.
        this.meta = loadMeta(this.profileId) || {
            legacyPoints: 0,
            upgrades: { startingWorker: 0, startingTraitBonus: 0, startingOreTier: 0 }
        };
        this.saveTimer = 0;
        this.pendingWorkerCount = 0;
        this.pendingWorkerXp = [];
        this.hasSavedRun = false;
        // Prevent beforeunload/visibilitychange from writing the old run back
        // after an intentional reset followed by a page reload.
        this.isResettingProgress = false;

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
            this.applyMetaStartingBonuses();
        }

        // Covers a save that had already climbed past B25F before this trait
        // gate existed; a fresh run simply stays trait-less until it gets there.
        this.checkTraitUnlock();

        // Equipment HP is part of the max, so recompute once state is loaded.
        this.maxPlayerHp = this.baseMaxHp + this.traitEffects.maxHpBonus + this.getGearHpBonus();

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
        if (this.mineEvent) {
            setTimeout(() => this.app.ui.showMineEvent?.(this.mineEvent, this.getWorkerData()), 400);
        }

        // Re-recruit the workers that were part of the squad on the last visit,
        // each rejoining at the individual level it had earned.
        for (let i = 0; i < this.pendingWorkerCount; i++) {
            this.addWorker(this.pendingWorkerXp[i] || 0, this.pendingWorkerRoles[i] || this.workerRoles[i % this.workerRoles.length]);
            const restoredTalent = this.pendingWorkerPromotions[i];
            if (restoredTalent && this.workers[i]) {
                this.workers[i].userData.workerTalents = { attack: Number(restoredTalent.attack) || 1, mining: Number(restoredTalent.mining) || 1, hp: Number(restoredTalent.hp) || 1, rare: Number(restoredTalent.rare) || 0 };
                this.workers[i].userData.workerPromotionTier = Number(restoredTalent.tier) || 0;
                this.workers[i].userData.maxHp = this.getWorkerMaxHp(this.workers[i]);
                this.workers[i].userData.hp = this.workers[i].userData.maxHp;
            }
        }
        this.setSquadCommand(this.savedCommand || this.squadCommand);

        if (this.savedArenaState) {
            setTimeout(() => {
                if (!this.arenaActive && !this.rewardPending && !this.bossRewardPending) {
                    this.finalBossActive = !!this.savedArenaState.boss;
                    this.enterCombatArena(this.wave || 1, {
                        resume: true,
                        time: this.savedArenaState.time,
                        duration: this.savedArenaState.duration,
                        kills: this.savedArenaState.kills,
                        spawnCount: this.savedArenaState.spawnCount,
                        boss: this.savedArenaState.boss,
                        command: this.savedArenaState.command,
                        autoMine: this.savedArenaState.autoMine
                    });
                }
            }, 650);
        }

        this.app.ui.setResetHandler(() => this.resetProgress());
        this.app.ui.setAdminRestartHandler?.(() => this.restartFromB30Admin());
        this.app.ui.showProgressNotice(this.getProgressNotice());
        // A reward left unclaimed at the last save is offered again on return.
        if (this.rewardPending) {
            setTimeout(() => this.offerWaveReward(this.rewardPending.wave), 800);
        }
        if (this.bossRewardPending) {
            setTimeout(() => this.app.ui.showBossReward?.(this.getBossRewardData()), 900);
        }
        // A leader who reloads mid-surface, boss not yet beaten, faces it again.
        if (this.depth <= 0 && !this.surfaceConquered) {
            setTimeout(() => this.startFinalBossWave(), 1200);
        }
        this.persist();

        // Save before the tab closes so nothing is lost mid-session.
        window.addEventListener('beforeunload', () => {
            if (this.isResettingProgress) return;
            this.persist();
        });
        document.addEventListener('visibilitychange', () => {
            if (this.isResettingProgress) return;
            if (document.visibilityState === 'hidden') this.persist();
        });

        // Multiplayer sync
        this.app.multiplayer.subscribeToPlayers((peers) => this.syncPlayers(peers));
        this.app.multiplayer.onEvent?.((event) => this.handlePeerEvent(event));
    }

    // Innate traits are stored by id, so a returning leader is exactly the same
    // slime. Unknown ids (from an older catalog) are simply skipped. A leader
    // is otherwise born without a trait; it awakens exactly one at B25F's
    // dragon hoard (see checkTraitUnlock) — unless the "추가 태생 특성" legacy
    // unlock grants one immediately at birth instead of requiring the climb.
    restoreTraits(saved) {
        const ids = Array.isArray(saved?.traitIds) ? saved.traitIds : null;
        if (ids && ids.length > 0) {
            const restored = ids.map((id) => getTraitById(id)).filter(Boolean);
            if (restored.length > 0) return restored;
        }
        if (!saved && this.meta?.upgrades?.startingTraitBonus) return rollTraits(1);
        return [];
    }

    // Grants the leader's single innate trait once B25F is reached (or the
    // moment a returning save that already passed B25F loads with none yet).
    checkTraitUnlock() {
        if (this.traits.length > 0) return;
        if (this.depth > 25) return;

        const granted = rollTraits(1);
        if (granted.length === 0) return;

        this.traits = granted;
        this.traitEffects = buildTraitEffects(this.traits);
        this.maxPlayerHp = this.baseMaxHp + this.traitEffects.maxHpBonus + this.getGearHpBonus();
        if (this.playerData) this.playerData.traits = this.traits.map((trait) => trait.name);

        Object.entries(this.traitEffects.startingBonus).forEach(([ore, amount]) => {
            if (amount > 0) this.inventory[ore] += amount;
        });

        const trait = this.traits[0];
        this.app.ui.showBanner('◆ 태생 특성 각성', `${trait.name} · ${trait.description}`, '#d5b3ff');
        this.pushCombatFeed(`태생 특성을 각성했습니다: ${trait.name}`, '#d5b3ff');
        this.persist();
    }

    /** Spends one reroll ticket to swap the leader's single trait for a new one. */
    rerollTrait() {
        if ((this.traitRerollTickets || 0) <= 0) {
            return { ok: false, reason: '특성 변경권이 없습니다.' };
        }
        if (this.traits.length === 0) {
            return { ok: false, reason: '아직 각성한 태생 특성이 없습니다.' };
        }

        const currentId = this.traits[0]?.id;
        const candidates = rollTraits(2).filter((trait) => trait.id !== currentId);
        const next = candidates[0] || rollTraits(1)[0];
        if (!next) return { ok: false, reason: '변경할 특성을 찾지 못했습니다.' };

        this.traitRerollTickets -= 1;
        this.traits = [next];
        this.traitEffects = buildTraitEffects(this.traits);
        this.refreshMaxHp();
        this.playerData.traits = this.traits.map((trait) => trait.name);

        this.app.ui.showBanner('◆ 태생 특성 변경', `${next.name} · ${next.description}`, '#d5b3ff');
        this.pushCombatFeed(`태생 특성을 변경했습니다: ${next.name}`, '#d5b3ff');
        this.persist();
        return { ok: true, trait: next };
    }

    // Applied only to a brand-new leader (no save yet) — legacy unlocks bought
    // with a past leader's points.
    applyMetaStartingBonuses() {
        const upgrades = this.meta?.upgrades || {};
        if (upgrades.startingWorker) {
            this.pendingWorkerCount = Math.max(this.pendingWorkerCount, 1);
        }
        const oreTier = upgrades.startingOreTier || 0;
        if (oreTier > 0) {
            this.inventory.coal += oreTier * 20;
            this.inventory.iron += oreTier * 10;
        }
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

        if ([
            'coal', 'recruit', 'statUpgrade', 'reach29', 'iron20', 'craft', 'reach27',
            'gold15', 'reach26', 'craft3', 'trait25', 'waveDefense', 'complete'
        ].includes(saved.quest?.stage)) {
            this.quest.stage = saved.quest.stage;
        }
        const coalGoal = Number(saved.quest?.coalGoal);
        if (Number.isFinite(coalGoal) && coalGoal > 0) this.quest.coalGoal = Math.floor(coalGoal);
        if (typeof saved.quest?.rewardReady === 'boolean') this.quest.rewardReady = saved.quest.rewardReady;
        const craftCount = Number(saved.quest?.craftCount);
        if (Number.isFinite(craftCount) && craftCount >= 0) this.quest.craftCount = Math.floor(craftCount);
        if (saved.mineEvent && saved.mineEvent.id && saved.mineEvent.choices) {
            this.mineEvent = saved.mineEvent;
        }
        this.eventRareBoost = Math.max(0, Number(saved.eventRareBoost) || 0);
        this.eventRareCharges = Math.max(0, Math.floor(Number(saved.eventRareCharges) || 0));
        this.eventCooldown = Math.max(0, Number(saved.eventCooldown) || 0);
        this.markedSeams = Math.max(0, Math.floor(Number(saved.markedSeams) || 0));
        if (saved.mineEventStats && typeof saved.mineEventStats === 'object') {
            Object.keys(this.mineEventStats).forEach((key) => {
                const value = Number(saved.mineEventStats[key]);
                if (Number.isFinite(value) && value >= 0) this.mineEventStats[key] = Math.floor(value);
            });
        }

        if (saved.quest?.contractStats && typeof saved.quest.contractStats === 'object') {
            Object.keys(this.quest.contractStats).forEach((key) => {
                const value = Number(saved.quest.contractStats[key]);
                if (Number.isFinite(value) && value >= 0) this.quest.contractStats[key] = Math.floor(value);
            });
        }
        if (Array.isArray(saved.quest?.contracts)) this.quest.contracts = saved.quest.contracts.filter(c => c && c.id && c.type);
        this.ensureQuestContracts();

        const rerollTickets = Number(saved.traitRerollTickets);
        if (Number.isFinite(rerollTickets) && rerollTickets >= 0) this.traitRerollTickets = Math.floor(rerollTickets);
        const cycle = Number(saved.cycle);
        if (Number.isFinite(cycle) && cycle >= 0) this.cycle = Math.floor(cycle);
        if (Array.isArray(saved.bossRelics)) this.bossRelics = saved.bossRelics.filter(r => r && r.id).slice(-5);
        if (saved.bossRewardPending && Array.isArray(saved.bossRewardPending.choices)) this.bossRewardPending = saved.bossRewardPending;
        if (saved.cycleModifier && saved.cycleModifier.id) this.cycleModifier = saved.cycleModifier;
        if (typeof saved.surfaceConquered === 'boolean') this.surfaceConquered = saved.surfaceConquered;
        if (typeof saved.floorReadyToAscend === 'boolean') this.floorReadyToAscend = saved.floorReadyToAscend;

        const workerCount = Number(saved.workerCount);
        // Sanity bound only; addWorker() enforces the real cap once facilities
        // are restored (base 6 + up to 4 barracks levels).
        if (Number.isFinite(workerCount)) this.pendingWorkerCount = Math.max(0, Math.min(10, Math.floor(workerCount)));
        if (Array.isArray(saved.workerXp)) {
            this.pendingWorkerXp = saved.workerXp.map((xp) => Math.max(0, Number(xp) || 0));
        }
        if (Array.isArray(saved.workerRoles)) {
            this.pendingWorkerRoles = saved.workerRoles.map((role) => this.workerRoles.includes(role) ? role : 'miner');
        }
        if (Array.isArray(saved.workerPromotions)) this.pendingWorkerPromotions = saved.workerPromotions;

        if (['mine', 'attack', 'defend', 'focus'].includes(saved.squadCommand)) {
            this.savedCommand = saved.squadCommand;
        }

        // Restore the forged loadout and every recipe the player invented.
        if (saved.equipped && saved.equipped.stats) this.equipped = saved.equipped;
        if (saved.equippedArmor && saved.equippedArmor.stats) this.equippedArmor = saved.equippedArmor;
        if (saved.equippedAccessory && saved.equippedAccessory.stats) this.equippedAccessory = saved.equippedAccessory;
        if (Array.isArray(saved.recipeBook)) {
            this.recipeBook = saved.recipeBook.filter((entry) => entry && entry.key && entry.mix);
        }

        const wave = Number(saved.wave);
        if (Number.isFinite(wave) && wave > 0) this.wave = Math.floor(wave);
        if (typeof saved.autoCombat === 'boolean') this.autoCombat = saved.autoCombat;
        if (typeof saved.autoMine === 'boolean') this.autoMine = saved.autoMine;
        const savedLevel = Number(saved.playerLevel);
        if (Number.isFinite(savedLevel) && savedLevel >= 1) this.playerLevel = Math.floor(savedLevel);
        const savedXp = Number(saved.playerXp);
        if (Number.isFinite(savedXp) && savedXp >= 0) this.playerXp = savedXp;
        const savedNext = Number(saved.playerXpNext);
        if (Number.isFinite(savedNext) && savedNext > 0) this.playerXpNext = savedNext;
        const savedCdMult = Number(saved.skillCooldownMultiplier);
        if (Number.isFinite(savedCdMult) && savedCdMult > 0) this.skillCooldownMultiplier = Math.max(0.45, Math.min(1, savedCdMult));
        if (saved.skillLevels && typeof saved.skillLevels === 'object') {
            Object.keys(this.skillLevels).forEach((key) => {
                const lv = Number(saved.skillLevels[key]);
                if (Number.isFinite(lv) && lv >= 1) this.skillLevels[key] = Math.min(8, Math.floor(lv));
            });
        }

        // Which floor of the shaft the leader had climbed to.
        const depth = Number(saved.depth);
        if (Number.isFinite(depth) && depth >= 0 && depth <= this.startDepth) {
            this.depth = Math.floor(depth);
            this.floorTheme = FLOOR_THEMES[this.depth] || null;
        }
        const cleared = Number(saved.floorNodesCleared);
        if (Number.isFinite(cleared) && cleared >= 0) this.floorNodesCleared = Math.floor(cleared);
        this.unstableHaul = Math.max(0, Number(saved.unstableHaul) || 0);
        this.greedSeams = Math.max(0, Number(saved.greedSeams) || 0);
        const deepest = Number(saved.deepestReached);
        this.deepestReached = Number.isFinite(deepest) ? Math.floor(deepest) : this.depth;

        // Permanent bonuses picked from wave reward cards.
        Object.keys(this.boons).forEach((key) => {
            const value = Number(saved.boons?.[key]);
            if (Number.isFinite(value)) this.boons[key] = value;
        });

        // Permanent base-camp facility levels.
        Object.keys(this.facilities).forEach((key) => {
            const level = Number(saved.facilities?.[key]);
            const max = Game.FACILITY_CONFIG[key]?.maxLevel ?? 0;
            if (Number.isFinite(level) && level >= 0) this.facilities[key] = Math.min(max, Math.floor(level));
        });

        // A reward the player never got around to choosing is still owed.
        const pending = saved.rewardPending;
        if (pending && Array.isArray(pending.choices) && pending.choices.length > 0) {
            this.rewardPending = pending;
        }

        this.waveFailed = !!saved.waveFailed;

        // v16: a saved survivor run resumes as an active arena after the world
        // and player meshes have been rebuilt.
        if (saved.arenaActive) {
            this.savedArenaState = {
                time: Math.max(0, Number(saved.arenaTime) || 0),
                duration: Math.max(30, Number(saved.arenaDuration) || 90),
                kills: Math.max(0, Math.floor(Number(saved.arenaKills) || 0)),
                spawnCount: Math.max(0, Math.floor(Number(saved.arenaSpawnCount) || 0)),
                command: ['mine','attack','defend','focus'].includes(saved.arenaCommand) ? saved.arenaCommand : 'attack',
                autoMine: typeof saved.arenaAutoMine === 'boolean' ? saved.arenaAutoMine : false,
                boss: !!saved.arenaBoss
            };
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
            traitRerollTickets: this.traitRerollTickets,
            inventory: { ...this.inventory },
            stats: { ...this.stats },
            attackPower: this.attackPower,
            maxPlayerHp: this.maxPlayerHp,
            hp: this.playerData ? this.playerData.hp : this.maxPlayerHp,
            quest: {
                stage: this.quest.stage,
                coalGoal: this.quest.coalGoal,
                rewardReady: this.quest.rewardReady,
                craftCount: this.quest.craftCount,
                contractStats: { ...this.quest.contractStats },
                contracts: this.quest.contracts.map(c => ({ ...c }))
            },
            mineEvent: this.mineEvent ? { ...this.mineEvent } : null,
            eventRareBoost: this.eventRareBoost || 0,
            eventRareCharges: this.eventRareCharges || 0,
            eventCooldown: this.eventCooldown || 0,
            markedSeams: this.markedSeams || 0,
            mineEventStats: { ...this.mineEventStats },
            cycle: this.cycle,
            surfaceConquered: this.surfaceConquered,
            bossRelics: this.bossRelics.map(r => ({ ...r })),
            bossRewardPending: this.bossRewardPending ? { ...this.bossRewardPending, choices: this.bossRewardPending.choices.map(c => ({ ...c })) } : null,
            cycleModifier: this.cycleModifier ? { ...this.cycleModifier } : null,
            floorReadyToAscend: this.floorReadyToAscend,
            unstableHaul: this.unstableHaul || 0,
            greedSeams: this.greedSeams || 0,
            workerCount: this.workers.length,
            workerXp: this.workers.map((worker) => worker.userData.workerXp || 0),
            workerRoles: this.workers.map((worker) => worker.userData.workerRole || 'miner'),
            workerPromotions: this.workers.map((worker) => ({ ...(worker.userData.workerTalents || { attack: 1, mining: 1, hp: 1, rare: 0 }), tier: worker.userData.workerPromotionTier || 0 })),
            squadCommand: this.squadCommand,
            totalOreMined: this.totalOreMined || 0,
            equipped: this.equipped,
            equippedArmor: this.equippedArmor,
            equippedAccessory: this.equippedAccessory,
            recipeBook: this.recipeBook,
            totalCrafted: this.totalCrafted || 0,
            wave: this.wave,
            waveFailed: !!this.waveFailed,
            autoCombat: this.autoCombat,
            autoMine: this.autoMine,
            playerLevel: this.playerLevel,
            playerXp: this.playerXp,
            playerXpNext: this.playerXpNext,
            skillLevels: { ...this.skillLevels },
            skillCooldownMultiplier: this.skillCooldownMultiplier || 1,
            depth: this.depth,
            floorNodesCleared: this.floorNodesCleared,
            deepestReached: this.deepestReached,
            boons: { ...this.boons },
            facilities: { ...this.facilities },
            // An unclaimed reward survives a reload so a win is never lost.
            rewardPending: this.rewardPending,
            // v16 survivor arena state. The live enemies are reconstructed on load.
            arenaActive: !!this.arenaActive,
            arenaTime: this.arenaActive ? this.arenaTime : 0,
            arenaDuration: this.arenaActive ? this.arenaDuration : 90,
            arenaKills: this.arenaActive ? this.arenaKills : 0,
            arenaSpawnCount: this.arenaActive ? this.arenaSpawnCount : 0,
            arenaCommand: this.arenaActive ? this.squadCommand : null,
            arenaAutoMine: this.arenaActive ? this.autoMine : null,
            arenaBoss: this.arenaActive ? !!this.finalBossActive : false
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
                    this.traits.length > 0
                        ? `태생 특성 ${this.traits.length}개를 가지고 광산에 들어섭니다.`
                        : '태생 특성 없이 광산에 들어섭니다. 지하 25층 드래곤의 둥지에서 황금 상자를 열면 하나를 얻습니다.',
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
        this.awardLegacyRunPoints();
        this.isResettingProgress = true;
        clearProgress(this.profileId);
        window.location.reload();
    }

    // v18 admin/test shortcut: restart the current run at B30F without
    // awarding legacy points. Permanent legacy upgrades remain intact, so this
    // is useful for repeatedly testing the opening section of the game.
    restartFromB30Admin() {
        // IMPORTANT: reload fires beforeunload. Without the guard below, that
        // handler can call persist() and immediately recreate the old save we
        // just deleted.
        this.isResettingProgress = true;
        clearProgress(this.profileId);
        try {
            // Also remove the save directly in case a browser fires lifecycle
            // events in an unusual order during reload.
            const key = `gothic-slime-mine:save:${this.profileId}`;
            window.localStorage.removeItem(key);
        } catch (error) {
            console.warn('[admin] 진행 초기화 저장소 정리에 실패했습니다.', error);
        }
        window.location.reload();
    }

    // ------------------------------------------------------- meta progression
    // A roguelite-style ledger: retiring a leader (or reaching daylight) banks
    // legacy points from that run's depth and haul, spendable on permanent
    // starting bonuses for every leader born after.
    static META_UPGRADES = {
        startingWorker: {
            maxLevel: 1, cost: [40],
            label: '견습 일꾼 계약', hint: '새 광부가 워커 1명과 함께 시작합니다.'
        },
        startingTraitBonus: {
            maxLevel: 1, cost: [60],
            label: '각성한 채로 태어나기', hint: '새 광부가 지하 25층까지 가지 않아도 태생 특성을 갖고 태어납니다.'
        },
        startingOreTier: {
            maxLevel: 3, cost: [20, 35, 55],
            label: '비상 물자 지원', hint: '레벨당 시작 석탄 +20 · 철 +10.'
        }
    };

    // Depth climbed and ore hauled convert to points; a run that never left
    // B30F still earns something for the ore it banked.
    getLegacyPointsForRun() {
        return Math.round(this.getFloorsClimbed() * 3 + (this.totalOreMined || 0) / 20);
    }

    awardLegacyRunPoints() {
        const gained = this.getLegacyPointsForRun();
        if (gained <= 0) return 0;
        this.meta.legacyPoints = (this.meta.legacyPoints || 0) + gained;
        saveMeta(this.profileId, this.meta);
        return gained;
    }

    getMetaData() {
        const upgrades = Object.entries(Game.META_UPGRADES).map(([key, config]) => {
            const level = this.meta.upgrades[key] || 0;
            const maxed = level >= config.maxLevel;
            const cost = maxed ? null : config.cost[level];
            return {
                key,
                label: config.label,
                hint: config.hint,
                level,
                maxLevel: config.maxLevel,
                maxed,
                cost,
                affordable: !maxed && (this.meta.legacyPoints || 0) >= cost
            };
        });
        return { points: this.meta.legacyPoints || 0, upgrades };
    }

    buyMetaUpgrade(key) {
        const config = Game.META_UPGRADES[key];
        if (!config) return false;
        const level = this.meta.upgrades[key] || 0;
        if (level >= config.maxLevel) return false;
        const cost = config.cost[level];
        if ((this.meta.legacyPoints || 0) < cost) return false;

        this.meta.legacyPoints -= cost;
        this.meta.upgrades[key] = level + 1;
        saveMeta(this.profileId, this.meta);
        return true;
    }

    // Luck used by ore rolls already includes trait and accessory bonuses.
    getEffectiveLuck() {
        return this.stats.luck + this.traitEffects.luckBonus + (this.equippedAccessory?.stats.luck || 0);
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
            total: TRAITS.length,
            rerollTickets: this.traitRerollTickets || 0
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

        if (this.depth === 25) {
            // The dragon's hoard: no ore here, just the ten chests to choose from.
            this.spawnTreasureRoom();
        } else {
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
        }
        this.applyDepthAtmosphere();

        // 복귀 시 진행 중이던 퀘스트에 맞는 몬스터를 다시 배치합니다.
        if (this.quest.stage === 'recruit') {
            this.wave = Math.max(1, this.wave);
            this.waveEnemyTotal = 2;
            this.spawnEnemy('crawler', { distance: 13, isQuestEnemy: true });
            this.spawnEnemy('crawler', { distance: 15, isQuestEnemy: true });
        } else if (this.quest.stage === 'complete' || this.quest.stage === 'waveDefense') {
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
        // A themed floor (ice/lava) nudges its signature ore's weight up.
        if (this.floorTheme?.oreBonus) {
            Object.entries(this.floorTheme.oreBonus).forEach(([ore, mult]) => {
                if (weights[ore] !== undefined) weights[ore] *= mult;
            });
        }
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
        const markedRareBoost = this.markedSeams > 0 ? 1.55 : 1;
        const relicRareMult = this.bossRelics.reduce((m, r) => m * (r.rareMult || 1), 1);
        const cycleRareMult = this.cycleModifier?.rareMult || 1;

        Object.entries(this.oreConfig).forEach(([oreType, oreConfig]) => {
            const rarityGap = oreConfig.rarity - config.rarity;
            if (rarityGap === 0) {
                // The vein's own ore stays the most common result.
                weights[oreType] = 58;
            } else if (rarityGap > 0) {
                // Better ore than the vein: genuinely scarce. v9 incidents can
                // temporarily bend these odds upward for a few pulls.
                const rareBoost = this.eventRareBoost > 0 ? (1 + this.eventRareBoost) : 1;
                weights[oreType] = ((7 / Math.pow(3.4, rarityGap - 1)) + luck * (1.5 / rarityGap)) * rareBoost * markedRareBoost * relicRareMult * cycleRareMult;
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
        // 1.00x at B30F rising to about 3.9x just under the surface, plus a
        // further 15% per surface conquest so each reopened shaft is a real
        // step up rather than a cosmetic reset.
        return (1 + this.getFloorsClimbed() * 0.1) * (1 + this.cycle * 0.15);
    }

    /** Veins to clear before the shaft up opens. Bigger the higher you climb. */
    getFloorQuota() {
        // The hoard floor clears the instant one chest is chosen.
        if (this.depth === 25) return 1;
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

    /** Player-clicked confirmation once the floor quota is met. */
    requestAscend() {
        if (!this.floorReadyToAscend) return { ok: false, reason: '아직 이 층의 채굴 목표를 달성하지 못했습니다.' };
        if (this.isDown || this.enemies.some((enemy) => !enemy.userData.dying)) {
            return { ok: false, reason: '전투가 끝난 뒤에 안전하게 상승하세요.' };
        }
        this.ascendFloor();
        return { ok: true };
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
        const bankedGreed = Math.max(0, Math.round(this.unstableHaul || 0));
        this.bumpQuestStat('floorAscends', 1);
        if (bankedGreed > 0) {
            this.inventory.gold += bankedGreed;
            this.pushCombatFeed(`🏦 욕심 채굴 보너스 ${bankedGreed}을(를) 안전하게 확보했습니다!`, '#ffd166');
        }
        this.depth = Math.max(0, this.depth - 1);
        this.floorNodesCleared = 0;
        this.floorReadyToAscend = false;
        this.unstableHaul = 0;
        this.greedSeams = 0;
        this.floorTheme = FLOOR_THEMES[this.depth] || null;

        // Clear the stripped floor.
        this.nodes.forEach((node) => this.scene.remove(node));
        this.nodes = [];
        this.chests.forEach((chest) => this.scene.remove(chest));
        this.chests = [];
        this.playerData.miningTarget = null;

        if (this.depth === 25) {
            this.spawnTreasureRoom();
            this.app.ui.showBanner(`◆ ${this.floorTheme.name}`, this.floorTheme.desc, '#ffd166');
            this.pushCombatFeed(`${this.getFloorLabel()} — ${this.floorTheme.name}에 진입했습니다.`, '#ffd166');
            this.app.multiplayer.broadcastEvent?.('floor_ascend', { floor: this.depth });
        } else if (this.depth > 0) {
            const count = this.getFloorNodeCount();
            for (let i = 0; i < count; i++) this.spawnNode();
            if (this.floorTheme) {
                this.app.ui.showBanner(`❄ ${this.floorTheme.name}`, this.floorTheme.desc, '#8fe4ff');
                this.pushCombatFeed(`${this.getFloorLabel()} — ${this.floorTheme.name}에 진입했습니다.`, '#8fe4ff');
            } else {
                this.app.ui.showBanner(
                    `▲ ${this.getFloorLabel()}`,
                    `광맥이 더 단단해집니다 · 목표 ${this.getFloorQuota()}광맥`,
                    '#8fe4ff'
                );
                this.pushCombatFeed(
                    `${this.getFloorLabel(from)}의 광맥을 모두 캐냈습니다. ${this.getFloorLabel()}으로 올라갑니다.`,
                    '#8fe4ff'
                );
            }
            this.app.multiplayer.broadcastEvent?.('floor_ascend', { floor: this.depth });
        } else {
            // Daylight. The surface garrison still has to be beaten before a
            // fresh (harder) shaft can reopen, but the climb itself already
            // banks legacy points for whoever comes after this leader.
            this.app.ui.showBanner('☀ 지상 도달', '광산 점령전이 곧 시작됩니다!', '#ffe39a');
            this.pushCombatFeed('☀ 마침내 지상에 도달했습니다! 광산 점령전이 시작됩니다.', '#ffe39a');
            const bonus = this.awardLegacyRunPoints();
            if (bonus > 0) {
                this.pushCombatFeed(`유산 포인트 +${bonus} 획득! 다음 광부에게 물려줄 수 있습니다.`, '#c9a6ff');
            }
            if (!this.surfaceConquered) setTimeout(() => this.startFinalBossWave(), 1600);
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
        const theme = this.floorTheme;
        if (this.ambientLight) {
            this.ambientLight.intensity = 4.5 + t * 3.5;
            if (theme) this.ambientLight.color.copy(theme.lightColor);
            else this.ambientLight.color.setHSL(0.72 - t * 0.62, 0.28 - t * 0.14, 0.55 + t * 0.18);
        }
        if (this.caveLight) {
            if (theme) this.caveLight.color.copy(theme.lightColor);
            else this.caveLight.color.setHSL(0.74 - t * 0.62, 0.5 - t * 0.22, 0.55 + t * 0.15);
        }
        if (this.floor?.material) {
            if (theme) this.floor.material.color.copy(theme.floorColor);
            else this.floor.material.color.setHSL(0.78 - t * 0.68, 0.16 + t * 0.06, 0.66 + t * 0.06);
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
        const hardness = this.getDepthHardness() * (this.cycleModifier?.hardnessMult || 1);
        const base = Math.max(1, config.baseSwings - reduction) * traitMult * hardness;
        const floor = Math.max(2, Math.round(config.baseSwings * 0.3 * hardness));
        return Math.max(floor, Math.round(base));
    }

    // Speed shortens the interval between pickaxe swings, with a sane minimum.
    // The mining-rig facility stacks a further permanent multiplier on top.
    getSwingInterval() {
        const base = 0.46 - (this.stats.speed - 1) * 0.03;
        return Math.max(0.1, (base * this.getMiningSpeedFacilityMult()) / this.traitEffects.swingSpeedMult);
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

    // A simple procedural chest — the hoard room needs no ore-vein GLB, just
    // something gold and clickable.
    createTreasureChest() {
        const group = new THREE.Group();
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.75 });
        const goldMat = new THREE.MeshStandardMaterial({
            color: 0xffd166, metalness: 0.85, roughness: 0.25,
            emissive: 0x5a3a10, emissiveIntensity: 0.4
        });

        const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), woodMat);
        base.position.y = 0.28;
        base.castShadow = true;
        group.add(base);

        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.3, 0.64), woodMat);
        lid.position.y = 0.62;
        lid.castShadow = true;
        group.add(lid);

        const trim = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 0.68), goldMat);
        trim.position.y = 0.47;
        group.add(trim);

        const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.1), goldMat);
        lock.position.set(0, 0.42, 0.33);
        group.add(lock);

        return group;
    }

    /**
     * B25F is the dragon's hoard: ten golden chests scattered around the
     * floor, and the leader picks exactly one to open (see openChest).
     */
    spawnTreasureRoom() {
        this.chests.forEach((chest) => this.scene.remove(chest));
        this.chests = [];

        const count = 10;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
            const distance = 6 + Math.random() * 10;
            const chest = this.createTreasureChest();
            chest.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
            chest.rotation.y = Math.random() * Math.PI * 2;
            chest.userData = { type: 'chest', opened: false };
            chest.traverse((child) => { child.userData.type = 'chestPart'; });
            this.scene.add(chest);
            this.chests.push(chest);
        }
    }

    /**
     * Opening any one of the ten chests is the choice: it awakens the
     * leader's innate trait (see checkTraitUnlock) and clears the floor. The
     * other nine were never real, so they vanish the instant one is chosen.
     */
    openChest(chest) {
        if (!chest || chest.userData.opened || this.depth !== 25) return;
        chest.userData.opened = true;

        const hadTrait = this.traits.length > 0;
        this.checkTraitUnlock();

        if (hadTrait) {
            // An older leader already carries its one trait — the hoard still pays out.
            const gold = 20 + Math.floor(Math.random() * 15);
            const mithril = 2 + Math.floor(Math.random() * 3);
            this.inventory.gold += gold;
            this.inventory.mithril += mithril;
            this.pushCombatFeed(`상자에서 금 ${gold} · 미스릴 ${mithril}을(를) 발견했습니다!`, '#ffd166');
        }

        this.combatFX.spawnBurst(chest.position, { color: 0xffd166, radius: 0.9, expand: 3.2, life: 0.6, height: 1 });
        this.combatFX.spawnFlash(chest.position, 0xffd166, 40, 0.4);
        this.app.addShake(0.4);
        this.playSound('mining-hit');

        // The chosen chest is removed too — the floor advances immediately,
        // so there is no lingering "opened" pose to show off.
        this.chests.forEach((entry) => this.scene.remove(entry));
        this.chests = [];

        this.floorNodesCleared = this.getFloorQuota();
        if (this.isFloorCleared()) this.ascendFloor();
        this.persist();
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
        // Field encounters (no formal wave running) scale off depth progress
        // instead of the wave counter, which may still be 0 for a leader who
        // hasn't started a defence run yet.
        const scaled = scaleEnemyStats(config, Math.max(1, options.waveOverride ?? this.wave));
        const eliteAffix = options.eliteAffix || null;
        const affixTable = {
            berserker: { name: '광폭', hp: 1.18, damage: 1.38, speed: 1.22, tint: 0xff5f5f, desc: '체력이 낮아질수록 공격이 빨라집니다.' },
            plated: { name: '중갑', hp: 1.62, damage: 0.92, speed: 0.78, tint: 0xd8b56a, desc: '피해를 22% 덜 받습니다.' },
            volatile: { name: '불안정', hp: 0.88, damage: 1.16, speed: 1.08, tint: 0x9fffd0, desc: '사망 시 주변에 폭발 피해를 줍니다.' },
            leech: { name: '흡혈', hp: 1.05, damage: 1.08, speed: 0.96, tint: 0xc66bff, desc: '공격 적중 시 체력을 일부 회복합니다.' }
        };
        const affix = affixTable[eliteAffix];
        if (affix) {
            scaled.hp = Math.round(scaled.hp * affix.hp);
            scaled.damage = Math.round(scaled.damage * affix.damage);
        }
        const angle = options.angle !== undefined ? options.angle : Math.random() * Math.PI * 2;
        const distance = options.distance !== undefined ? options.distance : 17 + Math.random() * 7;
        // initWorld() can spawn a returning "recruit" quest enemy before
        // initPlayer() has created this.player; the leader always starts
        // at the origin anyway, so fall back to that.
        const origin = options.origin || this.player?.position || new THREE.Vector3();

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
            moveSpeed: config.moveSpeed * (affix?.speed || 1),
            keepDistance: config.keepDistance || 0,
            style: config.style,
            baseY: groundY,
            baseScale: config.scale,
            tint: affix ? affix.tint : config.tint,
            elite: config.elite || !!affix,
            eliteAffix: eliteAffix,
            eliteAffixName: affix?.name || '',
            eliteAffixDesc: affix?.desc || '',
            damageReduction: eliteAffix === 'plated' ? 0.22 : 0,
            pattern: config.pattern || 'basic',
            patternTimer: 3.5 + Math.random() * 2.5,
            patternCooldown: 2.5 + Math.random() * 1.5,
            patternWindup: 0,
            patternState: 'ready',
            phase: 1,
            enraged: false,
            bossPhase: 1,
            bossTransitioning: false,
            bossSummonCooldown: 0,
            bossHazardCooldown: 0,
            xp: config.xp,
            isQuestEnemy: !!options.isQuestEnemy,
            isFieldEnemy: !!options.isFieldEnemy,
            isArenaEnemy: !!options.isArenaEnemy,
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
        // v16: formal waves now leave the mine and become a timed survivor arena.
        this.wave = wave;
        this.waveActive = true;
        this.enterCombatArena(wave);
        this.app.multiplayer.broadcastEvent?.('wave_start', { wave });
    }

    /**
     * v16 Survivor Arena.
     * Exploration remains the mining game; formal waves are now a short,
     * high-pressure combat session with continuous edge spawns and a survival
     * clock. The same Three.js scene is reused, but exploration props are hidden
     * and a dedicated arena floor/ring is brought forward so the transition
     * feels like a real mode switch without a second renderer.
     */
    createCombatArenaVisuals() {
        if (this.arenaGroup) return;
        const group = new THREE.Group();
        group.name = 'CombatArena_v16';

        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x21172f, roughness: 0.92, metalness: 0.05,
            emissive: 0x140b20, emissiveIntensity: 0.45
        });
        const floor = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 14.5, 0.22, 64), floorMat);
        floor.position.y = 0.06;
        floor.receiveShadow = true;
        group.add(floor);
        this.arenaFloor = floor;

        const ringMat = new THREE.MeshStandardMaterial({
            color: 0xc36a4d, emissive: 0x4a170e, emissiveIntensity: 0.9,
            roughness: 0.5, metalness: 0.25
        });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(14.2, 0.18, 8, 64), ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.28;
        group.add(ring);
        this.arenaRing = ring;

        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x59446d, roughness: 0.8, metalness: 0.1
        });
        const glowMat = new THREE.MeshStandardMaterial({
            color: 0xff6f45, emissive: 0xff3d1d, emissiveIntensity: 2.2
        });
        this.arenaPillars = [];
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2;
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, 3.2, 8), pillarMat);
            pillar.position.set(Math.cos(a) * 12.8, 1.6, Math.sin(a) * 12.8);
            pillar.castShadow = true;
            group.add(pillar);
            const flame = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 10), glowMat);
            flame.position.set(pillar.position.x, 3.25, pillar.position.z);
            group.add(flame);
            this.arenaPillars.push(flame);
        }
        this.scene.add(group);
        this.arenaGroup = group;
    }

    enterCombatArena(wave, options = {}) {
        if (!this.player) return;
        this.createCombatArenaVisuals();
        this.arenaGroup.visible = true;

        const isBoss = !!options.boss;
        this.arenaActive = true;
        this.waveActive = true;
        this.arenaDuration = options.duration || (isBoss ? 9999 : 90);
        this.arenaTime = options.resume ? Math.max(0, options.time ?? this.arenaDuration) : this.arenaDuration;
        this.arenaKills = options.resume ? Math.max(0, options.kills || 0) : 0;
        this.arenaSpawnCount = options.resume ? Math.max(0, options.spawnCount || 0) : 0;
        this.arenaSpawnTimer = options.resume ? 1.2 : 0.9;
        this.arenaSavedPosition.copy(this.player.position);
        this.arenaSavedAutoMine = this.autoMine;
        this.arenaSavedCommand = this.squadCommand;

        // Clear exploration-only targets and park all mining props.
        this.playerData.miningTarget = null;
        this.playerTarget = null;
        this.autoMine = false;
        this.squadCommand = 'attack';
        this.workers.forEach((worker, i) => {
            worker.userData.squadRole = 'attack';
            worker.userData.miningTarget = null;
            const a = i / Math.max(1, this.workers.length) * Math.PI * 2;
            worker.position.set(Math.cos(a) * (2.2 + i * 0.12), worker.position.y, Math.sin(a) * (2.2 + i * 0.12));
            worker.userData.targetPos = worker.position.clone();
        });

        this.nodes.forEach(node => node.visible = false);
        this.chests.forEach(chest => chest.visible = false);
        if (this.floor) this.floor.visible = false;

        // Clear leftover field enemies; formal arena owns its enemy roster.
        this.enemies.slice().forEach(enemy => this.scene.remove(enemy));
        this.enemies = [];

        this.player.position.set(0, this.player.userData.baseY || 0.5, 0);
        this.playerData.targetPos.copy(this.player.position);
        this.player.rotation.y = 0;
        this.autoCombat = true;

        const intro = isBoss ? 'BOSS ARENA' : 'SURVIVAL ARENA';
        const subtitle = isBoss
            ? '3단계 광산 점령자 · 끝까지 살아남아 처치하세요'
            : `${this.arenaDuration}초 생존 · 몰려오는 적을 계속 베어내세요`;
        this.app.ui.showCombatArena?.({
            wave,
            boss: isBoss,
            duration: this.arenaDuration,
            title: intro,
            subtitle
        });
        this.app.ui.showBanner(
            isBoss ? '⚔ 광산 점령전' : `WAVE ${wave}`,
            isBoss ? '전용 전투 구역으로 진입합니다!' : '전투 구역 진입 · 적이 계속 몰려옵니다!',
            '#ff7a4a'
        );

        if (isBoss && options.resume) {
            // Boss HP was intentionally not serialized in v16; a reload resumes
            // the boss arena with a fresh boss rather than creating a broken
            // empty arena. Progress resources remain safe.
            const boss = this.spawnEnemy('overlord', { distance: 8.5, angle: Math.PI / 2, origin: new THREE.Vector3() });
            if (boss) {
                const scaled = scaleEnemyStats(ENEMY_TYPES.overlord, wave + 6);
                boss.userData.hp = Math.round(scaled.hp * 1.6 * (1 + this.cycle * 0.25));
                boss.userData.maxHp = boss.userData.hp;
                boss.userData.damage = Math.round(scaled.damage * 1.3 * (1 + this.cycle * 0.15));
                boss.userData.name = '광산 점령자';
                boss.userData.isFinalBoss = true;
                boss.userData.bossPhase = 1;
                boss.userData.bossSummonCooldown = 5.0;
                boss.userData.bossHazardCooldown = 8.0;
            }
            this.spawnEnemy('brute', { distance: 6.5, angle: Math.PI / 2 - 1.3, origin: new THREE.Vector3() });
            this.spawnEnemy('brute', { distance: 6.5, angle: Math.PI / 2 + 1.3, origin: new THREE.Vector3() });
        } else if (!options.resume) {
            const composition = getWaveComposition(wave);
            const initial = Math.max(3, Math.min(6, composition.reduce((sum, [, count]) => sum + count, 0)));
            for (let i = 0; i < initial; i++) this.spawnArenaEnemy(wave, i < Math.floor(initial * 0.65));
        } else {
            const initial = Math.min(5, Math.max(2, 2 + Math.floor(this.arenaKills / 8)));
            for (let i = 0; i < initial; i++) this.spawnArenaEnemy(wave, false);
        }
        this.persist();
    }

    spawnArenaEnemy(wave = this.wave, forceElite = false) {
        const climbed = this.getFloorsClimbed();
        const pool = wave < 3 ? ['crawler']
            : wave < 6 ? ['crawler', 'archer']
            : wave < 10 ? ['crawler', 'archer', 'brute']
            : ['crawler', 'archer', 'brute'];
        let typeId = pool[Math.floor(Math.random() * pool.length)];
        if (this.finalBossActive) typeId = Math.random() < 0.55 ? 'brute' : 'crawler';

        const elite = forceElite || (wave % 5 === 0 && this.arenaSpawnCount > 0 && Math.random() < 0.09);
        const affixPool = ['berserker', 'plated', 'volatile', 'leech'];
        const eliteAffix = elite ? affixPool[Math.floor(Math.random() * affixPool.length)] : null;
        const angle = Math.random() * Math.PI * 2;
        const distance = 11.8 + Math.random() * 2.1;
        const enemy = this.spawnEnemy(typeId, {
            angle, distance, eliteAffix,
            waveOverride: Math.max(1, wave),
            origin: new THREE.Vector3(0, 0, 0)
        });
        if (enemy) {
            enemy.userData.isArenaEnemy = true;
            enemy.userData.arenaWave = wave;
            this.arenaSpawnCount += 1;
            if (elite) {
                this.pushCombatFeed(`⚠ 정예 출현! ${enemy.userData.eliteAffixName} · ${enemy.userData.name}`, '#ff7a4a');
                this.app.addShake(0.25);
            }
        }
        return enemy;
    }

    updateCombatArena(delta) {
        if (!this.arenaActive) return;
        // Level-up choice freezes the survival clock and enemy spawning.
        if (this.levelUpPending) return;
        const isBoss = !!this.finalBossActive;
        if (!isBoss) {
            this.arenaTime = Math.max(0, this.arenaTime - delta);
            this.arenaSpawnTimer -= delta;

            const elapsed = this.arenaDuration - this.arenaTime;
            const spawnInterval = Math.max(0.48, 1.75 - elapsed * 0.010 - this.wave * 0.025);
            if (this.arenaSpawnTimer <= 0 && this.enemies.filter(e => !e.userData.dying).length < Math.min(18, 6 + Math.floor(elapsed / 14) + this.wave)) {
                const count = Math.random() < Math.min(0.55, elapsed / 110) ? 2 : 1;
                for (let i = 0; i < count; i++) this.spawnArenaEnemy(this.wave);
                this.arenaSpawnTimer = spawnInterval;
            }

            if (this.arenaTime <= 0) {
                this.completeCombatArena();
                return;
            }
        } else {
            const bossLiving = this.enemies.some(e => e.userData.isFinalBoss && !e.userData.dying);
            if (!bossLiving) {
                this.waveActive = false;
                this.resolveFinalBossVictory();
                return;
            }
            this.arenaSpawnTimer -= delta;
            if (this.arenaSpawnTimer <= 0 && this.enemies.filter(e => !e.userData.dying).length < 7) {
                this.spawnArenaEnemy(this.wave);
                this.arenaSpawnTimer = this.arenaTime > 999 ? 6 : 4;
            }
        }

        this.clampCombatArenaPositions();
    }

    clampCombatArenaPositions() {
        if (!this.arenaActive) return;
        const radius = 12.4;
        const clampOne = (obj, margin = 0) => {
            if (!obj) return;
            const x = obj.position.x, z = obj.position.z;
            const len = Math.hypot(x, z);
            const max = radius - margin;
            if (len > max && len > 0.001) {
                obj.position.x = x / len * max;
                obj.position.z = z / len * max;
            }
        };
        clampOne(this.player, 1.0);
        this.workers.forEach(worker => clampOne(worker, 1.2));
        this.enemies.forEach(enemy => clampOne(enemy, 0));
    }

    completeCombatArena() {
        if (!this.arenaActive || this.finalBossActive) return;
        const clearedWave = this.wave;
        const kills = this.arenaKills;
        this.waveActive = false;
        this.arenaActive = false;
        this.arenaTime = 0;
        this.exitCombatArena();
        this.rewardPending = { wave: clearedWave, choices: this.buildRewardChoices(clearedWave) };
        // v25: the first formal defence quest must also complete when the
        // survivor-style arena is cleared. The old fixed-wave code handled
        // this in updateWaves(), but v16+ completes through completeCombatArena().
        if (this.quest.stage === 'waveDefense' && !this.quest.rewardReady) {
            this.quest.rewardReady = true;
            this.pushCombatFeed('🎯 첫 방어전 클리어! 퀘스트 보상을 받으세요.', '#8fd9a8');
        }
        this.pushCombatFeed(`🏆 생존 성공! ${clearedWave} 웨이브 · ${kills}처치 · 보상을 선택하세요.`, '#8fd9a8');
        this.app.multiplayer.broadcastEvent?.('wave_clear', { wave: clearedWave, kills });
        this.app.ui.showWaveCleared(clearedWave);
        setTimeout(() => this.offerWaveReward(clearedWave), 900);
        this.persist();
    }

    exitCombatArena() {
        if (this.arenaGroup) this.arenaGroup.visible = false;
        this.nodes.forEach(node => node.visible = true);
        this.chests.forEach(chest => chest.visible = true);
        if (this.floor) this.floor.visible = true;
        if (this.player) {
            this.player.position.copy(this.arenaSavedPosition);
            this.playerData.targetPos.copy(this.player.position);
        }
        // Anyone still downed was only kept alive by the arena-only guard in
        // updateDownedWorker(); patch them back up now instead of letting them
        // die the instant arenaActive flips off on the next frame.
        let revivedCount = 0;
        this.workers.forEach(worker => {
            if (worker.userData.downTimer > 0 || (worker.userData.hp ?? worker.userData.maxHp) <= 0) {
                worker.userData.hp = Math.round(worker.userData.maxHp * 0.45);
                worker.userData.regenTimer = 3;
                worker.userData.downTimer = 0;
                worker.userData.squadRole = this.arenaSavedCommand || 'mine';
                if (worker.userData.healthBar) worker.userData.healthBar.visible = false;
                revivedCount += 1;
            }
            const a = Math.random() * Math.PI * 2;
            worker.position.set(this.player.position.x + Math.cos(a) * (2 + Math.random()), worker.position.y, this.player.position.z + Math.sin(a) * (2 + Math.random()));
        });
        if (revivedCount > 0) {
            this.pushCombatFeed(`💚 전투 구역에서 쓰러졌던 워커 ${revivedCount}명을 수습했습니다.`, '#8fd9a8');
        }
        this.playerData.miningTarget = null;
        this.playerTarget = null;
        this.autoMine = this.arenaSavedAutoMine;
        this.squadCommand = this.arenaSavedCommand;
        this.arenaActive = false;
        this.app.ui.hideCombatArena?.();
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

    addWorker(initialXp = 0, role = 'miner') {
        if (this.workers.length >= this.getWorkerCap()) return false;

        const index = this.workers.length;
        const worker = this.assets.worker.clone();
        const angle = (index / this.getWorkerCap()) * Math.PI * 2;
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
        worker.userData.workerRole = this.workerRoles.includes(role) ? role : 'miner';
        worker.userData.attackCooldown = 0;
        worker.userData.maxHp = this.getWorkerMaxHp(worker);
        worker.userData.hp = worker.userData.maxHp;
        worker.userData.regenTimer = 0;
        worker.userData.downTimer = 0;
        worker.userData.healthBar = this.createHealthBar(0.95, 0x66d9a8);
        worker.userData.healthBar.position.set(0, 1.15, 0);
        worker.userData.healthBar.visible = false;
        worker.add(worker.userData.healthBar);
        // Each worker gets its own seam assignment so the squad actually feels
        // like a mining crew instead of ten units stacked on one node.
        worker.userData.miningTarget = null;
        worker.userData.miningTargetIndex = index;
        // Individual growth: a worker gets a little sharper the more it mines
        // and fights, on top of the global trait/boon/facility multipliers.
        worker.userData.workerXp = Math.max(0, initialXp);
        worker.userData.workerTalents = { attack: 1, mining: 1, hp: 1, rare: 0 };
        worker.userData.workerPromotionTier = 0;
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

    // Worker progression: Lv.1 at 0 XP, +1 every 50 XP, capped at 100.
    // Workers are long-term companions, so their growth should remain meaningful
    // well beyond the early mine floors without becoming literally uncapped.
    getWorkerLevel(worker) {
        return Math.min(100, 1 + Math.floor((worker.userData.workerXp || 0) / 50));
    }

    /** Grants worker XP and opens a promotion choice at Lv.20/40/60/80/100. */
    addWorkerXp(worker, amount) {
        const before = this.getWorkerLevel(worker);
        worker.userData.workerXp = (worker.userData.workerXp || 0) + amount;
        const after = this.getWorkerLevel(worker);
        if (after > before) {
            const index = this.workers.indexOf(worker);
            this.combatFX.spawnFlash(worker.position, 0x8fd9a8, 24, 0.3);
            this.combatFX.spawnBurst(worker.position, { color: 0x8fd9a8, radius: 0.4, expand: 2, life: 0.4, height: worker.userData.baseY });
            this.pushCombatFeed(`🌱 워커 ${index + 1}번이 레벨업했습니다! Lv.${after}`, '#8fd9a8');
            [20,40,60,80,100].forEach(tier => {
                if (before < tier && after >= tier && (worker.userData.workerPromotionTier || 0) < tier) {
                    this.workerPromotionQueue.push({ worker, index, tier });
                }
            });
            this.processWorkerPromotionQueue();
        }
    }

    getWorkerLevelMult(worker) {
        return (1 + (this.getWorkerLevel(worker) - 1) * 0.025) * (worker.userData.workerTalents?.attack || 1);
    }

    getWorkerMiningMult(worker) {
        return (worker.userData.workerTalents?.mining || 1);
    }

    processWorkerPromotionQueue() {
        if (this.workerPromotionChoices || !this.workerPromotionQueue.length) return;
        const entry = this.workerPromotionQueue.shift();
        if (!entry?.worker || !this.workers.includes(entry.worker)) return this.processWorkerPromotionQueue();
        this.workerPromotionChoices = entry;
        this.app.ui.showWorkerPromotion?.({ worker: entry.index + 1, level: entry.tier, choices: this.getWorkerPromotionChoices(entry.worker, entry.tier) });
        this.persist();
    }

    getWorkerPromotionChoices(worker, tier) {
        const role = worker.userData.workerRole || 'miner';
        const common = [
            { id:'power', icon:'⚔️', title:'강철 심장', desc:'공격력 성장 +15%', color:'#ff8f8f', effect:'attack' },
            { id:'fortress', icon:'🛡️', title:'철벽', desc:'최대 HP +25%', color:'#8fd9ff', effect:'hp' },
            { id:'master', icon:'⛏️', title:'숙련 광부', desc:'채굴 속도 +18%', color:'#ffd27a', effect:'mining' }
        ];
        if (role === 'prospector') common[2] = { id:'fortune', icon:'💎', title:'행운의 손', desc:'희귀 광석 발견 보정 +8%', color:'#d4a6ff', effect:'rare' };
        if (tier === 100) {
            common[0].title='전설의 전사'; common[0].desc='공격력 성장 +30%';
            common[1].title='불멸의 수호자'; common[1].desc='최대 HP +50%';
            common[2] = role === 'prospector' ? { id:'fortune', icon:'💎', title:'광산의 축복', desc:'희귀 광석 발견 보정 +18%', color:'#d4a6ff', effect:'rare' } : { id:'master', icon:'⛏️', title:'광산의 달인', desc:'채굴 속도 +35%', color:'#ffd27a', effect:'mining' };
        }
        return common;
    }

    claimWorkerPromotion(choiceId) {
        const entry = this.workerPromotionChoices;
        if (!entry) return { ok:false, reason:'승급 선택이 없습니다.' };
        const choice = this.getWorkerPromotionChoices(entry.worker, entry.tier).find(c => c.id === choiceId);
        if (!choice) return { ok:false, reason:'잘못된 승급 선택입니다.' };
        const w = entry.worker;
        const t = w.userData.workerTalents || (w.userData.workerTalents = { attack:1, mining:1, hp:1, rare:0 });
        if (choice.effect === 'attack') t.attack *= entry.tier === 100 ? 1.30 : 1.15;
        if (choice.effect === 'mining') t.mining *= entry.tier === 100 ? 1.35 : 1.18;
        if (choice.effect === 'hp') t.hp *= entry.tier === 100 ? 1.50 : 1.25;
        if (choice.effect === 'rare') t.rare += entry.tier === 100 ? 0.18 : 0.08;
        w.userData.workerPromotionTier = entry.tier;
        w.userData.maxHp = this.getWorkerMaxHp(w);
        w.userData.hp = w.userData.maxHp;
        this.combatFX.spawnFlash(w.position, 0xffe28a, 45, 0.5);
        this.combatFX.spawnBurst(w.position, { color:0xffd166, radius:0.65, expand:3.4, life:0.75, height:w.userData.baseY });
        this.pushCombatFeed(`★ 워커 ${entry.index + 1}번 승급: ${choice.title}`, '#ffe39a');
        this.workerPromotionChoices = null;
        this.app.ui.closeWorkerPromotion?.();
        this.persist();
        setTimeout(() => this.processWorkerPromotionQueue(), 120);
        return { ok:true };
    }

    getWorkerMaxHp(worker) {
        const role = worker?.userData?.workerRole || 'miner';
        const roleMult = { miner: 0.9, fighter: 1.0, guard: 1.35, prospector: 0.95 }[role] || 1;
        const relicHpMult = this.bossRelics.reduce((m, r) => m * (r.workerHpMult || 1), 1);
        return Math.round((55 + this.getWorkerLevel(worker) * 5) * roleMult * relicHpMult * (worker?.userData?.workerTalents?.hp || 1));
    }

    getWorkerRoleLabel(role) {
        return ({ miner: '광부', fighter: '전투원', guard: '경비', prospector: '탐광꾼' })[role] || '광부';
    }

    setWorkerRole(index, role) {
        if (!this.workerRoles.includes(role)) return false;
        const worker = this.workers[index];
        if (!worker || worker.userData.downTimer > 0) return false;
        const oldMax = worker.userData.maxHp || this.getWorkerMaxHp(worker);
        const ratio = oldMax > 0 ? (worker.userData.hp ?? oldMax) / oldMax : 1;
        worker.userData.workerRole = role;
        worker.userData.maxHp = this.getWorkerMaxHp(worker);
        worker.userData.hp = Math.max(1, Math.min(worker.userData.maxHp, Math.round(worker.userData.maxHp * ratio)));
        this.pushCombatFeed(`워커 ${index + 1}번 역할 변경: ${this.getWorkerRoleLabel(role)}`, '#d7c4ed');
        this.persist();
        return true;
    }

    initControls() {
        this.canvas = this.app.renderer.domElement;
        this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
        window.addEventListener('keydown', (event) => {
            if (event.code === 'Space' && !event.repeat) {
                const result = this.startDodge();
                if (result?.ok) event.preventDefault();
            }
        });
        this.app.ui.setCommandHandler((command) => this.setSquadCommand(command));
        this.app.ui.setWorkerRoleHandler?.((index, role) => this.setWorkerRole(index, role));
        this.app.ui.setStatHandler((stat) => this.upgradeStat(stat));
        this.app.ui.setFacilityHandler((key) => this.upgradeFacility(key));
        this.app.ui.setMetaHandler((key) => this.buyMetaUpgrade(key));
        this.app.ui.setAutoCombatHandler(() => this.toggleAutoCombat());
        this.app.ui.setAutoMineHandler(() => this.toggleAutoMine());
        this.app.ui.setRetreatHandler(() => this.startEmergencyRetreat());
        this.app.ui.setDodgeHandler?.(() => this.startDodge());
        this.app.ui.setSkillHandler?.((skill) => this.castSkill(skill));
        this.app.ui.setLevelUpHandler?.((choiceId) => this.claimLevelUp(choiceId));
        this.app.ui.setWorkerPromotionHandler?.((choiceId) => this.claimWorkerPromotion(choiceId));
        // Mine defence waves are launched by the player from the combat menu.
        this.app.ui.setWaveStartHandler(() => {
            const result = this.startDefenceWave();
            if (!result.ok) this.pushCombatFeed(result.reason, '#ff9c9c');
            return result;
        });
        // Post-victory reward card selection.
        this.app.ui.setWaveRewardHandler((choiceId) => this.claimWaveReward(choiceId));
        // Tutorial-quest "claim reward" button in the quest panel.
        this.app.ui.setQuestRewardHandler(() => this.claimQuestReward());
        this.app.ui.setMineEventHandler?.((choiceId) => this.resolveMineEvent(choiceId));
        this.app.ui.setBossRewardHandler?.((choiceId) => this.claimBossReward(choiceId));
        // Status window: spend a ticket to reroll the leader's innate trait.
        this.app.ui.setTraitRerollHandler(() => this.rerollTrait());
        // Depth panel: climb to the next floor once its quota is met.
        this.app.ui.setAscendHandler(() => this.requestAscend());
        // Crafting workshop: the UI owns the mix, gameLogic owns the forge.
        this.app.ui.setCraftHandlers({
            preview: (mix, slot) => this.getCraftData(mix, slot),
            craft: (mix, slot) => {
                const result = this.craft(mix, slot);
                return { result, data: this.getCraftData(mix, slot) };
            },
            equip: (item, slot) => {
                this.equipItem(item, slot);
                return this.getCraftData(this.app.ui.craftMix, slot || item?.slot);
            }
        });
    }

    /** v12: short invulnerable dash. It is intentionally compact: the player
     * still clicks to move, but Space gives a reaction tool for telegraphed hits. */
    startDodge() {
        if (this.isDown || this.mineEvent || this.retreatTimer > 0 || this.dodgeCooldown > 0) {
            return { ok: false, reason: '회피할 수 없습니다.' };
        }
        const dir = new THREE.Vector3(0, 0, 1);
        const angle = this.player.rotation.y || 0;
        dir.set(Math.sin(angle), 0, Math.cos(angle)).normalize();
        if (this.playerTarget && this.enemies.includes(this.playerTarget)) {
            const away = new THREE.Vector3().subVectors(this.player.position, this.playerTarget.position).setY(0);
            if (away.lengthSq() > 0.2) dir.copy(away.normalize());
        }
        this.dodgeVector.copy(dir);
        this.dodgeTimer = 0.48;
        this.dodgeCooldown = 4.2;
        this.playerData.miningTarget = null;
        this.playerData.targetPos.copy(this.player.position);
        this.player.userData.airborne = 0.16;
        this.combatFX.spawnBurst(this.player.position, { color: 0x8fe4ff, radius: 0.45, expand: 2.5, life: 0.32 });
        this.combatFX.spawnFlash(this.player.position, 0x8fe4ff, 28, 0.24);
        this.app.addShake(0.18);
        this.pushCombatFeed('💨 회피! 짧은 시간 동안 피해를 무시합니다.', '#8fe4ff');
        return { ok: true };
    }

    setSquadCommand(command) {
        if (this.workers.length === 0) return;
        if (!['mine', 'attack', 'defend', 'focus'].includes(command)) return;
        if (command === 'focus' && (!this.playerTarget || !this.enemies.includes(this.playerTarget) || this.playerTarget.userData.dying)) {
            this.pushCombatFeed('🎯 먼저 적을 클릭해 집중 대상을 지정하세요.', '#ffe39a');
            return;
        }
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

        // The dragon's hoard: clicking a chest is an instant, decisive choice.
        const intersectsChests = this.raycaster.intersectObjects(this.chests, true);
        if (intersectsChests.length > 0) {
            let chest = intersectsChests[0].object;
            while (chest.parent && !this.chests.includes(chest)) chest = chest.parent;
            if (this.chests.includes(chest) && !chest.userData.opened) {
                this.openChest(chest);
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

    // v20: repeatable side contracts were removed. Story/tutorial quests remain.
    getContractDefinitions() { return []; }
    ensureQuestContracts() {
        if (this.quest) this.quest.contracts = [];
    }
    getQuestContractData() { return []; }
    claimContract(id) { return { ok: false, reason: '반복 의뢰는 제거되었습니다.' }; }
    bumpQuestStat(type, amount = 1) { /* legacy save compatibility: no side-contract progression */ }

    getStoryQuestData() {
        // The dragon's hoard always takes priority: a leader standing on
        // B25F sees the chest choice, whatever tutorial step it is nominally on.
        if (this.depth === 25) {
            return {
                stage: 'climb',
                title: '드래곤의 둥지',
                description: '흩어진 황금 상자 10개 중 하나를 선택해 여세요. 그 안에 태생 특성이 잠들어 있습니다.',
                progress: this.floorNodesCleared,
                target: this.getFloorQuota(),
                accent: '#ffd166'
            };
        }

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
        if (this.quest.stage === 'statUpgrade') {
            const done = ['strength', 'speed', 'luck'].filter((stat) => this.stats[stat] >= 2).length;
            return {
                stage: 'statUpgrade',
                title: '리더 강화',
                description: this.quest.rewardReady
                    ? '힘·속도·행운을 모두 강화했습니다! 보상을 받으세요.'
                    : '리더 스탯 창에서 힘·속도·행운을 각각 한 번씩 강화하세요.',
                progress: done,
                target: 3,
                rewardReady: this.quest.rewardReady,
                accent: this.quest.rewardReady ? '#8fd9a8' : '#ffcf8a'
            };
        }
        if (this.quest.stage === 'reach29') {
            return {
                stage: 'reach29',
                title: '더 깊은 곳으로',
                description: this.quest.rewardReady
                    ? '지하 29층에 도착했습니다! 보상을 받으세요.'
                    : `지하 29층에 도착하세요. 현재 ${this.getFloorLabel()}`,
                progress: this.depth <= 29 ? 1 : 0,
                target: 1,
                rewardReady: this.quest.rewardReady,
                accent: this.quest.rewardReady ? '#8fd9a8' : '#8fe4ff'
            };
        }
        if (this.quest.stage === 'iron20') {
            return {
                stage: 'iron20',
                title: '철을 벼려서',
                description: this.quest.rewardReady
                    ? '철광석 20개를 모았습니다! 보상을 받으세요.'
                    : '철광석을 20개 모으세요.',
                progress: Math.min(this.inventory.iron, 20),
                target: 20,
                rewardReady: this.quest.rewardReady,
                accent: this.quest.rewardReady ? '#8fd9a8' : '#cdd6e0'
            };
        }
        if (this.quest.stage === 'craft') {
            return {
                stage: 'craft',
                title: '첫 제작',
                description: '대장간에서 아이템을 하나 제작해보세요. 단축키 I 또는 C.',
                progress: 0,
                target: 1,
                accent: '#ffe39a'
            };
        }
        if (this.quest.stage === 'reach27') {
            return {
                stage: 'reach27',
                title: '더 깊은 곳으로',
                description: this.quest.rewardReady
                    ? '지하 27층에 도착했습니다! 보상을 받으세요.'
                    : `지하 27층에 도착하세요. 현재 ${this.getFloorLabel()}`,
                progress: this.depth <= 27 ? 1 : 0,
                target: 1,
                rewardReady: this.quest.rewardReady,
                accent: this.quest.rewardReady ? '#8fd9a8' : '#8fe4ff'
            };
        }
        if (this.quest.stage === 'gold15') {
            return {
                stage: 'gold15',
                title: '금맥을 찾아서',
                description: this.quest.rewardReady
                    ? '금광석 15개를 모았습니다! 보상을 받으세요.'
                    : '금광석을 15개 모으세요.',
                progress: Math.min(this.inventory.gold, 15),
                target: 15,
                rewardReady: this.quest.rewardReady,
                accent: this.quest.rewardReady ? '#8fd9a8' : '#ffd166'
            };
        }
        if (this.quest.stage === 'reach26') {
            return {
                stage: 'reach26',
                title: '더 깊은 곳으로',
                description: this.quest.rewardReady
                    ? '지하 26층에 도착했습니다! 보상을 받으세요.'
                    : `지하 26층에 도착하세요. 현재 ${this.getFloorLabel()}`,
                progress: this.depth <= 26 ? 1 : 0,
                target: 1,
                rewardReady: this.quest.rewardReady,
                accent: this.quest.rewardReady ? '#8fd9a8' : '#8fe4ff'
            };
        }
        if (this.quest.stage === 'craft3') {
            const count = Math.min(3, this.quest.craftCount || 0);
            return {
                stage: 'craft3',
                title: '대장장이 수련',
                description: `무기를 3번 제작해보세요. 단축키 I 또는 C. (${count}/3)`,
                progress: count,
                target: 3,
                accent: '#ffe39a'
            };
        }
        if (this.quest.stage === 'trait25') {
            if (this.quest.rewardReady) {
                return {
                    stage: 'trait25',
                    title: '드래곤의 둥지로',
                    description: '태생 특성을 얻었습니다! 보상을 받으세요.',
                    progress: 1,
                    target: 1,
                    rewardReady: true,
                    accent: '#8fd9a8'
                };
            }
            return {
                stage: 'trait25',
                title: '드래곤의 둥지로',
                description: this.depth > 25
                    ? `지하 25층 드래곤의 둥지로 내려가 태생 특성을 얻으세요. 현재 ${this.getFloorLabel()}`
                    : '황금 상자 하나를 열어 태생 특성을 얻으세요.',
                progress: 0,
                target: 1,
                accent: '#ffd166'
            };
        }
        if (this.quest.stage === 'waveDefense') {
            if (this.quest.rewardReady) {
                return {
                    stage: 'waveDefense',
                    title: '첫 방어전',
                    description: '웨이브를 막아냈습니다! 보상을 받으세요.',
                    progress: 1,
                    target: 1,
                    rewardReady: true,
                    accent: '#8fd9a8'
                };
            }
            if (this.depth > 24) {
                return {
                    stage: 'waveDefense',
                    title: '방어선 구축',
                    description: `지하 24층까지 내려가면 광산 방어를 시작할 수 있습니다. 현재 ${this.getFloorLabel()}`,
                    progress: 0,
                    target: 1,
                    accent: '#8fe4ff'
                };
            }
            return {
                stage: 'waveDefense',
                title: '첫 방어전',
                description: '지하 24층에 도착했습니다! 메뉴에서 광산 방어를 시작해 웨이브를 막아내세요.',
                progress: 0,
                target: 1,
                accent: '#ff9c9c'
            };
        }

        // 'complete': the tutorial chain is done. Floors above B24F still
        // climb one at a time; B24F and below unlock the defence waves.
        if (this.depth > 0) {
            const fromLabel = this.getFloorLabel(this.depth);
            const toLabel = this.getFloorLabel(this.depth - 1);
            return {
                stage: 'climb',
                title: `${fromLabel}에서 ${toLabel}으로`,
                description: this.floorReadyToAscend
                    ? '광맥을 모두 캐냈습니다! 상단의 이동 버튼을 눌러 다음 층으로 올라가세요.'
                    : `이 층의 광맥을 ${this.getFloorQuota()}개 캐내 다음 층으로 올라가세요.`,
                progress: this.floorNodesCleared,
                target: this.getFloorQuota(),
                accent: this.floorReadyToAscend ? '#8fd9a8' : '#8fe4ff'
            };
        }

        if (this.finalBossActive) {
            return {
                stage: 'complete',
                title: '⚔ 광산 점령전',
                description: `지상의 지배자를 물리치세요! 남은 적 ${this.enemies.length}마리`,
                progress: Math.max(0, this.waveEnemyTotal - this.enemies.length),
                target: Math.max(1, this.waveEnemyTotal || 1),
                accent: '#ff7a4a'
            };
        }
        if (!this.surfaceConquered) {
            return {
                stage: 'complete',
                title: '☀ 지상 도달',
                description: '광산 점령전이 곧 시작됩니다.',
                progress: 0,
                target: 1,
                accent: '#ffe39a'
            };
        }
        if (this.surfaceConquered) {
            return {
                stage: 'complete',
                title: '★ 광산 점령 완료',
                description: '더 단단해진 새 광산이 곧 지하 30층에 열립니다.',
                progress: 1,
                target: 1,
                accent: '#ffe39a'
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

    getQuestData() {
        const story = this.getStoryQuestData();
        return { ...story, contracts: this.getQuestContractData() };
    }

    /** Announces a tutorial-chain transition with a banner and feed line. */
    advanceTutorialQuest(nextStage, title, subtitle) {
        this.quest.stage = nextStage;
        this.app.ui.showBanner(title, subtitle, '#cbb8e8');
        this.pushCombatFeed(subtitle, '#cbb8e8');
        this.persist();
    }

    /**
     * Runs every frame. Some tutorial steps are simple threshold checks
     * against state that can already be true the moment the step becomes
     * current (the player may have out-mined the floor quota while still on
     * an earlier quest), so they are polled here instead of only reacting to
     * the event that usually satisfies them.
     */
    updateQuestProgress() {
        if (this.quest.stage === 'coal') {
            this.completeCoalQuest();
            return;
        }
        if (this.quest.rewardReady) return;
        const done =
            (this.quest.stage === 'statUpgrade'
                && this.stats.strength >= 2 && this.stats.speed >= 2 && this.stats.luck >= 2) ||
            (this.quest.stage === 'reach29' && this.depth <= 29) ||
            (this.quest.stage === 'iron20' && this.inventory.iron >= 20) ||
            (this.quest.stage === 'reach27' && this.depth <= 27) ||
            (this.quest.stage === 'gold15' && this.inventory.gold >= 15) ||
            (this.quest.stage === 'reach26' && this.depth <= 26) ||
            (this.quest.stage === 'trait25' && this.traits.length > 0);
        if (!done) return;

        // The condition is met, but the stage does not advance until the
        // player actually presses the reward button in the quest panel.
        this.quest.rewardReady = true;
        this.pushCombatFeed('퀘스트 목표 달성! 보상을 받으세요.', '#8fd9a8');
        this.persist();
    }

    /** Claims the current tutorial quest's reward and advances the chain. */
    claimQuestReward() {
        if (!this.quest.rewardReady) return { ok: false };
        this.quest.rewardReady = false;

        let message;
        let nextStage;
        let nextGoal;

        if (this.quest.stage === 'statUpgrade') {
            this.inventory.coal += 12;
            this.inventory.iron += 6;
            message = '보상으로 석탄 12 · 철광석 6을 받았습니다!';
            nextStage = 'reach29';
            nextGoal = '지하 29층에 도착하세요.';
        } else if (this.quest.stage === 'reach29') {
            if (this.addWorker()) {
                message = '보상으로 워커를 영입하였습니다!';
            } else {
                this.inventory.gold += 5;
                message = '보상으로 금광석 5개를 받았습니다!';
            }
            nextStage = 'iron20';
            nextGoal = '철광석을 20개 모으세요.';
        } else if (this.quest.stage === 'iron20') {
            this.inventory.gold += 5;
            this.inventory.coal += 10;
            message = '보상으로 금광석 5 · 석탄 10을 받았습니다!';
            nextStage = 'craft';
            nextGoal = '대장간에서 아이템을 하나 제작해보세요.';
        } else if (this.quest.stage === 'reach27') {
            this.stats.strength += 1;
            message = '보상으로 힘 +1을 얻었습니다!';
            nextStage = 'gold15';
            nextGoal = '금광석을 15개 모으세요.';
        } else if (this.quest.stage === 'gold15') {
            this.maxPlayerHp += 15;
            this.playerData.hp = Math.min(this.maxPlayerHp, this.playerData.hp + 15);
            message = '보상으로 최대 HP +15를 얻었습니다!';
            nextStage = 'reach26';
            nextGoal = '지하 26층에 도착하세요.';
        } else if (this.quest.stage === 'reach26') {
            this.inventory.coal += 15;
            this.inventory.iron += 10;
            message = '보상으로 석탄 15 · 철광석 10을 받았습니다!';
            nextStage = 'craft3';
            nextGoal = '무기를 3번 제작해보세요.';
        } else if (this.quest.stage === 'trait25') {
            this.traitRerollTickets = (this.traitRerollTickets || 0) + 1;
            message = '보상으로 특성 변경권을 얻었습니다!';
            nextStage = 'waveDefense';
            nextGoal = '지하 24층에 도착해 첫 웨이브를 막아내세요.';
        } else if (this.quest.stage === 'waveDefense') {
            if (this.addWorker()) {
                message = '보상으로 워커를 영입하였습니다!';
            } else {
                this.inventory.gold += 5;
                message = '보상으로 금광석 5개를 받았습니다!';
            }
            nextStage = 'complete';
            nextGoal = '자유롭게 채굴하고, 광산 방어를 계속하세요.';
        } else {
            return { ok: false };
        }

        this.quest.stage = nextStage;
        this.pushCombatFeed(message, '#8fd9a8');
        this.app.ui.showBanner('보상 획득', `${message} 다음 목표: ${nextGoal}`, '#8fd9a8');
        this.persist();
        return { ok: true };
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

    toggleAutoMine() {
        this.autoMine = !this.autoMine;
        this.persist();
        return this.autoMine;
    }

    /**
     * Emergency retreat is the first explicit greed-vs-safety decision: stop
     * digging, pull the squad back into a defensive ring, and let mining noise
     * fall quickly. It does not erase danger or heal the leader, so retreating
     * is a reset of pressure rather than a free escape.
     */
    startEmergencyRetreat() {
        if (this.isDown || this.workers.length === 0) {
            return { ok: false, reason: this.isDown ? '리더가 쓰러져 있습니다.' : '지휘할 워커가 없습니다.' };
        }

        if (this.arenaActive && !this.finalBossActive) {
            const failedWave = this.wave;
            this.waveActive = false;
            this.arenaActive = false;
            this.exitCombatArena();
            this.miningNoise = Math.max(0, (this.miningNoise || 0) * 0.45);
            this.pushCombatFeed(`↩ 전투 구역 철수 · WAVE ${failedWave} 보상 없음`, '#8fe4ff');
            this.app.ui.showBanner('↩ 전투 철수', '생존 보상을 포기하고 광산으로 돌아갑니다.', '#8fe4ff');
            this.persist();
            return { ok: true };
        }

        this.autoMine = false;
        this.playerData.miningTarget = null;
        this.playerTarget = null;
        this.squadCommand = 'defend';
        this.workers.forEach((worker) => {
            worker.userData.squadRole = 'defend';
            worker.userData.miningTarget = null;
            worker.userData.attackCooldown = 0;
        });
        this.retreatTimer = 6;
        this.bumpQuestStat('retreats', 1);
        this.miningNoise = Math.max(0, (this.miningNoise || 0) * 0.72);
        this.pushCombatFeed('↩ 긴급 철수! 채굴을 중단하고 분대를 리더 곁으로 집결시킵니다.', '#8fe4ff');
        this.app.ui.showBanner('↩ 긴급 철수', '채굴을 멈추고 분대를 방어 태세로 전환합니다.', '#8fe4ff');
        this.persist();
        return { ok: true };
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

    /** v14: three-stage surface boss. Each transition changes the arena pressure
     * instead of simply multiplying HP/damage. */
    updateBossPhase(enemy) {
        const d = enemy?.userData;
        if (!d?.isFinalBoss || d.dying) return;
        const ratio = d.hp / Math.max(1, d.maxHp);
        let next = ratio <= 0.20 ? 3 : ratio <= 0.50 ? 2 : 1;
        if (next <= d.bossPhase || d.bossTransitioning) return;
        d.bossPhase = next;
        d.phase = next;
        d.enraged = next >= 2;
        d.bossTransitioning = true;
        d.patternState = 'cooldown';
        d.patternCooldown = 1.4;
        d.patternTimer = 1.2;
        d.bossSummonCooldown = 0.5;
        d.bossHazardCooldown = 0.2;
        if (next === 2) {
            d.moveSpeed *= 1.12;
            d.attackInterval *= 0.78;
            this.combatFX.spawnShockwave(enemy.position, { color: 0xff6b55, scale: 13 });
            this.combatFX.spawnFlash(enemy.position, 0xff5a5a, 90, 0.85);
            this.app.addShake(1.2);
            this.pushCombatFeed('🔥 2단계: 광산 점령자가 광폭화했습니다!', '#ff6b55');
            this.app.ui.showBanner('🔥 2단계 — 광폭화', '공격이 빨라지고 갱도에 지원군을 부릅니다!', '#ff6b55');
        } else if (next === 3) {
            d.moveSpeed *= 1.18;
            d.attackInterval *= 0.72;
            this.combatFX.spawnShockwave(enemy.position, { color: 0xff304f, scale: 17 });
            this.combatFX.spawnFlash(enemy.position, 0xff304f, 120, 1.0);
            this.app.addShake(1.6);
            this.pushCombatFeed('☠ 최종 단계: 광산 점령자가 갱도를 붕괴시키기 시작합니다!', '#ff304f');
            this.app.ui.showBanner('☠ 최종 단계', '지면분쇄가 강해집니다. 회피 타이밍을 놓치지 마세요!', '#ff304f');
        }
        setTimeout(() => { if (d) d.bossTransitioning = false; }, 900);
    }

    bossPhaseAction(enemy, d, pos) {
        if (!d.isFinalBoss || d.dying) return;
        d.bossSummonCooldown = Math.max(0, (d.bossSummonCooldown || 0) - 0.1);
        d.bossHazardCooldown = Math.max(0, (d.bossHazardCooldown || 0) - 0.1);
        if (d.bossPhase >= 2 && d.bossSummonCooldown <= 0) {
            const alive = this.enemies.filter(e => !e.userData.dying && e !== enemy).length;
            const maxAdds = d.bossPhase === 3 ? 5 : 4;
            if (alive < maxAdds) {
                const type = Math.random() < 0.55 ? 'crawler' : 'archer';
                this.spawnEnemy(type, { distance: 8 + Math.random() * 4, angle: Math.random() * Math.PI * 2, isFieldEnemy: true, waveOverride: this.wave + 3 });
                this.pushCombatFeed('⚠ 광산 점령자가 지원군을 소환했습니다!', '#ff9c6b');
            }
            d.bossSummonCooldown = d.bossPhase === 3 ? 7.5 : 10.5;
        }
        if (d.bossPhase === 3 && d.bossHazardCooldown <= 0) {
            const hazardPos = new THREE.Vector3(
                this.player.position.x + (Math.random() - 0.5) * 5,
                d.baseY,
                this.player.position.z + (Math.random() - 0.5) * 5
            );
            this.combatFX.spawnShockwave(hazardPos, { color: 0xff304f, scale: 5.5 });
            this.pushCombatFeed('☠ 붕괴 지점이 생겼습니다! 이동하세요.', '#ff5470');
            const targets = this.getCombatTargetsInRadius(hazardPos, 2.1);
            targets.forEach(v => this.damageCombatTarget(v, Math.round(d.damage * 0.7), enemy));
            d.bossHazardCooldown = 5.2;
        }
    }

    /** Applies damage to a monster with full visual feedback. */
    damageEnemy(enemy, rawDamage, options = {}) {
        if (!enemy || enemy.userData.dying) return 0;

        const reduction = enemy.userData.damageReduction || 0;
        const damage = Math.max(1, Math.round(rawDamage * (1 - reduction)));
        enemy.userData.hp -= damage;
        this.updateBossPhase(enemy);
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
        if (enemy.userData.eliteAffix === 'volatile') {
            const blastTargets = this.getCombatTargetsInRadius(enemy.position, 3.2);
            blastTargets.forEach((target) => this.damageCombatTarget(target, Math.round(enemy.userData.damage * 0.9), enemy));
            this.combatFX.spawnShockwave(enemy.position, { color: 0x9fffd0, scale: 7 });
            this.pushCombatFeed('💥 불안정 정예가 폭발했습니다!', '#9fffd0');
        }
        this.grantKillReward(enemy);
        if (!enemy.userData.isFinalBoss && (enemy.userData.isArenaEnemy || this.arenaActive)) {
            this.spawnXpGem(enemy.position, enemy.userData.xp || 5);
        }
        this.bumpQuestStat('kills', 1);
        if (this.arenaActive && enemy.userData.isArenaEnemy) {
            this.arenaKills += 1;
        }
    }

    /** Ore + recruit rewards for a slain monster. */
    grantKillReward(enemy) {
        const xp = enemy.userData.xp || 5;
        const oreRoll = Math.random();
        let reward;
        if (enemy.userData.elite) {
            this.inventory.mithril += enemy.userData.eliteAffix ? 3 : 2;
            this.inventory.gold += enemy.userData.eliteAffix ? 5 : 3;
            reward = enemy.userData.eliteAffix
                ? `미스릴 3 · 금광석 5 · ${enemy.userData.eliteAffixName} 보너스`
                : '미스릴 2 · 금광석 3';
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
        // After that, new workers only come from wave-clear reward cards or
        // tutorial-quest claims, so the squad never balloons on its own.
        if (this.quest.stage === 'recruit' && this.enemies.filter((e) => !e.userData.dying).length <= 1) {
            if (this.addWorker()) {
                this.pushCombatFeed('워커 슬라임이 합류했습니다!', '#ffe39a');
                this.advanceTutorialQuest('statUpgrade', '다음 목표', '리더 스탯 창에서 힘·속도·행운을 각각 강화하세요.');
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

        if (dealt > 0 && Math.random() < this.traitEffects.lifestealChance + this.getEquipmentLifesteal()) {
            const healed = Math.max(1, Math.round(dealt * 0.3));
            this.playerData.hp = Math.min(this.maxPlayerHp, this.playerData.hp + healed);
            this.combatFX.spawnDamageNumber(this.player.position, healed, { color: '#8fd9a8', text: `+${healed}` });
        }

        // Legendary weapon proc: a bonus magic burst on top of the normal hit.
        if (Math.random() < this.getSpellProcChance() && target.userData && !target.userData.dying) {
            const burstDamage = Math.max(1, Math.round(this.getTotalAttack() * 0.75));
            this.combatFX.spawnFlash(target.position, 0x9f6bff, 62, 0.45);
            this.combatFX.spawnBurst(target.position, { color: 0xc9a6ff, radius: 0.85, expand: 3.6, life: 0.5, height: target.userData.baseY });
            this.combatFX.spawnShockwave(target.position, { color: 0x9f6bff, scale: 6.5, life: 0.55 });
            this.combatFX.spawnSparks(target.position, { color: 0xd8b8ff, count: 26, speed: 7.5, life: 0.6, height: target.userData.baseY });
            this.app.addShake(0.4);
            this.damageEnemy(target, burstDamage, { from: this.player.position, color: '#c9a6ff' });
            this.pushCombatFeed('✨ 마법 폭발이 터졌습니다!', '#c9a6ff');
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
        if (this.dodgeTimer > 0) {
            this.combatFX.spawnFlash(this.player.position, 0x8fe4ff, 36, 0.25);
            this.pushCombatFeed('💨 회피 성공!', '#8fe4ff');
            return;
        }

        // Legendary armor proc: shrug off the hit entirely.
        if (Math.random() < this.getBlockChance()) {
            this.combatFX.spawnFlash(this.player.position, 0x8fe4ff, 30, 0.3);
            this.pushCombatFeed('🛡 방어구가 공격을 완전히 막아냈습니다!', '#8fe4ff');
            return;
        }

        const damage = Math.max(1, Math.round(
            amount * this.traitEffects.damageTakenMult * this.getDamageReductionMult()
        ));
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

    /** The leader is knocked out. Defence arenas are a clean run failure: no revive loop, no death penalty. */
    downPlayer() {
        this.playerData.miningTarget = null;
        this.combatFX.spawnShockwave(this.player.position, { color: 0x6ab7ff, scale: 8 });
        this.combatFX.spawnBurst(this.player.position, { color: 0x6ab7ff, radius: 1, expand: 3.6, life: 0.6 });
        this.app.addShake(0.9);

        if (this.arenaActive && !this.finalBossActive) {
            this.failDefenceArena();
            return;
        }

        this.isDown = true;
        this.deathTimer = 3;
        this.pushCombatFeed('리더가 쓰러졌습니다… 잠시 후 부활합니다.', '#ff7d6b');

        if (this.waveActive) {
            this.failWave();
        } else {
            this.applyDeathPenalty();
        }

        this.enemies.forEach((enemy) => {
            enemy.userData.attackTimer = 2.5;
        });
    }

    /** v24: regular defence failure ends the arena immediately; the same wave remains available for a retry. */
    failDefenceArena() {
        const failedWave = this.wave;
        this.isDown = false;
        this.deathTimer = 0;
        this.waveFailed = true;
        this.waveActive = false;
        this.rewardPending = null;
        this.enemies.slice().forEach((enemy) => this.scene.remove(enemy));
        this.enemies = [];
        this.playerData.hp = Math.round(this.maxPlayerHp * 0.6);
        this.playerData.targetPos.copy(this.player.position);
        this.player.scale.setScalar(this.player.userData.baseScale || 1.25);
        this.player.rotation.z = 0;
        this.exitCombatArena();
        this.app.ui.showBanner?.('🛡 방어전 실패', `리더가 쓰러졌습니다 · 웨이브 ${failedWave} 재도전 가능`, '#ff7d6b');
        this.pushCombatFeed(`❌ 방어전 ${failedWave} 실패. 전력을 강화한 뒤 같은 웨이브에 다시 도전하세요.`, '#ff7d6b');
        this.app.multiplayer.broadcastEvent?.('wave_fail', { wave: failedWave });
        this.persist();
    }

    /** Falling in a formal wave is an outright loss: no reward, run ends now. */
    failWave() {
        const failedWave = this.wave;
        this.waveActive = false;
        this.finalBossActive = false;

        // Clear the field so the next attempt starts clean.
        this.enemies.forEach((enemy) => this.scene.remove(enemy));
        this.enemies = [];

        this.app.ui.showBanner('☠ 웨이브 실패', `웨이브 ${failedWave}에서 리더가 쓰러졌습니다`, '#ff5a5a');
        this.pushCombatFeed(`☠ 웨이브 ${failedWave} 실패하였습니다.`, '#ff5a5a');
        this.app.multiplayer.broadcastEvent?.('wave_fail', { wave: failedWave });
        this.persist();
    }

    /**
     * Falling to a wandering field monster costs a slice of the haul, plus
     * something heavier: a squad worker dies outright if one is on hand,
     * otherwise the leader's own revival is bought back with a steep gold fee.
     */
    applyDeathPenalty() {
        const lost = {};
        let anyLost = false;
        Object.keys(this.oreConfig).forEach((ore) => {
            const amount = Math.floor((this.inventory[ore] || 0) * 0.1);
            if (amount > 0) {
                this.inventory[ore] -= amount;
                lost[ore] = amount;
                anyLost = true;
            }
        });

        if (anyLost) {
            const summary = Object.entries(lost)
                .map(([ore, amount]) => `${this.oreConfig[ore].label} ${amount}`)
                .join(' · ');
            this.pushCombatFeed(`💢 몬스터에게 당해 광석을 빼앗겼습니다: ${summary}`, '#ff9c9c');
        }

        if ((this.unstableHaul || 0) > 0) {
            const lostBonus = Math.round(this.unstableHaul);
            this.unstableHaul = 0;
            this.greedSeams = 0;
            this.pushCombatFeed(`💥 욕심 채굴 보너스 ${lostBonus}을(를) 모두 잃었습니다.`, '#ff7d6b');
        }

        if (this.workers.length > 0) {
            // The least experienced worker takes the fall for the squad.
            const fallen = this.workers.reduce((weakest, worker) => (
                (worker.userData.workerXp || 0) < (weakest.userData.workerXp || 0) ? worker : weakest
            ));
            this.combatFX.spawnBurst(fallen.position, { color: 0x8b1a1a, radius: 0.6, expand: 2.4, life: 0.6 });
            this.removeWorker(fallen);
            this.pushCombatFeed('💀 워커 슬라임 한 마리가 목숨을 잃었습니다.', '#ff5a5a');
        } else {
            const cost = Math.min(
                this.inventory.gold,
                40 + this.getFloorsClimbed() * 4 + this.cycle * 15
            );
            if (cost > 0) {
                this.inventory.gold -= cost;
                this.pushCombatFeed(`💰 부활 비용으로 금광석 ${cost}을(를) 지불했습니다.`, '#ffe39a');
            } else {
                this.pushCombatFeed('💸 지불할 금광석마저 없어 빈손으로 부활했습니다.', '#9fc4d8');
            }
        }

        this.persist();
    }

    /** Removes a worker for good: scene, mesh resources, and the squad list. */
    removeWorker(worker) {
        if (worker.userData.pickaxe) {
            worker.userData.pickaxe.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    child.material?.dispose();
                }
            });
        }
        this.scene.remove(worker);
        this.workers = this.workers.filter((entry) => entry !== worker);
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

    /** Monsters can pressure the squad as well as the leader. Defenders are
     * attractive targets, while a mining worker is an easier victim. */
    acquireEnemyTarget(enemy) {
        const candidates = [];
        if (!this.isDown) candidates.push({ object: this.player, priority: 1.35 });
        this.workers.forEach(worker => {
            if (worker.userData.downTimer > 0) return;
            const priority = worker.userData.squadRole === 'defend' ? 0.85 : 1.15;
            candidates.push({ object: worker, priority });
        });
        let best = null;
        let bestScore = Infinity;
        candidates.forEach(({ object, priority }) => {
            const distance = enemy.position.distanceTo(object.position);
            if (distance > 18) return;
            const score = distance * priority;
            if (score < bestScore) { bestScore = score; best = object; }
        });
        return best;
    }

    /** v11 combat patterns: readable telegraphs, area threats, and boss phases. */
    getCombatTargetsInRadius(center, radius) {
        const targets = [];
        if (!this.isDown && this.player) {
            const d = center.distanceTo(this.player.position);
            if (d <= radius) targets.push(this.player);
        }
        this.workers.forEach(worker => {
            if (worker.userData.downTimer > 0) return;
            if (center.distanceTo(worker.position) <= radius) targets.push(worker);
        });
        return targets;
    }

    damageCombatTarget(target, amount, source) {
        if (target === this.player) this.damagePlayer(amount, source);
        else if (this.workers.includes(target)) this.damageWorker(target, amount, source);
    }

    triggerEnemyPattern(enemy) {
        const d = enemy.userData;
        if (d.dying || d.patternState !== 'ready') return false;
        d.patternState = 'windup';
        d.patternWindup = d.pattern === 'boss' ? 1.15 : 0.8;
        this.combatFX.spawnFlash(enemy.position, d.tint, d.elite ? 42 : 26, 0.28);
        return true;
    }

    resolveEnemyPattern(enemy) {
        const d = enemy.userData;
        const pos = enemy.position.clone();
        pos.y = d.baseY;
        const target = this.acquireEnemyTarget(enemy);
        const dir = target
            ? new THREE.Vector3().subVectors(target.position, enemy.position).setY(0).normalize()
            : new THREE.Vector3(0, 0, 1);
        let radius = 0;
        let damage = d.damage;
        let label = '';

        if (d.pattern === 'lunge') {
            enemy.position.addScaledVector(dir, 1.15);
            radius = 2.15;
            damage = Math.round(d.damage * 1.35);
            label = '돌진';
            this.combatFX.spawnSlashArc(pos, dir, { color: `#${d.tint.toString(16).padStart(6,'0')}`, radius: 1.7, height: d.baseY * 0.7 });
        } else if (d.pattern === 'slam') {
            radius = 3.2;
            damage = Math.round(d.damage * 1.15);
            label = '지면 강타';
            this.combatFX.spawnShockwave(pos, { color: d.tint, scale: 5.5 });
        } else if (d.pattern === 'volley') {
            // A three-shot radial volley. Each projectile is a warning rather than instant damage.
            radius = 0;
            label = '삼연발';
            const targets = this.getCombatTargetsInRadius(pos, 13);
            targets.slice(0, 3).forEach((victim, i) => {
                const from = pos.clone(); from.y += d.baseY * 0.75;
                this.combatFX.fireArrow(from, () => {
                    if (victim === this.player) return this.isDown ? null : this.player.position.clone();
                    if (!this.workers.includes(victim) || victim.userData.downTimer > 0) return null;
                    return victim.position.clone();
                }, {
                    color: d.tint, speed: 20 + i * 2,
                    onHit: (impact) => {
                        this.combatFX.spawnSparks(impact, { color: d.tint, count: 8, speed: 4, height: 0 });
                        this.damageCombatTarget(victim, Math.round(d.damage * 0.7), enemy);
                    }
                });
            });
        } else if (d.pattern === 'boss') {
            this.updateBossPhase(enemy);
            this.bossPhaseAction(enemy, d, pos);
            const phase = d.bossPhase || 1;
            radius = phase === 3 ? 6.4 : phase === 2 ? 5.2 : 4.1;
            damage = Math.round(d.damage * (phase === 3 ? 1.65 : phase === 2 ? 1.45 : 1.25));
            label = phase === 3 ? '최종 지면분쇄' : phase === 2 ? '폭주 지면분쇄' : '지면분쇄';
            this.combatFX.spawnShockwave(pos, { color: phase >= 2 ? 0xff4d55 : 0xff9c4a, scale: phase === 3 ? 12 : phase === 2 ? 10 : 7 });
            this.app.addShake(phase === 3 ? 1.35 : phase === 2 ? 1.0 : 0.65);
        }

        if (radius > 0) {
            this.getCombatTargetsInRadius(pos, radius).forEach(victim => this.damageCombatTarget(victim, damage, enemy));
        }
        if (label) this.pushCombatFeed(`⚠ ${d.name} · ${label}!`, d.enraged ? '#ff5a5a' : '#ffcf8a');
        d.patternState = 'cooldown';
        d.patternCooldown = d.pattern === 'boss' ? (d.enraged ? 3.2 : 4.2) : 5.2;
        d.patternTimer = d.pattern === 'boss' ? (d.enraged ? 3.0 : 4.5) : 4.0 + Math.random() * 2.0;
    }

    /** Per-frame monster brain: approach, keep range, telegraph, and strike. */
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

        // Pattern timer is independent from basic attacks. The orange/red telegraph gives
        // the player a short reaction window instead of turning combat into pure DPS racing.
        if (data.patternState === 'cooldown') {
            data.patternCooldown -= delta;
            if (data.patternCooldown <= 0) data.patternState = 'ready';
        }
        if (data.patternState === 'ready' && data.patternTimer > 0) data.patternTimer -= delta;
        if (data.patternState === 'ready' && data.patternTimer <= 0) {
            const activeTarget = this.acquireEnemyTarget(enemy);
            if (activeTarget && enemy.position.distanceTo(activeTarget.position) <= (data.pattern === 'volley' ? 13 : 8)) {
                this.triggerEnemyPattern(enemy);
            } else {
                data.patternTimer = 1.5;
            }
        }
        if (data.patternState === 'windup') {
            data.patternWindup -= delta;
            const pulse = Math.sin(Math.max(0, data.patternWindup) * 18) > 0 ? 1.08 : 1;
            enemy.scale.setScalar(data.baseScale * pulse);
            if (data.patternWindup <= 0) this.resolveEnemyPattern(enemy);
        }

        data.bob += delta * (data.style === 'melee' ? 5.5 : 3.4);
        const target = this.acquireEnemyTarget(enemy);
        const toTarget = target
            ? new THREE.Vector3().subVectors(target.position, enemy.position).setY(0)
            : new THREE.Vector3();
        const distance = target ? toTarget.length() : Infinity;

        if (target && distance > 0.01) {
            toTarget.normalize();
            enemy.lookAt(enemy.position.x + toTarget.x, enemy.position.y, enemy.position.z + toTarget.z);
        }

        // Movement: melee closes in, ranged keeps its preferred spacing.
        let moving = false;
        if (target) {
            const preferred = data.keepDistance > 0 ? data.keepDistance : data.range * 0.82;
            if (distance > preferred + 0.35) {
                enemy.position.addScaledVector(toTarget, data.moveSpeed * delta);
                moving = true;
            } else if (data.keepDistance > 0 && distance < preferred - 1.4) {
                enemy.position.addScaledVector(toTarget, -data.moveSpeed * 0.8 * delta);
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
        if (!target) return;
        data.attackTimer -= delta;

        // Telegraph: rear back briefly before the blow lands.
        if (data.attackTimer < 0.35 && data.attackTimer > 0 && distance <= data.range + 0.6) {
            data.windup = 1 - data.attackTimer / 0.35;
            enemy.position.addScaledVector(toTarget, -data.windup * delta * 1.4);
            enemy.scale.setScalar(data.baseScale * (1 + data.windup * 0.14));
        }

        if (data.attackTimer <= 0 && distance <= data.range + 0.4) {
            data.attackTimer = data.attackInterval * (0.85 + Math.random() * 0.3);
            data.windup = 0;

            if (data.style === 'ranged') {
                // Archers loose a real arrow that flies across the mine.
                const from = enemy.position.clone();
                from.y += data.baseY * 0.8;
                const rangedTarget = target;
                this.combatFX.fireArrow(from, () => {
                    if (rangedTarget === this.player) return this.isDown ? null : this.player.position.clone();
                    if (!this.workers.includes(rangedTarget) || rangedTarget.userData.downTimer > 0) return null;
                    return rangedTarget.position.clone();
                }, {
                    color: data.tint,
                    speed: 22,
                    onHit: (impact) => {
                        this.combatFX.spawnSparks(impact, { color: data.tint, count: 10, speed: 4, height: 0 });
                        if (rangedTarget === this.player) this.damagePlayer(data.damage, enemy);
                        else this.damageWorker(rangedTarget, data.damage, enemy);
                    }
                });
                this.pushCombatFeed(`${data.name}이(가) ${target === this.player ? '리더' : '워커'}에게 화살을 쏩니다!`, '#8fe4ff');
            } else {
                // Melee: lunge into the leader with a visible slash.
                const lunge = toTarget.clone().multiplyScalar(0.55);
                enemy.position.add(lunge);
                this.combatFX.spawnSlashArc(
                    enemy.position.clone().addScaledVector(toTarget, 0.9),
                    toTarget,
                    { color: `#${data.tint.toString(16).padStart(6, '0')}`, radius: 1.1, height: data.baseY * 0.9 }
                );
                if (target === this.player) this.damagePlayer(data.damage, enemy);
                else this.damageWorker(target, data.damage, enemy);
            }
        }
    }

    // ---------------------------------------------------- v19 survivor XP
    createXpGem(value) {
        const group = new THREE.Group();
        const amount = Math.max(1, Math.round(value || 1));
        const hue = amount >= 30 ? 0.12 : amount >= 15 ? 0.48 : 0.58;
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(hue, 0.88, 0.64),
            emissive: new THREE.Color().setHSL(hue, 0.9, 0.35),
            emissiveIntensity: 2.0,
            metalness: 0.25,
            roughness: 0.28
        });
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(amount >= 30 ? 0.34 : 0.26, 0), mat);
        gem.rotation.x = 0.4;
        gem.rotation.z = 0.25;
        group.add(gem);
        const halo = new THREE.Mesh(
            new THREE.TorusGeometry(amount >= 30 ? 0.46 : 0.36, 0.035, 6, 20),
            new THREE.MeshBasicMaterial({ color: mat.color, transparent: true, opacity: 0.7 })
        );
        halo.rotation.x = Math.PI / 2;
        group.add(halo);
        group.userData = { type: 'xpGem', xp: amount, age: 0, baseY: 0.45, phase: Math.random() * Math.PI * 2 };
        return group;
    }

    spawnXpGem(position, value) {
        const gem = this.createXpGem(value);
        gem.position.copy(position);
        gem.position.y = 0.45;
        this.scene.add(gem);
        this.xpGems.push(gem);
        return gem;
    }

    getLevelUpChoices() {
        const defs = [
            { id: 'lightning', icon: '⚡', title: '천둥폭우 강화', desc: '번개 피해 +28%', apply: () => { this.skillLevels.lightning = Math.min(8, this.skillLevels.lightning + 1); } },
            { id: 'nova', icon: '✦', title: '대폭발 강화', desc: '폭발 범위 +18% · 피해 +12%', apply: () => { this.skillLevels.nova = Math.min(8, this.skillLevels.nova + 1); } },
            { id: 'meteor', icon: '☄', title: '지옥 운석 강화', desc: '운석 피해 +30%', apply: () => { this.skillLevels.meteor = Math.min(8, this.skillLevels.meteor + 1); } },
            { id: 'haste', icon: '⏱', title: '마력 가속', desc: '모든 스킬 쿨타임 -10%', apply: () => { this.skillCooldownMultiplier = Math.max(0.45, (this.skillCooldownMultiplier || 1) * 0.9); } },
            { id: 'magnet', icon: '🧲', title: '마력 자석', desc: '경험치 획득 범위 +2.2m', apply: () => { this.xpMagnetRadius += 2.2; } },
            { id: 'vitality', icon: '💚', title: '슬라임 활력', desc: '최대 HP +15 · 즉시 회복', apply: () => { this.maxPlayerHp += 15; this.playerData.hp = Math.min(this.maxPlayerHp, this.playerData.hp + 15); } },
            { id: 'fury', icon: '🔥', title: '전투 본능', desc: '기본 공격력 +8%', apply: () => { this.attackPower = Math.round(this.attackPower * 1.08); } },
        ];
        const pool = defs.slice().sort(() => Math.random() - 0.5);
        // Avoid offering an already maxed skill when alternatives exist.
        const filtered = pool.filter((d) => !['lightning','nova','meteor'].includes(d.id) || this.skillLevels[d.id] < 8);
        return (filtered.length >= 3 ? filtered : pool).slice(0, 3).map(d => ({ id: d.id, icon: d.icon, title: d.title, desc: d.desc }));
    }

    gainPlayerXp(amount) {
        if (this.isDown) return;
        let xp = Math.max(0, Number(amount) || 0);
        if (!xp) return;
        this.playerXp += xp;
        while (this.playerXp >= this.playerXpNext && !this.levelUpPending) {
            this.playerXp -= this.playerXpNext;
            this.playerLevel += 1;
            this.playerXpNext = Math.round(24 + (this.playerLevel - 1) * 13 + Math.pow(this.playerLevel - 1, 1.25) * 2.5);
            this.levelUpPending = true;
            this.levelUpChoices = this.getLevelUpChoices();
            this.pushCombatFeed(`✨ 레벨 ${this.playerLevel}! 스킬을 선택하세요.`, '#ffe39a');
            this.app.ui.showLevelUp?.({ level: this.playerLevel, xp: this.playerXp, next: this.playerXpNext, choices: this.levelUpChoices });
            break;
        }
        this.persist();
    }

    claimLevelUp(choiceId) {
        if (!this.levelUpPending) return { ok: false, reason: '레벨업 선택이 없습니다.' };
        const choice = this.levelUpChoices.find(c => c.id === choiceId);
        if (!choice) return { ok: false, reason: '잘못된 선택입니다.' };
        const defs = this.getLevelUpChoices().concat([]); // descriptions only; apply by id below
        const apply = {
            lightning: () => { this.skillLevels.lightning = Math.min(8, this.skillLevels.lightning + 1); },
            nova: () => { this.skillLevels.nova = Math.min(8, this.skillLevels.nova + 1); },
            meteor: () => { this.skillLevels.meteor = Math.min(8, this.skillLevels.meteor + 1); },
            haste: () => { this.skillCooldownMultiplier = Math.max(0.45, (this.skillCooldownMultiplier || 1) * 0.9); },
            magnet: () => { this.xpMagnetRadius += 2.2; },
            vitality: () => { this.maxPlayerHp += 15; this.playerData.hp = Math.min(this.maxPlayerHp, this.playerData.hp + 15); },
            fury: () => { this.attackPower = Math.round(this.attackPower * 1.08); }
        }[choice.id];
        if (apply) apply();
        this.levelUpPending = false;
        this.levelUpChoices = [];
        this.pushCombatFeed(`${choice.icon} ${choice.title} 선택!`, '#d8b8ff');
        this.persist();
        return { ok: true };
    }

    updateXpGems(delta) {
        if (!this.xpGems.length || !this.player) return;
        const magnet = Math.max(1.5, this.xpMagnetRadius || 3.2);
        this.xpGems.slice().forEach((gem) => {
            if (!this.xpGems.includes(gem)) return;
            const d = gem.position.distanceTo(this.player.position);
            gem.userData.age += delta;
            gem.rotation.y += delta * 3.5;
            gem.position.y = 0.45 + Math.sin(gem.userData.age * 5 + gem.userData.phase) * 0.16;
            const collectRadius = magnet + (this.arenaActive ? 1.5 : 0);
            if (d < collectRadius) {
                const dir = new THREE.Vector3().subVectors(this.player.position, gem.position).setY(0);
                if (dir.lengthSq() > 0.01) {
                    dir.normalize();
                    gem.position.addScaledVector(dir, Math.min(delta * 14, d));
                }
            }
            if (d < 0.95) {
                const xp = gem.userData.xp || 1;
                this.scene.remove(gem);
                this.xpGems = this.xpGems.filter(g => g !== gem);
                this.gainPlayerXp(xp);
                this.combatFX.spawnBurst(this.player.position, { color: 0x8fe8ff, radius: 0.25, expand: 1.8, life: 0.22, height: 0.6 });
            }
        });
    }

    // ---------------------------------------------------------------- skills / VFX
    /** v17: three big active skills designed to read instantly in the arena. */
    castSkill(skillId) {
        if (this.isDown || this.mineEvent || !this.autoCombat) return { ok: false, reason: '전투 중에만 스킬을 사용할 수 있습니다.' };
        if (!this.arenaActive && this.enemies.filter(e => !e.userData.dying).length === 0) {
            return { ok: false, reason: '주변에 적이 없습니다.' };
        }
        if (!(skillId in this.skillCooldowns)) return { ok: false, reason: '알 수 없는 스킬입니다.' };
        if (this.skillCooldowns[skillId] > 0) return { ok: false, reason: `${this.getSkillName(skillId)} 재사용 대기 중입니다.` };

        const live = this.enemies.filter(e => !e.userData.dying && (!this.arenaActive || e.userData.isArenaEnemy));
        if (!live.length) return { ok: false, reason: '주변에 적이 없습니다.' };

        const p = this.player.position.clone();
        const color = skillId === 'lightning' ? 0x8fe8ff : skillId === 'nova' ? 0xb98cff : 0xff8a4d;
        const power = this.getTotalAttack();
        const cooldownMult = this.skillCooldownMultiplier || 1;
        const lightningLv = this.skillLevels.lightning || 1;
        const novaLv = this.skillLevels.nova || 1;
        const meteorLv = this.skillLevels.meteor || 1;

        if (skillId === 'lightning') {
            const targets = live.sort((a,b) => p.distanceTo(a.position)-p.distanceTo(b.position)).slice(0, 6);
            this.combatFX.spawnSkillCast(p, { color: 0x8fe8ff, type: 'lightning', radius: 1.6, life: 0.65 });
            targets.forEach((enemy, i) => {
                const strike = enemy.position.clone();
                this.combatFX.spawnLightningStrike(strike, { color: 0x9ff6ff, delay: i * 0.045, height: enemy.userData.baseY });
                setTimeout(() => {
                    if (!enemy.userData.dying) this.damageEnemy(enemy, Math.round(power * 1.05 * (1 + (lightningLv - 1) * 0.28)), { color: '#9ff6ff', knockback: 0.9, from: p });
                }, i * 45);
            });
            this.combatFX.spawnShockwave(p, { color: 0x8fe8ff, scale: 4.5, life: 0.45 });
            this.app.addShake(0.65);
            this.pushCombatFeed('⚡ 천둥폭우 발동!', '#9ff6ff');
        } else if (skillId === 'nova') {
            const radius = 6.2 * (1 + (novaLv - 1) * 0.18);
            this.combatFX.spawnSkillNova(p, { color: 0xc58cff, radius, life: 0.75 });
            live.forEach(enemy => {
                const d = p.distanceTo(enemy.position);
                if (d <= radius) this.damageEnemy(enemy, Math.round(power * 1.45 * (1 + (novaLv - 1) * 0.12)), { color: '#d6b5ff', knockback: 3.2, from: p });
            });
            this.combatFX.spawnSparks(p, { color: 0xe2c8ff, count: 48, speed: 10, life: 0.85, height: 0.7 });
            this.combatFX.spawnFlash(p, 0xc58cff, 100, 0.5);
            this.app.addShake(0.95);
            this.pushCombatFeed('✦ 슬라임 대폭발!', '#d8b8ff');
        } else if (skillId === 'meteor') {
            const target = this.playerTarget && !this.playerTarget.userData.dying
                ? this.playerTarget : live.sort((a,b) => p.distanceTo(a.position)-p.distanceTo(b.position))[0];
            const impact = target.position.clone();
            const radius = 4.5;
            this.combatFX.spawnMeteor(impact, { color: 0xff8a4d, radius, life: 1.0 });
            live.forEach(enemy => {
                if (impact.distanceTo(enemy.position) <= radius) this.damageEnemy(enemy, Math.round(power * 2.6 * (1 + (meteorLv - 1) * 0.30)), { color: '#ffd08a', crit: true, knockback: 2.6, from: impact });
            });
            this.combatFX.spawnShockwave(impact, { color: 0xff5b35, scale: 11, life: 0.75 });
            this.combatFX.spawnSparks(impact, { color: 0xffd28a, count: 64, speed: 13, life: 1.0, height: 0.8 });
            this.combatFX.spawnFlash(impact, 0xff7040, 150, 0.7);
            this.app.addShake(1.4);
            this.pushCombatFeed('☄️ 지옥 운석 낙하!', '#ffb36b');
        }

        this.skillCooldowns[skillId] = this.skillMaxCooldowns[skillId] * cooldownMult;
        this.persist();
        return { ok: true };
    }

    getSkillName(skillId) {
        return ({ lightning: '천둥폭우', nova: '슬라임 대폭발', meteor: '지옥 운석' })[skillId] || '스킬';
    }

    getSkillData() {
        return {
            lightning: Math.max(0, this.skillCooldowns.lightning),
            nova: Math.max(0, this.skillCooldowns.nova),
            meteor: Math.max(0, this.skillCooldowns.meteor),
            max: { ...this.skillMaxCooldowns },
            levels: { ...this.skillLevels },
            cooldownMultiplier: this.skillCooldownMultiplier || 1
        };
    }

    /** Leader auto-combat: pick a target, close in, and strike on cooldown. */
    updatePlayerCombat(delta) {
        this.playerAttackTimer = Math.max(0, this.playerAttackTimer - delta);
        this.dodgeCooldown = Math.max(0, this.dodgeCooldown - delta);
        Object.keys(this.skillCooldowns).forEach((key) => {
            this.skillCooldowns[key] = Math.max(0, this.skillCooldowns[key] - delta);
        });
        if (this.dodgeTimer > 0) {
            this.dodgeTimer = Math.max(0, this.dodgeTimer - delta);
            const step = Math.min(delta * this.dodgeSpeed, 0.8);
            this.player.position.addScaledVector(this.dodgeVector, step);
            this.player.position.y = this.player.userData.baseY || 0.5;
            this.player.scale.setScalar((this.player.userData.baseScale || 1.25) * (1 + this.dodgeTimer * 0.45));
            this.playerData.targetPos.copy(this.player.position);
            this.updateWeaponPose(delta, true);
            return true;
        }

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
     * Formal defence waves stay opt-in: the player chooses when to start one
     * from the menu. (Ambient field monsters are a separate, lighter system —
     * see updateFieldEncounters — that does interrupt free mining on a timer,
     * by design: auto-combat should have something to react to.)
     */
    updateWaves(delta) {
        if (this.arenaActive) {
            this.updateCombatArena(delta);
            return;
        }
        if (!this.canRunWaves()) return;
        if (!this.waveActive) return;

        const living = this.enemies.filter((enemy) => !enemy.userData.dying).length;
        if (living === 0) {
            if (this.quest.stage === 'recruit') return;
            this.waveActive = false;
            if (this.finalBossActive) {
                this.resolveFinalBossVictory();
                return;
            }
            if (this.quest.stage === 'waveDefense' && !this.quest.rewardReady) {
                this.quest.rewardReady = true;
                this.pushCombatFeed('퀘스트 목표 달성! 웨이브를 막아냈습니다. 보상을 받으세요.', '#8fd9a8');
            }
            this.pushCombatFeed(`웨이브 ${this.wave} 격퇴! 보상을 선택하세요.`, '#8fd9a8');
            this.app.multiplayer.broadcastEvent?.('wave_clear', { wave: this.wave });
            // Lock the next wave right away, then let the clear banner land
            // before the reward cards slide in.
            const clearedWave = this.wave;
            this.rewardPending = { wave: clearedWave, choices: this.buildRewardChoices(clearedWave) };
            setTimeout(() => this.offerWaveReward(clearedWave), 1400);
            this.app.ui.showWaveCleared(this.wave);
            this.persist();
        }
    }

    // --------------------------------------------------------- surface boss
    // The garrison guarding the surface: one heavily scaled overlord plus a
    // small escort. Beating it is what actually "finishes" a shaft — clearing
    // it just opens the endless wave grind (and NG+ reopen) that follows.
    startFinalBossWave() {
        if (this.finalBossActive || this.surfaceConquered || this.depth > 0) return;
        this.finalBossActive = true;
        this.waveActive = true;
        this.wave = Math.max(1, this.wave);
        this.enterCombatArena(this.wave, { boss: true, duration: 9999 });

        const boss = this.spawnEnemy('overlord', { distance: 8.5, angle: Math.PI / 2, origin: new THREE.Vector3() });
        if (boss) {
            const scaled = scaleEnemyStats(ENEMY_TYPES.overlord, this.wave + 6);
            boss.userData.hp = Math.round(scaled.hp * 1.6 * (1 + this.cycle * 0.25));
            boss.userData.maxHp = boss.userData.hp;
            boss.userData.damage = Math.round(scaled.damage * 1.3 * (1 + this.cycle * 0.15));
            boss.userData.name = '광산 점령자';
            boss.userData.isFinalBoss = true;
            boss.userData.bossPhase = 1;
            boss.userData.bossSummonCooldown = 5.0;
            boss.userData.bossHazardCooldown = 8.0;
        }
        this.spawnEnemy('brute', { distance: 6.5, angle: Math.PI / 2 - 1.3, origin: new THREE.Vector3() });
        this.spawnEnemy('brute', { distance: 6.5, angle: Math.PI / 2 + 1.3, origin: new THREE.Vector3() });

        this.waveEnemyTotal = this.enemies.length;
        this.app.ui.showBanner('⚔ 광산 점령전', '지상을 지키는 세력을 물리치세요!', '#ff7a4a');
        this.pushCombatFeed('⚔ 광산 점령자가 나타났습니다!', '#ff7a4a');
        this.persist();
    }

    /** The surface garrison is down: hand out a real reward and reopen the shaft. */
    resolveFinalBossVictory() {
        this.finalBossActive = false;
        this.waveActive = false;
        this.surfaceConquered = true;
        this.arenaActive = false;
        this.exitCombatArena();
        const bonusGold = 40 + (this.cycle + 1) * 10;
        const bonusMithril = 6 + (this.cycle + 1) * 2;
        this.inventory.gold += bonusGold;
        this.inventory.mithril += bonusMithril;
        this.attackPower += 5;
        this.bossRewardPending = {
            cycle: this.cycle + 1,
            choices: this.getBossRewardChoices()
        };
        this.app.ui.showBanner('★ 광산 점령 완료', `금광석 ${bonusGold} · 미스릴 ${bonusMithril} · 공격력 +5`, '#ffe39a');
        this.pushCombatFeed('★ 보스를 쓰러뜨렸습니다! 이제 보스 유물을 하나 선택하세요.', '#ffe39a');
        this.persist();
        setTimeout(() => this.app.ui.showBossReward?.(this.getBossRewardData()), 700);
    }

    /** Reopens a fresh, harder shaft at B30F after a surface conquest. */
    startNextCycle() {
        this.depth = this.startDepth;
        this.deepestReached = this.startDepth;
        this.floorNodesCleared = 0;
        this.surfaceConquered = false;
        this.floorTheme = FLOOR_THEMES[this.depth] || null;

        this.nodes.forEach((node) => this.scene.remove(node));
        this.nodes = [];
        this.chests.forEach((chest) => this.scene.remove(chest));
        this.chests = [];
        this.playerData.miningTarget = null;

        const count = this.getFloorNodeCount();
        for (let i = 0; i < count; i++) this.spawnNode();
        this.applyDepthAtmosphere();

        this.app.ui.showBanner('⛏ 새로운 광산', `${this.cycleModifier?.icon || '⚠'} ${this.cycleModifier?.name || '새로운 변형'} · ${this.cycleModifier?.desc || '더 단단해진 광산'}`, '#8fe4ff');
        this.pushCombatFeed(`⛏ 정복을 마치고 새로운 광산으로 다시 내려갑니다. ${this.cycleModifier?.icon || ''} ${this.cycleModifier?.name || ''}`, '#8fe4ff');
        this.persist();
    }

    // -------------------------------------------------- ambient field mobs
    // While the leader is out mining free-form (no formal wave running), a
    // lone monster — or a small pack, deeper down — wanders in on a randomised
    // timer. Auto-combat (on by default) simply reacts to it like any other
    // enemy; nothing here touches the wave/reward flow above.
    updateFieldEncounters(delta) {
        if (this.eventCooldown > 0) this.eventCooldown = Math.max(0, this.eventCooldown - delta);
        if (this.quest.stage === 'coal' || this.quest.stage === 'recruit') return;
        if (this.waveActive || this.isDown) return;

        // Mining noise decays while the crew is idle. Several workers hitting
        // seams at once therefore make an encounter arrive much sooner.
        const activeMiners = this.workers.filter((worker) => worker.userData.isMining).length
            + (this.player?.userData.isMining ? 1 : 0);
        this.retreatTimer = Math.max(0, (this.retreatTimer || 0) - delta);
        const decay = this.retreatTimer > 0
            ? 7.5
            : activeMiners > 0 ? 0.75 : 2.4;
        this.miningNoise = Math.max(0, (this.miningNoise || 0) - delta * decay);
        this.miningDangerFlash = Math.max(0, (this.miningDangerFlash || 0) - delta);

        if (this.fieldEncounterTimer === undefined || this.fieldEncounterTimer === null) {
            this.fieldEncounterTimer = this.rollFieldEncounterDelay();
        }
        this.fieldEncounterTimer -= delta;
        if (this.fieldEncounterTimer > 0) return;

        const activeFieldEnemies = this.enemies.filter((enemy) => enemy.userData.isFieldEnemy && !enemy.userData.dying).length;
        if (activeFieldEnemies >= 2) {
            this.fieldEncounterTimer = 7;
            return;
        }

        this.spawnFieldEncounter();
        // A successful ambush clears some pressure, but not all of it: the mine
        // should remain dangerous if the player immediately resumes mining.
        this.miningNoise *= 0.38;
        this.fieldEncounterTimer = this.rollFieldEncounterDelay();
    }

    // Base pressure is intentionally short enough to matter. High mining noise
    // compresses the timer further, making greed visibly dangerous.
    rollFieldEncounterDelay() {
        const tightening = Math.min(14, this.getFloorsClimbed() * 0.45);
        const noisePressure = Math.min(22, (this.miningNoise || 0) * 0.22);
        const modifier = this.cycleModifier?.encounterMult || 1;
        return Math.max(5.5, ((22 - tightening - noisePressure) + Math.random() * 18) * modifier);
    }

    addMiningNoise(amount = 1) {
        const relicNoiseMult = this.bossRelics.reduce((m, r) => m * (r.noiseMult || 1), 1);
        const cycleNoiseMult = this.cycleModifier?.noiseMult || 1;
        this.miningNoise = Math.min(100, (this.miningNoise || 0) + amount * relicNoiseMult * cycleNoiseMult);
        if (this.miningNoise >= 70 && this.miningDangerFlash <= 0) {
            this.miningDangerFlash = 4;
            this.pushCombatFeed(`🚨 채굴 소음 ${Math.round(this.miningNoise)}% — 몬스터가 몰려옵니다!`, '#ff7a4a');
            this.app.ui.showBanner('🚨 광산 소음 경보', '계속 캐면 습격 위험이 크게 올라갑니다!', '#ff7a4a');
        } else if (this.miningNoise >= 40 && this.miningDangerFlash <= 0) {
            this.miningDangerFlash = 4;
            this.pushCombatFeed(`⚠ 채굴 소음 ${Math.round(this.miningNoise)}% — 주변이 시끄러워졌습니다.`, '#ffd166');
        }
    }

    spawnFieldEncounter() {
        const climbed = this.getFloorsClimbed();
        const pool = climbed < 6 ? ['crawler']
            : climbed < 14 ? ['crawler', 'archer']
            : ['crawler', 'archer', 'brute'];
        const count = climbed >= 6 && Math.random() < 0.5 ? 2 : 1;
        // Ties field difficulty to depth climbed rather than the wave counter,
        // which can still be 0 for a leader who never started a defence run.
        const waveOverride = Math.max(1, Math.round(climbed * 0.9));

        for (let i = 0; i < count; i++) {
            const typeId = pool[Math.floor(Math.random() * pool.length)];
            const angle = Math.random() * Math.PI * 2;
            this.spawnEnemy(typeId, { angle, distance: 13 + Math.random() * 5, isFieldEnemy: true, waveOverride });
        }
        this.pushCombatFeed('⚠ 몬스터가 접근합니다!', '#ff9c9c');
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
    // How large the squad is allowed to grow by a given cleared wave. Keeps
    // the early game from being handed a full squad in a few clears; the
    // player still has to choose the recruit card each time it appears.
    getWorkerSoftCap(wave) {
        return Math.min(this.getWorkerCap(), 1 + Math.floor(wave / 2));
    }

    buildRewardChoices(wave) {
        const tier = Math.max(1, wave);
        const hardness = this.getDepthHardness();
        // Mini-boss waves pay out noticeably better across the board.
        const eliteMult = isEliteWave(wave) ? 1.6 : 1;

        // 1) Ore bundle — immediate crafting/upgrade fuel.
        const coal = Math.round((14 + tier * 6) * eliteMult);
        const iron = Math.round((7 + tier * 4) * eliteMult);
        const gold = Math.round(Math.max(1, Math.floor(tier * 1.6)) * eliteMult);
        const mithril = Math.round((tier >= 4 ? Math.max(1, Math.floor(tier / 4)) : 0) * eliteMult);
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
        const hpGain = Math.round((12 + tier * 3) * eliteMult);

        // 3) Worker squad upgrade — pays off in the next defence run.
        const workerAtk = 0.18 * eliteMult;
        const workerMine = 0.12 * eliteMult;

        const choices = [
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
            },
            // 4) Trait reroll ticket — a stockpiled way back into the wider
            // trait catalogue, since the leader only ever carries one trait.
            {
                id: 'trait_reroll',
                icon: '🎲',
                color: '#9ff3e0',
                title: '특성 변경권',
                summary: `특성 변경권 +1 (보유 ${this.traitRerollTickets || 0}장)`,
                benefit: '지금 태생 특성이 아쉽다면, 나중에 원할 때 다른 특성으로 바꿀 수 있는 티켓을 모아둡니다. 리더 상태 창에서 사용합니다.',
                payload: {}
            }
        ];

        // Only offered while the squad is under its wave-paced soft cap, so a
        // new worker is always a deliberate pick rather than a random drop.
        if (this.workers.length < this.getWorkerSoftCap(wave)) {
            choices.push({
                id: 'recruit',
                icon: '🐌',
                color: '#8fd9a8',
                title: '워커 슬라임 영입',
                summary: `워커 +1명 (현재 ${this.workers.length}명)`,
                benefit: '새 워커 슬라임이 분대에 합류합니다. 채굴이든 방어든, 다음 명령에 바로 투입할 수 있습니다.',
                payload: {}
            });
        }

        return choices;
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
        } else if (choice.id === 'trait_reroll') {
            this.traitRerollTickets = (this.traitRerollTickets || 0) + 1;
            this.pushCombatFeed(`보상 획득: 특성 변경권 +1 (보유 ${this.traitRerollTickets}장)`, '#9ff3e0');
        } else if (choice.id === 'recruit') {
            if (this.addWorker()) {
                this.pushCombatFeed(`보상 획득: ${choice.summary}`, '#8fd9a8');
            }
        }

        this.persist();
        return { ok: true };
    }

    /**
     * Player-initiated mine defence. Returns a result object so the UI can
     * explain why a run could not start.
     */
    // The scripted recruit-quest skirmish runs through the same wave
    // machinery, so it is always allowed; real defence waves (including the
    // "defend a wave" tutorial quest) only open once the leader has climbed
    // to B24F or below.
    canRunWaves() {
        return this.quest.stage === 'recruit'
            || ((this.quest.stage === 'waveDefense' || this.quest.stage === 'complete') && this.depth <= 24);
    }

    startDefenceWave(waveOverride = null) {
        if (!this.canRunWaves()) {
            const reason = (this.quest.stage === 'waveDefense' || this.quest.stage === 'complete')
                ? `지하 24층부터 광산 방어를 시작할 수 있습니다. 현재 ${this.getFloorLabel()}`
                : '아직 광산 방어를 시작할 수 없습니다. 퀘스트를 먼저 진행하세요.';
            return { ok: false, reason };
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

        const nextWave = waveOverride ?? (this.waveFailed ? Math.max(1, this.wave) : (Math.max(0, this.wave) + 1));
        this.waveFailed = false;
        this.waveEnemyTotal = getWaveComposition(nextWave).reduce((sum, [, count]) => sum + count, 0);
        this.startWave(nextWave);
        this.app.multiplayer.broadcastEvent?.('wave_start', { wave: nextWave });
        return { ok: true, wave: nextWave };
    }

    /** Highest wave the player may jump straight to (cleared waves + 1). */
    getMaxSelectableWave() {
        return this.waveFailed ? Math.max(1, this.wave) : Math.max(1, this.wave + 1);
    }

    getBossRewardChoices() {
        const cycle = this.cycle || 0;
        return [
            { id: 'heart_of_the_mine', icon: '💠', title: '광산의 심장', color: '#8fe4ff', summary: '영구 유물 · 공격력 +10%', benefit: '모든 후속 광산에서 리더의 기본 공격력이 10% 증가합니다.', relic: { id: 'heart_of_the_mine', name: '광산의 심장', icon: '💠', attackMult: 1.10 } },
            { id: 'prospector_crown', icon: '👑', title: '탐광왕의 왕관', color: '#ffe39a', summary: '영구 유물 · 희귀 광석 +18%', benefit: '금광석·미스릴이 나올 확률이 크게 증가합니다. 대신 채굴 소음이 8% 더 빠르게 쌓입니다.', relic: { id: 'prospector_crown', name: '탐광왕의 왕관', icon: '👑', rareMult: 1.18, noiseMult: 1.08 } },
            { id: 'guardian_core', icon: '🛡', title: '수호자의 핵', color: '#9ad9b0', summary: '영구 유물 · 워커 HP +20%', benefit: '모든 워커의 최대 HP가 20% 증가합니다. 구조와 방어가 쉬워집니다.', relic: { id: 'guardian_core', name: '수호자의 핵', icon: '🛡', workerHpMult: 1.20 } }
        ];
    }

    getCycleModifier() {
        const mods = [
            { id: 'hard_rock', icon: '🪨', name: '압축 암반', desc: '광맥의 채굴 난이도 +18%', hardnessMult: 1.18 },
            { id: 'monster_nest', icon: '👹', name: '괴물 둥지', desc: '습격 주기가 짧아집니다.', encounterMult: 0.72 },
            { id: 'rich_seams', icon: '💎', name: '풍요의 광맥', desc: '희귀 광석 확률 +22%, 채굴 소음 +12%', rareMult: 1.22, noiseMult: 1.12 },
            { id: 'volatile_mine', icon: '💥', name: '불안정 광산', desc: '욕심 보너스 +35%, 사망 시 불안정 보너스 전부 소실', greedMult: 1.35 }
        ];
        return mods[Math.floor(Math.random() * mods.length)];
    }

    getBossRewardData() {
        if (!this.bossRewardPending) return null;
        return { ...this.bossRewardPending, choices: this.bossRewardPending.choices.map(c => ({ ...c })) };
    }

    claimBossReward(choiceId) {
        const pending = this.bossRewardPending;
        if (!pending || !pending.choices) return { ok: false, reason: '선택할 보상이 없습니다.' };
        const choice = pending.choices.find(c => c.id === choiceId);
        if (!choice) return { ok: false, reason: '잘못된 보상입니다.' };
        const relic = choice.relic;
        if (!this.bossRelics.some(r => r.id === relic.id)) this.bossRelics.push({ ...relic });
        const gainedLegacy = 25 + this.cycle * 5;
        this.meta.legacyPoints = (this.meta.legacyPoints || 0) + gainedLegacy;
        saveMeta(this.profileId, this.meta);
        this.bossRewardPending = null;
        this.cycle += 1;
        this.cycleModifier = this.getCycleModifier();
        this.app.ui.closeBossReward?.();
        this.app.ui.showBanner('★ 유물 획득', `${relic.icon} ${relic.name} · 유산 포인트 +${gainedLegacy}`, '#ffe39a');
        this.pushCombatFeed(`★ 보스 유물 획득: ${relic.name}`, '#ffe39a');
        this.pushCombatFeed(`⚠ 다음 사이클 변형: ${this.cycleModifier.icon} ${this.cycleModifier.name}`, '#ffb3a6');
        this.persist();
        setTimeout(() => this.startNextCycle(), 1800);
        return { ok: true };
    }

    getCombatData() {
        const target = this.playerTarget && this.enemies.includes(this.playerTarget) && !this.playerTarget.userData.dying
            ? this.playerTarget
            : null;
        return {
            auto: this.autoCombat,
            autoMine: this.autoMine,
            isDown: this.isDown,
            reviveIn: this.isDown ? Math.max(0, this.deathTimer) : 0,
            wave: Math.max(0, this.wave),
            waveActive: this.waveActive,
            // Menu state: waves are opt-in, so the UI needs to know whether a
            // defence run can be launched right now and which wave is next.
            canStartWave: !this.waveActive && !this.isDown && !this.rewardPending && this.canRunWaves(),
            rewardPending: !!this.rewardPending,
            waveUnlocked: this.canRunWaves(),
            nextWave: this.waveFailed ? Math.max(1, this.wave) : Math.max(0, this.wave) + 1,
            waveFailed: !!this.waveFailed,
            maxSelectableWave: this.getMaxSelectableWave(),
            miningNoise: Math.round(this.miningNoise || 0),
            unstableHaul: Math.round(this.unstableHaul || 0),
            greedSeams: this.greedSeams || 0,
            retreating: (this.retreatTimer || 0) > 0,
            retreatIn: Math.max(0, this.retreatTimer || 0),
            enemiesLeft: this.enemies.filter((enemy) => !enemy.userData.dying).length,
            workersDown: this.workers.filter((worker) => worker.userData.downTimer > 0).length,
            attackInterval: this.getPlayerAttackInterval(),
            dodgeCooldown: Math.max(0, this.dodgeCooldown || 0),
            dodgeReady: !this.isDown && !this.mineEvent && (this.dodgeCooldown || 0) <= 0,
            bossRewardPending: !!this.bossRewardPending,
            bossRelics: this.bossRelics.map(r => ({ ...r })),
            cycleModifier: this.cycleModifier ? { ...this.cycleModifier } : null,
            arenaActive: !!this.arenaActive,
            arenaTime: Math.max(0, this.arenaTime || 0),
            arenaDuration: this.arenaDuration || 90,
            arenaKills: this.arenaKills || 0,
            arenaEnemies: this.enemies.filter((enemy) => enemy.userData.isArenaEnemy && !enemy.userData.dying).length,
            arenaSpawnCount: this.arenaSpawnCount || 0,
            finalBoss: !!this.finalBossActive,
            dodging: (this.dodgeTimer || 0) > 0,
            skills: this.getSkillData(),
            playerLevel: this.playerLevel,
            playerXp: this.playerXp,
            playerXpNext: this.playerXpNext,
            levelUpPending: !!this.levelUpPending,
            skillLevels: { ...this.skillLevels },
            skillCooldownMultiplier: this.skillCooldownMultiplier || 1,
            target: target
                ? {
                    name: target.userData.name,
                    hp: Math.max(0, target.userData.hp),
                    maxHp: target.userData.maxHp,
                    elite: target.userData.elite,
                    eliteAffix: target.userData.eliteAffix || null,
                    eliteAffixName: target.userData.eliteAffixName || '',
                    eliteAffixDesc: target.userData.eliteAffixDesc || '',
                    isFinalBoss: !!target.userData.isFinalBoss,
                    bossPhase: target.userData.bossPhase || target.userData.phase || 1,
                    pattern: target.userData.pattern || 'basic',
                    patternState: target.userData.patternState || 'ready',
                    patternWindup: Math.max(0, target.userData.patternWindup || 0),
                    enraged: !!target.userData.enraged
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
        const relicAttackMult = this.bossRelics.reduce((m, r) => m * (r.attackMult || 1), 1);
        return (this.attackPower + (this.equipped?.stats.attack || 0)) * relicAttackMult;
    }

    // Weapon crit and accessory crit stack the same way trait crit does.
    getEquipmentCrit() {
        return (this.equipped?.stats.crit || 0) + (this.equippedAccessory?.stats.crit || 0);
    }

    // Extra lifesteal chance granted by an accessory, additive with traits.
    getEquipmentLifesteal() {
        return (this.equipped?.stats.lifesteal || 0) + (this.equippedAccessory?.stats.lifesteal || 0);
    }

    // A legendary-only weapon option: a flat chance per hit to also blast the
    // target with a bonus magic burst, on top of the normal strike.
    getSpellProcChance() {
        return this.equipped?.stats.spellProcChance || 0;
    }

    // A legendary-only armor option: a flat chance to shrug off a hit entirely.
    getBlockChance() {
        return this.equippedArmor?.stats.blockChance || 0;
    }

    // Max HP bonus from every equipped slot combined.
    getGearHpBonus() {
        return (this.equipped?.stats.hp || 0)
            + (this.equippedArmor?.stats.hp || 0)
            + (this.equippedAccessory?.stats.hp || 0);
    }

    // Armor's defense stat converts to a diminishing-returns damage multiplier
    // (defense / (defense + K)), so there is no hard cap to itemize around.
    getDamageReductionMult() {
        const defense = this.equippedArmor?.stats.defense || 0;
        if (defense <= 0) return 1;
        const K = 120;
        return 1 - defense / (defense + K);
    }

    // Recompute max HP from base + traits + equipment so re-equipping is safe.
    refreshMaxHp() {
        const previousMax = this.maxPlayerHp;
        this.maxPlayerHp = this.baseMaxHp + this.traitEffects.maxHpBonus + this.getGearHpBonus();
        if (this.playerData) {
            const delta = this.maxPlayerHp - previousMax;
            this.playerData.hp = Math.max(1, Math.min(this.maxPlayerHp, this.playerData.hp + Math.max(0, delta)));
        }
    }

    // Recipes are keyed by slot+mix since the same blend forges a different
    // item depending on which slot the player was aiming for.
    recipeKeyFor(mix, slot) {
        return `${slot}:${recipeKey(mix)}`;
    }

    // The equipped item currently sitting in a given slot.
    getEquippedForSlot(slot) {
        if (slot === 'armor') return this.equippedArmor;
        if (slot === 'accessory') return this.equippedAccessory;
        return this.equipped;
    }

    setEquippedForSlot(slot, item) {
        if (slot === 'armor') this.equippedArmor = item;
        else if (slot === 'accessory') this.equippedAccessory = item;
        else this.equipped = item;
    }

    // Every distinct ore ratio the player has ever forged is remembered.
    recordRecipe(mix, result, slot) {
        const key = this.recipeKeyFor(mix, slot);
        let entry = this.recipeBook.find((recipe) => recipe.key === key);
        if (!entry) {
            entry = {
                key,
                slot,
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

    craft(mix, slot = 'weapon') {
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

        const result = forgeItem(mix, this.getEffectiveLuck(), slot);
        // Craft-power traits add a flat bonus to whatever comes out of the forge
        // (only meaningful for weapons, which is the only archetype with attack).
        if (this.traitEffects.craftPowerBonus > 0 && result.item.stats.attack) {
            result.item.stats.attack += Math.round(this.traitEffects.craftPowerBonus);
        }

        const entry = this.recordRecipe(mix, result, slot);
        this.totalCrafted = (this.totalCrafted || 0) + 1;

        if (this.quest.stage === 'craft') {
            this.advanceTutorialQuest('reach27', '다음 목표', '지하 27층에 도착하세요.');
        } else if (this.quest.stage === 'craft3' && slot === 'weapon') {
            this.quest.craftCount = (this.quest.craftCount || 0) + 1;
            if (this.quest.craftCount >= 3) {
                this.advanceTutorialQuest('trait25', '다음 목표', '지하 25층 드래곤의 둥지에서 태생 특성을 얻으세요.');
            } else {
                this.persist();
            }
        }

        // Auto-equip only when the new piece is genuinely better than what's
        // currently in that same slot.
        const upgraded = getItemPower(result.item) > getItemPower(this.getEquippedForSlot(slot));
        if (upgraded) {
            this.setEquippedForSlot(slot, result.item);
            this.refreshMaxHp();
            // The held weapon mesh must match the newly equipped item.
            if (slot === 'weapon') this.refreshWeaponMesh();
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
        if (result.item.options?.length > 0) {
            const optionText = result.item.options.map((option) => option.label).join(' · ');
            message += ` 옵션: ${optionText}`;
        }

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

    equipItem(item, slot = item?.slot || 'weapon') {
        if (!item || !item.stats) return false;
        this.setEquippedForSlot(slot, item);
        this.refreshMaxHp();
        if (slot === 'weapon') this.refreshWeaponMesh();
        this.persist();
        return true;
    }

    // Everything the crafting workshop UI needs to render for one slot tab.
    getCraftData(mix, slot = 'weapon') {
        const safeMix = {};
        ORE_KEYS.forEach((ore) => {
            safeMix[ore] = Math.max(0, Math.floor(mix?.[ore] || 0));
        });

        const preview = previewCraft(safeMix, this.getEffectiveLuck(), slot);
        const cost = this.getCraftCost(safeMix);
        const equippedInSlot = this.getEquippedForSlot(slot);

        return {
            slot,
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
            equipped: equippedInSlot,
            baseAttack: this.attackPower,
            totalAttack: this.getTotalAttack(),
            // Curated ratios to try before the player has discovered their
            // own — the actual result still follows the normal archetype/
            // tier rules, so the preview here is what it would really forge.
            defaultRecipes: DEFAULT_RECIPES
                .filter((recipe) => recipe.slot === slot)
                .map((recipe) => ({
                    id: recipe.id,
                    label: recipe.label,
                    note: recipe.note,
                    mix: recipe.mix,
                    preview: previewCraft(recipe.mix, this.getEffectiveLuck(), slot),
                    affordable: this.canAffordMix(recipe.mix)
                })),
            // Recipes saved before armor/accessory existed have no `slot` field
            // and were always weapons, so default missing slots to 'weapon'.
            recipes: this.recipeBook
                .filter((entry) => (entry.slot || 'weapon') === slot)
                .slice()
                .sort((a, b) => getItemPower({ stats: b.bestStats }) - getItemPower({ stats: a.bestStats }))
                .map((entry) => ({
                    key: entry.key,
                    slot: entry.slot || 'weapon',
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

    // ------------------------------------------------------- base facilities
    // A second, permanent ore sink alongside the forge: upgrades that never
    // need re-equipping and use the full coal/iron/gold/mithril spread rather
    // than just the coal+iron the leader-stat shop already drains.
    static FACILITY_CONFIG = {
        // Each level shaves 4% off the mining swing interval.
        miningRig: { maxLevel: 8, speedBonusPerLevel: 0.04 },
        // Each level opens one more worker slot beyond the base cap of 6.
        barracks: { maxLevel: 4, workerCapPerLevel: 1 }
    };

    getFacilityCost(key) {
        const level = this.facilities[key] || 0;
        if (key === 'miningRig') {
            return {
                coal: 20 + level * 22,
                iron: 10 + level * 16,
                gold: level >= 2 ? (level - 1) * 4 : 0,
                mithril: 0
            };
        }
        if (key === 'barracks') {
            return {
                coal: 40 + level * 34,
                iron: 24 + level * 22,
                gold: 6 + level * 8,
                mithril: level >= 2 ? (level - 1) * 3 : 0
            };
        }
        return { coal: 0, iron: 0, gold: 0, mithril: 0 };
    }

    canAffordFacility(key) {
        const config = Game.FACILITY_CONFIG[key];
        if (!config || (this.facilities[key] || 0) >= config.maxLevel) return false;
        const cost = this.getFacilityCost(key);
        return ORE_KEYS.every((ore) => this.inventory[ore] >= (cost[ore] || 0));
    }

    getMiningSpeedFacilityMult() {
        return 1 - this.facilities.miningRig * Game.FACILITY_CONFIG.miningRig.speedBonusPerLevel;
    }

    getWorkerCap() {
        return 6 + this.facilities.barracks * Game.FACILITY_CONFIG.barracks.workerCapPerLevel;
    }

    getFacilitiesData() {
        const describe = (key, label, hint) => {
            const config = Game.FACILITY_CONFIG[key];
            const level = this.facilities[key] || 0;
            return {
                key,
                label,
                hint,
                level,
                maxLevel: config.maxLevel,
                maxed: level >= config.maxLevel,
                cost: this.getFacilityCost(key),
                affordable: this.canAffordFacility(key)
            };
        };
        return [
            describe('miningRig', '채굴 설비 강화', `채굴 속도 영구 +${Math.round(Game.FACILITY_CONFIG.miningRig.speedBonusPerLevel * 100)}%/레벨`),
            describe('barracks', '막사 증축', `워커 정원 +${Game.FACILITY_CONFIG.barracks.workerCapPerLevel}명/레벨 (현재 ${this.getWorkerCap()}명)`)
        ];
    }

    upgradeFacility(key) {
        if (!this.canAffordFacility(key)) return false;
        const cost = this.getFacilityCost(key);
        ORE_KEYS.forEach((ore) => {
            this.inventory[ore] -= (cost[ore] || 0);
        });
        this.facilities[key] = (this.facilities[key] || 0) + 1;
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

        const roleDamageMult = ({ miner: 0.78, fighter: 1.35, guard: 0.92, prospector: 0.72 }[worker.userData.workerRole] || 1);
        const damage = 4 * roleDamageMult * this.traitEffects.workerAttackMult * this.boons.workerAttackMult
            * this.getWorkerLevelMult(worker) * (1 + (this.stats.strength - 1) * 0.18);
        this.damageEnemy(enemy, damage, { from: worker.position, color: '#b7f3ff', knockback: 0.16 });
        this.addWorkerXp(worker, 2);
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

    /** Worker damage is a downed-state system rather than an instant squad loss.
     * A downed worker can be rescued by the leader or a defending squadmate;
     * otherwise it is permanently lost when the bleed-out timer expires.
     */
    damageWorker(worker, amount, source) {
        if (!worker || !this.workers.includes(worker) || worker.userData.downTimer > 0) return;
        const damage = Math.max(1, Math.round(amount));
        worker.userData.hp = Math.max(0, (worker.userData.hp ?? worker.userData.maxHp) - damage);
        // Damage pauses passive worker regeneration for a short moment.
        worker.userData.regenTimer = 4;
        worker.userData.healthBar.visible = true;
        this.updateHealthBar(worker.userData.healthBar, worker.userData.hp / worker.userData.maxHp);
        this.combatFX.spawnDamageNumber(worker.position, damage, { color: '#ffb36b', text: `-${damage}` });
        this.combatFX.spawnFlash(worker.position, 0xff9c5a, 18, 0.2);
        this.app.addShake(0.16);
        if (source) this.pushCombatFeed(`${source.userData.name}이(가) 워커를 공격합니다! -${damage}`, '#ffb36b');
        this.app.ui.showWorkerAlert?.('워커가 공격받고 있습니다!');
        if (worker.userData.hp <= 0) {
            worker.userData.downTimer = 6;
            worker.userData.isMining = false;
            worker.userData.squadRole = 'downed';
            worker.userData.miningTarget = null;
            worker.userData.healthBar.visible = true;
            this.combatFX.spawnBurst(worker.position, { color: 0xff9c5a, radius: 0.45, expand: 2.2, life: 0.45 });
            this.pushCombatFeed('🚑 워커 슬라임이 쓰러졌습니다! 가까이 가서 구조하세요.', '#ffcf8a');
        }
    }

    updateDownedWorker(worker, delta) {
        if (!worker || worker.userData.downTimer <= 0) return false;
        worker.userData.downTimer = Math.max(0, worker.userData.downTimer - delta);
        worker.userData.isMining = false;
        worker.userData.squadRole = 'downed';
        worker.userData.healthBar.visible = true;
        this.updateHealthBar(worker.userData.healthBar, 1);
        const nearLeader = !this.isDown && worker.position.distanceTo(this.player.position) < 3.1;
        const rescuer = this.workers.find(other => other !== worker && other.userData.downTimer <= 0
            && other.position.distanceTo(worker.position) < 2.2
            && other.userData.squadRole === 'defend');
        if (nearLeader || rescuer) {
            worker.userData.hp = Math.round(worker.userData.maxHp * 0.45);
            worker.userData.regenTimer = 3;
            worker.userData.downTimer = 0;
            worker.userData.squadRole = this.squadCommand;
            worker.userData.healthBar.visible = false;
            this.combatFX.spawnShockwave(worker.position, { color: 0x8fd9a8, scale: 2.6 });
            this.bumpQuestStat('rescues', 1);
            this.pushCombatFeed('💚 워커 슬라임을 구조했습니다!', '#8fd9a8');
            return false;
        }
        if (worker.userData.downTimer <= 0) {
            // The survivor arena forces every worker into 'attack' role, so the
            // squadmate-rescue path above can never trigger there. Losing a
            // worker for good just because the arena was too chaotic to reach
            // them in time would feel unfair, so arena downs simply wait —
            // exitCombatArena() patches every still-downed worker back up once
            // the fight ends, win or lose.
            if (this.arenaActive) {
                worker.userData.downTimer = 0.5;
                return true;
            }
            this.combatFX.spawnBurst(worker.position, { color: 0x8b1a1a, radius: 0.55, expand: 2.3, life: 0.5 });
            this.removeWorker(worker);
            this.pushCombatFeed('💀 워커 슬라임을 잃었습니다.', '#ff5a5a');
            return true;
        }
        // Downed workers wobble in place and do not act.
        worker.scale.setScalar((worker.userData.baseScale || 0.9) * 0.72);
        worker.rotation.z = Math.sin(this.elapsed * 9) * 0.12;
        return true;
    }

    updateWorker(worker, index, delta) {
        if (this.updateDownedWorker(worker, delta)) return;

        // v21: workers now recover HP naturally instead of staying injured
        // forever. Taking damage starts a 4s recovery delay; after that they
        // regenerate slowly during combat and faster while the squad is safe.
        const maxHp = worker.userData.maxHp || 1;
        const hp = worker.userData.hp ?? maxHp;
        worker.userData.regenTimer = Math.max(0, (worker.userData.regenTimer || 0) - delta);
        if (hp < maxHp && worker.userData.regenTimer <= 0) {
            const regenRate = this.arenaActive || this.enemies.length > 0 ? 2.5 : 5;
            worker.userData.hp = Math.min(maxHp, hp + delta * regenRate);
            if (worker.userData.healthBar) {
                worker.userData.healthBar.visible = worker.userData.hp < maxHp - 0.5;
                this.updateHealthBar(worker.userData.healthBar, worker.userData.hp / maxHp);
            }
        }

        if (this.mineEvent) {
            worker.userData.isMining = false;
            return;
        }
        const formationAngle = (index / Math.max(1, this.workers.length)) * Math.PI * 2;
        let destination = this.player.position.clone();
        let enemy = null;
        let isMining = false;

        if (this.squadCommand === 'mine') {
            // A monster that wanders within striking distance interrupts mining:
            // the worker fights it off instead of standing there taking hits,
            // then automatically goes back to the same seam once it's clear.
            const threat = this.acquireTarget(worker.position, worker.userData.workerRole === 'guard' ? 8 : 6);
            if (threat) {
                const flank = new THREE.Vector3(Math.cos(formationAngle), 0, Math.sin(formationAngle)).multiplyScalar(1.5);
                destination = threat.position.clone().add(flank);
                if (worker.position.distanceTo(threat.position) < 2.6) this.workerAttack(worker, threat, delta);
            } else {
                // Prefer this worker's own seam. If it was depleted, pick the
                // nearest available node with a light round-robin bias so workers
                // naturally spread across the mine.
                let node = worker.userData.miningTarget;
                if (!node || !this.nodes.includes(node)) {
                    const candidates = this.nodes.slice().sort((a, b) => {
                        const da = worker.position.distanceToSquared(a.position);
                        const db = worker.position.distanceToSquared(b.position);
                        return da - db;
                    });
                    node = candidates.length ? candidates[worker.userData.miningTargetIndex % candidates.length] : null;
                    worker.userData.miningTarget = node;
                }
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
                            const roleMiningMult = ({ miner: 1.35, fighter: 0.72, guard: 0.82, prospector: 0.92 }[worker.userData.workerRole] || 1);
                            const roleNoiseMult = ({ miner: 1.0, fighter: 0.8, guard: 0.7, prospector: 0.65 }[worker.userData.workerRole] || 1);
                            this.addMiningNoise(0.75 * roleNoiseMult);
                            this.addWorkerXp(worker, 1);
                            worker.userData.swingTimer = 0.72 / (this.traitEffects.workerSwingMult
                                * this.boons.workerSwingMult * this.getWorkerLevelMult(worker) * this.getWorkerMiningMult(worker) * roleMiningMult);
                        }
                    }
                }
            }
        } else if (this.squadCommand === 'focus') {
            enemy = this.playerTarget && this.enemies.includes(this.playerTarget) && !this.playerTarget.userData.dying
                ? this.playerTarget : this.acquireTarget(worker.position, 20);
            if (enemy) {
                const flank = new THREE.Vector3(Math.cos(formationAngle), 0, Math.sin(formationAngle)).multiplyScalar(1.5);
                destination = enemy.position.clone().add(flank);
                if (worker.position.distanceTo(enemy.position) < 2.6) this.workerAttack(worker, enemy, delta);
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
            enemy = this.acquireTarget(this.player.position, worker.userData.workerRole === 'guard' ? 10 : 8);
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

        const roleSpeed = ({ miner: 3.8, fighter: 4.5, guard: 3.7, prospector: 4.1 }[worker.userData.workerRole] || 4);
        this.moveWorker(worker, destination, delta, this.squadCommand === 'defend' ? Math.min(roleSpeed, 3.8) : roleSpeed);
        // Fighting workers use the combat flourish; mining workers keep the
        // existing pickaxe loop.
        if (enemy) {
            this.animateWorkerCombat(worker, delta);
        } else {
            this.animateWorkerMining(worker, isMining, delta);
        }
    }

    update(delta) {
        // A stalled tab (backgrounded, GC pause, breakpoint) can hand back a
        // huge delta on the next frame; every per-frame movement/timer below
        // scales with it, so an unclamped spike sends enemies flying off to
        // nowhere in one step. Cap it the same way the camera smoothing does.
        delta = Math.min(delta, 0.1);
        this.elapsed += delta;

        // Periodic autosave keeps progression safe without hammering storage.
        this.saveTimer -= delta;
        if (this.saveTimer <= 0) {
            this.persist();
            this.saveTimer = 5;
        }

        this.updateQuestProgress();
        this.updateWaves(delta);
        this.updateXpGems(delta);
        this.updateFieldEncounters(delta);
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

        // Auto-mine: once free (no target, not fighting) and the toggle is
        // on, keep heading for the nearest ore instead of standing idle —
        // the moment a fight ends this picks right back up on its own.
        if (!this.arenaActive && !inCombat && !this.isDown && this.autoMine && !this.playerData.miningTarget) {
            const nearest = this.findNearestNode(this.player.position);
            if (nearest) {
                this.playerData.miningTarget = nearest;
                this.playerData.targetPos.copy(this.getMiningStandPosition(nearest));
                this.miningHitTimer = 0;
            }
        }

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
        this.clampCombatArenaPositions();

        // Mining logic: stop at the node, visibly swing the pickaxe, and apply
        // one clear impact every few tenths of a second instead of relying on a
        // tiny per-frame damage value. Fighting always interrupts mining.
        let isPlayerMining = false;
        const miningTarget = this.playerData.miningTarget;
        if (!this.mineEvent && !inCombat && !this.isDown && miningTarget && this.nodes.includes(miningTarget)) {
            const dx = this.player.position.x - miningTarget.position.x;
            const dz = this.player.position.z - miningTarget.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 3.1) {
                isPlayerMining = true;
                this.miningHitTimer -= delta;
                if (this.miningHitTimer <= 0) {
                    this.swingAtNode(miningTarget);
                    this.addMiningNoise(1.4);
                    this.miningHitTimer = this.getSwingInterval();
                }
            }
        } else {
            this.miningHitTimer = 0;
        }
        this.animatePlayerMining(isPlayerMining, delta);

        // Only one tool shows at a time: the pickaxe while heading to or
        // working an ore node, the weapon the rest of the time (including
        // combat and standing idle).
        const showsPickaxe = !inCombat && !this.isDown && !!miningTarget && this.nodes.includes(miningTarget);
        if (this.player.userData.pickaxe) this.player.userData.pickaxe.visible = showsPickaxe;
        if (this.weaponArm) this.weaponArm.visible = !showsPickaxe;

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
            this.getDepthData(),
            this.getFacilitiesData(),
            this.getMetaData(),
            this.getWorkerData()
        );
    }

    /** Individual worker growth for the status window's roster line. */
    getWorkerData() {
        const levels = this.workers.map((worker) => this.getWorkerLevel(worker));
        const avgLevel = levels.length > 0
            ? Math.round((levels.reduce((sum, lv) => sum + lv, 0) / levels.length) * 10) / 10
            : 0;
        return {
            count: this.workers.length,
            levels,
            avgLevel,
            downed: this.workers.filter((worker) => worker.userData.downTimer > 0).length,
            roles: this.workers.map((worker) => ({ role: worker.userData.workerRole || 'miner', label: this.getWorkerRoleLabel(worker.userData.workerRole || 'miner') })),
            xp: this.workers.map((worker) => Math.max(0, Math.floor(worker.userData.workerXp || 0))),
            maxLevel: 100,
            promotions: this.workers.map((worker) => ({ tier: worker.userData.workerPromotionTier || 0, talents: { ...(worker.userData.workerTalents || { attack:1, mining:1, hp:1, rare:0 }) } }))
        };
    }

    // Compact loadout summary for the HUD.
    getEquipmentData() {
        return {
            equipped: this.equipped,
            equippedArmor: this.equippedArmor,
            equippedAccessory: this.equippedAccessory,
            tier: this.equipped ? getTierById(this.equipped.tierId) : null,
            baseAttack: Math.round(this.attackPower),
            totalAttack: Math.round(this.getTotalAttack()),
            recipeCount: this.recipeBook.length
        };
    }

    /** Optional post-quota mining. Extra seams create an unstable bonus that is
     * banked by ascending and wiped by a field death. This is the v7 greed loop. */
    addGreedHaul(node, minedOre, amount) {
        if (!this.floorReadyToAscend || this.depth <= 0) return;
        const rarity = this.oreConfig[minedOre]?.rarity || 0;
        const veinRarity = this.oreConfig[node?.userData?.oreType]?.rarity || 0;
        const lucky = rarity > veinRarity;
        const base = 3 + rarity * 4 + Math.min(4, Math.max(0, amount - 1) * 2);
        const bonus = Math.max(2, Math.round(base * (1 + this.greedSeams * 0.12) * (this.cycleModifier?.greedMult || 1)));
        this.unstableHaul = Math.min(999, (this.unstableHaul || 0) + bonus);
        this.greedSeams = (this.greedSeams || 0) + 1;
        this.bumpQuestStat('greedSeams', 1);
        this.bumpQuestStat('rareFinds', rarity >= 2 ? amount : (lucky ? amount : 0));
        if (lucky || rarity >= 2) {
            this.pushCombatFeed(`🔥 욕심 채굴! ${this.oreConfig[minedOre].label} 발견으로 보너스 +${bonus}`, '#ffd166');
        } else {
            this.pushCombatFeed(`💰 욕심 채굴 보너스 +${bonus} · 더 캐면 더 커집니다.`, '#d8c1ff');
        }
        this.persist();
    }

    // ============================================================= v9 mine events
    getMineEventDefinitions() {
        const depth = this.depth;
        const danger = Math.round(this.miningNoise || 0);
        // FLOOR_THEMES is keyed by B-depth, so special-event routing uses the actual depth.
        const themeId = this.depth;
        const defs = [
            { id:'crack', icon:'🕳️', title:'수상한 균열', text:'균열 안쪽에서 푸른 광택과 낮은 울음소리가 동시에 들립니다.', choices:[
                {id:'dig',icon:'⛏',title:'균열을 판다',desc:'희귀 광석 대폭 증가 · 습격 위험 크게 증가',color:'#ffd166',risk:2},
                {id:'seal',icon:'🧱',title:'봉인한다',desc:'안전하게 진행 · 대신 숨겨진 광맥을 포기',color:'#8fd9a8',safe:true},
                {id:'workers',icon:'👷',title:'워커 2명을 투입한다',desc:'보상 증가 · 두 워커가 대신 위험을 감수',color:'#d7b8ff',requiresWorkers:2,workerChoice:true}
            ]},
            { id:'bones', icon:'🦴', title:'뼈 무더기', text:'오래된 광부의 장비 사이에서 아직 움직이는 뼈가 보입니다.', choices:[
                {id:'search',icon:'🔎',title:'조사한다',desc:'보물 획득 · 즉시 습격',color:'#ffd166',risk:2},
                {id:'leave',icon:'🚶',title:'지나간다',desc:'아무것도 잃지 않고 진행',color:'#8fd9a8',safe:true},
                {id:'guard',icon:'🛡',title:'경비 워커를 세운다',desc:'경비가 있으면 보상과 안전을 함께 확보',color:'#8fe4ff',workerChoice:true}
            ]},
            { id:'gold_seam', icon:'💎', title:'빛나는 광맥', text:`광맥 깊숙한 곳에서 ${depth <= 15 ? '금빛' : '희미한'} 맥이 번쩍입니다.`, choices:[
                {id:'rush',icon:'🔥',title:'전부 캐낸다',desc:'욕심 보너스 크게 증가 · 소음 급증',color:'#ffd166',risk:2},
                {id:'sample',icon:'⛏',title:'조금만 캔다',desc:'희귀 광석 확률 증가 · 위험 소폭 증가',color:'#d7b8ff'},
                {id:'mark',icon:'📍',title:'위치를 표시한다',desc:'지금은 안전 · 다음 채굴에서 희귀 보너스 유지',color:'#8fd9a8',safe:true}
            ]},
            { id:'collapse', icon:'🧱', title:'무너지는 갱도', text:'천장에서 돌가루가 떨어집니다. 오래 머물면 통로가 무너질 것 같습니다.', choices:[
                {id:'mine',icon:'⛏',title:'서둘러 채굴한다',desc:'즉시 보상 · 워커 부상 가능',color:'#ffd166',risk:1},
                {id:'retreat',icon:'↩',title:'즉시 물러난다',desc:'이번 광맥은 포기하지만 위험을 낮춘다',color:'#8fd9a8',safe:true},
                {id:'two_workers',icon:'👷',title:'워커 2명을 보낸다',desc:'큰 보상 · 부상 위험 큼',color:'#ff9c9c',requiresWorkers:2,workerChoice:true,risk:2}
            ]},
            { id:'whisper', icon:'👂', title:'이상한 울음소리', text:'벽 너머에서 누군가 도움을 청하는 것 같은 소리가 들립니다.', choices:[
                {id:'approach',icon:'👁️',title:'다가간다',desc:'대박 보상 또는 강한 적과 조우',color:'#d7b8ff',risk:2},
                {id:'send',icon:'👷',title:'워커를 보낸다',desc:'작은 보상 · 워커가 대신 위험을 감수',color:'#ff9c9c',requiresWorkers:1,workerChoice:true},
                {id:'ignore',icon:'🚶',title:'무시한다',desc:'안전하지만 숨겨진 기회를 놓친다',color:'#8fd9a8',safe:true}
            ]},
            { id:'black_slime', icon:'👁️', title:'검은 점액', text:'바위 틈에서 검은 슬라임이 꿈틀거립니다. 보통 슬라임과는 냄새부터 다릅니다.', choices:[
                {id:'touch',icon:'🧪',title:'채취한다',desc:'희귀 보상 · 위험 증가',color:'#d7b8ff',risk:1},
                {id:'burn',icon:'🔥',title:'태워버린다',desc:'안전하게 위험 요소 제거',color:'#8fd9a8',safe:true},
                {id:'observe',icon:'🔎',title:'관찰한다',desc:'탐광꾼이 있으면 추가 보상',color:'#8fe4ff',workerChoice:true}
            ]}
        ];
        if (themeId === 20) defs.push({id:'frozen_cache',icon:'❄️',title:'얼어붙은 보급함',text:'얼음 속에 오래된 광부의 보급함이 갇혀 있습니다.',choices:[
            {id:'break',icon:'⛏',title:'얼음을 깨고 꺼낸다',desc:'미스릴 기회 ↑ · 소음 증가',color:'#8fe4ff',risk:1},
            {id:'melt',icon:'🔥',title:'천천히 녹인다',desc:'안전하게 작은 보상 확보',color:'#8fd9a8',safe:true},
            {id:'prospector',icon:'💎',title:'탐광꾼에게 맡긴다',desc:'탐광꾼이 있으면 희귀 보상 크게 증가',color:'#d7b8ff',workerChoice:true}
        ]});
        if (themeId === 10) defs.push({id:'lava_vent',icon:'🌋',title:'용암 가스 분출구',text:'갈라진 바위 아래에서 뜨거운 가스가 새어 나옵니다.',choices:[
            {id:'open',icon:'🔥',title:'분출구를 연다',desc:'금광 보상 ↑↑ · 전투 위험 ↑↑',color:'#ff9c9c',risk:2},
            {id:'seal',icon:'🧱',title:'봉인한다',desc:'화염 위험 제거 · 안전하게 진행',color:'#8fd9a8',safe:true},
            {id:'guard',icon:'🛡',title:'경비를 세우고 채굴한다',desc:'경비가 있으면 위험을 크게 완화',color:'#8fe4ff',workerChoice:true}
        ]});
        if (themeId === 25) defs.push({id:'dragon_scale',icon:'🐉',title:'용의 비늘 흔적',text:'벽면에 거대한 비늘 자국이 남아 있습니다. 드래곤이 이곳을 지나간 듯합니다.',choices:[
            {id:'track',icon:'👁️',title:'흔적을 추적한다',desc:'전설 보상 기회 ↑ · 강력한 적 조우 가능',color:'#ffd166',risk:2},
            {id:'hide',icon:'🫥',title:'흔적을 숨긴다',desc:'안전하게 통로를 확보',color:'#8fd9a8',safe:true},
            {id:'workers',icon:'👷',title:'워커 2명을 보내 확인한다',desc:'보상 ↑↑ · 부상 위험',color:'#d7b8ff',requiresWorkers:2,workerChoice:true}
        ]});
        return defs;
    }

    maybeTriggerMineEvent(node) {
        if (this.mineEvent || this.isDown || this.waveActive || !node || this.eventCooldown > 0) return false;
        if (this.depth <= 0 || this.quest.stage === 'coal' || this.quest.stage === 'recruit') return false;
        const prospectors = this.workers.filter(w => (w.userData.workerRole || 'miner') === 'prospector' && w.userData.downTimer <= 0).length;
        const markedBonus = this.markedSeams > 0 ? 0.025 : 0;
        const chance = Math.min(0.15, 0.032 + this.getFloorsClimbed() * 0.0016 + prospectors * 0.018 + (this.miningNoise || 0) * 0.00028 + markedBonus);
        if (Math.random() > chance) return false;
        const defs = this.getMineEventDefinitions();
        const def = defs[Math.floor(Math.random() * defs.length)];
        this.mineEvent = { id:def.id, icon:def.icon, title:def.title, text:def.text, choices:def.choices, danger:Math.round(this.miningNoise || 0), createdAt:Date.now() };
        this.mineEventStats.triggered += 1;
        this.playerData.miningTarget = null; this.playerTarget = null; this.miningHitTimer = 0;
        this.workers.forEach(w => { w.userData.miningTarget = null; w.userData.isMining = false; });
        this.eventCooldown = 5.5;
        this.app.ui.showMineEvent?.(this.mineEvent, this.getWorkerData());
        this.pushCombatFeed(`❗ 사건 발생: ${def.title}`, '#ffd166');
        this.persist();
        return true;
    }

    resolveMineEvent(choiceId) {
        const event = this.mineEvent;
        if (!event) return { ok: false, reason: '진행 중인 사건이 없습니다.' };
        const choice = event.choices.find(c => c.id === choiceId);
        if (!choice) return { ok: false, reason: '잘못된 선택입니다.' };
        const aliveWorkers = this.workers.filter(w => w.userData.downTimer <= 0);
        if (choice.requiresWorkers && aliveWorkers.length < choice.requiresWorkers) {
            return { ok: false, reason: `워커가 ${choice.requiresWorkers}명 필요합니다.` };
        }
        // Event payouts join the same unstable pool as greed-mining bonuses:
        // banked for real on the next ascend, wiped entirely on a field death.
        const reward = (n) => {
            const amount = Math.max(0, Math.round(n));
            this.unstableHaul = Math.min(999, (this.unstableHaul || 0) + amount);
            return amount;
        };
        const injure = (worker, amount) => this.damageWorker(worker, amount, { userData: { type: 'mine-event' } });
        const workerRisk = (workers, amount, chance = 0.5) => {
            workers.slice(0, choice.requiresWorkers || workers.length).forEach(w => {
                if (Math.random() < chance) injure(w, amount + Math.random() * 12);
            });
        };
        let message = '';
        let color = choice.color || '#d7c4ed';
        if (choice.safe) this.mineEventStats.safeChoices += 1;
        else if (choice.risk) this.mineEventStats.riskyChoices += 1;
        if (choice.workerChoice) this.mineEventStats.workerChoices += 1;

        if (event.id === 'crack') {
            if (choiceId === 'dig') {
                this.eventRareBoost = 1.9; this.eventRareCharges = 4; this.addMiningNoise(24);
                if (Math.random() < 0.65) this.spawnFieldEncounter();
                message = '균열을 파고들었습니다. 희귀 광맥이 보이지만 무언가 깨어났습니다!';
            } else if (choiceId === 'workers') {
                reward(12 + this.getFloorsClimbed() * 2); this.addMiningNoise(12);
                workerRisk(aliveWorkers, 22, 0.45); this.eventRareBoost = 0.9; this.eventRareCharges = 3;
                message = '워커 2명이 균열 안쪽을 확보했습니다. 보너스 광석을 얻었지만 부상자가 생길 수 있습니다.';
            } else message = '균열을 봉인했습니다. 위험 없이 길을 확보했습니다.';
        } else if (event.id === 'bones') {
            if (choiceId === 'search') {
                reward(10 + Math.floor(Math.random() * 10)); this.addMiningNoise(18); this.spawnFieldEncounter();
                message = '낡은 광부의 보관함을 찾았습니다. 하지만 뼈들이 움직이기 시작합니다!';
            } else if (choiceId === 'guard') {
                const guards = aliveWorkers.filter(w => w.userData.workerRole === 'guard');
                if (guards.length) { reward(7 + guards.length * 3); message = '경비 워커가 주변을 통제했습니다. 안전하게 보급품을 확보했습니다.'; }
                else { this.addMiningNoise(8); message = '경비 워커가 없어 조심스럽게 지나갔습니다.'; }
            } else message = '뼈 무더기를 지나쳤습니다. 지금은 안전이 우선입니다.';
        } else if (event.id === 'gold_seam') {
            if (choiceId === 'rush') {
                reward(16); this.greedSeams = (this.greedSeams || 0) + 1; this.addMiningNoise(28);
                this.eventRareBoost = 1.5; this.eventRareCharges = 5;
                message = '빛나는 광맥을 끝까지 긁어냈습니다. 큰 보상이지만 광산이 크게 소란스러워졌습니다.';
            } else if (choiceId === 'sample') {
                reward(5); this.addMiningNoise(10); this.eventRareBoost = 1.25; this.eventRareCharges = 3;
                message = '광맥 일부만 채취했습니다. 희귀 광석의 기척이 남아 있습니다.';
            } else {
                this.markedSeams = Math.min(5, (this.markedSeams || 0) + 1);
                this.eventRareBoost = Math.max(this.eventRareBoost || 0, 1.35); this.eventRareCharges = Math.max(this.eventRareCharges || 0, 5);
                message = '광맥 위치를 표시했습니다. 다음 채굴에서 이 흔적이 희귀광맥을 유도합니다.';
            }
        } else if (event.id === 'collapse') {
            if (choiceId === 'mine') {
                reward(10); this.addMiningNoise(20);
                if (Math.random() < 0.35 && aliveWorkers.length) injure(aliveWorkers[Math.floor(Math.random() * aliveWorkers.length)], 26);
                message = '무너지기 직전까지 채굴해 광석을 확보했습니다.';
            } else if (choiceId === 'two_workers') {
                reward(18); this.addMiningNoise(14); workerRisk(aliveWorkers, 28, 0.6);
                message = '워커 2명이 위험한 지점을 뚫었습니다. 큰 보상과 함께 부상 위험도 컸습니다.';
            } else { this.miningNoise = Math.max(0, this.miningNoise - 18); message = '통로에서 즉시 빠져나왔습니다. 광맥은 포기했지만 모두 무사합니다.'; }
        } else if (event.id === 'whisper') {
            if (choiceId === 'approach') {
                if (Math.random() < 0.55) { reward(22); this.eventRareBoost = 2.1; this.eventRareCharges = 3; message = '숨겨진 광부의 주머니를 찾았습니다!'; }
                else { this.addMiningNoise(25); this.spawnFieldEncounter(); message = '울음소리의 정체는 굶주린 괴물이었습니다!'; color = '#ff9c9c'; }
            } else if (choiceId === 'send') {
                const w = aliveWorkers[0]; if (Math.random() < 0.65) injure(w, 24 + Math.random() * 18); reward(9);
                message = '워커가 대신 확인했습니다. 작은 보급품을 회수했습니다.';
            } else message = '울음소리를 무시하고 채굴을 계속합니다.';
        } else if (event.id === 'black_slime') {
            if (choiceId === 'touch') { reward(15); this.eventRareBoost = 2.4; this.eventRareCharges = 4; this.addMiningNoise(16); message = '검은 점액을 채취했습니다. 희귀 광석의 반응이 강해졌습니다.'; }
            else if (choiceId === 'observe') {
                const pros = aliveWorkers.filter(w => w.userData.workerRole === 'prospector');
                if (pros.length) { reward(12 + pros.length * 4); this.eventRareBoost = 1.5; this.eventRareCharges = 3; message = '탐광꾼이 검은 점액의 광물 반응을 분석해 추가 보상을 찾았습니다.'; }
                else message = '관찰했지만 특별한 정보를 얻지 못했습니다.';
            } else message = '검은 점액을 태워 없앴습니다. 위험 요소가 사라졌습니다.';
        } else if (event.id === 'frozen_cache') {
            if (choiceId === 'break') { reward(16); this.addMiningNoise(14); this.eventRareBoost = 2.0; this.eventRareCharges = 4; message = '얼음을 깨고 보급함을 확보했습니다. 미스릴 반응이 강해졌습니다.'; }
            else if (choiceId === 'prospector') { const pros = aliveWorkers.filter(w => w.userData.workerRole === 'prospector'); reward(pros.length ? 22 + pros.length * 5 : 5); this.eventRareBoost = pros.length ? 2.4 : 0.7; this.eventRareCharges = 4; message = pros.length ? '탐광꾼이 얼음 속 미스릴을 정확히 찾아냈습니다.' : '탐광꾼이 없어 얼음 속 보급함만 간신히 확보했습니다.'; }
            else { reward(7); message = '얼음을 천천히 녹여 안전하게 보급품을 확보했습니다.'; }
        } else if (event.id === 'lava_vent') {
            if (choiceId === 'open') { reward(24); this.addMiningNoise(30); this.eventRareBoost = 1.8; this.eventRareCharges = 4; if (Math.random() < 0.65) this.spawnFieldEncounter(); message = '용암 가스를 열어 금빛 광석을 끌어냈습니다. 광산이 크게 소란스러워졌습니다.'; }
            else if (choiceId === 'guard') { const guards = aliveWorkers.filter(w => w.userData.workerRole === 'guard'); reward(guards.length ? 18 + guards.length * 5 : 8); this.addMiningNoise(12); if (!guards.length && Math.random() < 0.35) workerRisk(aliveWorkers, 18, 0.4); message = guards.length ? '경비 워커가 열기를 견디며 안전한 채굴선을 확보했습니다.' : '경비가 없어 조심스럽게 작업했습니다.'; }
            else { this.miningNoise = Math.max(0, this.miningNoise - 12); message = '분출구를 봉인했습니다. 용암 가스가 잠잠해졌습니다.'; }
        } else if (event.id === 'dragon_scale') {
            if (choiceId === 'track') { reward(28 + Math.floor(Math.random() * 12)); this.addMiningNoise(22); this.eventRareBoost = 3.0; this.eventRareCharges = 3; if (Math.random() < 0.5) this.spawnFieldEncounter(); message = '용의 흔적을 추적해 오래된 보물을 발견했습니다. 하지만 거대한 포효가 들립니다!'; }
            else if (choiceId === 'workers') { reward(24); this.addMiningNoise(14); workerRisk(aliveWorkers, 30, 0.55); this.eventRareBoost = 2.0; this.eventRareCharges = 4; message = '워커들이 용의 흔적 주변에서 귀중한 조각을 회수했습니다.'; }
            else { this.markedSeams = Math.min(5, (this.markedSeams || 0) + 1); message = '용의 흔적을 숨기고 조용히 통로를 확보했습니다.'; }
        }

        this.mineEvent = null;
        this.eventCooldown = Math.max(this.eventCooldown || 0, 4.5);
        this.app.ui.closeMineEvent?.();
        this.app.ui.showBanner('사건 해결', message, color);
        this.pushCombatFeed(`🧭 ${message}`, color);
        this.persist();
        return { ok: true, message };
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
        this.bumpQuestStat('oreMined', amount);
        if (this.eventRareCharges > 0) {
            this.eventRareCharges -= 1;
            if (this.eventRareCharges <= 0) this.eventRareBoost = 0;
        }
        if (this.maybeTriggerMineEvent(node)) return;
        node.userData.lastYieldAmount = amount;
        node.userData.lastYield = minedOre;
        node.userData.lastYieldTimer = 2.2;
        // A drop rarer than the vein itself is a lucky strike worth calling out.
        const veinRarity = (this.oreConfig[node.userData.oreType] || this.oreConfig.coal).rarity;
        node.userData.lastYieldLucky = (this.oreConfig[minedOre]?.rarity || 0) > veinRarity;
        if (node.userData.lastYieldLucky && this.markedSeams > 0) { this.markedSeams -= 1; this.pushCombatFeed('📍 표시한 광맥의 흔적이 희귀 광석을 끌어냈습니다!', '#8fd9a8'); }

        // Mithril is scarce enough that finding any at all deserves a callout.
        if (minedOre === 'mithril') {
            this.pushCombatFeed(`✦ 미스릴 ${amount}개를 캐냈습니다!`, '#8fe4ff');
            this.combatFX.spawnFlash(node.position, 0x8fe4ff, 30, 0.45);
        }

        this.completeCoalQuest();
        this.playSound('mining-hit');

        if (node.userData.reserves <= 0) {
            this.addGreedHaul(node, minedOre, amount);
            this.scene.remove(node);
            this.nodes = this.nodes.filter((entry) => entry !== node);
            if (this.playerData.miningTarget === node) this.playerData.miningTarget = null;
            this.workers.forEach((worker) => {
                if (worker.userData.miningTarget === node) worker.userData.miningTarget = null;
            });

            // Emptying a seam is progress toward stripping this floor bare.
            this.floorNodesCleared += 1;
            if (this.depth > 0 && this.isFloorCleared()) {
                if (!this.floorReadyToAscend) {
                    this.floorReadyToAscend = true;
                    this.pushCombatFeed(
                        `${this.getFloorLabel()}의 광맥을 모두 캐냈습니다! 다음 층으로 이동할 수 있습니다.`,
                        '#8fe4ff'
                    );
                    this.persist();
                }
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
            surface: this.depth <= 0,
            readyToAscend: this.floorReadyToAscend,
            unstableHaul: this.unstableHaul || 0,
            greedSeams: this.greedSeams || 0
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

    // Shows every other leader sharing this room as a translucent, tinted
    // ghost of the player's own model. Real co-op play (shared veins/waves)
    // is a bigger architecture change — see instant_db.md — but at least the
    // "same room" is no longer invisible.
    syncPlayers(peers) {
        const seen = new Set();
        Object.entries(peers || {}).forEach(([peerId, peer]) => {
            if (!peer?.pos) return;
            seen.add(peerId);

            let mesh = this.peerMeshes[peerId];
            if (!mesh) {
                mesh = this.assets.leader.clone();
                mesh.scale.setScalar(1.25);
                mesh.traverse((child) => {
                    if (child.material) {
                        child.material = child.material.clone();
                        child.material.transparent = true;
                        child.material.opacity = 0.72;
                        child.material.color = new THREE.Color(0x7fd4e8);
                    }
                });
                this.scene.add(mesh);
                this.peerMeshes[peerId] = mesh;
            }
            mesh.position.set(peer.pos.x ?? 0, peer.pos.y ?? 0, peer.pos.z ?? 0);
        });

        // Peers who left the room (or whose presence expired) are removed.
        Object.keys(this.peerMeshes).forEach((peerId) => {
            if (seen.has(peerId)) return;
            this.scene.remove(this.peerMeshes[peerId]);
            delete this.peerMeshes[peerId];
        });
    }

    // Fire-and-forget social pings from other rooms' leaders — a light layer
    // of "we're in this together" without syncing actual world/combat state.
    handlePeerEvent(event) {
        if (!event || typeof event !== 'object') return;
        if (event.type === 'wave_start') {
            this.pushCombatFeed(`🔔 다른 광부가 웨이브 ${event.wave} 방어를 시작했습니다.`, '#9fc4d8');
        } else if (event.type === 'wave_clear') {
            this.pushCombatFeed(`🔔 다른 광부가 웨이브 ${event.wave}을(를) 격퇴했습니다!`, '#8fd9a8');
        } else if (event.type === 'wave_fail') {
            this.pushCombatFeed(`🔔 다른 광부가 웨이브 ${event.wave}에서 쓰러졌습니다…`, '#ff9c9c');
        } else if (event.type === 'floor_ascend') {
            this.pushCombatFeed(`🔔 다른 광부가 ${this.getFloorLabel(event.floor)}(으)로 올라갔습니다.`, '#8fe4ff');
        }
    }
}
