export class UI {
    constructor() {
        this.container = document.createElement('div');
        this.container.id = 'ui-container';
        this.container.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            color: white;
            font-family: 'Orbitron', sans-serif;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
        `;
        document.body.appendChild(this.container);

        this.commandHandler = null;
        this.battleActionHandler = null;
        this.activeCommand = 'mine';
        this.battleOpen = false;
        this.battleResult = null;
        this.statHandler = null;
        this.facilityHandler = null;
        this.metaHandler = null;
        this.metaData = null;
        this.traitData = null;
        this.traitFilter = 'all';
        this.resetHandler = null;
        this.craftHandlers = null;
        this.craftOpen = false;
        this.craftMix = { coal: 0, iron: 0, gold: 0, mithril: 0 };
        this.craftSlot = 'weapon';
        this.equipmentData = null;
        this.statusOpen = false;
        this.rewardOpen = false;
        this.openDock = null;
        this.lastPlayerHp = 0;
        this.lastMaxPlayerHp = 0;
        this.lastWorkerCount = 0;
        this.initHUD();
        this.initTraitCodex();
        this.initDepthPanel();
        this.initQuestPanel();
        this.initStatPanel();
        this.initCommandPanel();
        this.initBattleOverlay();
        this.initCraftWorkshop();
        this.initProgressNotice();
        this.initAudioPrompt();
        this.initStatusWindow();
        this.initWaveReward();
        this.initShortcuts();
    }

    /**
     * Keyboard access to the item/equipment window. I(nventory) and C(raft) both
     * toggle it, and Escape closes it, so the player never has to hunt for the
     * button in the corner HUD.
     */
    initShortcuts() {
        window.addEventListener('keydown', (event) => {
            // Never steal keys while the player is typing in a field.
            const tag = event.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            // The reward choice must be made; no shortcut may dismiss it.
            if (this.rewardOpen) return;

            const key = event.key.toLowerCase();
            if (key === 'i' || key === 'c') {
                event.preventDefault();
                this.closeStatusWindow();
                this.closeDockPanels();
                if (this.craftOpen) this.closeCraftWorkshop();
                else this.openCraftWorkshop();
            } else if (key === 'v') {
                event.preventDefault();
                this.closeCraftWorkshop();
                this.closeDockPanels();
                if (this.statusOpen) this.closeStatusWindow();
                else this.openStatusWindow();
            } else if (key === 'escape') {
                if (this.craftOpen || this.statusOpen || this.openDock) event.preventDefault();
                this.closeCraftWorkshop();
                this.closeStatusWindow();
                this.closeDockPanels();
            }
        });
    }

    // -------------------------------------------------------- status window
    // Innate traits used to sit permanently in the corner HUD, which crowded the
    // screen. They now live in an on-demand window opened from the status card.
    initStatusWindow() {
        this.statusOverlay = document.createElement('div');
        this.statusOverlay.style.cssText = `
            position: absolute;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(6, 5, 12, .72);
            backdrop-filter: blur(3px);
            pointer-events: auto;
            z-index: 97;
        `;
        this.statusOverlay.innerHTML = `
            <div class="status-card" style="width:min(560px, calc(100vw - 40px)); max-height:calc(100vh - 80px);
                        display:flex; flex-direction:column; box-sizing:border-box; padding:20px 22px;
                        border:2px solid #4a89a0; border-radius:14px;
                        background:linear-gradient(150deg, rgba(21,28,38,.98), rgba(9,10,17,.98));
                        box-shadow:0 22px 60px rgba(0,0,0,.6); font-family:Inter, sans-serif;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px;">
                    <div>
                        <div style="font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#7fd4e8;">LEADER STATUS</div>
                        <h2 style="margin:6px 0 0; color:#eafaff; font:700 clamp(18px,3vw,24px) Orbitron, sans-serif;">리더 상태 · 태생 특성</h2>
                    </div>
                    <button class="status-close" type="button" style="cursor:pointer; border:1px solid #4a89a0;
                            background:rgba(255,255,255,.06); color:#dff3fa; border-radius:8px; padding:7px 13px;
                            font:700 12px Inter, sans-serif; flex:none;">닫기 (ESC)</button>
                </div>
                <div class="status-vitals" style="margin-top:16px; display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:9px;"></div>
                <div style="margin-top:18px; display:flex; justify-content:space-between; align-items:baseline; gap:10px;">
                    <div style="font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#ffcc00;">태생 특성</div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div class="status-trait-count" style="font-size:11.5px; color:#8d80a0;"></div>
                        <button class="status-reroll" type="button" style="cursor:pointer; border:1px solid #a875ca;
                                background:rgba(168,117,202,.14); color:#e8dcf5; border-radius:7px; padding:4px 9px;
                                font:700 10.5px Inter, sans-serif; flex:none;">🎲 특성 변경 (0장)</button>
                    </div>
                </div>
                <div class="status-traits" style="margin-top:10px; display:grid; gap:8px; overflow-y:auto;
                            padding-right:4px; min-height:0;"></div>
                <div style="margin-top:18px; display:flex; justify-content:space-between; align-items:baseline;">
                    <div style="font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#c9a6ff;">🏛 유산</div>
                    <div class="legacy-points" style="font-size:11.5px; color:#8d80a0;"></div>
                </div>
                <div style="font-size:11px; color:#8d80a0; margin-top:3px;">과거 광부들이 남긴 포인트로, 새로 태어날 광부에게 영구 혜택을 물려줍니다.</div>
                <div class="legacy-rows" style="margin-top:9px; display:grid; gap:7px;"></div>
                <button class="status-codex" type="button" style="margin-top:14px; width:100%; padding:9px;
                        border:1px solid #6c568d; border-radius:7px; background:#2a203a; color:#e8dcf5;
                        font:700 12px Inter, sans-serif; cursor:pointer; flex:none;">특성 도감 보기</button>
            </div>
        `;
        this.container.appendChild(this.statusOverlay);

        this.statusOverlay.querySelector('.status-close')
            .addEventListener('click', () => this.closeStatusWindow());
        this.statusOverlay.querySelector('.status-codex')
            .addEventListener('click', () => {
                this.closeStatusWindow();
                this.openTraitCodex();
            });
        this.statusOverlay.querySelector('.status-reroll').addEventListener('click', () => {
            if (this.traitRerollHandler) this.traitRerollHandler();
        });
        // Clicking the dimmed backdrop closes, clicking the card itself does not.
        this.statusOverlay.addEventListener('click', (event) => {
            if (event.target === this.statusOverlay) this.closeStatusWindow();
        });
    }

    openStatusWindow() {
        if (!this.statusOverlay) return;
        this.statusOpen = true;
        this.statusOverlay.style.display = 'flex';
        this.renderStatusWindow();
    }

    closeStatusWindow() {
        if (!this.statusOverlay) return;
        this.statusOpen = false;
        this.statusOverlay.style.display = 'none';
    }

    renderStatusWindow() {
        if (!this.statusOverlay) return;

        const equip = this.equipmentData;
        const vitals = [
            ['체력', `${Math.ceil(this.lastPlayerHp ?? 0)} / ${this.lastMaxPlayerHp ?? 0}`, '#9fe8ff'],
            ['공격력', `${Math.round(equip?.totalAttack ?? 10)}`, '#ff9c9c'],
            ['워커 슬라임', this.workerData?.count
                ? `${this.workerData.count}명 · 평균 Lv.${this.workerData.avgLevel}`
                : `${this.lastWorkerCount ?? 0}명`, '#d7c4ed'],
            ['장착 무기', equip?.equipped ? equip.equipped.name : '맨손', equip?.tier?.color || '#8d80a0'],
            ['장착 방어구', equip?.equippedArmor ? equip.equippedArmor.name : '없음', equip?.equippedArmor ? '#8fc4ff' : '#8d80a0'],
            ['장착 장신구', equip?.equippedAccessory ? equip.equippedAccessory.name : '없음', equip?.equippedAccessory ? '#c7a3ef' : '#8d80a0']
        ];
        this.statusOverlay.querySelector('.status-vitals').innerHTML = vitals
            .map(([label, value, color]) => `
                <div style="padding:10px 11px; border-radius:9px; border:1px solid #33465a; background:rgba(255,255,255,.03);">
                    <div style="font-size:10.5px; letter-spacing:1px; color:#8fa3b5;">${label}</div>
                    <div style="margin-top:3px; font-size:14px; font-weight:800; color:${color};">${value}</div>
                </div>
            `).join('');

        this.renderLegacyShop();

        const owned = this.traitData?.owned || [];
        this.statusOverlay.querySelector('.status-trait-count').textContent = `${owned.length}개 보유`;

        const tickets = this.traitData?.rerollTickets || 0;
        const rerollBtn = this.statusOverlay.querySelector('.status-reroll');
        rerollBtn.textContent = `🎲 특성 변경 (${tickets}장)`;
        const canReroll = tickets > 0 && owned.length > 0;
        rerollBtn.disabled = !canReroll;
        rerollBtn.style.opacity = canReroll ? '1' : '0.45';
        rerollBtn.style.cursor = canReroll ? 'pointer' : 'not-allowed';

        const traitsEl = this.statusOverlay.querySelector('.status-traits');
        if (owned.length === 0) {
            traitsEl.innerHTML = `<div style="color:#8d80a0; font-size:12.5px; padding:8px 2px;">보유한 태생 특성이 없습니다.</div>`;
            return;
        }
        traitsEl.innerHTML = owned.map((trait) => {
            const category = this.traitData.categories[trait.category] || { label: '', color: '#ccc' };
            return `
                <div style="padding:10px 12px; border-radius:9px; border:1px solid #3b3048; background:rgba(255,255,255,.03);">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span style="font-size:10.5px; padding:2px 7px; border-radius:999px;
                                     border:1px solid ${category.color}; color:${category.color};">${category.label}</span>
                        <span style="font-size:13.5px; font-weight:800; color:#fff1d1;">${trait.name}</span>
                    </div>
                    <div style="margin-top:5px; color:#bfb2cc; font-size:12px; line-height:1.5;">${trait.description}</div>
                </div>
            `;
        }).join('');
    }

    setMetaHandler(handler) {
        this.metaHandler = handler;
    }

    // Legacy shop: rows are (re)built every render since the upgrade list is
    // short and this only runs while the status window is open, not per frame.
    renderLegacyShop() {
        if (!this.statusOverlay || !this.metaData) return;
        this.statusOverlay.querySelector('.legacy-points').textContent = `보유 ${this.metaData.points} 포인트`;

        const rows = this.statusOverlay.querySelector('.legacy-rows');
        rows.innerHTML = this.metaData.upgrades.map((upgrade) => `
            <div style="display:flex; align-items:center; gap:9px; padding:9px 10px; border-radius:9px;
                        border:1px solid #4b3a5d; background:rgba(255,255,255,.03);">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:12.5px; font-weight:700; color:#e8d8ff;">
                        ${upgrade.label} <span style="color:#a99bb8; font-weight:400;">Lv.${upgrade.level}/${upgrade.maxLevel}</span>
                    </div>
                    <div style="font-size:11px; color:#a99bb8; margin-top:2px;">${upgrade.hint}</div>
                </div>
                <button class="legacy-buy" data-upgrade="${upgrade.key}" type="button"
                        style="flex:none; cursor:pointer; border:1px solid ${upgrade.affordable ? '#9ad9b0' : '#6c568d'};
                        border-radius:7px; background:#2a203a; color:#fff1d1; font:700 11.5px Inter, sans-serif;
                        padding:7px 10px; opacity:${upgrade.maxed || upgrade.affordable ? '1' : '.42'};
                        cursor:${upgrade.maxed ? 'default' : upgrade.affordable ? 'pointer' : 'not-allowed'};"
                        ${upgrade.maxed || !upgrade.affordable ? 'disabled' : ''}>
                    ${upgrade.maxed ? '완료' : `${upgrade.cost}P`}
                </button>
            </div>
        `).join('');

        rows.querySelectorAll('.legacy-buy').forEach((button) => {
            button.addEventListener('click', () => {
                if (this.metaHandler) this.metaHandler(button.dataset.upgrade);
            });
        });
    }

    // ------------------------------------------------------------- workshop
    // Free-form forge: the player dials in their own ore ratio, sees the
    // predicted item and success odds, and every blend they try is recorded.
    initCraftWorkshop() {
        this.craftOverlay = document.createElement('div');
        this.craftOverlay.style.cssText = `
            position: absolute;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
            background: linear-gradient(135deg, rgba(8,6,18,.96), rgba(34,14,20,.95));
            z-index: 96;
            pointer-events: auto;
        `;
        this.craftOverlay.innerHTML = `
            <div style="width:min(980px,100%); max-height:90vh; display:flex; flex-direction:column;
                        padding:clamp(16px,2.6vw,26px); box-sizing:border-box; border:2px solid #c08a5a;
                        border-radius:16px; background:linear-gradient(180deg, rgba(38,24,26,.98), rgba(12,9,17,.98));
                        font-family:Inter, sans-serif; box-shadow:0 24px 60px rgba(0,0,0,.6);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div>
                        <div style="font:700 11px Orbitron, sans-serif; letter-spacing:3px; color:#e0ac74;">FORGE WORKSHOP</div>
                        <h2 style="margin:6px 0 0; color:#fff1d1; font:700 clamp(19px,3.4vw,27px) Orbitron, sans-serif;">제작 작업장</h2>
                        <div class="craft-subtitle" style="margin-top:4px; color:#a99bb8; font-size:12px;">광석 배합은 직접 정합니다. 배합이 곧 합성법입니다.</div>
                    </div>
                    <button class="craft-close" type="button" style="cursor:pointer; border:1px solid #6a5480;
                            background:rgba(255,255,255,.06); color:#e6dcf4; border-radius:8px; padding:7px 13px;
                            font:700 12px Inter, sans-serif;">닫기 (ESC)</button>
                </div>

                <div class="craft-slot-tabs" style="margin-top:14px; display:flex; gap:8px;"></div>

                <div class="craft-body" style="margin-top:16px; display:grid; gap:16px; grid-template-columns:1.05fr .95fr;
                            overflow:auto; padding-right:4px;">
                    <div>
                        <div style="font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#cbb8e8;">광석 배합</div>
                        <div class="craft-ore-rows" style="margin-top:10px; display:grid; gap:9px;"></div>
                        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
                            <button class="craft-clear" type="button" style="cursor:pointer; border:1px solid #6a5480;
                                    background:rgba(255,255,255,.05); color:#cfc3dd; border-radius:7px; padding:6px 11px;
                                    font:600 11.5px Inter, sans-serif;">비우기</button>
                            <button class="craft-random" type="button" style="cursor:pointer; border:1px solid #6a5480;
                                    background:rgba(255,255,255,.05); color:#cfc3dd; border-radius:7px; padding:6px 11px;
                                    font:600 11.5px Inter, sans-serif;">무작위 배합</button>
                        </div>

                        <div class="craft-preview" style="margin-top:14px; padding:13px; border-radius:11px;
                                    border:1px solid #5a4460; background:rgba(0,0,0,.36);"></div>

                        <button class="craft-forge" type="button" style="margin-top:12px; width:100%; cursor:pointer;
                                border:1px solid #d19a5f; border-radius:10px; padding:13px;
                                background:linear-gradient(180deg,#8a4f2a,#5c3018); color:#ffe6c4;
                                font:800 15px Orbitron, sans-serif; letter-spacing:1px;">제 작 하 기</button>
                        <div class="craft-log" style="margin-top:10px; min-height:18px; font-size:12.5px; line-height:1.5;"></div>
                    </div>

                    <div style="display:flex; flex-direction:column; min-height:0;">
                        <div class="craft-equipped" style="padding:13px; border-radius:11px; border:1px solid #5a4460;
                                    background:rgba(0,0,0,.36);"></div>
                        <div style="margin-top:14px; font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#ffcf6b;">기본 조합법</div>
                        <div class="craft-default-recipes" style="margin-top:9px; display:grid; gap:8px;"></div>
                        <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:baseline;">
                            <div style="font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#cbb8e8;">발견한 합성법</div>
                            <div class="craft-recipe-count" style="color:#a99bb8; font-size:11px;"></div>
                        </div>
                        <div class="craft-recipes" style="margin-top:9px; display:grid; gap:8px; overflow:auto;
                                    max-height:min(360px, 42vh); padding-right:4px;"></div>
                    </div>
                </div>
            </div>
        `;
        this.container.appendChild(this.craftOverlay);

        // Stack the workshop into one column on narrow screens.
        if (!document.getElementById('craft-workshop-style')) {
            const style = document.createElement('style');
            style.id = 'craft-workshop-style';
            style.textContent = `@media (max-width: 760px) { .craft-body { grid-template-columns: 1fr !important; } }`;
            document.head.appendChild(style);
        }

        this.craftOverlay.querySelector('.craft-close').addEventListener('click', () => this.closeCraftWorkshop());
        this.craftOverlay.addEventListener('pointerdown', (event) => event.stopPropagation());
        this.craftOverlay.querySelector('.craft-clear').addEventListener('click', () => {
            Object.keys(this.craftMix).forEach((ore) => { this.craftMix[ore] = 0; });
            this.refreshCraftWorkshop();
        });
        this.craftOverlay.querySelector('.craft-random').addEventListener('click', () => this.randomiseCraftMix());
        this.craftOverlay.querySelector('.craft-forge').addEventListener('click', () => this.submitCraft());

        this.buildCraftOreRows();
        this.buildCraftSlotTabs();
    }

    buildCraftSlotTabs() {
        const bar = this.craftOverlay.querySelector('.craft-slot-tabs');
        const tabs = [
            { key: 'weapon', label: '🗡️ 무기' },
            { key: 'armor', label: '🛡️ 방어구' },
            { key: 'accessory', label: '💍 장신구' }
        ];
        tabs.forEach((tab) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.slot = tab.key;
            button.textContent = tab.label;
            button.style.cssText = `flex:1; cursor:pointer; border-radius:8px; padding:9px 6px;
                    font:700 12.5px Inter, sans-serif; border:1px solid #6a5480; background:rgba(255,255,255,.05); color:#cfc3dd;`;
            button.addEventListener('click', () => {
                if (this.craftSlot === tab.key) return;
                this.craftSlot = tab.key;
                this.refreshCraftWorkshop(null);
            });
            bar.appendChild(button);
        });
        this.updateCraftSlotTabs();
    }

    updateCraftSlotTabs() {
        const bar = this.craftOverlay?.querySelector('.craft-slot-tabs');
        if (!bar) return;
        bar.querySelectorAll('button').forEach((button) => {
            const active = button.dataset.slot === this.craftSlot;
            button.style.background = active ? 'linear-gradient(180deg,#8a4f2a,#5c3018)' : 'rgba(255,255,255,.05)';
            button.style.color = active ? '#ffe6c4' : '#cfc3dd';
            button.style.borderColor = active ? '#d19a5f' : '#6a5480';
        });
    }

    buildCraftOreRows() {
        const rows = this.craftOverlay.querySelector('.craft-ore-rows');
        const definitions = [
            { key: 'coal', label: '석탄', color: '#b3bccb' },
            { key: 'iron', label: '철광석', color: '#cfd8e3' },
            { key: 'gold', label: '금광석', color: '#ffd873' },
            { key: 'mithril', label: '미스릴', color: '#9ff3e0' }
        ];

        definitions.forEach((definition) => {
            const row = document.createElement('div');
            row.dataset.ore = definition.key;
            row.style.cssText = `display:flex; align-items:center; gap:10px; padding:9px 11px; border-radius:9px;
                                 border:1px solid #4b3a5d; background:rgba(255,255,255,.03);`;
            row.innerHTML = `
                <div style="flex:1; min-width:0;">
                    <div style="font-size:13px; font-weight:700; color:${definition.color};">${definition.label}</div>
                    <div class="ore-owned" style="font-size:11px; color:#a99bb8; margin-top:2px;"></div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <button class="ore-dec" data-step="-5" type="button">－5</button>
                    <button class="ore-dec" data-step="-1" type="button">－</button>
                    <div class="ore-amount" style="min-width:34px; text-align:center; font:800 16px Orbitron, sans-serif; color:#fff1d1;">0</div>
                    <button class="ore-inc" data-step="1" type="button">＋</button>
                    <button class="ore-inc" data-step="5" type="button">＋5</button>
                </div>
            `;
            rows.appendChild(row);

            row.querySelectorAll('button').forEach((button) => {
                button.style.cssText = `min-width:34px; height:32px; padding:0 7px; border:1px solid #6c568d;
                                        border-radius:7px; background:#2a203a; color:#fff;
                                        font:700 12px Inter, sans-serif; cursor:pointer;`;
                button.addEventListener('click', () => {
                    const step = Number(button.dataset.step) || 0;
                    this.adjustCraftMix(definition.key, step);
                });
            });
        });
    }

    adjustCraftMix(ore, step) {
        const owned = this.craftData?.ores.find((entry) => entry.key === ore)?.owned ?? 99;
        const next = Math.max(0, Math.min(owned, (this.craftMix[ore] || 0) + step));
        this.craftMix[ore] = next;
        this.refreshCraftWorkshop();
    }

    randomiseCraftMix() {
        const ores = this.craftData?.ores || [];
        ores.forEach((ore) => {
            const cap = Math.min(ore.owned, 12);
            this.craftMix[ore.key] = cap > 0 ? Math.floor(Math.random() * (cap + 1)) : 0;
        });
        this.refreshCraftWorkshop();
    }

    setCraftHandlers(handlers) {
        this.craftHandlers = handlers;
        this.refreshCraftWorkshop();
    }

    openCraftWorkshop() {
        if (!this.craftOverlay) return;
        this.craftOpen = true;
        this.craftInventorySignature = null;
        this.craftOverlay.style.display = 'flex';
        this.refreshCraftWorkshop(null);
    }

    closeCraftWorkshop() {
        if (!this.craftOverlay) return;
        this.craftOpen = false;
        this.craftOverlay.style.display = 'none';
    }

    submitCraft() {
        if (!this.craftHandlers?.craft) return;
        const outcome = this.craftHandlers.craft({ ...this.craftMix }, this.craftSlot);
        this.craftData = outcome.data;
        // A successful craft consumes the ore, so reset the dials to what is
        // still affordable rather than leaving impossible numbers on screen.
        this.craftData.ores.forEach((ore) => {
            this.craftMix[ore.key] = Math.min(this.craftMix[ore.key] || 0, ore.owned);
        });
        this.craftLastLog = outcome.result;
        this.renderCraftWorkshop(this.craftHandlers.preview({ ...this.craftMix }, this.craftSlot), outcome.result);
    }

    refreshCraftWorkshop(log) {
        if (!this.craftHandlers?.preview || !this.craftOverlay) return;
        const data = this.craftHandlers.preview({ ...this.craftMix }, this.craftSlot);
        this.craftData = data;
        if (log === null) this.craftLastLog = null;
        else if (log !== undefined) this.craftLastLog = log;
        this.updateCraftSlotTabs();
        this.renderCraftWorkshop(data, this.craftLastLog);
    }

    // Equipment stat objects vary by slot (weapon: attack/crit/hp, armor:
    // defense/hp, accessory: luck/crit/lifesteal/hp) — render whichever keys
    // the item actually has rather than assuming a weapon's shape.
    describeStats(stats) {
        const chips = [];
        if (stats.attack) chips.push({ label: `공격 +${stats.attack}`, color: '#ff9c9c' });
        if (stats.defense) chips.push({ label: `방어 +${stats.defense}`, color: '#8fc4ff' });
        if (stats.crit) chips.push({ label: `치명 +${Math.round(stats.crit * 100)}%`, color: '#ffe39a' });
        if (stats.luck) chips.push({ label: `행운 +${Math.round(stats.luck * 10) / 10}`, color: '#c7a3ef' });
        if (stats.lifesteal) chips.push({ label: `흡혈 +${Math.round(stats.lifesteal * 100)}%`, color: '#ff8fae' });
        if (stats.hp) chips.push({ label: `체력 +${stats.hp}`, color: '#8fd9a8' });
        if (stats.spellProcChance) chips.push({ label: `마법 폭발 ${Math.round(stats.spellProcChance * 100)}%`, color: '#c9a6ff' });
        if (stats.blockChance) chips.push({ label: `피해 무효 ${Math.round(stats.blockChance * 100)}%`, color: '#8fe4ff' });
        return chips;
    }

    formatStatChips(stats) {
        return this.describeStats(stats).map((chip) => `<div style="color:${chip.color};">${chip.label}</div>`).join('');
    }

    formatStatSummary(stats) {
        return this.describeStats(stats).map((chip) => chip.label).join(' · ');
    }

    renderCraftWorkshop(data, log) {
        if (!data || !this.craftOverlay) return;
        this.craftData = data;

        const tierOf = (id) => (data.tiers || []).find((tier) => tier.id === id)
            || { label: '노멀', color: '#d8d2e2' };

        // Ore dials
        this.craftOverlay.querySelectorAll('.craft-ore-rows > div').forEach((row) => {
            const key = row.dataset.ore;
            const ore = data.ores.find((entry) => entry.key === key);
            if (!ore) return;
            const amount = this.craftMix[key] || 0;
            row.querySelector('.ore-amount').textContent = amount;
            row.querySelector('.ore-owned').textContent = ore.cost > 0
                ? `보유 ${ore.owned} · 소모 ${ore.cost}`
                : `보유 ${ore.owned}`;
            row.style.borderColor = amount > 0 ? '#8b6fae' : '#4b3a5d';
            row.querySelectorAll('.ore-inc').forEach((button) => {
                const disabled = amount >= ore.owned;
                button.disabled = disabled;
                button.style.opacity = disabled ? '.35' : '1';
                button.style.cursor = disabled ? 'not-allowed' : 'pointer';
            });
            row.querySelectorAll('.ore-dec').forEach((button) => {
                const disabled = amount <= 0;
                button.disabled = disabled;
                button.style.opacity = disabled ? '.35' : '1';
                button.style.cursor = disabled ? 'not-allowed' : 'pointer';
            });
        });

        // Preview panel
        const preview = data.preview;
        const previewEl = this.craftOverlay.querySelector('.craft-preview');
        if (!preview.valid) {
            previewEl.innerHTML = `<div style="color:#a99bb8; font-size:12.5px; line-height:1.6;">
                광석을 넣어 배합을 만들어 보세요.<br>
                가장 많이 넣은 광석이 장비 종류를, 총 가치가 등급을 결정합니다.
            </div>`;
        } else {
            // The result is intentionally hidden. The player only sees vague,
            // atmospheric hints from the crucible so that opening the finished
            // item is a surprise rather than a confirmation of a spoiled preview.
            const heat = preview.score >= 220 ? 3 : preview.score >= 120 ? 2 : preview.score >= 55 ? 1 : 0;
            const heatText = [
                '도가니가 미지근합니다. 흔한 무언가가 나올 듯합니다.',
                '도가니가 붉게 달아오릅니다. 쓸 만한 것이 될 것 같습니다.',
                '도가니가 새하얗게 타오릅니다! 심상치 않은 기운이 감돕니다.',
                '도가니가 굉음을 냅니다!! 전설적인 무언가가 깨어나려 합니다…'
            ][heat];
            const heatColor = ['#a99bb8', '#e8b06a', '#9fe8ff', '#ffcf6b'][heat];
            const purity = Math.round(preview.blend.purity * 100);
            const purityText = purity >= 80 ? '배합이 매우 순수합니다'
                : purity >= 55 ? '배합이 비교적 안정적입니다'
                : '배합이 어지럽게 뒤섞여 있습니다';

            previewEl.innerHTML = `
                <div style="display:flex; align-items:center; gap:11px;">
                    <div style="font-size:30px; filter:blur(1.5px); opacity:.75;">❓</div>
                    <div style="min-width:0;">
                        <div style="font-size:15px; font-weight:800; color:#e8d8ff;">???</div>
                        <div style="font-size:11.5px; color:#a99bb8; margin-top:2px;">무엇이 만들어질지는 두드려 봐야 압니다.</div>
                    </div>
                </div>
                <div style="margin-top:11px; padding:9px 10px; border-radius:8px;
                            background:rgba(255,255,255,.04); border:1px solid #4e3d5e;
                            font-size:12px; color:${heatColor}; line-height:1.55;">
                    🔥 ${heatText}
                </div>
                <div style="margin-top:8px; font-size:11.5px; color:#8d80a0; line-height:1.55;">
                    ${purityText} · 총 광석 ${['coal', 'iron', 'gold', 'mithril'].reduce((sum, ore) => sum + (this.craftMix[ore] || 0), 0)}개
                </div>
                <div style="margin-top:10px; font-size:11px; color:#8d80a0; line-height:1.5;">
                    가장 많이 넣은 광석이 장비의 종류를, 배합의 가치가 등급을 정합니다.
                    <b style="color:#ffb3a6;">제작은 실패가 잦습니다.</b> 욕심을 낼수록 더 어렵지만,
                    실패해도 장비는 반드시 나오며 광석을 잃지 않습니다.
                </div>
            `;
        }

        // Forge button
        const forgeButton = this.craftOverlay.querySelector('.craft-forge');
        forgeButton.disabled = !data.affordable;
        forgeButton.style.opacity = data.affordable ? '1' : '.42';
        forgeButton.style.cursor = data.affordable ? 'pointer' : 'not-allowed';

        // Craft result log
        const logEl = this.craftOverlay.querySelector('.craft-log');
        if (log && log.message) {
            const color = !log.ok ? '#ff9c9c'
                : log.critical ? '#ffcf6b'
                : log.success ? '#8fd9a8'
                : '#ff9c9c';
            logEl.textContent = log.message;
            logEl.style.color = color;
        } else {
            logEl.textContent = '';
        }

        // Equipped loadout (per-slot: weapon shows total attack, others don't)
        const equippedEl = this.craftOverlay.querySelector('.craft-equipped');
        const slotLabel = { weapon: '무기', armor: '방어구', accessory: '장신구' }[data.slot] || '장비';
        const slotEmptyHint = { weapon: '첫 무기를', armor: '첫 방어구를', accessory: '첫 장신구를' }[data.slot] || '첫 장비를';
        if (data.equipped) {
            const tier = tierOf(data.equipped.tierId);
            const attackFooter = data.slot === 'weapon'
                ? `<div style="margin-top:9px; font-size:12px; color:#cfc3dd;">
                        총 공격력 <b style="color:#fff1d1;">${Math.round(data.totalAttack)}</b>
                        <span style="color:#8d80a0;">(기본 ${Math.round(data.baseAttack)})</span>
                   </div>`
                : '';
            equippedEl.innerHTML = `
                <div style="font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#cbb8e8;">장착 중인 ${slotLabel}</div>
                <div style="margin-top:9px; display:flex; align-items:center; gap:10px;">
                    <div style="font-size:26px;">${data.equipped.icon}</div>
                    <div>
                        <div style="font-size:15px; font-weight:800; color:${tier.color};">${data.equipped.name}</div>
                        <div style="font-size:11.5px; color:#a99bb8; margin-top:2px;">${tier.label} 등급</div>
                    </div>
                </div>
                <div style="margin-top:9px; display:grid; grid-template-columns:repeat(3,1fr); gap:6px; font-size:12px;">
                    ${this.formatStatChips(data.equipped.stats)}
                </div>
                ${attackFooter}
            `;
        } else {
            equippedEl.innerHTML = `
                <div style="font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#cbb8e8;">장착 중인 ${slotLabel}</div>
                <div style="margin-top:9px; color:#a99bb8; font-size:12.5px; line-height:1.6;">
                    아직 장비가 없습니다. ${slotEmptyHint} 벼려 보세요.
                    ${data.slot === 'weapon' ? `<br>총 공격력 <b style="color:#fff1d1;">${Math.round(data.totalAttack)}</b>` : ''}
                </div>
            `;
        }

        // Default recipes — curated starting ratios, not yet discovered by the player.
        const defaultsEl = this.craftOverlay.querySelector('.craft-default-recipes');
        defaultsEl.innerHTML = '';
        (data.defaultRecipes || []).forEach((recipe) => {
            const tier = tierOf(recipe.preview.tier.id);
            const card = document.createElement('div');
            card.style.cssText = `padding:10px 11px; border-radius:9px; border:1px solid ${recipe.affordable ? '#d19a5f' : '#5a4460'};
                                  background:rgba(255,255,255,.03);`;
            const mixText = ['coal', 'iron', 'gold', 'mithril']
                .filter((ore) => recipe.mix[ore] > 0)
                .map((ore) => {
                    const labels = { coal: '석탄', iron: '철', gold: '금', mithril: '미스릴' };
                    return `${labels[ore]} ${recipe.mix[ore]}`;
                })
                .join(' · ');
            card.innerHTML = `
                <div style="display:flex; align-items:center; gap:9px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:800; color:#fff1d1;">${recipe.label}</div>
                        <div style="font-size:11px; color:#a99bb8; margin-top:2px;">${mixText}</div>
                    </div>
                    <button class="default-recipe-load" type="button" style="cursor:pointer; border:1px solid #d19a5f;
                            border-radius:7px; background:#3a2818; color:#ffe6c4; padding:6px 10px;
                            font:700 11px Inter, sans-serif;">불러오기</button>
                </div>
                <div style="margin-top:7px; font-size:11px; color:#8d80a0;">
                    예상 결과 <span style="color:${tier.color}; font-weight:700;">${recipe.preview.expectedName}</span>
                    (${tier.label}) · 성공 확률 ${Math.round(recipe.preview.chance * 100)}%
                </div>
                <div style="margin-top:3px; font-size:11px; color:#8d80a0;">${recipe.note}</div>
            `;
            card.querySelector('.default-recipe-load').addEventListener('click', () => {
                Object.keys(this.craftMix).forEach((ore) => {
                    this.craftMix[ore] = recipe.mix[ore] || 0;
                });
                this.refreshCraftWorkshop(null);
            });
            defaultsEl.appendChild(card);
        });

        // Recipe book
        this.craftOverlay.querySelector('.craft-recipe-count').textContent = `${data.recipes.length}종 기록됨`;
        const recipesEl = this.craftOverlay.querySelector('.craft-recipes');
        recipesEl.innerHTML = '';

        if (data.recipes.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#8d80a0; font-size:12px; line-height:1.6; padding:10px 2px;';
            empty.textContent = '아직 발견한 합성법이 없습니다. 배합을 시도하면 여기에 자동으로 기록됩니다.';
            recipesEl.appendChild(empty);
        }

        data.recipes.forEach((recipe) => {
            const tier = tierOf(recipe.bestTierId);
            const card = document.createElement('div');
            card.style.cssText = `padding:10px 11px; border-radius:9px; border:1px solid ${recipe.affordable ? '#6f5a8c' : '#3b3048'};
                                  background:rgba(255,255,255,.03);`;
            const mixText = ['coal', 'iron', 'gold', 'mithril']
                .filter((ore) => recipe.mix[ore] > 0)
                .map((ore) => {
                    const labels = { coal: '석탄', iron: '철', gold: '금', mithril: '미스릴' };
                    return `${labels[ore]} ${recipe.mix[ore]}`;
                })
                .join(' · ');
            card.innerHTML = `
                <div style="display:flex; align-items:center; gap:9px;">
                    <div style="font-size:19px;">${recipe.icon}</div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:800; color:${tier.color};">${recipe.name}</div>
                        <div style="font-size:11px; color:#a99bb8; margin-top:2px;">${mixText}</div>
                    </div>
                    <button class="recipe-load" type="button" style="cursor:pointer; border:1px solid #6c568d;
                            border-radius:7px; background:#2a203a; color:#e6dcf4; padding:6px 10px;
                            font:700 11px Inter, sans-serif;">불러오기</button>
                </div>
                <div style="margin-top:7px; font-size:11px; color:#8d80a0;">
                    최고 등급 <span style="color:${tier.color}; font-weight:700;">${tier.label}</span>
                    · ${this.formatStatSummary(recipe.bestStats)}
                    · ${recipe.crafts}회 제작 (성공 ${recipe.successes})
                </div>
            `;
            card.querySelector('.recipe-load').addEventListener('click', () => {
                Object.keys(this.craftMix).forEach((ore) => {
                    this.craftMix[ore] = recipe.mix[ore] || 0;
                });
                if (recipe.slot) this.craftSlot = recipe.slot;
                this.refreshCraftWorkshop(null);
            });
            recipesEl.appendChild(card);
        });
    }

    // "Continue your adventure" banner shown once on entering the mine, plus a
    // deliberate reset control for starting a brand new leader.
    initProgressNotice() {
        this.progressNotice = document.createElement('div');
        this.progressNotice.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translate(-50%, -16px);
            width: min(420px, calc(100vw - 40px));
            padding: 16px 18px;
            box-sizing: border-box;
            background: linear-gradient(145deg, rgba(34, 24, 47, 0.97), rgba(12, 10, 20, 0.96));
            border: 2px solid #a875ca;
            border-radius: 12px;
            box-shadow: 0 12px 32px rgba(0,0,0,.55), inset 0 0 0 1px #2b203d;
            font-family: Inter, sans-serif;
            pointer-events: auto;
            opacity: 0;
            transition: opacity .35s ease, transform .35s ease;
            z-index: 80;
        `;
        this.progressNotice.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                <div style="min-width:0;">
                    <div class="notice-kicker" style="font:700 10px Orbitron, sans-serif; letter-spacing:3px; color:#c6a8ed;">MINE PROGRESS</div>
                    <div class="notice-title" style="margin-top:6px; font-size:17px; font-weight:800; color:#fff1d1;"></div>
                    <div class="notice-lines" style="margin-top:6px; color:#d7cbe1; font-size:12.5px; line-height:1.55;"></div>
                </div>
                <button class="notice-close" type="button" style="flex:none; cursor:pointer; border:1px solid #6a5480;
                        background:rgba(255,255,255,.06); color:#e6dcf4; border-radius:8px; padding:5px 10px;
                        font:700 12px Inter, sans-serif;">확인</button>
            </div>
            <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div style="color:#8d80a0; font-size:11px;">진행 상황은 자동 저장됩니다.</div>
                <button class="notice-reset" type="button" style="cursor:pointer; border:1px solid #8a4a5c;
                        background:rgba(150,40,70,.22); color:#ffc4d2; border-radius:8px; padding:5px 10px;
                        font:700 11px Inter, sans-serif;">새 광부로 시작</button>
            </div>
        `;
        this.container.appendChild(this.progressNotice);

        this.progressNotice.querySelector('.notice-close').addEventListener('click', () => this.hideProgressNotice());
        this.progressNotice.querySelector('.notice-reset').addEventListener('click', () => {
            if (!window.confirm('저장된 광산 진행 상황을 모두 지우고 새 리더로 다시 시작할까요?')) return;
            if (this.resetHandler) this.resetHandler();
        });
    }

    setResetHandler(handler) {
        this.resetHandler = handler;
    }

    showProgressNotice(notice) {
        if (!notice || !this.progressNotice) return;
        this.progressNotice.querySelector('.notice-kicker').textContent = notice.fresh ? 'NEW RUN' : 'CONTINUE';
        this.progressNotice.querySelector('.notice-title').textContent = notice.title;
        this.progressNotice.querySelector('.notice-lines').innerHTML = (notice.lines || [])
            .map((line) => `<div>${line}</div>`)
            .join('');
        this.progressNotice.style.opacity = '1';
        this.progressNotice.style.transform = 'translate(-50%, 0)';
        clearTimeout(this.progressNoticeTimer);
        this.progressNoticeTimer = setTimeout(() => this.hideProgressNotice(), 9000);
    }

    hideProgressNotice() {
        if (!this.progressNotice) return;
        clearTimeout(this.progressNoticeTimer);
        this.progressNotice.style.opacity = '0';
        this.progressNotice.style.transform = 'translate(-50%, -16px)';
        setTimeout(() => {
            if (this.progressNotice && this.progressNotice.style.opacity === '0') {
                this.progressNotice.style.pointerEvents = 'none';
            }
        }, 400);
    }

    initHUD() {
        this.ensureLeftRail();
        this.hud = document.createElement('div');
        // `margin-top:auto` pins the HUD to the bottom of the rail, and
        // `flex-shrink` lets it scroll internally rather than push the quest and
        // combat panels off the top of the screen.
        this.hud.style.cssText = `
            position: relative;
            width: 100%;
            margin-top: auto;
            flex: 0 1 auto;
            min-height: 0;
            padding: 16px;
            background: rgba(0,0,0,0.68);
            border: 2px solid #555;
            border-radius: 8px;
            pointer-events: auto;
            box-sizing: border-box;
            overflow-y: auto;
        `;
        // Built once. `update()` only patches text/colors on these nodes from
        // here on — replacing the whole subtree every frame used to tear out
        // and recreate these buttons constantly, which drops any real click
        // that doesn't complete within a single frame (mousedown fires on a
        // node that's already gone by the time mouseup/click resolves).
        this.hud.innerHTML = `
            <button class="status-open" type="button" style="
                display:block; width:100%; text-align:left; margin-bottom:12px;
                padding:9px 11px; border:1px solid #2f6f80; border-radius:8px;
                background:rgba(0,210,255,.07); color:inherit; font:inherit;
                cursor:pointer;
            ">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:19px;">🧬</span>
                    <span style="flex:1; min-width:0; display:flex; gap:10px; font-size:12.5px;">
                        <span class="hud-hp" style="color:#9fe8ff;"></span>
                        <span class="hud-attack" style="color:#ff9c9c;">공<span class="hud-attack-value"></span></span>
                        <span class="hud-workers" style="color:#d7c4ed;"></span>
                    </span>
                    <span class="hud-traits" style="color:#8d80a0; font-size:10.5px; font-weight:700;"></span>
                </div>
            </button>
            <div style="margin-bottom: 15px;">
                <h3 style="margin: 0; color: #ffd08a;">🎒 아이템 · 장비</h3>
                <div class="equip-slot" style="margin-top:8px; display:flex; align-items:center; gap:9px;
                            padding:9px 10px; border-radius:8px; border:1px solid #8d80a0;
                            background:rgba(255,255,255,.04);">
                    <div class="equip-icon" style="font-size:22px;"></div>
                    <div style="min-width:0;">
                        <div style="font-size:10px; letter-spacing:1px; color:#a99bb8;">장착 중인 무기</div>
                        <div class="equip-name" style="font-size:12.5px; font-weight:800;"></div>
                    </div>
                </div>
                <button class="craft-open" type="button" style="
                    margin-top:10px; width:100%; padding:11px 9px; border:1px solid #f0b268;
                    border-radius:7px; background:linear-gradient(180deg,#8a4c26,#4d2711); color:#ffe6c4;
                    font:800 12.5px Inter, sans-serif; cursor:pointer;
                    box-shadow:0 0 14px rgba(224,150,74,.34);
                "></button>
                <div style="margin-top:5px; text-align:center; font-size:10.5px; color:#8d80a0;">단축키 <b style="color:#cbb8e8;">I</b> 또는 <b style="color:#cbb8e8;">C</b></div>
            </div>
            <div style="margin-bottom: 15px;">
                <h3 style="margin: 0; color: #00d2ff;">광석 보관함</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 0.9em;">
                    <span class="inv-coal"></span>
                    <span class="inv-iron"></span>
                    <span class="inv-gold"></span>
                    <span class="inv-mithril"></span>
                </div>
            </div>
        `;
        this.leftRail.appendChild(this.hud);

        this.hud.querySelector('.status-open').addEventListener('click', (event) => {
            event.stopPropagation();
            this.closeDockPanels();
            this.openStatusWindow();
        });
        this.hud.querySelector('.craft-open').addEventListener('click', (event) => {
            event.stopPropagation();
            this.openCraftWorkshop();
        });
    }

    /**
     * Left rail: quest, combat, and the main HUD share one flow column, so no
     * two of them can ever overlap however tall their content grows.
     */
    ensureLeftRail() {
        if (!this.leftRail) {
            this.leftRail = document.createElement('div');
            // Full-height column: quest and combat sit at the top, the HUD is
            // pushed to the bottom by an auto-margin. Because they share one
            // flex column, a tall HUD shortens the combat feed instead of
            // colliding with it.
            this.leftRail.style.cssText = `
                position: absolute;
                top: 20px;
                bottom: 20px;
                left: 20px;
                width: min(300px, calc(100vw - 40px));
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 12px;
                pointer-events: none;
                z-index: 71;
            `;
            this.container.appendChild(this.leftRail);
        }
        return this.leftRail;
    }

    /**
     * Depth readout at the top of the screen. The run starts at B30F and every
     * stripped floor moves the marker one step closer to daylight, so the
     * player always knows how far the climb has come and how hard the rock is.
     */
    initDepthPanel() {
        this.depthPanel = document.createElement('div');
        this.depthPanel.style.cssText = `
            position: absolute;
            top: 18px;
            left: 50%;
            transform: translateX(-50%);
            width: min(340px, calc(100vw - 40px));
            box-sizing: border-box;
            padding: 10px 14px;
            background: linear-gradient(160deg, rgba(20,17,30,.94), rgba(9,8,15,.94));
            border: 2px solid #5c7f9a;
            border-radius: 10px;
            box-shadow: 0 0 18px rgba(40,80,110,.4);
            font-family: Inter, sans-serif;
            pointer-events: none;
            z-index: 70;
        `;
        this.depthPanel.innerHTML = `
            <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px;">
                <div class="depth-label" style="font:800 16px Orbitron, sans-serif; color:#bfe6ff;">지하 30층</div>
                <div class="depth-hardness" style="font-size:11px; color:#ffcf9a;">암반 경도 x1.0</div>
            </div>
            <div style="margin-top:7px; height:7px; border-radius:999px; overflow:hidden; background:#161320; border:1px solid #3d4f60;">
                <div class="depth-bar" style="height:100%; width:0%; background:linear-gradient(90deg,#4d7fa0,#9fe0ff); transition:width .3s;"></div>
            </div>
            <div class="depth-progress" style="margin-top:6px; font-size:11.5px; color:#9fc4d8;">광맥 0 / 8 채굴 완료 · 모두 캐면 위층으로</div>
            <button class="depth-ascend" type="button" style="
                display:none; margin-top:9px; width:100%; padding:8px 9px; pointer-events:auto;
                border:1px solid #8fe4ff; border-radius:7px; background:linear-gradient(180deg,#2c5f78,#173a4d);
                color:#eafcff; font:800 12px Inter, sans-serif; cursor:pointer;
                box-shadow:0 0 14px rgba(143,228,255,.35);
            ">▲ 다음 층으로 이동</button>
        `;
        this.container.appendChild(this.depthPanel);

        this.depthPanel.querySelector('.depth-ascend').addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.ascendHandler) this.ascendHandler();
        });
    }

    setAscendHandler(handler) {
        this.ascendHandler = handler;
    }

    updateDepth(depth) {
        if (!depth || !this.depthPanel) return;
        const label = this.depthPanel.querySelector('.depth-label');
        const hardness = this.depthPanel.querySelector('.depth-hardness');
        const bar = this.depthPanel.querySelector('.depth-bar');
        const progress = this.depthPanel.querySelector('.depth-progress');

        const ascendBtn = this.depthPanel.querySelector('.depth-ascend');

        if (depth.surface) {
            label.textContent = '☀ 지상';
            label.style.color = '#ffe39a';
            hardness.textContent = '탈출 완료';
            bar.style.width = '100%';
            bar.style.background = 'linear-gradient(90deg,#d8a24d,#ffe39a)';
            progress.textContent = `지하 ${depth.startDepth}층에서 지상까지 올라왔습니다`;
            this.depthPanel.style.borderColor = '#c99b4e';
            ascendBtn.style.display = 'none';
            return;
        }

        label.textContent = depth.label;
        hardness.textContent = `암반 경도 x${depth.hardness.toFixed(1)}`;
        const ratio = Math.min(100, depth.cleared / Math.max(1, depth.quota) * 100);
        bar.style.width = `${ratio}%`;
        progress.textContent = depth.readyToAscend
            ? `광맥을 모두 캐냈습니다! 준비되면 다음 층으로 이동하세요.`
            : `광맥 ${depth.cleared} / ${depth.quota} 채굴 완료 · 모두 캐면 위층으로`;
        ascendBtn.style.display = depth.readyToAscend ? 'block' : 'none';
    }

    // --------------------------------------------------------- wave reward
    // Clearing a wave opens a three-card choice. Each card states what it gives
    // and, just as importantly, what that buys the player next — so victory
    // rolls straight back into an operational decision.
    initWaveReward() {
        this.rewardOverlay = document.createElement('div');
        this.rewardOverlay.style.cssText = `
            position: absolute;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 24px;
            box-sizing: border-box;
            background: radial-gradient(circle at 50% 40%, rgba(30,22,16,.82), rgba(6,5,10,.92));
            backdrop-filter: blur(4px);
            pointer-events: auto;
            z-index: 98;
        `;
        this.rewardOverlay.innerHTML = `
            <div style="width:min(940px, 100%); max-height:100%; overflow-y:auto; text-align:center;
                        font-family:Inter, sans-serif;">
                <div style="font:700 11px Orbitron, sans-serif; letter-spacing:3px; color:#8fd9a8;">WAVE CLEARED</div>
                <h2 class="reward-title" style="margin:8px 0 4px; color:#fff1d1;
                        font:800 clamp(20px,3.4vw,30px) Orbitron, sans-serif;">웨이브 격퇴</h2>
                <div style="color:#bfb2cc; font-size:13px;">보상 하나를 선택하세요. 선택은 즉시 적용됩니다.</div>
                <div class="reward-cards" style="margin-top:20px; display:grid; gap:14px;
                        grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));"></div>
            </div>
        `;
        this.container.appendChild(this.rewardOverlay);
    }

    setWaveRewardHandler(handler) {
        this.waveRewardHandler = handler;
    }

    setQuestRewardHandler(handler) {
        this.questRewardHandler = handler;
    }

    setTraitRerollHandler(handler) {
        this.traitRerollHandler = handler;
    }

    showWaveReward(data) {
        if (!this.rewardOverlay || !data) return;
        this.rewardOpen = true;
        // A pending choice takes priority over any other window.
        this.closeCraftWorkshop();
        this.closeStatusWindow();
        this.closeDockPanels();

        this.rewardOverlay.querySelector('.reward-title').textContent =
            `웨이브 ${data.wave} 격퇴 — 보상 선택`;

        const cards = this.rewardOverlay.querySelector('.reward-cards');
        cards.innerHTML = '';
        data.choices.forEach((choice) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.reward = choice.id;
            card.style.cssText = `
                display:flex; flex-direction:column; gap:9px; text-align:left;
                padding:18px 17px; border:2px solid ${choice.color}; border-radius:13px;
                background:linear-gradient(165deg, rgba(28,23,38,.96), rgba(11,9,17,.97));
                color:#eee; cursor:pointer; font:inherit;
                box-shadow:0 0 20px ${choice.color}33;
                transition:transform .14s ease, box-shadow .14s ease;
            `;
            card.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:26px;">${choice.icon}</span>
                    <span style="font:800 16px Orbitron, sans-serif; color:${choice.color};">${choice.title}</span>
                </div>
                <div style="font-size:13.5px; font-weight:800; color:#fff1d1;">${choice.summary}</div>
                <div style="font-size:12px; line-height:1.55; color:#bfb2cc;">${choice.benefit}</div>
                <div style="margin-top:auto; padding-top:8px; font-size:11px; letter-spacing:1px;
                            color:${choice.color}; font-weight:700;">선택하기 ▸</div>
            `;
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-4px)';
                card.style.boxShadow = `0 8px 28px ${choice.color}55`;
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'none';
                card.style.boxShadow = `0 0 20px ${choice.color}33`;
            });
            card.addEventListener('mousedown', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            card.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this.waveRewardHandler) this.waveRewardHandler(choice.id);
                this.closeWaveReward();
            });
            cards.appendChild(card);
        });

        this.rewardOverlay.style.display = 'flex';
    }

    closeWaveReward() {
        if (!this.rewardOverlay) return;
        this.rewardOpen = false;
        this.rewardOverlay.style.display = 'none';
    }

    initQuestPanel() {
        this.ensureLeftRail();

        this.questPanel = document.createElement('div');
        this.questPanel.style.cssText = `
            position: relative;
            width: 100%;
            flex: none;
            padding: 16px;
            box-sizing: border-box;
            background: linear-gradient(145deg, rgba(31, 23, 42, 0.96), rgba(10, 9, 18, 0.95));
            border: 2px solid #a875ca;
            border-radius: 10px;
            box-shadow: 0 0 18px rgba(84, 52, 125, 0.42), inset 0 0 0 1px #2b203d;
            pointer-events: auto;
            flex-shrink: 0;
            font-family: Inter, sans-serif;
        `;
        this.questPanel.innerHTML = `
            <div style="font: 700 11px Orbitron, sans-serif; letter-spacing: 2px; color: #cbb8e8;">현재 퀘스트</div>
            <div class="quest-title" style="margin-top: 7px; font-size: 17px; font-weight: 800; color: #fff1d1;"></div>
            <div class="quest-description" style="margin-top: 6px; color: #d7cbe1; font-size: 13px; line-height: 1.4;"></div>
            <div class="quest-progress-text" style="margin-top: 12px; color: #b7f3ff; font-size: 12px; font-weight: 700;"></div>
            <div style="height: 7px; margin-top: 6px; overflow: hidden; border-radius: 999px; background: #1c1726; border: 1px solid #4e3d5e;"><div class="quest-progress-bar" style="height:100%; width:0%; background:linear-gradient(90deg,#8c63b5,#c7a3ef); transition:width .25s;"></div></div>
            <button class="quest-reward-claim" type="button" style="
                display:none; margin-top:12px; width:100%; padding:10px 9px; border:1px solid #6be3a8;
                border-radius:7px; background:linear-gradient(180deg,#2f8a5c,#175236); color:#e8fff2;
                font:800 12.5px Inter, sans-serif; cursor:pointer;
                box-shadow:0 0 14px rgba(107,227,168,.35);
            ">🎁 보상받기</button>
        `;
        // Insert above the HUD, which was appended to the rail first.
        this.leftRail.insertBefore(this.questPanel, this.hud || null);

        this.questPanel.querySelector('.quest-reward-claim').addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.questRewardHandler) this.questRewardHandler();
        });
    }

    updateQuest(quest) {
        if (!quest || !this.questPanel) return;
        const progress = Math.max(0, quest.progress || 0);
        const target = Math.max(1, quest.target || 1);
        const completed = quest.stage === 'complete';
        this.questPanel.querySelector('.quest-title').textContent = completed ? `✓ ${quest.title}` : quest.title;
        this.questPanel.querySelector('.quest-description').textContent = quest.description;
        this.questPanel.querySelector('.quest-progress-text').textContent = completed
            ? '보상 완료 · 분대 지휘 가능'
            : `${progress} / ${target}`;
        this.questPanel.querySelector('.quest-progress-text').style.color = quest.accent || '#b7f3ff';
        this.questPanel.querySelector('.quest-progress-bar').style.width = `${Math.min(100, progress / target * 100)}%`;
        this.questPanel.querySelector('.quest-progress-bar').style.background = completed
            ? 'linear-gradient(90deg,#54d6aa,#b7f3ff)'
            : `linear-gradient(90deg, ${quest.accent || '#8c63b5'}, #c7a3ef)`;
        this.questPanel.querySelector('.quest-reward-claim').style.display = quest.rewardReady ? 'block' : 'none';
    }

    initTraitCodex() {
        this.traitOverlay = document.createElement('div');
        this.traitOverlay.style.cssText = `
            position: absolute;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 24px;
            box-sizing: border-box;
            background: linear-gradient(135deg, rgba(8,6,18,.96), rgba(26,12,37,.96));
            z-index: 95;
            pointer-events: auto;
        `;
        this.traitOverlay.innerHTML = `
            <div style="width:min(940px,100%); max-height:88vh; display:flex; flex-direction:column;
                        padding:clamp(18px,3vw,30px); box-sizing:border-box; border:2px solid #9a6ac0;
                        border-radius:16px; background:linear-gradient(180deg, rgba(31,18,47,.98), rgba(11,9,21,.98));
                        font-family:Inter, sans-serif;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                    <div>
                        <div style="font:700 11px Orbitron, sans-serif; letter-spacing:3px; color:#c6a8ed;">TRAIT CODEX</div>
                        <h2 style="margin:6px 0 0; color:#fff1d1; font:700 clamp(20px,4vw,30px) Orbitron, sans-serif;">태생 특성 도감</h2>
                        <div class="trait-count" style="margin-top:4px; color:#a99bb8; font-size:12px;"></div>
                    </div>
                    <button class="trait-close" type="button">닫기</button>
                </div>
                <div class="trait-filters" style="display:flex; flex-wrap:wrap; gap:7px; margin:14px 0;"></div>
                <div class="trait-list" style="overflow-y:auto; display:grid; gap:8px; padding-right:6px;"></div>
            </div>
        `;
        this.container.appendChild(this.traitOverlay);

        const closeButton = this.traitOverlay.querySelector('.trait-close');
        closeButton.style.cssText = `
            padding:10px 16px; border:1px solid #805ba0; border-radius:8px;
            background:#382349; color:#fff; font:700 13px Inter, sans-serif; cursor:pointer;
        `;
        closeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this.traitOverlay.style.display = 'none';
        });

        const filters = this.traitOverlay.querySelector('.trait-filters');
        const filterDefs = [
            { key: 'all', label: '전체' },
            { key: 'owned', label: '보유' },
            { key: 'mining', label: '채광' },
            { key: 'combat', label: '전투' },
            { key: 'craft', label: '제작' },
            { key: 'special', label: '특수' }
        ];
        filterDefs.forEach((definition) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.filter = definition.key;
            button.textContent = definition.label;
            button.style.cssText = `
                padding:7px 13px; border:1px solid #6c568d; border-radius:999px;
                background:#2a203a; color:#ddd; font:600 12px Inter, sans-serif; cursor:pointer;
            `;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.traitFilter = definition.key;
                this.renderTraitCodex();
            });
            filters.appendChild(button);
        });
    }

    openTraitCodex() {
        if (!this.traitData) return;
        this.traitOverlay.style.display = 'flex';
        this.renderTraitCodex();
    }

    renderTraitCodex() {
        if (!this.traitData) return;
        const { catalog, categories, rarities, total, owned } = this.traitData;

        this.traitOverlay.querySelector('.trait-count').textContent =
            `총 ${total}종 · 보유 ${owned.length}종`;

        this.traitOverlay.querySelectorAll('.trait-filters button').forEach((button) => {
            const active = button.dataset.filter === this.traitFilter;
            button.style.background = active ? '#664487' : '#2a203a';
            button.style.borderColor = active ? '#c7a3ef' : '#6c568d';
            button.style.color = active ? '#fff' : '#ddd';
        });

        const filtered = catalog.filter((trait) => {
            if (this.traitFilter === 'all') return true;
            if (this.traitFilter === 'owned') return trait.owned;
            return trait.category === this.traitFilter;
        });

        const list = this.traitOverlay.querySelector('.trait-list');
        list.innerHTML = filtered.map((trait) => {
            const category = categories[trait.category] || { label: trait.category, color: '#ccc' };
            const rarity = rarities[trait.rarity] || { label: trait.rarity, color: '#ccc' };
            return `
                <div style="display:flex; gap:12px; align-items:flex-start; padding:11px 13px; border-radius:9px;
                            border:1px solid ${trait.owned ? '#9ad9b0' : '#4b3a5d'};
                            background:${trait.owned ? 'rgba(48,88,64,.28)' : 'rgba(0,0,0,.28)'};">
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="font-weight:800; color:#fff1d1; font-size:14px;">${trait.name}</span>
                            <span style="font-size:10px; padding:2px 7px; border-radius:999px; border:1px solid ${category.color}; color:${category.color};">${category.label}</span>
                            <span style="font-size:10px; padding:2px 7px; border-radius:999px; border:1px solid ${rarity.color}; color:${rarity.color};">${rarity.label}</span>
                            ${trait.owned ? '<span style="font-size:10px; color:#8fd9a8; font-weight:700;">보유중</span>' : ''}
                        </div>
                        <div style="margin-top:5px; color:#d7cbe1; font-size:12px; line-height:1.5;">${trait.description}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateTraits(traitData) {
        if (!traitData) return;
        const changed = !this.traitData || this.traitData.owned.length !== traitData.owned.length;
        this.traitData = traitData;
        if (changed && this.traitOverlay.style.display === 'flex') this.renderTraitCodex();
    }

    /**
     * Right side is now an icon dock. The stat and command panels are collapsed
     * into small buttons and only unfold as popovers when the player asks for
     * them, so the mine stays visible.
     */
    ensureRightRail() {
        if (!this.rightRail) {
            this.rightRail = document.createElement('div');
            this.rightRail.style.cssText = `
                position: absolute;
                top: 20px;
                right: 20px;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 10px;
                pointer-events: none;
                z-index: 71;
            `;
            this.container.appendChild(this.rightRail);

            this.iconDock = document.createElement('div');
            this.iconDock.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: auto;
            `;
            this.rightRail.appendChild(this.iconDock);

            // Popovers float to the left of the dock so they never cover it.
            this.popoverLayer = document.createElement('div');
            this.popoverLayer.style.cssText = `
                position: absolute;
                top: 0;
                right: 62px;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 10px;
                width: min(290px, calc(100vw - 96px));
                max-height: calc(100vh - 40px);
                pointer-events: none;
            `;
            this.rightRail.appendChild(this.popoverLayer);
        }
        return this.rightRail;
    }

    /**
     * Creates one square icon button in the dock. `key` identifies the panel it
     * reveals so the dock can highlight whichever one is open.
     */
    createDockIcon(key, icon, title, onClick) {
        this.ensureRightRail();
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.dock = key;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.innerHTML = `<span style="font-size:20px; line-height:1;">${icon}</span>`;
        button.style.cssText = `
            width: 46px;
            height: 46px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid #8066a8;
            border-radius: 11px;
            background: linear-gradient(160deg, rgba(29,21,40,.95), rgba(11,9,19,.95));
            color: #fff;
            cursor: pointer;
            box-shadow: 0 0 14px rgba(84,52,125,.45);
            transition: transform .12s ease, border-color .12s ease, box-shadow .12s ease;
        `;
        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
        });
        this.iconDock.appendChild(button);
        return button;
    }

    /**
     * Only one dock popover is open at a time; passing null just closes
     * everything. Keeps the screen clear, which was the whole point.
     */
    setDockPanel(key) {
        this.openDock = this.openDock === key ? null : key;
        this.refreshDock();
    }

    closeDockPanels() {
        this.openDock = null;
        this.refreshDock();
    }

    refreshDock() {
        if (!this.iconDock) return;
        const panels = { stats: this.statPanel, command: this.commandPanel };
        Object.entries(panels).forEach(([key, panel]) => {
            if (!panel) return;
            const open = this.openDock === key && !this.battleOpen;
            panel.style.display = open ? 'block' : 'none';
        });
        this.iconDock.querySelectorAll('button[data-dock]').forEach((button) => {
            const active = button.dataset.dock === this.openDock;
            button.style.borderColor = active ? '#ffd08a' : '#8066a8';
            button.style.boxShadow = active
                ? '0 0 16px rgba(255,208,138,.55)'
                : '0 0 14px rgba(84,52,125,.45)';
            button.style.transform = active ? 'scale(1.06)' : 'scale(1)';
        });
    }

    initStatPanel() {
        this.ensureRightRail();
        this.statPanel = document.createElement('div');
        this.statPanel.style.cssText = `
            position: relative;
            width: 100%;
            display: none;
            max-height: calc(100vh - 60px);
            overflow-y: auto;
            padding: 14px;
            box-sizing: border-box;
            background: linear-gradient(160deg, rgba(29, 21, 40, 0.96), rgba(11, 9, 19, 0.96));
            border: 2px solid #8066a8;
            border-radius: 10px;
            box-shadow: 0 0 18px rgba(84, 52, 125, 0.45);
            pointer-events: auto;
            font-family: Inter, sans-serif;
        `;
        this.statPanel.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <div style="font: 700 11px Orbitron, sans-serif; letter-spacing: 2px; color: #cbb8e8;">⚒ 리더 스탯</div>
                <button class="panel-close" type="button" style="border:1px solid #6c568d; border-radius:6px;
                        background:rgba(255,255,255,.05); color:#e8dcf5; font:700 11px Inter, sans-serif;
                        padding:3px 8px; cursor:pointer;">✕</button>
            </div>
            <div class="mining-progress" style="margin-top: 9px; padding: 8px 10px; border-radius: 7px; background: rgba(0,0,0,.32); border: 1px solid #4b3a5d; color: #b7f3ff; font-size: 12px;">채굴할 광석을 클릭하세요</div>
            <div class="stat-rows" style="margin-top: 10px; display: grid; gap: 7px;"></div>
            <div style="margin-top:14px; padding-top:10px; border-top:1px solid #3b3048;
                        font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#cbb8e8;">🏕 기지 시설</div>
            <div class="facility-rows" style="margin-top: 9px; display: grid; gap: 7px;"></div>
        `;
        this.popoverLayer.appendChild(this.statPanel);

        const statClose = this.statPanel.querySelector('.panel-close');
        statClose.addEventListener('mousedown', (event) => event.stopPropagation());
        statClose.addEventListener('click', (event) => {
            event.stopPropagation();
            this.closeDockPanels();
        });

        // Icon dock entries: stats, status window, squad command.
        this.createDockIcon('stats', '⚒', '리더 스탯 (곡괭이 강화)', () => this.setDockPanel('stats'));
        this.createDockIcon('status', '🧬', '리더 상태 · 태생 특성 (V)', () => {
            this.closeDockPanels();
            if (this.statusOpen) this.closeStatusWindow();
            else this.openStatusWindow();
        });

        const rows = this.statPanel.querySelector('.stat-rows');
        const definitions = [
            { key: 'strength', label: '힘', hint: '광석당 곡괭이질 감소', color: '#ff9c9c' },
            { key: 'speed', label: '속도', hint: '곡괭이 속도 증가', color: '#b7f3ff' },
            { key: 'luck', label: '행운', hint: '고급 광석 확률 증가', color: '#ffe39a' }
        ];

        definitions.forEach((definition) => {
            const row = document.createElement('div');
            row.dataset.stat = definition.key;
            row.style.cssText = 'display:flex; align-items:center; gap:9px;';
            row.innerHTML = `
                <div style="flex:1;">
                    <div style="font-size:13px; font-weight:700; color:${definition.color};">
                        ${definition.label} <span class="stat-value" style="color:#fff1d1;">Lv.1</span>
                    </div>
                    <div style="font-size:11px; color:#a99bb8;">${definition.hint}</div>
                    <div class="stat-cost" style="font-size:11px; color:#8fd9a8; margin-top:2px;"></div>
                </div>
                <button class="stat-up" data-stat="${definition.key}" type="button">＋</button>
            `;
            rows.appendChild(row);

            const button = row.querySelector('.stat-up');
            button.style.cssText = `
                width: 38px;
                height: 38px;
                border: 1px solid #6c568d;
                border-radius: 7px;
                background: #2a203a;
                color: #fff;
                font: 700 16px Inter, sans-serif;
                cursor: pointer;
            `;
            button.addEventListener('mousedown', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this.statHandler) this.statHandler(definition.key);
            });
        });

        this.buildFacilityRows();
    }

    setStatHandler(handler) {
        this.statHandler = handler;
    }

    setFacilityHandler(handler) {
        this.facilityHandler = handler;
    }

    // A second, independent upgrade shop for permanent base-camp facilities
    // (mining speed, worker cap) — separate from the leader-stat rows above
    // since its costs can span all four ore types, not just coal/iron.
    buildFacilityRows() {
        const rows = this.statPanel.querySelector('.facility-rows');
        const definitions = [
            { key: 'miningRig', label: '채굴 설비 강화', hint: '채굴 속도 영구 증가', color: '#8fd9a8' },
            { key: 'barracks', label: '막사 증축', hint: '워커 정원 영구 확장', color: '#ffcf8a' }
        ];

        definitions.forEach((definition) => {
            const row = document.createElement('div');
            row.dataset.facility = definition.key;
            row.style.cssText = 'display:flex; align-items:center; gap:9px;';
            row.innerHTML = `
                <div style="flex:1;">
                    <div style="font-size:13px; font-weight:700; color:${definition.color};">
                        ${definition.label} <span class="facility-value" style="color:#fff1d1;">Lv.0</span>
                    </div>
                    <div class="facility-hint" style="font-size:11px; color:#a99bb8;">${definition.hint}</div>
                    <div class="facility-cost" style="font-size:11px; color:#8fd9a8; margin-top:2px;"></div>
                </div>
                <button class="facility-up" type="button">＋</button>
            `;
            rows.appendChild(row);

            const button = row.querySelector('.facility-up');
            button.style.cssText = `
                width: 38px; height: 38px; border: 1px solid #6c568d; border-radius: 7px;
                background: #2a203a; color: #fff; font: 700 16px Inter, sans-serif; cursor: pointer;
            `;
            button.addEventListener('mousedown', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this.facilityHandler) this.facilityHandler(definition.key);
            });
        });
    }

    updateFacilities(facilities) {
        if (!this.statPanel || !Array.isArray(facilities)) return;
        const oreLabels = { coal: '석탄', iron: '철', gold: '금', mithril: '미스릴' };

        this.statPanel.querySelectorAll('.facility-rows > div').forEach((row) => {
            const entry = facilities.find((item) => item.key === row.dataset.facility);
            if (!entry) return;

            row.querySelector('.facility-value').textContent = `Lv.${entry.level}`;
            const costLabel = row.querySelector('.facility-cost');
            const hintLabel = row.querySelector('.facility-hint');
            const button = row.querySelector('.facility-up');

            if (entry.maxed) {
                costLabel.textContent = '최대 레벨';
                costLabel.style.color = '#a99bb8';
                hintLabel.textContent = entry.hint;
                button.disabled = true;
                button.style.opacity = '0.35';
                button.style.cursor = 'not-allowed';
                return;
            }

            const costText = ['coal', 'iron', 'gold', 'mithril']
                .filter((ore) => entry.cost[ore] > 0)
                .map((ore) => `${oreLabels[ore]} ${entry.cost[ore]}`)
                .join(' · ');
            costLabel.textContent = `비용: ${costText}`;
            costLabel.style.color = entry.affordable ? '#8fd9a8' : '#9b8ba8';
            hintLabel.textContent = entry.hint;

            button.disabled = !entry.affordable;
            button.style.opacity = entry.affordable ? '1' : '0.42';
            button.style.cursor = entry.affordable ? 'pointer' : 'not-allowed';
            button.style.borderColor = entry.affordable ? '#9ad9b0' : '#6c568d';
        });
    }

    updateStats(stats, inventory, miningProgress) {
        if (!this.statPanel || !stats) return;

        this.statPanel.querySelectorAll('.stat-rows > div').forEach((row) => {
            const key = row.dataset.stat;
            const cost = stats.costs[key];
            const affordable = inventory.coal >= cost.coal && inventory.iron >= cost.iron;
            row.querySelector('.stat-value').textContent = `Lv.${stats[key]}`;
            const costText = cost.iron > 0
                ? `비용: 석탄 ${cost.coal} · 철 ${cost.iron}`
                : `비용: 석탄 ${cost.coal}`;
            const costLabel = row.querySelector('.stat-cost');
            costLabel.textContent = costText;
            costLabel.style.color = affordable ? '#8fd9a8' : '#9b8ba8';

            const button = row.querySelector('.stat-up');
            button.disabled = !affordable;
            button.style.opacity = affordable ? '1' : '0.42';
            button.style.cursor = affordable ? 'pointer' : 'not-allowed';
            button.style.borderColor = affordable ? '#9ad9b0' : '#6c568d';
        });

        const progress = this.statPanel.querySelector('.mining-progress');
        if (miningProgress) {
            const base = `${miningProgress.label} 광맥 ${miningProgress.swings}/${miningProgress.swingsRequired}회 · 매장량 ${miningProgress.reserves}`;
            if (miningProgress.lastYieldLabel) {
                const amount = miningProgress.lastYieldAmount > 1 ? ` x${miningProgress.lastYieldAmount}` : '';
                progress.textContent = miningProgress.lastYieldLucky
                    ? `${base}\n✨ ${miningProgress.lastYieldLabel}${amount} 획득! (행운)`
                    : `${base}\n${miningProgress.lastYieldLabel}${amount} 획득`;
                progress.style.color = miningProgress.lastYieldLucky ? '#ffe39a' : '#b7f3ff';
            } else {
                progress.textContent = base;
                progress.style.color = '#b7f3ff';
            }
            progress.style.whiteSpace = 'pre-line';
        } else {
            progress.textContent = `곡괭이 간격 ${stats.swingInterval.toFixed(2)}초 · 석탄 ${stats.swingsPerOre.coal}회/개`;
            progress.style.color = '#a99bb8';
        }
    }

    initCommandPanel() {
        this.commandPanel = document.createElement('div');
        this.commandPanel.style.cssText = `
            position: relative;
            width: 100%;
            display: none;
            box-sizing: border-box;
            padding: 14px;
            background: linear-gradient(180deg, rgba(29, 20, 44, 0.94), rgba(10, 8, 18, 0.94));
            border: 2px solid #8066a8;
            border-radius: 8px;
            box-shadow: 0 0 18px rgba(84, 52, 125, 0.55), inset 0 0 0 1px #2b203d;
            pointer-events: auto;
        `;
        this.commandPanel.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom: 9px;">
                <div style="font-size: 12px; letter-spacing: 1px; color: #cbb8e8;">📣 워커 분대 명령</div>
                <button class="panel-close" type="button" style="border:1px solid #6c568d; border-radius:6px;
                        background:rgba(255,255,255,.05); color:#e8dcf5; font:700 11px Inter, sans-serif;
                        padding:3px 8px; cursor:pointer;">✕</button>
            </div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;">
                <button data-command="mine" type="button">⛏ 채굴</button>
                <button data-command="attack" type="button">⚔ 공격</button>
                <button data-command="defend" type="button">🛡 방어</button>
            </div>
            <div class="command-status" style="margin-top: 9px; color: #9fe8ff; font-size: 12px;">현재 명령: 채굴</div>
        `;
        this.popoverLayer.appendChild(this.commandPanel);

        const commandClose = this.commandPanel.querySelector('.panel-close');
        commandClose.addEventListener('mousedown', (event) => event.stopPropagation());
        commandClose.addEventListener('click', (event) => {
            event.stopPropagation();
            this.closeDockPanels();
        });

        // Dock icon reflects the active order at a glance.
        this.commandIcon = this.createDockIcon('command', '⛏', '워커 분대 명령', () => this.setDockPanel('command'));

        this.commandPanel.querySelectorAll('button[data-command]').forEach((button) => {
            button.style.cssText = `
                border: 1px solid #6c568d;
                border-radius: 5px;
                padding: 8px 4px;
                color: #eee;
                background: #2a203a;
                font: 600 12px Inter, sans-serif;
                cursor: pointer;
            `;
            button.addEventListener('mousedown', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.setCommand(button.dataset.command);
            });
        });
        this.refreshCommandPanel();
    }

    initBattleOverlay() {
        this.initCombatHUD();
        this.injectBattleAnimations();
    }

    // ---------------------------------------------------------- combat HUD
    // Combat is real-time in the 3D world, so the interface is a lightweight
    // overlay: target plate, wave status, damage vignette and a rolling feed.
    initCombatHUD() {
        // Red vignette that pulses when the leader is hit.
        this.damageVignette = document.createElement('div');
        this.damageVignette.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            z-index: 70;
            background: radial-gradient(circle at 50% 50%, transparent 42%, rgba(190, 26, 40, 0.72) 100%);
            transition: opacity .28s ease-out;
        `;
        this.container.appendChild(this.damageVignette);

        // Focused-target nameplate at the top center of the screen.
        this.targetPlate = document.createElement('div');
        this.targetPlate.style.cssText = `
            position: absolute;
            top: 18px;
            left: 50%;
            transform: translateX(-50%);
            width: min(360px, calc(100vw - 40px));
            padding: 10px 14px;
            box-sizing: border-box;
            display: none;
            border: 1px solid #a2495a;
            border-radius: 10px;
            background: linear-gradient(180deg, rgba(44,16,22,.94), rgba(14,8,14,.94));
            box-shadow: 0 8px 26px rgba(0,0,0,.55);
            font-family: Inter, sans-serif;
            pointer-events: none;
            z-index: 72;
        `;
        this.targetPlate.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px;">
                <div class="target-name" style="font-size:14px; font-weight:800; color:#ffd9cf;"></div>
                <div class="target-hp" style="font:700 12px Orbitron, sans-serif; color:#ffb3a6;"></div>
            </div>
            <div style="height:9px; margin-top:7px; border-radius:999px; overflow:hidden; background:#2a1119; border:1px solid #8c4353;">
                <div class="target-bar" style="height:100%; width:100%; background:linear-gradient(90deg,#ff5b61,#ffb06b); transition:width .12s linear;"></div>
            </div>
        `;
        this.container.appendChild(this.targetPlate);

        // Wave / auto-combat status panel, stacked below the quest panel in the
        // shared left rail so the two can never overlap.
        this.combatPanel = document.createElement('div');
        this.combatPanel.style.cssText = `
            position: relative;
            width: 100%;
            flex: 0 1 auto;
            min-height: 0;
            overflow: hidden;
            padding: 12px 14px;
            box-sizing: border-box;
            border: 2px solid #8a5a6e;
            border-radius: 10px;
            background: linear-gradient(145deg, rgba(37,20,28,.95), rgba(11,9,18,.95));
            box-shadow: 0 0 18px rgba(125, 46, 62, 0.35);
            font-family: Inter, sans-serif;
            pointer-events: auto;
        `;
        this.combatPanel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                <div style="font:700 11px Orbitron, sans-serif; letter-spacing:2px; color:#ffb3a6;">COMBAT</div>
                <div style="display:flex; gap:6px;">
                    <button class="auto-mine-toggle" type="button">⛏ 자동 채굴 ON</button>
                    <button class="auto-combat-toggle" type="button">⚔ 자동 전투 ON</button>
                </div>
            </div>
            <div class="combat-status" style="margin-top:9px; font-size:12.5px; color:#d7cbe1; line-height:1.5;"></div>
            <button class="wave-start" type="button">🛡 광산 방어 시작</button>
            <div class="combat-feed" style="margin-top:9px; display:grid; gap:3px; font-size:11.5px; line-height:1.45; overflow:hidden;"></div>
        `;
        if (this.leftRail) {
            // Sits between the quest panel and the bottom-pinned HUD.
            this.leftRail.insertBefore(this.combatPanel, this.hud || null);
        } else {
            this.container.appendChild(this.combatPanel);
        }

        const toggle = this.combatPanel.querySelector('.auto-combat-toggle');
        toggle.style.cssText = `
            cursor:pointer; border:1px solid #d1785f; border-radius:7px; padding:5px 9px;
            background:linear-gradient(180deg,#7a3524,#4a1d12); color:#ffdcc4;
            font:700 11px Inter, sans-serif;
        `;
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.autoCombatHandler) this.autoCombatHandler();
        });

        const mineToggle = this.combatPanel.querySelector('.auto-mine-toggle');
        mineToggle.style.cssText = `
            cursor:pointer; border:1px solid #6fb08a; border-radius:7px; padding:5px 9px;
            background:linear-gradient(180deg,#245c40,#123122); color:#dffff0;
            font:700 11px Inter, sans-serif;
        `;
        mineToggle.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.autoMineHandler) this.autoMineHandler();
        });

        // Opt-in mine defence. Waves never start on their own any more.
        const waveStart = this.combatPanel.querySelector('.wave-start');
        waveStart.style.cssText = `
            margin-top:10px; width:100%; padding:10px 9px; border:1px solid #6fb8d1;
            border-radius:7px; background:linear-gradient(180deg,#245c74,#12303f); color:#dff3fa;
            font:800 12.5px Inter, sans-serif; cursor:pointer;
            box-shadow:0 0 14px rgba(90,180,215,.3);
        `;
        waveStart.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.waveStartHandler) this.waveStartHandler();
        });

        // Big centered wave banner.
        this.waveBanner = document.createElement('div');
        this.waveBanner.style.cssText = `
            position: absolute;
            top: 26%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.85);
            opacity: 0;
            text-align: center;
            pointer-events: none;
            z-index: 78;
            transition: opacity .3s ease, transform .3s ease;
        `;
        this.waveBanner.innerHTML = `
            <div class="wave-kicker" style="font:700 13px Orbitron, sans-serif; letter-spacing:6px; color:#ffb3a6;"></div>
            <div class="wave-title" style="margin-top:8px; font:800 clamp(30px,7vw,58px) Orbitron, sans-serif; color:#fff1d1;
                        text-shadow:0 0 30px rgba(255,120,80,.75), 0 6px 18px rgba(0,0,0,.85);"></div>
            <div class="wave-sub" style="margin-top:8px; font-size:14px; color:#e4d3e8; text-shadow:0 2px 10px rgba(0,0,0,.9);"></div>
        `;
        this.container.appendChild(this.waveBanner);
    }

    setWaveStartHandler(handler) {
        this.waveStartHandler = handler;
    }

    setAutoCombatHandler(handler) {
        this.autoCombatHandler = handler;
    }

    setAutoMineHandler(handler) {
        this.autoMineHandler = handler;
    }

    flashDamageVignette() {
        if (!this.damageVignette) return;
        this.damageVignette.style.transition = 'opacity .05s ease-out';
        this.damageVignette.style.opacity = '0.85';
        clearTimeout(this.vignetteTimer);
        this.vignetteTimer = setTimeout(() => {
            this.damageVignette.style.transition = 'opacity .38s ease-out';
            this.damageVignette.style.opacity = '0';
        }, 70);
    }

    showWaveBanner(wave, count) {
        this.showBanner(`WAVE ${wave}`, `몬스터 ${count}마리 접근 중`, '#ffb3a6');
    }

    showWaveCleared(wave) {
        this.showBanner(`WAVE ${wave} CLEAR`, '잠시 숨을 돌리고 장비를 정비하세요', '#8fd9a8');
    }

    showBanner(title, subtitle, color) {
        if (!this.waveBanner) return;
        this.waveBanner.querySelector('.wave-kicker').textContent = 'UNDERMINE';
        this.waveBanner.querySelector('.wave-kicker').style.color = color;
        this.waveBanner.querySelector('.wave-title').textContent = title;
        this.waveBanner.querySelector('.wave-sub').textContent = subtitle;
        this.waveBanner.style.opacity = '1';
        this.waveBanner.style.transform = 'translate(-50%, -50%) scale(1)';
        clearTimeout(this.bannerTimer);
        this.bannerTimer = setTimeout(() => {
            this.waveBanner.style.opacity = '0';
            this.waveBanner.style.transform = 'translate(-50%, -50%) scale(1.12)';
        }, 2100);
    }

    updateCombatHUD(combat) {
        if (!combat || !this.combatPanel) return;

        const toggle = this.combatPanel.querySelector('.auto-combat-toggle');
        toggle.textContent = combat.auto ? '⚔ 자동 전투 ON' : '⏸ 자동 전투 OFF';
        toggle.style.background = combat.auto
            ? 'linear-gradient(180deg,#7a3524,#4a1d12)'
            : 'linear-gradient(180deg,#3a3346,#211d2b)';
        toggle.style.borderColor = combat.auto ? '#d1785f' : '#6c568d';

        const mineToggle = this.combatPanel.querySelector('.auto-mine-toggle');
        mineToggle.textContent = combat.autoMine ? '⛏ 자동 채굴 ON' : '⏸ 자동 채굴 OFF';
        mineToggle.style.background = combat.autoMine
            ? 'linear-gradient(180deg,#245c40,#123122)'
            : 'linear-gradient(180deg,#3a3346,#211d2b)';
        mineToggle.style.borderColor = combat.autoMine ? '#6fb08a' : '#6c568d';

        const status = this.combatPanel.querySelector('.combat-status');
        if (combat.isDown) {
            status.innerHTML = `<span style="color:#ff7d6b; font-weight:700;">리더 전투불능 · ${combat.reviveIn.toFixed(1)}초 후 부활</span>`;
        } else if (combat.waveActive || combat.enemiesLeft > 0) {
            status.innerHTML = `웨이브 <b style="color:#fff1d1;">${combat.wave}</b> 교전 중 ·
                                남은 몬스터 <b style="color:#ff9c9c;">${combat.enemiesLeft}</b>마리`;
        } else if (combat.waveUnlocked) {
            status.innerHTML = `평화 · 다음은 웨이브 <b style="color:#ffe39a;">${combat.nextWave}</b> ·
                                공격 속도 ${combat.attackInterval.toFixed(2)}초<br>
                                <span style="color:#a99bb8;">준비되면 아래 버튼으로 시작하세요.</span>`;
        } else {
            status.innerHTML = `<span style="color:#a99bb8;">퀘스트를 진행하면 광산 방어가 열립니다.</span>`;
        }

        // Start button reflects whether a defence run can be launched now.
        const waveStart = this.combatPanel.querySelector('.wave-start');
        if (waveStart) {
            const active = combat.waveActive || combat.enemiesLeft > 0;
            waveStart.style.display = combat.waveUnlocked && !active ? 'block' : 'none';
            waveStart.disabled = !combat.canStartWave;
            waveStart.style.opacity = combat.canStartWave ? '1' : '.45';
            waveStart.style.cursor = combat.canStartWave ? 'pointer' : 'not-allowed';
            waveStart.textContent = combat.rewardPending
                ? '🎁 보상을 먼저 선택하세요'
                : `🛡 웨이브 ${combat.nextWave} 방어 시작`;
        }

        const feed = this.combatPanel.querySelector('.combat-feed');
        feed.innerHTML = (combat.feed || [])
            .map((entry, index) => `<div style="color:${entry.color}; opacity:${1 - index * 0.22};">${entry.text}</div>`)
            .join('');

        // Focused target plate.
        if (combat.target) {
            this.targetPlate.style.display = 'block';
            const ratio = Math.max(0, Math.min(1, combat.target.hp / Math.max(1, combat.target.maxHp)));
            this.targetPlate.querySelector('.target-name').textContent = combat.target.elite
                ? `👑 ${combat.target.name}`
                : combat.target.name;
            this.targetPlate.querySelector('.target-hp').textContent =
                `${Math.ceil(combat.target.hp)} / ${combat.target.maxHp}`;
            this.targetPlate.querySelector('.target-bar').style.width = `${ratio * 100}%`;
            this.targetPlate.style.borderColor = combat.target.elite ? '#e0a24a' : '#a2495a';
        } else {
            this.targetPlate.style.display = 'none';
        }
    }

    initLegacyBattleOverlay() {
        this.battleOverlay = document.createElement('div');
        this.battleOverlay.style.cssText = `
            position: absolute;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 24px;
            box-sizing: border-box;
            background:
                radial-gradient(circle at 50% 35%, rgba(91, 47, 118, 0.48), transparent 42%),
                linear-gradient(135deg, rgba(8, 6, 18, 0.98), rgba(28, 12, 39, 0.98));
            z-index: 90;
            pointer-events: auto;
        `;
        this.battleOverlay.innerHTML = `
            <div class="battle-shell" style="
                width: min(900px, 100%);
                min-height: min(600px, 88vh);
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                padding: clamp(20px, 4vw, 42px);
                box-sizing: border-box;
                border: 2px solid #9a6ac0;
                border-radius: 18px;
                background: linear-gradient(180deg, rgba(31, 18, 47, 0.97), rgba(11, 9, 21, 0.98));
                box-shadow: 0 0 50px rgba(130, 71, 173, 0.36), inset 0 0 40px rgba(0, 0, 0, 0.5);
                font-family: Inter, sans-serif;
            ">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:16px;">
                    <div>
                        <div style="font: 700 12px Orbitron, sans-serif; letter-spacing: 3px; color:#c6a8ed;">UNDERMINE // COMBAT</div>
                        <h1 style="margin:8px 0 0; color:#fff1d1; font:700 clamp(24px, 5vw, 42px) Orbitron, sans-serif;">광산 전투</h1>
                    </div>
                    <div class="battle-turn" style="padding:8px 12px; border:1px solid #66487c; border-radius:999px; color:#bfa8d7; font-size:12px;">교전 중</div>
                </div>

                <div class="battle-arena" style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:clamp(12px, 4vw, 44px); margin:30px 0;">
                    <div class="battle-fighter" style="text-align:center;">
                        <div style="font-size:12px; letter-spacing:2px; color:#91ddff;">LEADER SLIME</div>
                        <div class="player-stage" style="position:relative; margin:18px 0; min-height:clamp(64px, 12vw, 112px);">
                            <div class="player-sprite" style="font-size:clamp(56px, 11vw, 100px); line-height:1; filter:drop-shadow(0 0 18px rgba(0,210,255,.55));">💧</div>
                            <div class="player-impact" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:clamp(44px, 9vw, 78px); opacity:0; pointer-events:none;"></div>
                            <div class="player-damage-layer" style="position:absolute; inset:0; pointer-events:none; overflow:visible;"></div>
                        </div>
                        <div style="font-weight:700; color:#d8f5ff;">리더 슬라임</div>
                        <div class="player-hp-text" style="margin-top:10px; color:#9fe8ff; font-size:13px;"></div>
                        <div style="height:10px; margin:8px auto 0; max-width:220px; overflow:hidden; border-radius:999px; background:#172938; border:1px solid #3c7592;"><div class="player-hp-bar" style="height:100%; width:100%; background:linear-gradient(90deg,#39d8ff,#a4f5ff); transition:width .2s;"></div></div>
                    </div>
                    <div style="font:700 clamp(22px, 5vw, 38px) Orbitron, sans-serif; color:#ffb7a8; text-shadow:0 0 16px rgba(255,100,80,.6);">VS</div>
                    <div class="battle-fighter" style="text-align:center;">
                        <div style="font-size:12px; letter-spacing:2px; color:#ff9f9f;">HOSTILE CREATURE</div>
                        <div class="enemy-stage" style="position:relative; margin:18px 0; min-height:clamp(64px, 12vw, 112px);">
                            <div class="enemy-sprite" style="font-size:clamp(56px, 11vw, 100px); line-height:1; filter:drop-shadow(0 0 18px rgba(255,70,70,.55));">👹</div>
                            <div class="enemy-impact" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:clamp(44px, 9vw, 78px); opacity:0; pointer-events:none;"></div>
                            <div class="enemy-damage-layer" style="position:absolute; inset:0; pointer-events:none; overflow:visible;"></div>
                        </div>
                        <div class="enemy-name" style="font-weight:700; color:#ffe0d9;">광산 굴착수</div>
                        <div class="enemy-hp-text" style="margin-top:10px; color:#ffb3a6; font-size:13px;"></div>
                        <div style="height:10px; margin:8px auto 0; max-width:220px; overflow:hidden; border-radius:999px; background:#361a27; border:1px solid #934c5d;"><div class="enemy-hp-bar" style="height:100%; width:100%; background:linear-gradient(90deg,#ff5b61,#ffb06b); transition:width .2s;"></div></div>
                    </div>
                </div>

                <div class="battle-threat" style="margin-bottom:12px; padding:11px 14px; box-sizing:border-box; border:1px solid #5c4570; border-radius:9px; background:rgba(0,0,0,.32);">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                        <div class="threat-label" style="font:700 12px Inter, sans-serif; color:#bfa8d7; letter-spacing:.4px;">적의 다음 공격 준비 중</div>
                        <div class="threat-countdown" style="font:700 13px Orbitron, sans-serif; color:#ffd39b;">--</div>
                    </div>
                    <div style="height:8px; margin-top:8px; overflow:hidden; border-radius:999px; background:#1b1526; border:1px solid #4c3a5e;">
                        <div class="threat-bar" style="height:100%; width:0%; background:linear-gradient(90deg,#7c5ea6,#c9a7ef);"></div>
                    </div>
                </div>

                <div class="battle-log" style="min-height:44px; padding:13px 16px; box-sizing:border-box; border-left:3px solid #a875ca; background:rgba(0,0,0,.28); color:#ded0e9; font-size:13px; line-height:1.5;"></div>
                <div class="battle-result" style="display:none; margin-top:14px; padding:14px; border:1px solid #c69a54; border-radius:8px; background:rgba(95,65,29,.28); color:#ffe7a7; text-align:center; font-weight:700;"></div>
                <div class="battle-actions" style="display:flex; gap:12px; justify-content:center; margin-top:22px;">
                    <button class="battle-attack" data-battle-action="attack" type="button">💥 슬라임 공격</button>
                    <button class="battle-retreat" data-battle-action="retreat" type="button">후퇴</button>
                </div>
            </div>
        `;
        this.container.appendChild(this.battleOverlay);

        const actionButtons = this.battleOverlay.querySelectorAll('[data-battle-action]');
        actionButtons.forEach((button) => {
            button.style.cssText = `
                min-width: 150px;
                padding: 13px 20px;
                border: 1px solid #805ba0;
                border-radius: 8px;
                color: #fff;
                background: #382349;
                font: 700 14px Inter, sans-serif;
                cursor: pointer;
                transition: transform .15s, background .15s, border-color .15s;
            `;
            button.addEventListener('mousedown', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this.battleActionHandler) this.battleActionHandler(button.dataset.battleAction);
            });
        });
    }

    injectBattleAnimations() {
        if (document.getElementById('battle-fx-styles')) return;
        const style = document.createElement('style');
        style.id = 'battle-fx-styles';
        style.textContent = `
            @keyframes battle-lunge-right {
                0% { transform: translateX(0) scale(1); }
                28% { transform: translateX(26px) scale(1.14); }
                55% { transform: translateX(-8px) scale(0.97); }
                100% { transform: translateX(0) scale(1); }
            }
            @keyframes battle-lunge-left {
                0% { transform: translateX(0) scale(1); }
                28% { transform: translateX(-26px) scale(1.14); }
                55% { transform: translateX(8px) scale(0.97); }
                100% { transform: translateX(0) scale(1); }
            }
            @keyframes battle-hit-shake {
                0% { transform: translate(0,0) scale(1); filter: brightness(1) drop-shadow(0 0 18px rgba(255,255,255,.2)); }
                12% { transform: translate(-11px,-6px) scale(1.1); filter: brightness(3.4) drop-shadow(0 0 26px rgba(255,255,255,.95)); }
                26% { transform: translate(10px,4px) scale(0.93); filter: brightness(2.6); }
                42% { transform: translate(-7px,3px) scale(1.05); filter: brightness(1.9); }
                62% { transform: translate(5px,-2px) scale(0.98); filter: brightness(1.35); }
                100% { transform: translate(0,0) scale(1); filter: brightness(1); }
            }
            @keyframes battle-impact-burst {
                0% { opacity: 0; transform: scale(0.35) rotate(-16deg); }
                18% { opacity: 1; transform: scale(1.25) rotate(6deg); }
                60% { opacity: .85; transform: scale(1.05) rotate(-3deg); }
                100% { opacity: 0; transform: scale(1.5) rotate(4deg); }
            }
            @keyframes battle-damage-float {
                0% { opacity: 0; transform: translate(-50%, 10px) scale(0.6); }
                16% { opacity: 1; transform: translate(-50%, -12px) scale(1.25); }
                45% { opacity: 1; transform: translate(-50%, -34px) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -78px) scale(0.92); }
            }
            @keyframes battle-screen-flash {
                0% { box-shadow: 0 0 50px rgba(130, 71, 173, 0.36), inset 0 0 40px rgba(0,0,0,.5); }
                20% { box-shadow: 0 0 90px rgba(255, 226, 168, 0.75), inset 0 0 70px rgba(255, 190, 120, 0.35); }
                100% { box-shadow: 0 0 50px rgba(130, 71, 173, 0.36), inset 0 0 40px rgba(0,0,0,.5); }
            }
            @keyframes battle-danger-pulse {
                0% { border-color: #7d4a4a; background: rgba(60,12,18,.34); }
                50% { border-color: #ff8b7a; background: rgba(122,26,32,.52); }
                100% { border-color: #7d4a4a; background: rgba(60,12,18,.34); }
            }
        `;
        document.head.appendChild(style);
    }

    replayAnimation(element, animation) {
        if (!element) return;
        element.style.animation = 'none';
        // Force reflow so the same animation can restart on consecutive hits.
        void element.offsetWidth;
        element.style.animation = animation;
    }

    spawnDamageNumber(layerSelector, amount, options = {}) {
        const layer = this.battleOverlay.querySelector(layerSelector);
        if (!layer) return;
        const number = document.createElement('div');
        const color = options.color || '#ffd76b';
        number.textContent = options.prefix ? `${options.prefix}${amount}` : `-${amount}`;
        number.style.cssText = `
            position: absolute;
            left: 50%;
            top: 18%;
            transform: translate(-50%, 0);
            color: ${color};
            font: 800 ${options.size || 'clamp(26px, 5vw, 42px)'} Orbitron, sans-serif;
            text-shadow: 0 0 14px ${color}, 0 3px 8px rgba(0,0,0,.85);
            pointer-events: none;
            white-space: nowrap;
            animation: battle-damage-float .95s ease-out forwards;
        `;
        layer.appendChild(number);
        setTimeout(() => number.remove(), 1000);
    }

    playImpactBurst(selector, symbol, color) {
        const burst = this.battleOverlay.querySelector(selector);
        if (!burst) return;
        burst.textContent = symbol;
        burst.style.color = color;
        burst.style.textShadow = `0 0 26px ${color}`;
        this.replayAnimation(burst, 'battle-impact-burst .55s ease-out forwards');
    }

    flashBattleShell() {
        const shell = this.battleOverlay.querySelector('.battle-shell');
        this.replayAnimation(shell, 'battle-screen-flash .4s ease-out');
    }

    playPlayerAttack(damage, isCrit = false) {
        if (!this.battleOpen || !this.battleOverlay) return;
        this.replayAnimation(this.battleOverlay.querySelector('.player-sprite'), 'battle-lunge-right .42s ease-out');
        this.replayAnimation(this.battleOverlay.querySelector('.enemy-sprite'), 'battle-hit-shake .55s ease-out');
        this.playImpactBurst('.enemy-impact', isCrit ? '⚡' : '💥', isCrit ? '#fff3a8' : '#ffd166');
        this.spawnDamageNumber('.enemy-damage-layer', damage, {
            color: isCrit ? '#fff3a8' : '#ffd166',
            prefix: isCrit ? 'CRIT -' : undefined,
            size: isCrit ? 'clamp(30px, 6vw, 50px)' : undefined
        });
        this.flashBattleShell();
    }

    playEnemyAttack(damage) {
        if (!this.battleOpen || !this.battleOverlay) return;
        this.replayAnimation(this.battleOverlay.querySelector('.enemy-sprite'), 'battle-lunge-left .42s ease-out');
        this.replayAnimation(this.battleOverlay.querySelector('.player-sprite'), 'battle-hit-shake .55s ease-out');
        this.playImpactBurst('.player-impact', '✸', '#ff7d6b');
        this.spawnDamageNumber('.player-damage-layer', damage, { color: '#ff7d6b' });
        this.flashBattleShell();
    }

    updateThreat(data) {
        const panel = this.battleOverlay.querySelector('.battle-threat');
        const label = this.battleOverlay.querySelector('.threat-label');
        const countdown = this.battleOverlay.querySelector('.threat-countdown');
        const bar = this.battleOverlay.querySelector('.threat-bar');
        if (!panel || !label || !countdown || !bar) return;

        if (this.battleResult) {
            panel.style.animation = 'none';
            panel.style.borderColor = '#5c4570';
            panel.style.background = 'rgba(0,0,0,.32)';
            label.textContent = '전투 종료';
            label.style.color = '#bfa8d7';
            countdown.textContent = '--';
            bar.style.width = '0%';
            return;
        }

        const total = Math.max(0.001, data.enemyTimerMax || 1);
        const remaining = Math.max(0, data.enemyTimer || 0);
        const charge = Math.min(100, (1 - remaining / total) * 100);
        const imminent = remaining <= 0.6;

        bar.style.width = `${charge}%`;
        bar.style.background = imminent
            ? 'linear-gradient(90deg,#ff5f52,#ffb56b)'
            : 'linear-gradient(90deg,#7c5ea6,#c9a7ef)';
        countdown.textContent = `${remaining.toFixed(1)}s`;
        countdown.style.color = imminent ? '#ff9c8a' : '#ffd39b';

        if (imminent) {
            label.textContent = '⚠ 적의 반격 임박! 곧 피해를 입습니다';
            label.style.color = '#ffb1a2';
            if (panel.dataset.state !== 'danger') {
                panel.dataset.state = 'danger';
                panel.style.animation = 'battle-danger-pulse .5s ease-in-out infinite';
            }
        } else {
            label.textContent = '적의 다음 공격 준비 중';
            label.style.color = '#bfa8d7';
            if (panel.dataset.state !== 'calm') {
                panel.dataset.state = 'calm';
                panel.style.animation = 'none';
                panel.style.borderColor = '#5c4570';
                panel.style.background = 'rgba(0,0,0,.32)';
            }
        }
    }

    setBattleHandlers(handler) {
        this.battleActionHandler = handler;
    }

    showBattle(data) {
        this.battleOpen = true;
        this.battleResult = null;
        this.battleOverlay.style.display = 'flex';
        this.hud.style.display = 'none';
        // Collapse the dock popovers and hide the icons during a battle.
        this.closeDockPanels();
        if (this.iconDock) this.iconDock.style.display = 'none';
        if (this.depthPanel) this.depthPanel.style.display = 'none';
        this.battleOverlay.querySelector('.battle-result').style.display = 'none';
        const attackButton = this.battleOverlay.querySelector('.battle-attack');
        const retreatButton = this.battleOverlay.querySelector('.battle-retreat');
        attackButton.dataset.battleAction = 'attack';
        attackButton.textContent = '💥 슬라임 공격';
        attackButton.disabled = false;
        retreatButton.dataset.battleAction = 'retreat';
        retreatButton.textContent = '후퇴';
        this.battleOverlay.querySelector('.enemy-name').textContent = data.enemyName;
        const threatPanel = this.battleOverlay.querySelector('.battle-threat');
        if (threatPanel) {
            threatPanel.dataset.state = '';
            threatPanel.style.animation = 'none';
        }
        this.updateBattle(data);
    }

    showBattleVictory(rewardText) {
        this.battleResult = 'victory';
        this.battleOverlay.querySelector('.battle-turn').textContent = '전투 승리';
        this.battleOverlay.querySelector('.battle-log').textContent = '적을 쓰러뜨렸습니다. 보상을 확인하세요.';
        const result = this.battleOverlay.querySelector('.battle-result');
        result.textContent = `🎁 ${rewardText}`;
        result.style.display = 'block';
        const attackButton = this.battleOverlay.querySelector('.battle-attack');
        attackButton.dataset.battleAction = 'claim';
        attackButton.textContent = '보상 받고 복귀';
        attackButton.disabled = false;
        this.battleOverlay.querySelector('.battle-retreat').textContent = '광산으로 돌아가기';
    }

    showBattleDefeat() {
        this.battleResult = 'defeat';
        this.battleOverlay.querySelector('.battle-turn').textContent = '전투 패배';
        this.battleOverlay.querySelector('.battle-log').textContent = '리더 슬라임이 쓰러졌습니다. 체력을 회복하고 광산으로 돌아가세요.';
        const result = this.battleOverlay.querySelector('.battle-result');
        result.textContent = '이번 전투에서는 보상을 얻지 못했습니다.';
        result.style.display = 'block';
        const attackButton = this.battleOverlay.querySelector('.battle-attack');
        attackButton.textContent = '공격 불가';
        attackButton.disabled = true;
        this.battleOverlay.querySelector('.battle-retreat').textContent = '광산으로 돌아가기';
    }

    updateBattle(data) {
        if (!this.battleOpen || !this.battleOverlay) return;
        const playerMax = Math.max(1, data.playerMaxHp || 1);
        const enemyMax = Math.max(1, data.enemyMaxHp || 1);
        const playerHp = Math.max(0, data.playerHp || 0);
        const enemyHp = Math.max(0, data.enemyHp || 0);
        this.battleOverlay.querySelector('.player-hp-text').textContent = `HP ${Math.ceil(playerHp)} / ${playerMax}`;
        this.battleOverlay.querySelector('.enemy-hp-text').textContent = `HP ${Math.ceil(enemyHp)} / ${enemyMax}`;
        this.battleOverlay.querySelector('.player-hp-bar').style.width = `${Math.min(100, playerHp / playerMax * 100)}%`;
        this.battleOverlay.querySelector('.enemy-hp-bar').style.width = `${Math.min(100, enemyHp / enemyMax * 100)}%`;
        this.updateThreat(data);
        if (!this.battleResult && data.log) {
            this.battleOverlay.querySelector('.battle-log').textContent = data.log;
        }
        const attackButton = this.battleOverlay.querySelector('.battle-attack');
        if (!this.battleResult) {
            attackButton.disabled = (data.cooldown || 0) > 0;
            attackButton.style.opacity = attackButton.disabled ? '0.55' : '1';
        }
    }

    hideBattle() {
        this.battleOpen = false;
        this.battleResult = null;
        if (this.battleOverlay) this.battleOverlay.style.display = 'none';
        this.hud.style.display = 'block';
        if (this.iconDock) this.iconDock.style.display = 'flex';
        if (this.depthPanel) this.depthPanel.style.display = 'block';
        this.refreshDock();
    }

    setCommand(command) {
        if (!['mine', 'attack', 'defend'].includes(command)) return;
        this.activeCommand = command;
        this.refreshCommandPanel();
        if (this.commandHandler) this.commandHandler(command);
    }

    setCommandHandler(handler) {
        this.commandHandler = handler;
        handler(this.activeCommand);
    }

    refreshCommandPanel() {
        const labels = { mine: '채굴', attack: '공격', defend: '방어' };
        const colors = { mine: '#b7f3ff', attack: '#ff9c9c', defend: '#ffe39a' };
        const icons = { mine: '⛏', attack: '⚔', defend: '🛡' };
        const buttons = this.commandPanel?.querySelectorAll('button[data-command]') || [];
        buttons.forEach((button) => {
            const selected = button.dataset.command === this.activeCommand;
            button.style.background = selected ? '#664487' : '#2a203a';
            button.style.borderColor = selected ? colors[this.activeCommand] : '#6c568d';
            button.style.boxShadow = selected ? `0 0 10px ${colors[this.activeCommand]}66` : 'none';
        });
        const status = this.commandPanel?.querySelector('.command-status');
        if (status) {
            status.textContent = `현재 명령: ${labels[this.activeCommand]}`;
            status.style.color = colors[this.activeCommand];
        }
        // The dock icon doubles as the readout of the current order.
        if (this.commandIcon) {
            this.commandIcon.innerHTML = `<span style="font-size:20px; line-height:1;">${icons[this.activeCommand]}</span>`;
            this.commandIcon.title = `워커 분대 명령 — 현재: ${labels[this.activeCommand]}`;
            this.commandIcon.setAttribute('aria-label', this.commandIcon.title);
        }
    }

    initAudioPrompt() {
        this.overlay = document.createElement('div');
        this.overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.85);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 100;
            pointer-events: auto;
            cursor: pointer;
        `;
        this.overlay.innerHTML = `
            <h1 style="color: #00d2ff; margin-bottom: 10px;">슬라임 광산 RPG</h1>
            <p style="color: #aaa; margin-bottom: 20px;">화면을 클릭해 고딕 지하 광산 모험을 시작하세요</p>
            <div style="font-size: 0.8em; color: #777;">퀘스트: 석탄 10개 모으기 · 목표를 달성하면 첫 몬스터가 등장합니다</div>
        `;
        this.container.appendChild(this.overlay);

        this.overlay.onclick = () => {
            this.overlay.style.display = 'none';
            this.startMusic();
        };
    }

    startMusic() {
        const music = new Audio('assets/audio/dungeon-theme.mp3');
        music.loop = true;
        music.volume = Math.max(0, Math.min(1, 0.3));
        music.play().catch(() => {});
    }

    update(inventory, traits, command = this.activeCommand, workerCount = 0, playerHp = 100, maxPlayerHp = 100, quest = null, stats = null, miningProgress = null, traitData = null, equipment = null, combat = null, depth = null, facilities = null, meta = null, workerData = null) {
        this.equipmentData = equipment || this.equipmentData;
        this.updateDepth(depth);
        this.updateFacilities(facilities);
        this.metaData = meta || this.metaData;
        if (this.statusOpen) this.renderLegacyShop();
        // Cached so the status window can render current vitals on demand.
        this.lastPlayerHp = playerHp;
        this.lastMaxPlayerHp = maxPlayerHp;
        this.lastWorkerCount = workerCount;
        this.workerData = workerData;
        this.updateCombatHUD(combat);
        // Keep the open workshop in sync with the stockpile without re-rendering
        // (and killing interaction) on every single frame.
        if (this.craftOpen) {
            const signature = `${inventory.coal}|${inventory.iron}|${inventory.gold}|${inventory.mithril}`;
            if (signature !== this.craftInventorySignature) {
                this.craftInventorySignature = signature;
                this.refreshCraftWorkshop();
            }
        }
        this.updateQuest(quest);
        this.updateStats(stats, inventory, miningProgress);
        this.updateTraits(traitData);
        if (command !== this.activeCommand) {
            this.activeCommand = command;
            this.refreshCommandPanel();
        }
        const hasWorkers = workerCount > 0;
        const commandButtons = this.commandPanel?.querySelectorAll('button[data-command]') || [];
        commandButtons.forEach((button) => {
            button.disabled = !hasWorkers;
            button.style.opacity = hasWorkers ? '1' : '0.45';
            button.style.cursor = hasWorkers ? 'pointer' : 'not-allowed';
        });
        if (this.commandIcon) this.commandIcon.style.opacity = hasWorkers ? '1' : '0.5';
        const commandStatus = this.commandPanel?.querySelector('.command-status');
        if (commandStatus && !hasWorkers) {
            commandStatus.textContent = '전투 보상 획득 후 사용 가능';
            commandStatus.style.color = '#a99bb8';
        } else if (commandStatus) {
            const labels = { mine: '채굴', attack: '공격', defend: '방어' };
            commandStatus.textContent = `현재 명령: ${labels[this.activeCommand]}`;
        }
        // Loadout summary shown next to the leader's vitals.
        const equip = this.equipmentData;
        const equipInfo = equip?.equipped
            ? {
                attackText: `${equip.totalAttack} <span style="color:#8d80a0; font-size:0.85em;">(기본 ${equip.baseAttack})</span>`,
                slotIcon: equip.equipped.icon,
                slotName: equip.equipped.name,
                color: equip.tier?.color || '#d8d2e2',
                recipeSuffix: equip.recipeCount > 0 ? ` (${equip.recipeCount})` : ''
            }
            : {
                attackText: `${equip?.totalAttack ?? 10}`,
                slotIcon: '✊',
                slotName: '맨손 — 무기를 제작하세요',
                color: '#8d80a0',
                recipeSuffix: equip?.recipeCount > 0 ? ` (${equip.recipeCount})` : ''
            };

        const traitCount = (this.traitData?.owned || []).length;

        // Patch the existing nodes in place — see initHUD for why this must
        // never go through innerHTML on every frame.
        this.hud.querySelector('.hud-hp').textContent = `HP ${Math.ceil(playerHp)}/${maxPlayerHp}`;
        this.hud.querySelector('.hud-attack-value').innerHTML = equipInfo.attackText;
        this.hud.querySelector('.hud-workers').textContent = `워커 ${workerCount}`;
        this.hud.querySelector('.hud-traits').textContent = `특성 ${traitCount} ▸`;

        const equipSlot = this.hud.querySelector('.equip-slot');
        equipSlot.style.borderColor = equipInfo.color;
        this.hud.querySelector('.equip-icon').textContent = equipInfo.slotIcon;
        const equipName = this.hud.querySelector('.equip-name');
        equipName.textContent = equipInfo.slotName;
        equipName.style.color = equipInfo.color;

        this.hud.querySelector('.craft-open').textContent = `🔨 아이템 제작 · 장비창 열기${equipInfo.recipeSuffix}`;

        this.hud.querySelector('.inv-coal').textContent = `석탄: ${inventory.coal}`;
        this.hud.querySelector('.inv-iron').textContent = `철광석: ${inventory.iron}`;
        this.hud.querySelector('.inv-gold').textContent = `금광석: ${inventory.gold}`;
        this.hud.querySelector('.inv-mithril').textContent = `미스릴: ${inventory.mithril}`;

        // Keep the status window live while it is open.
        if (this.statusOpen) this.renderStatusWindow();
    }
}
