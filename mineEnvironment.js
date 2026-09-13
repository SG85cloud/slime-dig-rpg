import * as THREE from 'three';

/**
 * Visual bands used by both the 3D environment and the depth HUD.
 * Progress is 0 at B30F and 1 at the surface.
 */
export function getMineTheme(progress = 0) {
    const t = THREE.MathUtils.clamp(progress, 0, 1);
    // The three playable bands line up exactly with B21~30, B11~20 and B1~10.
    if (t < 1 / 3) {
        return {
            id: 'deep',
            element: '공허',
            label: '공허 현무암층 · 지하 21~30층',
            detail: '보랏빛 현무암과 유령 수정이 빛을 삼키는 심층 갱도',
            accent: '#b58cff',
            sky: 0x100c1d,
            fog: 0x171027,
            floor: 0x3d2b52
        };
    }
    if (t < 2 / 3) {
        return {
            id: 'veins',
            element: '빙정·금속',
            label: '빙정 금속층 · 지하 11~20층',
            detail: '푸른 빙정과 차가운 금속 광맥이 서리를 뿜는 중간 갱도',
            accent: '#7de4e2',
            sky: 0x10202a,
            fog: 0x16313a,
            floor: 0x385963
        };
    }
    if (t < 1) {
        return {
            id: 'fissures',
            element: '화염',
            label: '마그마 균열층 · 지하 1~10층',
            detail: '붉은 용암과 황금빛 열기가 지상으로 밀려 올라오는 화염 갱도',
            accent: '#ffb36b',
            sky: 0x2a1717,
            fog: 0x3b201b,
            floor: 0x704331
        };
    }
    return {
        id: 'threshold',
        element: '태양석',
        label: '태양석 전실 · 지상',
        detail: '햇빛과 이끼가 스며드는 마지막 암반과 오래된 승강장',
        accent: '#ffe39a',
        sky: 0x4d3525,
        fog: 0x765136,
        floor: 0x98765a
    };
}

export function getWaveTheme(wave = 1) {
    const cycle = (Math.max(1, wave) - 1) % 4;
    const themes = [
        {
            id: 'wave-void',
            element: '공허',
            label: '공허 방어 결계',
            detail: '네 원소 제단이 포위망을 이루는 웨이브 전용 결투장',
            accent: '#bb8cff', sky: 0x0b0718, fog: 0x1a1030, floor: 0x302044
        },
        {
            id: 'wave-frost',
            element: '빙정',
            label: '빙정 방어 결계',
            detail: '얼어붙은 룬과 청백색 서리가 적의 발을 늦추는 방어 결투장',
            accent: '#89f1ff', sky: 0x071923, fog: 0x10394a, floor: 0x315968
        },
        {
            id: 'wave-flame',
            element: '화염',
            label: '화염 방어 결계',
            detail: '용암 고리와 불씨 제단이 포위된 광부를 감싸는 방어 결투장',
            accent: '#ff8a4d', sky: 0x210b0b, fog: 0x4b1b16, floor: 0x693523
        },
        {
            id: 'wave-spore',
            element: '균사',
            label: '균사 방어 결계',
            detail: '독성 포자와 녹색 룬이 어둠 속에서 맥동하는 방어 결투장',
            accent: '#b9f27c', sky: 0x0a170f, fog: 0x18351d, floor: 0x3c5a3b
        }
    ];
    return themes[cycle];
}

function makeMaterial(options) {
    return new THREE.MeshStandardMaterial({
        roughness: options.roughness ?? 0.82,
        metalness: options.metalness ?? 0.05,
        color: options.color ?? 0xffffff,
        emissive: options.emissive ?? 0x000000,
        emissiveIntensity: options.emissiveIntensity ?? 0,
        transparent: options.transparent ?? false,
        opacity: options.opacity ?? 1,
        depthWrite: options.depthWrite ?? true
    });
}

function addShadowFlags(object, cast = true, receive = true) {
    object.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = cast;
            child.receiveShadow = receive;
        }
    });
    return object;
}

/**
 * A modest procedural set dressing layer around the playable clearing.
 * It is generated once and then recoloured/faded as the player climbs, so floor
 * changes never create a new renderer or a growing pile of GPU resources.
 */
export class MineEnvironment {
    constructor(scene) {
        this.scene = scene;
        this.root = new THREE.Group();
        this.root.name = 'procedural-mine-environment';
        this.scene.add(this.root);

        this.deepGroup = new THREE.Group();
        this.veinGroup = new THREE.Group();
        this.fissureGroup = new THREE.Group();
        this.thresholdGroup = new THREE.Group();
        this.waveGroup = new THREE.Group();
        this.waveGroup.name = 'elemental-wave-arena';
        this.root.add(this.deepGroup, this.veinGroup, this.fissureGroup, this.thresholdGroup, this.waveGroup);

        this.deepMaterials = [];
        this.veinMaterials = [];
        this.fissureMaterials = [];
        this.thresholdMaterials = [];
        this.waveMaterials = [];
        this.warmLights = [];
        this.waveLights = [];
        this.crystalMotes = [];
        this.waveMotes = [];
        this.progress = 0;
        this.waveActive = false;
        this.wave = 0;
        this.currentTheme = getMineTheme(0);

        this.buildDeepBand();
        this.buildVeinBand();
        this.buildFissureBand();
        this.buildThresholdBand();
        this.buildWaveArena();
        this.setProgress(0);
    }

    registerMaterial(material, band) {
        this[`${band}Materials`].push(material);
        return material;
    }

    rockMaterial(color, band, options = {}) {
        return this.registerMaterial(makeMaterial({
            color,
            roughness: options.roughness ?? 0.94,
            metalness: options.metalness ?? 0.02
        }), band);
    }

    crystalMaterial(color, band, emissiveIntensity = 0.55) {
        return this.registerMaterial(makeMaterial({
            color,
            roughness: 0.28,
            metalness: 0.18,
            emissive: color,
            emissiveIntensity,
            transparent: true,
            opacity: 0.95
        }), band);
    }

    addRock(group, material, position, scale, rotation = {}) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), material);
        rock.position.copy(position);
        rock.scale.set(scale.x, scale.y, scale.z);
        rock.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
        addShadowFlags(rock);
        group.add(rock);
        return rock;
    }

    addCrystalCluster(group, material, position, scale, rotation = 0) {
        const cluster = new THREE.Group();
        cluster.position.copy(position);
        cluster.rotation.y = rotation;

        const heights = [1, 0.72, 0.52];
        heights.forEach((height, index) => {
            const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 0), material);
            crystal.position.set((index - 1) * 0.48, height * 0.55, (index % 2) * 0.24 - 0.12);
            crystal.scale.set(0.52, height, 0.52);
            crystal.rotation.z = (index - 1) * 0.22;
            addShadowFlags(crystal, true, false);
            cluster.add(crystal);
        });

        cluster.scale.setScalar(scale);
        group.add(cluster);
        this.crystalMotes.push(cluster);
        return cluster;
    }

    buildDeepBand() {
        const rock = this.rockMaterial(0x291b3d, 'deep');
        const rockLight = this.rockMaterial(0x4a2c62, 'deep');
        const purpleCrystal = this.crystalMaterial(0x9b5de5, 'deep', 0.72);

        // Broken ring of violet bedrock keeps the playable centre open while
        // giving the mine a cave silhouette from the isometric camera.
        for (let i = 0; i < 18; i++) {
            const angle = (i / 18) * Math.PI * 2;
            const radius = 20.2 + (i % 3) * 0.55;
            const height = 3.5 + (i % 5) * 0.8;
            this.addRock(
                this.deepGroup,
                i % 4 === 0 ? rockLight : rock,
                new THREE.Vector3(Math.cos(angle) * radius, height * 0.5, Math.sin(angle) * radius),
                new THREE.Vector3(2.2 + (i % 3) * 0.4, height, 1.55 + (i % 2) * 0.35),
                { x: 0.08 * (i % 2), y: angle + 0.3, z: -0.1 * (i % 3) }
            );
        }

        // A few tall formations break the otherwise flat horizon.
        [
            [-16, 0, -13, 1.2], [14, 0, -15, 1], [-18, 0, 10, 0.85], [17, 0, 12, 1.15]
        ].forEach(([x, y, z, scale], index) => {
            const spire = new THREE.Mesh(new THREE.ConeGeometry(1.3 * scale, 6 + (index % 2) * 2, 6), rockLight);
            spire.position.set(x, 3, z);
            spire.rotation.y = index * 0.7;
            addShadowFlags(spire);
            this.deepGroup.add(spire);
        });

        [
            [-17.6, 0, -7], [17.5, 0, -4], [-15, 0, 16], [11, 0, 16], [19, 0, 3]
        ].forEach(([x, y, z], index) => {
            this.addCrystalCluster(
                this.deepGroup,
                purpleCrystal,
                new THREE.Vector3(x, y, z),
                0.9 + (index % 3) * 0.18,
                index * 0.75
            );
        });
    }

    buildVeinBand() {
        const slate = this.rockMaterial(0x243a43, 'vein', { roughness: 0.78 });
        const metal = this.rockMaterial(0x536b73, 'vein', { roughness: 0.42, metalness: 0.52 });
        const cyanCrystal = this.crystalMaterial(0x42d6d0, 'vein', 0.82);
        const goldCrystal = this.crystalMaterial(0xe6aa4d, 'vein', 0.68);

        // Layered seam slabs suggest exposed strata rather than generic rocks.
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2 + 0.18;
            const radius = 18.8 + (i % 2) * 1.1;
            const slab = new THREE.Mesh(
                new THREE.BoxGeometry(3.1 + (i % 3) * 0.5, 1.2 + (i % 2) * 0.7, 0.34),
                i % 3 === 0 ? metal : slate
            );
            slab.position.set(Math.cos(angle) * radius, 1.3 + (i % 3) * 1.35, Math.sin(angle) * radius);
            slab.rotation.set(0.1 * (i % 2), angle + Math.PI * 0.5, -0.18 + (i % 3) * 0.12);
            addShadowFlags(slab);
            this.veinGroup.add(slab);
        }

        [
            [-18, 0, -10, cyanCrystal], [18, 0, -11, goldCrystal], [-19, 0, 6, goldCrystal],
            [18, 0, 8, cyanCrystal], [-10, 0, 19, cyanCrystal], [10, 0, 19, goldCrystal]
        ].forEach(([x, y, z, material], index) => {
            this.addCrystalCluster(
                this.veinGroup,
                material,
                new THREE.Vector3(x, y, z),
                1.05 + (index % 2) * 0.18,
                index * 0.9
            );
        });

        // Hanging vein teeth make the middle band read vertically in the camera.
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2 + 0.35;
            const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.8 + (i % 3) * 0.6, 5), cyanCrystal);
            tooth.position.set(Math.cos(angle) * 19.5, 6.7 + (i % 2) * 0.6, Math.sin(angle) * 19.5);
            tooth.rotation.z = Math.PI;
            addShadowFlags(tooth, true, false);
            this.veinGroup.add(tooth);
        }
    }

    addCrack(group, points, material) {
        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i];
            const end = points[i + 1];
            const direction = new THREE.Vector3().subVectors(end, start);
            const length = direction.length();
            const segment = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, length, 5), material);
            segment.position.copy(start).add(end).multiplyScalar(0.5);
            segment.position.y = 0.055;
            segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
            segment.castShadow = false;
            group.add(segment);
        }
    }

    buildFissureBand() {
        const warmRock = this.rockMaterial(0x5d3029, 'fissure', { roughness: 0.88 });
        const emberRock = this.rockMaterial(0x834431, 'fissure', { roughness: 0.62 });
        const ember = this.registerMaterial(makeMaterial({
            color: 0xff6b32,
            emissive: 0xff3b12,
            emissiveIntensity: 2.8,
            roughness: 0.32,
            transparent: true,
            opacity: 0.95
        }), 'fissure');
        const amber = this.crystalMaterial(0xffa23c, 'fissure', 1.35);

        // Warm stone ribs and a broken arch frame the approach to daylight.
        [-10, 10].forEach((x, index) => {
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 7.2, 7), index === 0 ? warmRock : emberRock);
            pillar.position.set(x, 3.6, -17.8);
            pillar.rotation.z = index === 0 ? -0.08 : 0.08;
            addShadowFlags(pillar);
            this.fissureGroup.add(pillar);
        });
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(22, 1.25, 1.25), emberRock);
        lintel.position.set(0, 7.2, -17.8);
        lintel.rotation.z = 0.035;
        addShadowFlags(lintel);
        this.fissureGroup.add(lintel);

        const cracks = [
            [new THREE.Vector3(-14, 0, 3), new THREE.Vector3(-8, 0, 1), new THREE.Vector3(-4, 0, -2), new THREE.Vector3(1, 0, -1)],
            [new THREE.Vector3(14, 0, 5), new THREE.Vector3(9, 0, 2), new THREE.Vector3(6, 0, -1), new THREE.Vector3(3, 0, -5)],
            [new THREE.Vector3(-5, 0, 17), new THREE.Vector3(-3, 0, 11), new THREE.Vector3(1, 0, 8), new THREE.Vector3(5, 0, 7)],
            [new THREE.Vector3(7, 0, 17), new THREE.Vector3(6, 0, 13), new THREE.Vector3(9, 0, 10)]
        ];
        cracks.forEach((points) => this.addCrack(this.fissureGroup, points, ember));

        [
            [-15, 0, -11], [15, 0, -11], [-13, 0, 12], [14, 0, 13], [0, 0, 18]
        ].forEach(([x, y, z], index) => {
            this.addCrystalCluster(this.fissureGroup, amber, new THREE.Vector3(x, y, z), 0.82 + (index % 2) * 0.16, index);
            const light = new THREE.PointLight(0xff6a35, 1.9, 8.5, 2);
            light.position.set(x, 2.1, z);
            this.fissureGroup.add(light);
            this.warmLights.push(light);
        });

        // A glowing threshold ring makes the last few floors feel like an arrival,
        // not merely another recolour of the same room.
        const ring = new THREE.Mesh(new THREE.TorusGeometry(8.6, 0.16, 6, 48), ember);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(0, 0.08, -12.2);
        this.fissureGroup.add(ring);
    }

    buildThresholdBand() {
        const sandstone = this.rockMaterial(0x8f6748, 'threshold', { roughness: 0.9 });
        const sunstone = this.registerMaterial(makeMaterial({
            color: 0xffc66d,
            emissive: 0xff8d35,
            emissiveIntensity: 1.7,
            roughness: 0.3,
            transparent: true,
            opacity: 0.85
        }), 'threshold');
        const moss = this.crystalMaterial(0xb7d77b, 'threshold', 0.3);

        // Old lift markers and low sunlit stone blocks appear only at the threshold.
        for (let i = 0; i < 9; i++) {
            const x = -17 + i * 4.25;
            const block = new THREE.Mesh(new THREE.BoxGeometry(3.25, 1.1 + (i % 2) * 0.4, 1.5), sandstone);
            block.position.set(x, 0.6, -20.2 - (i % 2) * 0.7);
            block.rotation.y = (i % 2 ? -1 : 1) * 0.08;
            addShadowFlags(block);
            this.thresholdGroup.add(block);
        }

        const opening = new THREE.Mesh(new THREE.RingGeometry(5.2, 7.1, 32), sunstone);
        opening.rotation.x = -Math.PI / 2;
        opening.position.set(0, 0.11, -16.5);
        this.thresholdGroup.add(opening);

        for (let i = 0; i < 14; i++) {
            const angle = (i / 14) * Math.PI * 2;
            const x = Math.cos(angle) * (16 + (i % 2) * 2);
            const z = Math.sin(angle) * (16 + (i % 2) * 2);
            this.addCrystalCluster(this.thresholdGroup, moss, new THREE.Vector3(x, 0, z), 0.5 + (i % 3) * 0.12, angle);
        }
    }

    buildWaveArena() {
        const obsidian = this.rockMaterial(0x191326, 'wave', { roughness: 0.72, metalness: 0.18 });
        const rune = this.registerMaterial(makeMaterial({
            color: 0x8d52c7,
            emissive: 0x5f2b9c,
            emissiveIntensity: 1.8,
            roughness: 0.3,
            metalness: 0.3,
            transparent: true,
            opacity: 0.92
        }), 'wave');
        const voidGlow = this.registerMaterial(makeMaterial({
            color: 0xb875ff,
            emissive: 0x7d32d2,
            emissiveIntensity: 2.4,
            roughness: 0.24,
            metalness: 0.22
        }), 'wave');
        const frostGlow = this.registerMaterial(makeMaterial({
            color: 0x8ceeff,
            emissive: 0x2daecb,
            emissiveIntensity: 2.2,
            roughness: 0.2,
            metalness: 0.25
        }), 'wave');
        const flameGlow = this.registerMaterial(makeMaterial({
            color: 0xff713b,
            emissive: 0xff2b0c,
            emissiveIntensity: 2.6,
            roughness: 0.25,
            metalness: 0.12
        }), 'wave');
        const sporeGlow = this.registerMaterial(makeMaterial({
            color: 0xb5ef70,
            emissive: 0x4aa82b,
            emissiveIntensity: 1.9,
            roughness: 0.34,
            metalness: 0.08
        }), 'wave');
        const elementMaterials = [voidGlow, frostGlow, flameGlow, sporeGlow];
        const elementColors = [0xb875ff, 0x8ceeff, 0xff713b, 0xb5ef70];

        const arena = new THREE.Mesh(new THREE.CylinderGeometry(17.5, 17.5, 0.16, 64), obsidian);
        arena.position.y = -0.02;
        arena.receiveShadow = true;
        this.waveGroup.add(arena);

        [7.5, 13.5, 18.5].forEach((radius, index) => {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(radius, index === 2 ? 0.18 : 0.08, 6, 72),
                index === 2 ? rune : elementMaterials[index]
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.09 + index * 0.012;
            this.waveGroup.add(ring);
        });

        for (let i = 0; i < 20; i++) {
            const angle = (i / 20) * Math.PI * 2;
            const radius = 19 + (i % 3) * 0.45;
            this.addRock(
                this.waveGroup,
                i % 4 === 0 ? rune : obsidian,
                new THREE.Vector3(Math.cos(angle) * radius, 0.6 + (i % 3) * 0.28, Math.sin(angle) * radius),
                new THREE.Vector3(1.1 + (i % 2) * 0.3, 1.2 + (i % 3) * 0.35, 0.9 + (i % 2) * 0.2),
                { y: angle, z: -0.12 + (i % 2) * 0.16 }
            );
        }

        const shrines = [
            [-14.5, -7.5], [14.5, -7.5], [-14.5, 7.5], [14.5, 7.5]
        ];
        shrines.forEach(([x, z], index) => {
            const shrineMaterial = index === 0 ? obsidian : elementMaterials[index - 1];
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 1.05, 3.6, 7), shrineMaterial);
            pillar.position.set(x, 1.8, z);
            pillar.rotation.y = index * 0.8;
            addShadowFlags(pillar);
            this.waveGroup.add(pillar);

            const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.82, 0), elementMaterials[index]);
            crown.position.set(x, 4.05, z);
            crown.scale.y = 1.35;
            addShadowFlags(crown, true, false);
            this.waveGroup.add(crown);

            const light = new THREE.PointLight(elementColors[index], 2.6, 9, 2);
            light.position.set(x, 3.3, z);
            this.waveGroup.add(light);
            this.waveLights.push(light);
        });

        for (let i = 0; i < 28; i++) {
            const angle = (i / 28) * Math.PI * 2;
            const radius = 4 + (i % 5) * 2.25;
            const mote = new THREE.Mesh(
                new THREE.SphereGeometry(0.075 + (i % 3) * 0.025, 6, 4),
                elementMaterials[i % elementMaterials.length]
            );
            mote.position.set(Math.cos(angle) * radius, 0.45 + (i % 4) * 0.22, Math.sin(angle) * radius);
            mote.userData.baseY = mote.position.y;
            mote.userData.orbit = angle;
            mote.userData.radius = radius;
            mote.userData.speed = 0.18 + (i % 4) * 0.035;
            mote.castShadow = false;
            this.waveGroup.add(mote);
            this.waveMotes.push(mote);
        }

        this.waveGroup.visible = false;
    }

    setGroupOpacity(group, amount) {
        const opacity = THREE.MathUtils.clamp(amount, 0, 1);
        group.visible = opacity > 0.015;
        group.traverse((child) => {
            if (!child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (material.transparent || opacity < 0.99) {
                    material.transparent = true;
                    material.opacity = opacity * (material.userData.baseOpacity ?? 1);
                    material.depthWrite = opacity > 0.72;
                }
            });
        });
    }

    setProgress(progress = 0) {
        const t = THREE.MathUtils.clamp(progress, 0, 1);
        const theme = getMineTheme(t);
        this.progress = t;
        this.depthTheme = theme;

        // Crossfade only at the exact borders of the three floor bands. Each
        // range therefore reads as its own map instead of a permanent purple
        // room with a slightly different tint.
        const deepFade = THREE.MathUtils.smoothstep(t, 0.29, 0.36);
        const veinIn = THREE.MathUtils.smoothstep(t, 0.29, 0.37);
        const veinOut = THREE.MathUtils.smoothstep(t, 0.63, 0.70);
        const fissureIn = THREE.MathUtils.smoothstep(t, 0.63, 0.71);
        const fissureOut = THREE.MathUtils.smoothstep(t, 0.96, 1);
        const thresholdIn = THREE.MathUtils.smoothstep(t, 0.95, 1);

        if (!this.waveActive) {
            this.setGroupOpacity(this.deepGroup, 1 - deepFade * 0.96);
            this.setGroupOpacity(this.veinGroup, veinIn * (1 - veinOut));
            this.setGroupOpacity(this.fissureGroup, fissureIn * (1 - fissureOut));
            this.setGroupOpacity(this.thresholdGroup, thresholdIn);
            this.waveGroup.visible = false;
            this.currentTheme = theme;
            this.scene.background?.set(theme.sky);
            if (this.scene.fog) this.scene.fog.color.set(theme.fog);
        }

        const deepColor = new THREE.Color(0x291b3d).lerp(new THREE.Color(0x59352a), t * 0.72);
        this.deepMaterials.forEach((material) => material.color.copy(deepColor));
        this.veinMaterials.forEach((material) => {
            material.emissiveIntensity = material.emissive?.getHex() === 0x42d6d0 ? 0.72 + t * 0.32 : 0.58 + t * 0.28;
        });
        this.fissureMaterials.forEach((material) => {
            material.emissiveIntensity = 1.8 + t * 1.3;
        });

        return this.getCurrentTheme();
    }

    setWaveMode(active, wave = this.wave) {
        this.waveActive = !!active;
        this.wave = Math.max(1, wave || 1);
        this.waveGroup.visible = this.waveActive;
        if (this.waveActive) {
            this.deepGroup.visible = false;
            this.veinGroup.visible = false;
            this.fissureGroup.visible = false;
            this.thresholdGroup.visible = false;
            this.currentTheme = getWaveTheme(this.wave);
            this.scene.background?.set(this.currentTheme.sky);
            if (this.scene.fog) this.scene.fog.color.set(this.currentTheme.fog);
        } else {
            this.setProgress(this.progress);
        }
        return this.currentTheme;
    }

    getCurrentTheme() {
        return this.waveActive ? getWaveTheme(this.wave) : (this.depthTheme || getMineTheme(this.progress));
    }

    update(delta, elapsed) {
        // The fissures breathe gently rather than strobing. The lights are few,
        // shared by the whole near-surface band, and never recreated per frame.
        this.warmLights.forEach((light, index) => {
            const pulse = 0.9 + Math.sin(elapsed * 3.1 + index * 1.7) * 0.1;
            light.intensity = 1.9 * pulse;
        });

        this.waveLights.forEach((light, index) => {
            const pulse = 0.88 + Math.sin(elapsed * 2.6 + index * 1.35) * 0.16;
            light.intensity = 2.6 * pulse;
        });

        this.crystalMotes.forEach((cluster, index) => {
            cluster.position.y += Math.sin(elapsed * 1.4 + index * 0.65) * delta * 0.012;
        });

        this.waveMotes.forEach((mote) => {
            const orbit = mote.userData.orbit + elapsed * mote.userData.speed;
            mote.position.x = Math.cos(orbit) * mote.userData.radius;
            mote.position.z = Math.sin(orbit) * mote.userData.radius;
            mote.position.y = mote.userData.baseY + Math.sin(elapsed * 2.1 + mote.userData.orbit) * 0.16;
        });
    }
}
