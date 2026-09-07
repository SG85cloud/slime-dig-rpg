import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Game } from './gameLogic.js';
import { UI } from './ui.js';
import { initMultiplayer } from './multiplayer.js';

class App {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x100c1d);
        this.scene.fog = new THREE.FogExp2(0x100c1d, 0.035);

        const aspect = window.innerWidth / window.innerHeight;
        const d = 10;
        this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
        
        // Isometric view position
        this.cameraOffset = new THREE.Vector3(20, 20, 20);
        this.camera.position.copy(this.cameraOffset);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setClearColor(0x100c1d, 1);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.45;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        document.getElementById('game-container').appendChild(this.renderer.domElement);

        this.timer = new THREE.Timer();
        this.loader = new GLTFLoader();
        this.texLoader = new THREE.TextureLoader();
        
        this.assets = {};
        this.init();
    }

    async init() {
        await this.loadAssets();
        
        this.ui = new UI();
        this.multiplayer = await initMultiplayer();
        this.game = new Game(this);
        
        window.addEventListener('resize', () => this.onResize());
        this.animate();
    }

    async loadAssets() {
        const loadModel = (path) => new Promise(res => this.loader.load(path, gltf => res(gltf.scene)));
        const loadTex = (path) => new Promise(res => this.texLoader.load(path, tex => {
            tex.colorSpace = THREE.SRGBColorSpace;
            res(tex);
        }));

        const assetPaths = {
            'leader': 'assets/models/leader-slime.glb',
            'worker': 'assets/models/worker-slime.glb',
            'coal': 'assets/models/coal-node.glb',
            'iron': 'assets/models/iron-node.glb',
            'gold': 'assets/models/gold-node.glb',
            'mithril': 'assets/models/mithril-node.glb',
            'crawler': 'assets/models/mine-crawler.glb',
            'brute': 'assets/models/bone-brute.glb',
            'archer': 'assets/models/shadow-archer.glb',
            'overlord': 'assets/models/mine-overlord.glb',
            'floor': 'assets/dungeon-floor.webp'
        };

        for (const [key, path] of Object.entries(assetPaths)) {
            if (path.endsWith('.glb')) {
                this.assets[key] = await loadModel(path);
            } else {
                this.assets[key] = await loadTex(path);
            }
        }
    }

    onResize() {
        const aspect = window.innerWidth / window.innerHeight;
        const d = 10;
        this.camera.left = -d * aspect;
        this.camera.right = d * aspect;
        this.camera.top = d;
        this.camera.bottom = -d;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate(timestamp) {
        requestAnimationFrame((t) => this.animate(t));
        this.timer.update(timestamp);
        const delta = this.timer.getDelta();
        
        if (this.game) {
            this.game.update(delta);
            this.followPlayer(delta);
        }

        this.renderer.render(this.scene, this.camera);
    }

    // Impact camera shake. Combat calls this on heavy hits and deaths.
    addShake(amount) {
        this.shake = Math.min(1.1, (this.shake || 0) + amount);
    }

    // Keep the isometric camera centered on the leader so it never walks off screen.
    followPlayer(delta) {
        const player = this.game?.player;
        if (!player) return;

        const smoothing = 1 - Math.pow(0.0025, Math.min(delta, 0.1));
        this.cameraTarget = this.cameraTarget || new THREE.Vector3();
        this.cameraTarget.lerp(player.position, smoothing);

        this.camera.position.copy(this.cameraTarget).add(this.cameraOffset);

        this.shake = Math.max(0, (this.shake || 0) - delta * 3.4);
        if (this.shake > 0.001) {
            const magnitude = this.shake * this.shake * 1.6;
            this.camera.position.x += (Math.random() - 0.5) * magnitude;
            this.camera.position.y += (Math.random() - 0.5) * magnitude;
            this.camera.position.z += (Math.random() - 0.5) * magnitude;
        }

        this.camera.lookAt(this.cameraTarget);
    }
}

new App();
