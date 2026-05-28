const DATA_URL = "./data/lol.json";
const STATE_SCHEMA = 8;
const STORE_KEY = "spelltracker:v7";
const AD_STORE_KEY = "spelltracker:ads:v1";
const AD_DISMISS_MS = 2 * 60 * 1000;
const EMPTY_CHAMPION_IMAGE = "./assets/champion/None.png";
const BRAND_ICON = "./assets/favicon.png";
const ROLE_ICONS = {
  top: "./assets/role-icons/Top_icon.png",
  jungle: "./assets/role-icons/Jungle_icon.png",
  mid: "./assets/role-icons/Middle_icon.png",
  bot: "./assets/role-icons/Bottom_icon.png",
  support: "./assets/role-icons/Support_icon.png"
};

const LANES = [
  { id: "top", label: "TOP", defaultSpells: ["SummonerFlash", "SummonerTeleport"] },
  { id: "jungle", label: "JNG", defaultSpells: ["SummonerFlash", "SummonerSmite"] },
  { id: "mid", label: "MID", defaultSpells: ["SummonerFlash", "SummonerDot"] },
  { id: "bot", label: "BOT", defaultSpells: ["SummonerFlash", "SummonerBarrier"] },
  { id: "support", label: "SUP", defaultSpells: ["SummonerFlash", "SummonerHeal"] }
];

const MODES = {
  classic: {
    label: "Classic",
    defaultSpells: LANES.map((lane) => lane.defaultSpells)
  },
  aram: {
    label: "ARAM",
    defaultSpells: LANES.map(() => ["SummonerFlash", "SummonerSnowball"])
  }
};

const ADJUSTMENTS = [-1, -5, -30, 1, 5, 30];

let appData = null;
let state = null;
const ui = {
  championPickerIndex: null,
  championQuery: "",
  championActiveIndex: 0,
  spellContext: null,
  dismissedAdUntil: loadAdDismissals(),
  adRefreshTimer: null
};

const app = document.querySelector("#app");

init();

async function init() {
  try {
    appData = await fetchJson(DATA_URL);
    state = hydrateState(loadState());
    app.addEventListener("click", handleClick);
    app.addEventListener("change", handleChange);
    app.addEventListener("input", handleInput);
    window.addEventListener("keydown", handleKeydown);
    render();
    updateTimers();
    setInterval(updateTimers, 250);
  } catch (error) {
    app.innerHTML = `
      <div class="loading-screen">
        <div class="loading-mark">!</div>
        <div>Could not load SpellTracker data.</div>
        <pre>${escapeHtml(error.message)}</pre>
      </div>
    `;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function makeDefaultState(mode = "classic") {
  const nextState = {
    schema: STATE_SCHEMA,
    mode,
    theme: "dark",
    flashKey: "D",
    paused: false,
    pausedAt: null,
    players: LANES.map((lane, laneIndex) => ({
      role: mode === "aram" ? "mid" : lane.id,
      championId: "",
      modifierIds: [],
      slots: getModeDefaults(mode, laneIndex).map((spellId) => ({
        spellId,
        cooldowns: []
      }))
    }))
  };
  for (const player of nextState.players) {
    applyFlashPreferenceToPlayer(player, nextState.flashKey);
  }
  return nextState;
}

function hydrateState(saved) {
  const fallback = makeDefaultState();
  if (!saved || ![5, 6, 7, STATE_SCHEMA].includes(saved.schema) || !Array.isArray(saved.players)) {
    return fallback;
  }

  const mode = saved.mode === "aram" ? "aram" : "classic";
  const theme = saved.theme === "light" ? "light" : "dark";
  const flashKey = saved.flashKey === "F" ? "F" : "D";
  const spellIds = new Set(appData.spells.map((spell) => spell.id));
  const championIds = new Set(appData.champions.map((champion) => champion.id));
  const validModifierIds = new Set(selectableModifiers().map((modifier) => modifier.id));
  const poolIds = new Set(spellPoolForMode(mode).map((spell) => spell.id));

  return {
    ...fallback,
    schema: STATE_SCHEMA,
    mode,
    theme,
    flashKey,
    paused: Boolean(saved.paused),
    pausedAt: Number(saved.pausedAt) || null,
    players: fallback.players.map((player, playerIndex) => {
      const savedPlayer = saved.players[playerIndex] || {};
      const savedSlots = Array.isArray(savedPlayer.slots) ? savedPlayer.slots : [];
      const cosmic = selectableModifiers().find((modifier) => modifier.key === "CosmicInsight");
      const migratedModifierIds = [];
      if (savedPlayer.cosmicInsight && cosmic) {
        migratedModifierIds.push(cosmic.id);
      }
      if (savedPlayer.itemModifierId && savedPlayer.itemModifierId !== "none") {
        migratedModifierIds.push(savedPlayer.itemModifierId);
      }
      const savedModifierIds = Array.isArray(savedPlayer.modifierIds) ? savedPlayer.modifierIds : [];
      return {
        ...player,
        role: mode === "aram" ? "mid" : LANES[playerIndex].id,
        championId: championIds.has(savedPlayer.championId) ? savedPlayer.championId : "",
        modifierIds: [...new Set([...savedModifierIds, ...migratedModifierIds])]
          .filter((modifierId) => validModifierIds.has(modifierId)),
        slots: player.slots.map((slot, slotIndex) => {
          const savedSlot = savedSlots[slotIndex] || {};
          const savedSpell = spellIds.has(savedSlot.spellId) && poolIds.has(savedSlot.spellId)
            ? savedSlot.spellId
            : slot.spellId;
          return {
            spellId: savedSpell,
            cooldowns: Array.isArray(savedSlot.cooldowns)
              ? savedSlot.cooldowns.map(Number).filter(Number.isFinite)
              : []
          };
        })
      };
    }).map((player) => {
      applyFlashPreferenceToPlayer(player, flashKey);
      return player;
    })
  };
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY));
  } catch {
    return null;
  }
}

function loadAdDismissals() {
  try {
    const saved = JSON.parse(localStorage.getItem(AD_STORE_KEY));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveAdDismissals() {
  localStorage.setItem(AD_STORE_KEY, JSON.stringify(ui.dismissedAdUntil));
}

function isAdDismissed(adId) {
  const until = Number(ui.dismissedAdUntil[adId]) || 0;
  if (until > Date.now()) {
    return true;
  }
  if (until) {
    delete ui.dismissedAdUntil[adId];
    saveAdDismissals();
  }
  return false;
}

function dismissAd(adId, banner) {
  if (!adId) return;
  ui.dismissedAdUntil[adId] = Date.now() + AD_DISMISS_MS;
  saveAdDismissals();
  banner?.classList.add("is-dismissed");
  scheduleAdRefresh();
  window.setTimeout(render, 180);
}

function scheduleAdRefresh() {
  window.clearTimeout(ui.adRefreshTimer);
  const now = Date.now();
  const nextUntil = Object.values(ui.dismissedAdUntil)
    .map(Number)
    .filter((until) => until > now)
    .sort((a, b) => a - b)[0];
  if (nextUntil) {
    ui.adRefreshTimer = window.setTimeout(render, Math.max(250, nextUntil - now + 50));
  }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function render() {
  pruneAllCooldowns();
  applyTheme();
  app.innerHTML = `
    <div class="tracker-shell">
      ${renderAdBanner("top")}
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark"><img src="${BRAND_ICON}" alt=""></div>
          <div>
            <h1>SpellTracker</h1>
            <p>Patch ${escapeHtml(appData.version)} · by psyopgirl</p>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="control-button pause-button ${state.paused ? "is-on" : ""}" type="button" data-action="toggle-pause">
            ${state.paused ? "Resume" : "Pause"}
          </button>
          <button class="control-button reset-button" type="button" data-action="reset-site">Reset</button>
          <button class="control-button flash-button" type="button" data-action="toggle-flash-key">
            Flash on ${escapeHtml(state.flashKey)}
          </button>
          <button class="control-button theme-button" type="button" data-action="toggle-theme">
            ${state.theme === "dark" ? "Dark" : "Light"}
          </button>
          <button class="control-button mode-button ${state.mode === "aram" ? "is-aram" : ""}" type="button" data-action="toggle-mode">
            ${escapeHtml(MODES[state.mode].label)}
          </button>
          <a class="control-button donate-button" href="https://ko-fi.com/psyopgirl" target="_blank" rel="noopener noreferrer">Donate</a>
        </div>
      </header>

      <main class="team-board" data-mode="${state.mode}">
        ${state.players.map(renderPlayer).join("")}
      </main>
      <footer class="site-disclaimer">
        &copy; SpellTracker 2026. League of Legends &copy; Riot Games. SpellTracker is not endorsed by, affiliated with, partnered with, or approved by Riot Games.
      </footer>
      ${renderAdBanner("bottom")}
    </div>
    ${renderChampionModal()}
    ${renderSpellContext()}
  `;

  focusChampionSearch();
  scheduleAdRefresh();
}

function renderPlayer(player, playerIndex) {
  const lane = LANES[playerIndex];
  const displayRole = displayRoleForPlayer(playerIndex);
  const champion = championById(player.championId);
  const haste = getTotalHaste(player);
  const championImage = champion?.image || EMPTY_CHAMPION_IMAGE;
  const championName = champion ? champion.name : "No champion";
  const roleIcon = ROLE_ICONS[displayRole.id];

  return `
    <article class="player-card" data-player="${playerIndex}">
      <div class="scoreboard-loadout">
        <button class="champion-button" type="button" data-action="open-champion-picker" data-player="${playerIndex}" aria-label="${displayRole.label} champion">
          <img src="${championImage}" alt="${champion ? escapeHtml(champion.name) : "No champion selected"}">
          <b aria-label="${displayRole.label} role">${roleIcon ? `<img class="role-icon" src="${roleIcon}" alt="">` : escapeHtml(displayRole.label)}</b>
        </button>

        <div class="summoner-pair">
          ${player.slots.map((slot, slotIndex) => renderSpellSlot(player, playerIndex, slot, slotIndex)).join("")}
        </div>
      </div>

      <section class="player-name-section" aria-label="${escapeHtml(lane.label)} champion name">
        <strong>${escapeHtml(championName)}</strong>
      </section>

      <section class="timers-section" aria-label="${escapeHtml(lane.label)} timers">
        <div class="section-label">Timers</div>
        <div class="time-controls" aria-label="${escapeHtml(lane.label)} cooldown controls">
          ${player.slots.map((slot, slotIndex) => renderTimeControls(playerIndex, slot, slotIndex)).join("")}
        </div>
      </section>

      <div class="modifier-strip">
        <div class="haste-total" aria-label="${haste} summoner spell haste">
          ${renderHasteValue(haste)}
        </div>
        ${renderModifierButtons(player, playerIndex)}
      </div>
    </article>
  `;
}

function renderSpellSlot(player, playerIndex, slot, slotIndex) {
  const spell = spellById(slot.spellId) || spellPool()[0];
  const status = getSlotStatus(player, slot);
  const fallback = spell.name.slice(0, 2).toUpperCase();
  const contextOpen = ui.spellContext?.playerIndex === playerIndex && ui.spellContext?.slotIndex === slotIndex;

  return `
    <section class="spell-panel ${status.isCooling ? "is-cooling" : ""}" data-player="${playerIndex}" data-slot="${slotIndex}" style="--cooldown-fill:${status.progressPercent}%">
      <div class="spell-frame">
        <button class="spell-button" type="button" data-action="fire-spell" data-player="${playerIndex}" data-slot="${slotIndex}" aria-label="${escapeHtml(spell.name)}">
          <span class="spell-art">
            ${spell.image ? `<img src="${spell.image}" alt="">` : `<span>${escapeHtml(fallback)}</span>`}
          </span>
          <span class="spell-timer" data-spell-timer>${escapeHtml(status.timerText)}</span>
          <span class="charge-count" data-charge-count>${escapeHtml(status.chargeText)}</span>
        </button>
      </div>
      <div class="spell-actions" aria-label="${escapeHtml(spell.name)} actions">
        <button class="context-toggle ${contextOpen ? "is-open" : ""}" type="button" data-action="toggle-spell-context" data-player="${playerIndex}" data-slot="${slotIndex}" aria-label="Open ${escapeHtml(spell.name)} menu">...</button>
        <button class="spell-reset" type="button" data-action="clear-slot" data-player="${playerIndex}" data-slot="${slotIndex}" aria-label="Reset ${escapeHtml(spell.name)} cooldown">&#8635;</button>
      </div>
    </section>
  `;
}

function renderTimeControls(playerIndex, slot, slotIndex) {
  const spell = spellById(slot.spellId) || spellPool()[0];
  const fallback = spell.name.slice(0, 2).toUpperCase();
  return `
    <div class="time-control-row" aria-label="${escapeHtml(spell.name)} time controls">
      <span class="timer-spell-chip" aria-hidden="true">
        ${spell.image ? `<img src="${spell.image}" alt="">` : `<span>${escapeHtml(fallback)}</span>`}
      </span>
      <div class="timer-buttons">
        ${ADJUSTMENTS.map((amount) => `
          <button type="button" data-action="adjust-cooldown" data-player="${playerIndex}" data-slot="${slotIndex}" data-delta="${amount}" aria-label="${amount > 0 ? "Add" : "Subtract"} ${Math.abs(amount)} seconds ${escapeHtml(spell.name)}">
            ${amount > 0 ? "+" : ""}${amount}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderAdBanner(position) {
  if (isAdDismissed(position)) {
    return "";
  }

  return `
    <aside class="ad-banner ad-banner-${position}" data-ad-id="${position}" aria-label="Advertisement">
      <div class="ad-creative">
        <span>Your ad here? - Possibly! Email admin@spelltracker.lol</span>
      </div>
      <button class="ad-close" type="button" data-action="dismiss-ad" data-ad-id="${position}" aria-label="Close advertisement">X</button>
    </aside>
  `;
}

function renderModifierButton({ modifier, selected, playerIndex }) {
  return `
    <button class="modifier-button ${selected ? "is-selected" : ""}" type="button" data-action="toggle-modifier" data-player="${playerIndex}" data-modifier-id="${modifier.id}" aria-pressed="${selected}" title="${escapeHtml(modifier.name)}">
      ${modifier.image ? `<img class="modifier-icon" src="${modifier.image}" alt="">` : ""}
      <span class="modifier-name">${escapeHtml(modifier.name)}</span>
      <span class="modifier-haste">${renderHasteValue(modifier.haste)}</span>
    </button>
  `;
}

function renderModifierButtons(player, playerIndex) {
  return selectableModifiers()
    .map((modifier) => renderModifierButton({
      modifier,
      selected: selectedModifierIds(player).includes(modifier.id),
      playerIndex
    }))
    .join("");
}

function renderHasteValue(value) {
  const icon = appData.icons?.abilityHaste;
  return `${icon ? `<img class="haste-icon" src="${icon}" alt="">` : ""}<span>${Number(value) || 0}</span>`;
}

function renderChampionModal() {
  if (ui.championPickerIndex === null) {
    return "";
  }

  return `
    <div class="modal-backdrop" data-action="close-champion-picker">
      <section class="champion-modal" role="dialog" aria-modal="true" aria-label="Select champion" data-modal-panel>
        <div class="modal-head">
          <h2>Select Champion</h2>
          <button type="button" class="icon-button" data-action="close-champion-picker" aria-label="Close">X</button>
        </div>
        <input class="champion-search" type="search" placeholder="Search champion" value="${escapeHtml(ui.championQuery)}" data-action="champion-search" autocomplete="off">
        <div class="champion-grid" data-champion-grid>
          ${championGridHtml(ui.championQuery)}
        </div>
      </section>
    </div>
  `;
}

function renderSpellContext() {
  const context = ui.spellContext;
  if (!context) {
    return "";
  }

  const player = state.players[context.playerIndex];
  const slot = player?.slots[context.slotIndex];
  const spell = slot ? spellById(slot.spellId) : null;
  const displayRole = displayRoleForPlayer(context.playerIndex);
  if (!player || !slot || !spell) {
    return "";
  }

  return `
    <div class="context-backdrop" data-action="close-spell-context">
      <section class="spell-context" role="dialog" aria-modal="true" aria-label="${escapeHtml(spell.name)} spell menu" data-context-panel>
        <div class="context-head">
          <div class="context-title">
            ${spell.image ? `<img src="${spell.image}" alt="">` : ""}
            <div>
              <h2>${escapeHtml(spell.name)}</h2>
              <span>${escapeHtml(displayRole.label)} Slot ${context.slotIndex + 1}</span>
            </div>
          </div>
          <button type="button" class="icon-button" data-action="close-spell-context" aria-label="Close">X</button>
        </div>

        <div class="context-section">
          <div class="spell-option-grid">
            ${spellPool().map((option) => renderSpellOption(option, spell.id, context)).join("")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderSpellOption(spell, selectedSpellId, context) {
  const fallback = spell.name.slice(0, 2).toUpperCase();
  return `
    <button class="spell-option ${spell.id === selectedSpellId ? "is-selected" : ""}" type="button" data-action="replace-spell" data-player="${context.playerIndex}" data-slot="${context.slotIndex}" data-spell-id="${spell.id}" aria-label="${escapeHtml(spell.name)}" title="${escapeHtml(spell.name)}">
      <span class="spell-option-art">${spell.image ? `<img src="${spell.image}" alt="">` : `<span>${escapeHtml(fallback)}</span>`}</span>
    </button>
  `;
}

function championGridHtml(query) {
  const champions = getChampionSearchResults(query);
  const activeId = champions[ui.championActiveIndex]?.id || "";

  return `
    <button class="champion-option none-option" type="button" data-action="pick-champion" data-champion-id="">
      <img src="${EMPTY_CHAMPION_IMAGE}" alt="">
      <span>None</span>
    </button>
    ${champions.map((champion, index) => `
      <button class="champion-option ${champion.id === activeId ? "is-active" : ""}" type="button" data-action="pick-champion" data-champion-id="${champion.id}" data-champion-index="${index}">
        <img src="${champion.image}" alt="">
        <span>${escapeHtml(champion.name)}</span>
      </button>
    `).join("")}
  `;
}

function getChampionSearchResults(query) {
  const role = ui.championPickerIndex === null ? null : displayRoleForPlayer(ui.championPickerIndex);
  const roleId = role?.id || "";
  const needle = normalizeSearch(query);
  const ranked = appData.champions
    .map((champion) => ({
      champion,
      score: championSearchScore(champion, needle, roleId)
    }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.champion.name.localeCompare(b.champion.name));

  return ranked.map((entry) => entry.champion);
}

function championSearchScore(champion, needle, roleId) {
  const preferred = championPreferredRoles(champion).includes(roleId);
  if (!needle) {
    return preferred ? 0 : Number.POSITIVE_INFINITY;
  }

  const name = normalizeSearch(champion.name);
  const id = normalizeSearch(champion.id);
  const text = `${name} ${id}`;
  if (!text.includes(needle) && !isSubsequence(needle, name)) {
    return Number.POSITIVE_INFINITY;
  }

  let score = preferred ? 0 : 12;
  if (name === needle || id === needle) {
    score += 0;
  } else if (name.startsWith(needle) || id.startsWith(needle)) {
    score += 1;
  } else if (text.includes(needle)) {
    score += 4;
  } else {
    score += 8;
  }
  return score + name.length / 100;
}

function championPreferredRoles(champion) {
  return Array.isArray(champion?.roles) ? champion.roles : [];
}

function refreshChampionGrid() {
  const grid = app.querySelector("[data-champion-grid]");
  if (!grid) return;
  const champions = getChampionSearchResults(ui.championQuery);
  ui.championActiveIndex = champions.length
    ? clamp(ui.championActiveIndex, 0, champions.length - 1)
    : 0;
  grid.innerHTML = championGridHtml(ui.championQuery);
  requestAnimationFrame(() => {
    app.querySelector(".champion-option.is-active")?.scrollIntoView({ block: "nearest" });
  });
}

function focusChampionSearch() {
  const modalSearch = app.querySelector("[data-action='champion-search']");
  if (modalSearch) {
    requestAnimationFrame(() => modalSearch.focus());
  }
}

function handleClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  if (action === "dismiss-ad") {
    const banner = actionTarget.closest(".ad-banner");
    const adId = actionTarget.dataset.adId;
    dismissAd(adId, banner);
    return;
  }

  if (action === "close-champion-picker" && event.target.closest("[data-modal-panel]") && actionTarget.classList.contains("modal-backdrop")) {
    return;
  }
  if (action === "close-spell-context" && event.target.closest("[data-context-panel]") && actionTarget.classList.contains("context-backdrop")) {
    return;
  }

  if (action === "toggle-pause") {
    togglePause();
    return;
  }

  if (action === "toggle-mode") {
    setMode(state.mode === "classic" ? "aram" : "classic");
    return;
  }

  if (action === "reset-site") {
    resetSite();
    return;
  }

  if (action === "toggle-flash-key") {
    toggleFlashKey();
    return;
  }

  if (action === "toggle-theme") {
    toggleTheme();
    return;
  }

  if (action === "open-champion-picker") {
    ui.championPickerIndex = Number(actionTarget.dataset.player);
    ui.championQuery = "";
    ui.championActiveIndex = 0;
    ui.spellContext = null;
    render();
    return;
  }

  if (action === "close-champion-picker") {
    closeChampionPicker();
    return;
  }

  if (action === "pick-champion") {
    const player = state.players[ui.championPickerIndex];
    if (player) {
      player.championId = actionTarget.dataset.championId || "";
      closeChampionPicker(true);
    }
    return;
  }

  if (action === "toggle-spell-context") {
    const next = {
      playerIndex: Number(actionTarget.dataset.player),
      slotIndex: Number(actionTarget.dataset.slot)
    };
    const current = ui.spellContext;
    ui.spellContext = current?.playerIndex === next.playerIndex && current?.slotIndex === next.slotIndex ? null : next;
    render();
    return;
  }

  if (action === "close-spell-context") {
    ui.spellContext = null;
    render();
    return;
  }

  if (action === "toggle-modifier") {
    const player = state.players[Number(actionTarget.dataset.player)];
    toggleModifier(player, actionTarget.dataset.modifierId);
    saveAndRender();
    return;
  }

  if (action === "fire-spell") {
    fireSpell(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot));
    saveAndRender();
    return;
  }

  if (action === "start-full-cooldown") {
    startFullCooldown(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot));
    saveAndRender();
    return;
  }

  if (action === "adjust-cooldown") {
    adjustCooldown(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot), Number(actionTarget.dataset.delta));
    saveAndRender();
    return;
  }

  if (action === "clear-slot") {
    clearSlot(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot));
    saveAndRender();
    return;
  }

  if (action === "replace-spell") {
    replaceSpell(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot), actionTarget.dataset.spellId);
    ui.spellContext = null;
    saveAndRender();
  }
}

function handleChange() {}

function handleInput(event) {
  const target = event.target;
  if (target.dataset.action !== "champion-search") return;
  ui.championQuery = target.value;
  ui.championActiveIndex = 0;
  refreshChampionGrid();
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    if (ui.spellContext) {
      ui.spellContext = null;
      render();
    } else if (ui.championPickerIndex !== null) {
      closeChampionPicker();
    }
    return;
  }

  if (ui.championPickerIndex !== null) {
    if (event.key === "Enter") {
      event.preventDefault();
      pickActiveChampion();
      return;
    }

    if (event.key === "Tab" || event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      cycleChampionSelection(1);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      cycleChampionSelection(-1);
    }
  }
}

function closeChampionPicker(alreadySaved = false) {
  ui.championPickerIndex = null;
  ui.championQuery = "";
  ui.championActiveIndex = 0;
  if (alreadySaved) {
    saveAndRender();
  } else {
    render();
  }
}

function pickActiveChampion() {
  const champion = getChampionSearchResults(ui.championQuery)[ui.championActiveIndex];
  const player = state.players[ui.championPickerIndex];
  if (!champion || !player) return;
  player.championId = champion.id;
  closeChampionPicker(true);
}

function cycleChampionSelection(step) {
  const champions = getChampionSearchResults(ui.championQuery);
  if (!champions.length) return;
  ui.championActiveIndex = (ui.championActiveIndex + step + champions.length) % champions.length;
  refreshChampionGrid();
}

function setMode(mode) {
  state.mode = mode;
  ui.spellContext = null;
  for (let playerIndex = 0; playerIndex < state.players.length; playerIndex += 1) {
    const player = state.players[playerIndex];
    player.role = mode === "aram" ? "mid" : LANES[playerIndex].id;
    const defaults = getModeDefaults(mode, playerIndex);
    for (let slotIndex = 0; slotIndex < player.slots.length; slotIndex += 1) {
      const slot = player.slots[slotIndex];
      slot.spellId = defaults[slotIndex];
      slot.cooldowns = [];
    }
    applyFlashPreferenceToPlayer(player, state.flashKey);
  }
  saveAndRender();
}

function resetSite() {
  state = makeDefaultState();
  ui.championPickerIndex = null;
  ui.championQuery = "";
  ui.championActiveIndex = 0;
  ui.spellContext = null;
  saveAndRender();
}

function toggleFlashKey() {
  state.flashKey = state.flashKey === "D" ? "F" : "D";
  for (const player of state.players) {
    applyFlashPreferenceToPlayer(player, state.flashKey);
  }
  saveAndRender();
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveAndRender();
}

function applyTheme() {
  const theme = state?.theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  const themeColor = theme === "light" ? "#f2f2f2" : "#121212";
  document.querySelector("meta[name='theme-color']")?.setAttribute("content", themeColor);
}

function togglePause() {
  if (state.paused) {
    const delta = Date.now() - (state.pausedAt || Date.now());
    for (const player of state.players) {
      for (const slot of player.slots) {
        slot.cooldowns = slot.cooldowns.map((endAt) => endAt + delta);
      }
    }
    state.paused = false;
    state.pausedAt = null;
  } else {
    state.paused = true;
    state.pausedAt = Date.now();
  }
  saveAndRender();
}

function fireSpell(playerIndex, slotIndex) {
  const player = state.players[playerIndex];
  const slot = player.slots[slotIndex];
  const spell = spellById(slot.spellId);
  if (!spell) return;

  const maxAmmo = Math.max(1, spell.maxAmmo);
  const now = referenceNow();
  const active = slot.cooldowns.filter((endAt) => endAt > now).sort((a, b) => a - b);
  const durationMs = effectiveCooldown(spell, player) * 1000;

  if (maxAmmo === 1 && active.length > 0) {
    slot.cooldowns = [now + durationMs];
    return;
  }

  if (active.length < maxAmmo) {
    active.push(now + durationMs);
  } else {
    active[0] = now + durationMs;
  }
  slot.cooldowns = active.sort((a, b) => a - b);
}

function startFullCooldown(playerIndex, slotIndex) {
  clearSlot(playerIndex, slotIndex);
  fireSpell(playerIndex, slotIndex);
}

function adjustCooldown(playerIndex, slotIndex, seconds) {
  const player = state.players[playerIndex];
  const slot = player.slots[slotIndex];
  const now = referenceNow();
  const active = slot.cooldowns.filter((endAt) => endAt > now).sort((a, b) => a - b);

  if (active.length === 0) {
    if (seconds > 0) {
      slot.cooldowns = [now + seconds * 1000];
    }
    return;
  }

  active[0] = Math.max(now, active[0] + seconds * 1000);
  slot.cooldowns = active.filter((endAt) => endAt > now).sort((a, b) => a - b);
}

function clearSlot(playerIndex, slotIndex) {
  state.players[playerIndex].slots[slotIndex].cooldowns = [];
}

function replaceSpell(playerIndex, slotIndex, spellId) {
  const poolIds = new Set(spellPool().map((spell) => spell.id));
  if (!poolIds.has(spellId)) return;
  const slot = state.players[playerIndex].slots[slotIndex];
  slot.spellId = spellId;
  slot.cooldowns = [];
  applyFlashPreferenceToPlayer(state.players[playerIndex], state.flashKey);
}

function clearAllCooldowns() {
  for (const player of state.players) {
    for (const slot of player.slots) {
      slot.cooldowns = [];
    }
  }
}

function updateTimers() {
  if (!state || !appData) return;
  const panels = app.querySelectorAll(".spell-panel[data-player][data-slot]");
  for (const panel of panels) {
    const player = state.players[Number(panel.dataset.player)];
    const slot = player.slots[Number(panel.dataset.slot)];
    const spell = spellById(slot.spellId);
    if (!spell) continue;

    const status = getSlotStatus(player, slot);
    panel.classList.toggle("is-cooling", status.isCooling);
    panel.style.setProperty("--cooldown-fill", `${status.progressPercent}%`);
    const timer = panel.querySelector("[data-spell-timer]");
    const charges = panel.querySelector("[data-charge-count]");
    if (timer) timer.textContent = status.timerText;
    if (charges) charges.textContent = status.chargeText;
  }
}

function getSlotStatus(player, slot) {
  const spell = spellById(slot.spellId);
  const now = referenceNow();
  const active = slot.cooldowns.filter((endAt) => endAt > now).sort((a, b) => a - b);
  const maxAmmo = Math.max(1, spell?.maxAmmo || 1);
  const available = Math.max(0, maxAmmo - active.length);
  const nextEnd = active[0] || 0;
  const remainingMs = Math.max(0, nextEnd - now);
  const fullMs = Math.max(1, effectiveCooldown(spell, player) * 1000);
  const progressPercent = clamp((remainingMs / fullMs) * 100, 0, 100);

  return {
    isCooling: remainingMs > 0,
    progressPercent,
    timerText: remainingMs > 0 ? formatSeconds(remainingMs / 1000, "ceil") : "",
    chargeText: maxAmmo > 1 ? `${available}/${maxAmmo}` : ""
  };
}

function pruneAllCooldowns() {
  if (!state) return;
  const now = referenceNow();
  for (const player of state.players) {
    for (const slot of player.slots) {
      slot.cooldowns = slot.cooldowns.filter((endAt) => endAt > now).sort((a, b) => a - b);
    }
  }
}

function saveAndRender() {
  pruneAllCooldowns();
  saveState();
  render();
  updateTimers();
}

function effectiveCooldown(spell, player) {
  if (!spell) return 0;
  const haste = getTotalHaste(player);
  return spell.cooldown / (1 + haste / 100);
}

function getTotalHaste(player) {
  return Math.round(selectedModifierIds(player)
    .map((modifierId) => modifierById(modifierId)?.haste || 0)
    .reduce((total, haste) => total + haste, 0));
}

function selectedModifierIds(player) {
  return Array.isArray(player?.modifierIds) ? player.modifierIds : [];
}

function toggleModifier(player, modifierId) {
  const modifier = modifierById(modifierId);
  if (!player || !modifier) return;

  const selected = new Set(selectedModifierIds(player));
  if (selected.has(modifierId)) {
    selected.delete(modifierId);
  } else {
    if (modifier.exclusiveGroup) {
      for (const other of selectableModifiers()) {
        if (other.exclusiveGroup === modifier.exclusiveGroup) {
          selected.delete(other.id);
        }
      }
    }
    selected.add(modifierId);
  }
  player.modifierIds = [...selected].filter((id) => modifierById(id));
}

function modifierById(modifierId) {
  return selectableModifiers().find((modifier) => modifier.id === modifierId);
}

function selectableModifiers() {
  const modifierGroups = appData.modifiers || {};
  if (Array.isArray(modifierGroups.all)) {
    return modifierGroups.all.filter((modifier) => modifier.ui !== false && modifier.haste > 0);
  }

  const legacyRunes = (modifierGroups.runes || [])
    .filter((modifier) => modifier.key === "CosmicInsight")
    .map((modifier) => ({
      ...modifier,
      id: String(modifier.id),
      kind: "rune",
      exclusiveGroup: ""
    }));
  const legacyItems = (modifierGroups.items || []).map((modifier) => ({
    ...modifier,
    id: String(modifier.id),
    kind: "item",
    exclusiveGroup: "boots"
  }));
  return [...legacyRunes, ...legacyItems];
}

function getModeDefaults(mode, playerIndex) {
  return MODES[mode]?.defaultSpells[playerIndex] || MODES.classic.defaultSpells[playerIndex];
}

function applyFlashPreferenceToPlayer(player, flashKey) {
  if (!player?.slots || player.slots.length < 2) return;
  const targetIndex = flashKey === "F" ? 1 : 0;
  const flashIndex = player.slots.findIndex((slot) => slot.spellId === "SummonerFlash");
  if (flashIndex < 0 || flashIndex === targetIndex) return;
  const targetSlot = player.slots[targetIndex];
  player.slots[targetIndex] = player.slots[flashIndex];
  player.slots[flashIndex] = targetSlot;
}

function displayRoleForPlayer(playerIndex) {
  const lane = LANES[playerIndex] || LANES[0];
  return state?.mode === "aram"
    ? { id: "mid", label: "MID", defaultSpells: lane.defaultSpells }
    : lane;
}

function spellPool() {
  return spellPoolForMode(state?.mode || "classic");
}

function spellPoolForMode(mode) {
  const pool = appData.spells.filter((spell) => mode === "aram" ? spell.modes.includes("ARAM") : spell.isClassic);
  return pool.length ? pool : appData.spells;
}

function spellById(id) {
  return appData.spells.find((spell) => spell.id === id);
}

function championById(id) {
  return appData.champions.find((champion) => champion.id === id);
}

function referenceNow() {
  return state?.paused ? state.pausedAt || Date.now() : Date.now();
}

function formatSeconds(value, mode = "round") {
  const seconds = mode === "ceil" ? Math.ceil(value) : Math.round(value);
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  if (minutes <= 0) {
    return `${rest}s`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f'\u2019. -]/g, "")
    .toLowerCase();
}

function isSubsequence(needle, value) {
  let offset = 0;
  for (const character of value) {
    if (character === needle[offset]) {
      offset += 1;
      if (offset === needle.length) return true;
    }
  }
  return false;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
