/**
 * Real-time 3D auto-combat.
 *
 * Combat happens in the world, not in a modal. The leader and workers pick
 * targets, close the distance, and swing/fire automatically. Every hit is
 * physically visible: melee weapons arc through a real swing, archers loose
 * actual arrow meshes that travel and stick, and impacts spawn sparks, slashes,
 * blood-mist puffs and floating world-space damage numbers.
 */

import * as THREE from 'three';

// ------------------------------------------------------------------ archetypes

export const ENEMY_TYPES = {
    crawler: {
        id: 'crawler',
        asset: 'crawler',
        name: '광산 굴착충',
        hp: 26,
        damage: 5,
        attackInterval: 1.5,
        range: 1.9,
        moveSpeed: 2.6,
        scale: 1.5,
        baseY: 0.35,
        style: 'melee',
        tint: 0xb98cff,
        xp: 6,
        elite: false
    },
    brute: {
        id: 'brute',
        asset: 'brute',
        name: '해골 파괴자',
        hp: 62,
        damage: 11,
        attackInterval: 2.1,
        range: 2.3,
        moveSpeed: 2.0,
        scale: 2.1,
        baseY: 1.05,
        style: 'melee',
        tint: 0xff9c7a,
        xp: 16,
        elite: false
    },
    archer: {
        id: 'archer',
        asset: 'archer',
        name: '그림자 궁수',
        hp: 38,
        damage: 8,
        attackInterval: 2.4,
        range: 11,
        moveSpeed: 2.2,
        keepDistance: 8,
        scale: 1.85,
        baseY: 0.95,
        style: 'ranged',
        tint: 0x8fe4ff,
        xp: 12,
        elite: false
    },
    overlord: {
        id: 'overlord',
        asset: 'overlord',
        name: '광산의 군주',
        hp: 260,
        damage: 20,
        attackInterval: 2.6,
        range: 3.0,
        moveSpeed: 1.9,
        scale: 3.1,
        baseY: 1.55,
        style: 'melee',
        tint: 0xff7a4a,
        xp: 90,
        elite: true
    }
};

/** Wave table: which monsters show up as the mine gets deeper. */
export const WAVE_TABLE = [
    { wave: 1, spawns: [['crawler', 2]] },
    { wave: 2, spawns: [['crawler', 3]] },
    { wave: 3, spawns: [['crawler', 2], ['archer', 1]] },
    { wave: 4, spawns: [['crawler', 3], ['brute', 1]] },
    { wave: 5, spawns: [['archer', 2], ['brute', 1]] },
    { wave: 6, spawns: [['crawler', 3], ['archer', 2], ['brute', 1]] },
    { wave: 7, spawns: [['brute', 2], ['archer', 2]] },
    { wave: 8, spawns: [['overlord', 1], ['crawler', 3]] }
];

/** Every 5th wave past the hand-authored table is a named mini-boss wave. */
export function isEliteWave(wave) {
    return wave > WAVE_TABLE.length && wave % 5 === 0;
}

export function getWaveComposition(wave) {
    if (wave <= 0) return [];
    const entry = WAVE_TABLE[Math.min(wave, WAVE_TABLE.length) - 1];
    const scaling = Math.max(0, wave - WAVE_TABLE.length);
    const spawns = [];
    entry.spawns.forEach(([type, count]) => {
        spawns.push([type, count + Math.floor(scaling / 2)]);
    });
    if (isEliteWave(wave)) spawns.push(['overlord', 1 + Math.floor(scaling / 15)]);
    return spawns;
}

/** Enemy stats scale up each wave so later fights stay dangerous. */
export function scaleEnemyStats(config, wave) {
    const growth = 1 + Math.max(0, wave - 1) * 0.18;
    return {
        hp: Math.round(config.hp * growth),
        damage: Math.round(config.damage * (1 + Math.max(0, wave - 1) * 0.12))
    };
}

// ----------------------------------------------------------------- weapon mesh

const STEEL = { color: 0xd7e2ee, metalness: 0.85, roughness: 0.24 };

/**
 * Builds the weapon the leader actually holds, matched to the forged item so
 * crafting visibly changes the character. Returns a Group whose local origin is
 * the grip, oriented so +Y is the blade direction.
 */
export function createWeaponMesh(archetypeId, tierColor = '#d8d2e2') {
    const group = new THREE.Group();
    const accent = new THREE.Color(tierColor);

    const gripMat = new THREE.MeshStandardMaterial({ color: 0x50301c, roughness: 0.85 });
    const guardMat = new THREE.MeshStandardMaterial({
        color: accent.clone().multiplyScalar(0.85),
        metalness: 0.7,
        roughness: 0.35,
        emissive: accent.clone().multiplyScalar(0.16)
    });
    const bladeMat = new THREE.MeshStandardMaterial({
        ...STEEL,
        color: accent.clone().lerp(new THREE.Color(0xffffff), 0.35),
        emissive: accent.clone().multiplyScalar(0.22)
    });

    const addGrip = (length = 0.36, radius = 0.045) => {
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.1, length, 8), gripMat);
        grip.position.y = length * 0.5;
        group.add(grip);
        return length;
    };

    const addGuard = (width = 0.34) => {
        const guard = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, 0.09), guardMat);
        guard.position.y = 0.38;
        group.add(guard);
    };

    const addBlade = (length, width, thickness = 0.05) => {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(width, length, thickness), bladeMat);
        blade.position.y = 0.42 + length * 0.5;
        group.add(blade);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(width * 0.62, width * 1.5, 4), bladeMat);
        tip.position.y = 0.42 + length + width * 0.7;
        tip.rotation.y = Math.PI / 4;
        group.add(tip);
    };

    switch (archetypeId) {
        case 'dagger':
            addGrip(0.3, 0.038);
            addGuard(0.22);
            addBlade(0.42, 0.1);
            break;
        case 'club': {
            addGrip(0.46, 0.05);
            const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.19, 0), guardMat);
            head.position.y = 0.66;
            group.add(head);
            break;
        }
        case 'greatsword':
            addGrip(0.5, 0.055);
            addGuard(0.5);
            addBlade(1.26, 0.22, 0.07);
            break;
        case 'longsword':
            addGrip(0.38);
            addGuard(0.4);
            addBlade(0.95, 0.16);
            break;
        case 'gilded_blade':
            addGrip(0.36);
            addGuard(0.42);
            addBlade(0.86, 0.15);
            break;
        case 'sunspear': {
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.5, 8), gripMat);
            shaft.position.y = 0.75;
            group.add(shaft);
            const spearHead = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.46, 6), bladeMat);
            spearHead.position.y = 1.68;
            group.add(spearHead);
            break;
        }
        case 'mithril_edge':
            addGrip(0.38);
            addGuard(0.46);
            addBlade(1.02, 0.17);
            break;
        case 'void_reaver': {
            addGrip(0.5, 0.06);
            addGuard(0.58);
            addBlade(1.34, 0.26, 0.08);
            const halo = new THREE.Mesh(
                new THREE.TorusGeometry(0.28, 0.028, 6, 18),
                new THREE.MeshStandardMaterial({
                    color: accent,
                    emissive: accent,
                    emissiveIntensity: 1.4,
                    metalness: 0.4,
                    roughness: 0.3
                })
            );
            halo.position.y = 0.44;
            halo.rotation.x = Math.PI / 2;
            group.add(halo);
            break;
        }
        default:
            addGrip(0.36);
            addGuard(0.34);
            addBlade(0.78, 0.14);
    }

    group.traverse((child) => {
        if (child.isMesh) child.castShadow = true;
    });
    return group;
}

/** Bare-fist fallback so an unarmed leader still has a visible strike. */
export function createFistMesh() {
    const group = new THREE.Group();
    const fist = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.14, 0),
        new THREE.MeshStandardMaterial({ color: 0x7fd8c8, roughness: 0.5, emissive: 0x1c5a52 })
    );
    fist.position.y = 0.2;
    fist.castShadow = true;
    group.add(fist);
    return group;
}

// ------------------------------------------------------------------- VFX layer

/**
 * All transient combat visuals live here: slash arcs, sparks, blood mist,
 * arrows in flight, ground shockwaves and floating damage sprites. One instance
 * is owned by the Game and ticked every frame.
 */
export class CombatFX {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.effects = [];
        this.projectiles = [];
        this.numberCanvasCache = new Map();

        this.sparkGeometry = new THREE.SphereGeometry(0.055, 5, 4);
        this.arrowGeometry = new THREE.CylinderGeometry(0.022, 0.022, 0.85, 5);
    }

    // ---------------------------------------------------------------- damage UI

    makeNumberTexture(text, color) {
        const key = `${text}|${color}`;
        if (this.numberCanvasCache.has(key)) return this.numberCanvasCache.get(key);

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '800 82px Orbitron, Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 12;
        ctx.strokeStyle = 'rgba(0,0,0,0.92)';
        ctx.strokeText(text, 128, 66);
        ctx.shadowColor = color;
        ctx.shadowBlur = 26;
        ctx.fillStyle = color;
        ctx.fillText(text, 128, 66);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        // Cache is bounded so long fights do not grow memory forever.
        if (this.numberCanvasCache.size > 120) {
            const oldestKey = this.numberCanvasCache.keys().next().value;
            this.numberCanvasCache.get(oldestKey)?.dispose();
            this.numberCanvasCache.delete(oldestKey);
        }
        this.numberCanvasCache.set(key, texture);
        return texture;
    }

    spawnDamageNumber(position, amount, options = {}) {
        const color = options.color || '#ffd166';
        const text = options.text || `${amount}`;
        const texture = this.makeNumberTexture(text, color);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        }));
        const scale = options.scale || 1;
        sprite.scale.set(1.7 * scale, 0.85 * scale, 1);
        sprite.position.copy(position);
        sprite.position.y += 1.2;
        sprite.renderOrder = 999;
        this.scene.add(sprite);

        const drift = new THREE.Vector3((Math.random() - 0.5) * 1.1, 2.4, (Math.random() - 0.5) * 1.1);
        this.effects.push({
            object: sprite,
            life: 0,
            maxLife: 1.05,
            update: (fx, delta, t) => {
                sprite.position.addScaledVector(drift, delta);
                drift.y -= delta * 2.6;
                const pop = t < 0.16 ? 1 + (0.16 - t) * 3.2 : 1;
                sprite.scale.set(1.7 * scale * pop, 0.85 * scale * pop, 1);
                sprite.material.opacity = t > 0.62 ? 1 - (t - 0.62) / 0.38 : 1;
            }
        });
    }

    // ------------------------------------------------------------------ impacts

    /** Bright crescent slash left behind by a melee swing. */
    spawnSlashArc(position, facing, options = {}) {
        const color = new THREE.Color(options.color || 0xfff0c0);
        const radius = options.radius || 1.25;
        const geometry = new THREE.RingGeometry(radius * 0.55, radius, 22, 1, -0.75, 1.5);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const arc = new THREE.Mesh(geometry, material);
        arc.position.copy(position);
        arc.position.y += options.height ?? 0.75;
        arc.rotation.x = -Math.PI / 2.6;
        arc.rotation.z = Math.atan2(facing.x, facing.z);
        this.scene.add(arc);

        this.effects.push({
            object: arc,
            life: 0,
            maxLife: 0.28,
            update: (fx, delta, t) => {
                arc.scale.setScalar(0.75 + t * 0.75);
                material.opacity = 0.95 * (1 - t);
                arc.rotation.z += delta * 3.4;
            },
            dispose: () => {
                geometry.dispose();
                material.dispose();
            }
        });
    }

    /** Radial spark burst on a landed hit. */
    spawnSparks(position, options = {}) {
        const count = options.count || 12;
        const color = new THREE.Color(options.color || 0xffd166);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const group = new THREE.Group();
        const velocities = [];

        for (let i = 0; i < count; i++) {
            const spark = new THREE.Mesh(this.sparkGeometry, material);
            group.add(spark);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.55;
            const speed = (options.speed || 5) * (0.55 + Math.random() * 0.85);
            velocities.push(new THREE.Vector3(
                Math.cos(theta) * Math.sin(phi) * speed,
                Math.cos(phi) * speed * 0.9 + 1.6,
                Math.sin(theta) * Math.sin(phi) * speed
            ));
        }

        group.position.copy(position);
        group.position.y += options.height ?? 0.7;
        this.scene.add(group);

        this.effects.push({
            object: group,
            life: 0,
            maxLife: options.life || 0.5,
            update: (fx, delta, t) => {
                group.children.forEach((spark, index) => {
                    const velocity = velocities[index];
                    spark.position.addScaledVector(velocity, delta);
                    velocity.y -= delta * 13;
                    spark.scale.setScalar(Math.max(0.05, 1 - t));
                });
                material.opacity = 1 - t;
            },
            dispose: () => material.dispose()
        });
    }

    /** Soft coloured mist for wounds and deaths. */
    spawnBurst(position, options = {}) {
        const color = new THREE.Color(options.color || 0xff5a5a);
        const geometry = new THREE.SphereGeometry(options.radius || 0.5, 10, 8);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.position.y += options.height ?? 0.7;
        this.scene.add(mesh);

        this.effects.push({
            object: mesh,
            life: 0,
            maxLife: options.life || 0.42,
            update: (fx, delta, t) => {
                mesh.scale.setScalar(1 + t * (options.expand || 2.4));
                material.opacity = 0.7 * (1 - t);
            },
            dispose: () => {
                geometry.dispose();
                material.dispose();
            }
        });
    }

    /** Expanding ground ring for heavy blows and deaths. */
    spawnShockwave(position, options = {}) {
        const color = new THREE.Color(options.color || 0xffb066);
        const geometry = new THREE.RingGeometry(0.35, 0.55, 30);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const ring = new THREE.Mesh(geometry, material);
        ring.position.copy(position);
        ring.position.y = 0.06;
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);

        this.effects.push({
            object: ring,
            life: 0,
            maxLife: options.life || 0.5,
            update: (fx, delta, t) => {
                ring.scale.setScalar(1 + t * (options.scale || 5));
                material.opacity = 0.85 * (1 - t);
            },
            dispose: () => {
                geometry.dispose();
                material.dispose();
            }
        });
    }

    /** Brief point light so hits actually illuminate the cave. */
    spawnFlash(position, color = 0xffd07a, intensity = 26, life = 0.22) {
        const light = new THREE.PointLight(color, intensity, 9, 2);
        light.position.copy(position);
        light.position.y += 0.9;
        this.scene.add(light);
        this.effects.push({
            object: light,
            life: 0,
            maxLife: life,
            update: (fx, delta, t) => {
                light.intensity = intensity * (1 - t);
            }
        });
    }

    // --------------------------------------------------------------- projectiles

    /**
     * Fires a real arrow mesh that travels to its target and resolves on
     * arrival. `onHit` is invoked with the impact point.
     */
    fireArrow(from, getTargetPosition, options = {}) {
        const color = new THREE.Color(options.color || 0xbfe9ff);
        const material = new THREE.MeshStandardMaterial({
            color,
            emissive: color.clone().multiplyScalar(0.8),
            emissiveIntensity: 1.5,
            metalness: 0.3,
            roughness: 0.4
        });
        const arrow = new THREE.Mesh(this.arrowGeometry, material);
        arrow.castShadow = true;

        // The cylinder is Y-aligned; a container lets us aim it along -Z.
        const holder = new THREE.Group();
        arrow.rotation.x = Math.PI / 2;
        holder.add(arrow);

        const fletch = new THREE.Mesh(
            new THREE.ConeGeometry(0.075, 0.2, 4),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
        );
        fletch.rotation.x = -Math.PI / 2;
        fletch.position.z = 0.42;
        holder.add(fletch);

        holder.position.copy(from);
        this.scene.add(holder);

        const speed = options.speed || 21;
        this.projectiles.push({
            object: holder,
            material,
            getTargetPosition,
            speed,
            onHit: options.onHit,
            color,
            life: 0,
            maxLife: 3
        });

        this.spawnFlash(from, color.getHex(), 12, 0.15);
    }

    updateProjectiles(delta) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];
            projectile.life += delta;

            const target = projectile.getTargetPosition();
            if (!target || projectile.life > projectile.maxLife) {
                this.scene.remove(projectile.object);
                projectile.material.dispose();
                this.projectiles.splice(i, 1);
                continue;
            }

            const aim = target.clone();
            aim.y += 0.75;
            const toTarget = new THREE.Vector3().subVectors(aim, projectile.object.position);
            const distance = toTarget.length();
            const step = projectile.speed * delta;

            projectile.object.lookAt(aim);

            if (distance <= Math.max(0.45, step)) {
                const impact = projectile.object.position.clone();
                this.scene.remove(projectile.object);
                projectile.material.dispose();
                this.projectiles.splice(i, 1);
                if (projectile.onHit) projectile.onHit(impact);
                continue;
            }

            projectile.object.position.addScaledVector(toTarget.normalize(), step);
        }
    }

    update(delta) {
        this.updateProjectiles(delta);

        for (let i = this.effects.length - 1; i >= 0; i--) {
            const effect = this.effects[i];
            effect.life += delta;
            const t = Math.min(1, effect.life / effect.maxLife);
            if (effect.update) effect.update(effect, delta, t);

            if (effect.life >= effect.maxLife) {
                this.scene.remove(effect.object);
                if (effect.object.isSprite) {
                    effect.object.material.dispose();
                }
                if (effect.dispose) effect.dispose();
                this.effects.splice(i, 1);
            }
        }
    }
}
