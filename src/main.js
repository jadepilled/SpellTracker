const DATA_URL = "./data/lol.json";
const ADS_URL = "./data/ads.json";
const STATE_SCHEMA = 11;
const STORE_KEY = "spelltracker:v7";
const COUNTER_API_URL = window.SPELLTRACKER_COUNTER_ENDPOINT
  || "https://spelltracker-counter.jade-431.workers.dev/api/cooldowns";
const ANALYTICS_API_URL = window.SPELLTRACKER_ANALYTICS_ENDPOINT
  || "https://spelltracker-counter.jade-431.workers.dev/api/analytics";
const COUNTER_REFRESH_MS = 5 * 60 * 1000;
const COUNTER_SYNC_DEBOUNCE_MS = 2200;
const COUNTER_BATCH_LIMIT = 100;
const COUNTER_LOCAL_EVENT_LIMIT = 10;
const MIN_TRACKED_COOLDOWN_RATIO = 0.5;
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

const ROLE_PLACEHOLDER_LABELS = {
  top: "Top Laner",
  jungle: "Jungler",
  mid: "Mid Laner",
  bot: "Bot Laner",
  support: "Support"
};

const MODES = {
  classic: {
    label: "SR",
    defaultSpells: LANES.map((lane) => lane.defaultSpells)
  },
  aram: {
    label: "ARAM",
    defaultSpells: LANES.map(() => ["SummonerFlash", "SummonerSnowball"])
  }
};

const ADJUSTMENTS = [-1, -5, -15, 1, 5, 15];
const GAME_TIME_MENU_FADE_MS = 160;
const OVERLAY_FADE_MS = 180;
const STOP_PROMPT_MS = 1800;
const TIMELINE_PAST_MS = 30 * 1000;
const TIMELINE_FUTURE_MS = 5 * 60 * 1000;
const MAX_GAME_TIME_MS = 1000 * 60 * 1000;
const FLASH_ICON = "./assets/spell/SummonerFlash.png";
const MODE_BASE_SUMMONER_SPELL_HASTE = {
  aram: 70
};
const SPELL_COLORS = {
  SummonerBarrier: "#e7c84f",
  SummonerBoost: "#64c9d8",
  SummonerExhaust: "#8c6be8",
  SummonerFlash: "#d4d53f",
  SummonerHaste: "#8fcf55",
  SummonerHeal: "#60c56a",
  SummonerDot: "#e35a2e",
  SummonerSmite: "#d65b34",
  SummonerTeleport: "#8768d8",
  SummonerMana: "#4e9be8",
  SummonerCherryFlash: "#d4d53f",
  SummonerCherryHold: "#8fcf55",
  SummonerSnowURFSnowball_Mark: "#75c8e8",
  SummonerSnowball: "#75c8e8",
  SummonerPoroThrow: "#c28d54",
  SummonerPoroRecall: "#d5ba76"
};

let appData = null;
let adConfig = { ads: [] };
let state = null;
const ui = {
  championPickerIndex: null,
  championQuery: "",
  championActiveIndex: 0,
  spellContext: null,
  spellContextClosing: false,
  spellContextCloseTimer: null,
  gameTimerMenuOpen: false,
  gameTimerMenuClosing: false,
  gameTimerMenuCloseTimer: null,
  ctrlClockHeld: false,
  gameTimeEditing: false,
  gameTimeDraft: "",
  gameTimeEditInitialText: "",
  stopPromptVisible: false,
  stopPromptClosing: false,
  stopPromptTimer: null,
  stopShakeTimer: null,
  resetConfirmVisible: false,
  resetConfirmClosing: false,
  resetConfirmCloseTimer: null,
  helpVisible: false,
  helpClosing: false,
  helpCloseTimer: null,
  interactionDenied: false,
  viewTransition: false,
  counterSyncing: false,
  counterSyncTimer: null,
  counterRefreshTimer: null,
  counterAnimating: false,
  counterAnimationTimer: null,
  dismissedAds: new Set(),
  adSlots: {},
  championPickerClosing: false,
  championPickerCloseTimer: null,
  championGridRefreshing: false,
  lastTimelineRenderAt: 0,
  timelineRefreshBlockedUntil: 0
};

const app = document.querySelector("#app");

init();

async function init() {
  try {
    const [lolData, ads] = await Promise.all([
      fetchJson(DATA_URL),
      fetchJson(ADS_URL).catch(() => ({ ads: [] }))
    ]);
    appData = lolData;
    adConfig = ads;
    state = hydrateState(loadState());
    app.addEventListener("click", handleClick);
    app.addEventListener("change", handleChange);
    app.addEventListener("input", handleInput);
    app.addEventListener("focusout", handleFocusOut);
    app.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("contextmenu", preventDefaultSiteMenu);
    document.addEventListener("dragstart", preventDefaultSiteMenu);
    document.addEventListener("selectstart", preventSiteSelection);
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("keyup", handleKeyup);
    window.addEventListener("resize", () => requestAnimationFrame(updateTimelineCurrentLine));
    render();
    updateTimers();
    initCooldownCounter();
    trackSiteView();
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
    viewMode: "scoreboard",
    headerCollapsed: defaultHeaderCollapsed(),
    paused: false,
    pausedAt: null,
    gameTimeMs: 0,
    gameStartedAt: null,
    gameTimerRunning: false,
    counterTotal: "0",
    counterPending: 0,
    counterLastFetchAt: 0,
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
  if (!saved || ![5, 6, 7, 8, 10, STATE_SCHEMA].includes(saved.schema) || !Array.isArray(saved.players)) {
    return fallback;
  }

  const mode = saved.mode === "aram" ? "aram" : "classic";
  const theme = saved.theme === "light" ? "light" : "dark";
  const flashKey = saved.flashKey === "F" ? "F" : "D";
  const viewMode = "scoreboard";
  const paused = Boolean(saved.paused);
  const gameTimerRunning = Boolean(saved.gameTimerRunning);
  const gameStartedAt = gameTimerRunning && !paused && Number.isFinite(Number(saved.gameStartedAt))
    ? Number(saved.gameStartedAt)
    : null;
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
    viewMode,
    headerCollapsed: typeof saved.headerCollapsed === "boolean" ? saved.headerCollapsed : fallback.headerCollapsed,
    paused,
    pausedAt: Number(saved.pausedAt) || null,
    gameTimeMs: Math.max(0, Number(saved.gameTimeMs) || 0),
    gameStartedAt,
    gameTimerRunning,
    counterTotal: parseCounterValue(saved.counterTotal).toString(),
    counterPending: Math.max(0, Number(saved.counterPending) || 0),
    counterLastFetchAt: Math.max(0, Number(saved.counterLastFetchAt) || 0),
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
              ? savedSlot.cooldowns.map(normalizeCooldownEntry).filter(Boolean)
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

function isAdDismissed(adId) {
  return ui.dismissedAds.has(adId);
}

function dismissAd(adId) {
  if (!adId) return;
  ui.dismissedAds.add(adId);
  render();
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function saveCooldownChange() {
  saveState();
  if (ui.spellContext) {
    render();
    return;
  }
  if (state.viewMode === "timeline") {
    render();
    return;
  }
  pruneAllCooldowns();
  updateTimers();
}

function initCooldownCounter() {
  renderCounterValue();
  refreshCooldownCounter();
  scheduleCounterSync(900);
  clearInterval(ui.counterRefreshTimer);
  ui.counterRefreshTimer = setInterval(refreshCooldownCounter, COUNTER_REFRESH_MS);
}

function counterDisplayTotal() {
  return parseCounterValue(state?.counterTotal) + BigInt(Math.max(0, Math.floor(Number(state?.counterPending) || 0)));
}

function renderCounterValue({ animate = false } = {}) {
  if (animate) {
    ui.counterAnimating = true;
  }
  const counter = app.querySelector(".cooldown-counter");
  const value = app.querySelector("[data-counter-value]");
  if (!counter || !value || !state) return;
  value.textContent = formatCounterNumber(counterDisplayTotal());
  if (!animate) return;

  counter.classList.remove("is-updating");
  void counter.offsetWidth;
  counter.classList.add("is-updating");
  clearTimeout(ui.counterAnimationTimer);
  ui.counterAnimationTimer = setTimeout(() => {
    counter.classList.remove("is-updating");
    ui.counterAnimating = false;
  }, 520);
}

function queueCounterAnimation() {
  ui.counterAnimating = true;
  requestAnimationFrame(() => renderCounterValue({ animate: true }));
}

function addPendingCooldownCompletions(amount) {
  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!safeAmount || !state) return;
  const cappedAmount = Math.min(safeAmount, COUNTER_LOCAL_EVENT_LIMIT);
  state.counterPending = Math.max(0, Number(state.counterPending) || 0) + cappedAmount;
  saveState();
  renderCounterValue({ animate: true });
  scheduleCounterSync();
}

function scheduleCounterSync(delay = COUNTER_SYNC_DEBOUNCE_MS) {
  clearTimeout(ui.counterSyncTimer);
  if (!state || Number(state.counterPending) <= 0) return;
  ui.counterSyncTimer = setTimeout(flushCooldownCounter, delay);
}

async function refreshCooldownCounter({ force = false } = {}) {
  if (!state || !COUNTER_API_URL) return;
  const now = Date.now();
  if (!force && now - Number(state.counterLastFetchAt || 0) < COUNTER_REFRESH_MS) return;

  try {
    const response = await fetch(COUNTER_API_URL, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Counter refresh failed: ${response.status}`);
    const data = await response.json();
    applyCounterTotal(data.total, now);
  } catch {
    state.counterLastFetchAt = now;
    saveState();
  }
}

async function flushCooldownCounter() {
  if (!state || ui.counterSyncing || Number(state.counterPending) <= 0 || !COUNTER_API_URL) return;
  ui.counterSyncing = true;
  const amount = Math.min(COUNTER_BATCH_LIMIT, Math.max(1, Math.floor(Number(state.counterPending) || 0)));
  const previousDisplay = counterDisplayTotal();

  try {
    const response = await fetch(COUNTER_API_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount }),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Counter sync failed: ${response.status}`);
    const data = await response.json();
    state.counterPending = Math.max(0, Number(state.counterPending || 0) - amount);
    state.counterTotal = maxCounterString(state.counterTotal, data.total);
    state.counterLastFetchAt = Date.now();
    saveState();
    renderCounterValue({ animate: counterDisplayTotal() !== previousDisplay });
  } catch {
    scheduleCounterSync(30 * 1000);
  } finally {
    ui.counterSyncing = false;
  }

  if (Number(state.counterPending) > 0) {
    scheduleCounterSync(900);
  }
}

function applyCounterTotal(total, fetchedAt = Date.now(), { save = true } = {}) {
  if (!state) return;
  const nextTotal = parseCounterValue(total);
  const previousDisplay = counterDisplayTotal();
  state.counterTotal = maxCounterString(state.counterTotal, nextTotal);
  state.counterLastFetchAt = fetchedAt;
  if (save) saveState();
  const nextDisplay = counterDisplayTotal();
  renderCounterValue({ animate: nextDisplay !== previousDisplay });
}

function trackSiteView() {
  sendAnalyticsEvent("site-view");
}

function trackAdClick(adId, position) {
  sendAnalyticsEvent("ad-click", { adId, position });
}

function sendAnalyticsEvent(event, details = {}) {
  if (!ANALYTICS_API_URL || !event) return;
  const body = JSON.stringify({
    event,
    ...details,
    path: window.location.pathname,
    viewport: `${window.innerWidth}x${window.innerHeight}`
  });

  if (navigator.sendBeacon) {
    try {
      const payload = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ANALYTICS_API_URL, payload)) return;
    } catch {
      // Fall through to fetch.
    }
  }

  fetch(ANALYTICS_API_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body,
    cache: "no-store",
    keepalive: true
  }).catch(() => {});
}

function render() {
  pruneAllCooldowns();
  applyTheme();
  const topAd = renderAdBanner("top");
  const bottomAd = renderAdBanner("bottom");
  app.innerHTML = `
    <div class="tracker-shell ${state.headerCollapsed ? "is-header-collapsed" : ""} ${topAd ? "has-top-ad" : ""} ${state.paused ? "is-stopped" : ""} ${ui.interactionDenied ? "is-denied" : ""} ${ui.viewTransition ? "is-view-transitioning" : ""}" data-view="${state.viewMode}">
      ${renderTopbar()}
      ${renderGameTimer()}
      ${topAd}
      ${renderPrimaryView()}
      <div class="bottom-rail">
        ${bottomAd}
        <footer class="site-disclaimer">
          SpellTracker and spelltracker.lol copyright &copy; SpellTracker 2026. League of Legends, all champions, icons, names, and images are copyright &copy; Riot Games. SpellTracker is not endorsed by, affiliated with, partnered with, or approved by Riot Games.
        </footer>
      </div>
    </div>
    <div class="overlay-root" data-overlay-root>
      ${renderOverlays()}
    </div>
  `;

  focusChampionSearch();
  focusGameTimeInput();
  requestAnimationFrame(updateTimelineCurrentLine);
  if (ui.viewTransition) {
    setTimeout(() => {
      app.querySelector(".tracker-shell")?.classList.remove("is-view-transitioning");
      ui.viewTransition = false;
    }, 220);
  }
}

function renderOverlays() {
  return `
    ${renderChampionModal()}
    ${renderSpellContext()}
    ${renderHelpDialog()}
    ${renderStopPrompt()}
    ${renderResetConfirm()}
  `;
}

function renderOverlaysOnly() {
  const overlayRoot = app.querySelector("[data-overlay-root]");
  if (!overlayRoot) {
    render();
    return;
  }
  overlayRoot.innerHTML = renderOverlays();
  focusChampionSearch();
  focusGameTimeInput();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <button class="control-button drawer-button" type="button" data-action="toggle-header" aria-expanded="${!state.headerCollapsed}">
        ${state.headerCollapsed ? "Menu" : "Hide"}
      </button>
      <div class="drawer-summary" aria-hidden="${!state.headerCollapsed}">
        <span>SpellTracker</span>
        <small>Patch ${escapeHtml(appData.version)}</small>
      </div>
      ${state.headerCollapsed ? renderStopButton("collapsed-stop-button") : ""}
      <div class="topbar-content">
        <div class="brand">
          <div class="brand-mark"><img src="${BRAND_ICON}" alt=""></div>
          <div class="brand-copy">
            <h1>SpellTracker</h1>
            <p>Patch ${escapeHtml(appData.version)} &middot; by psyopgirl</p>
          </div>
        </div>
        ${renderCooldownCounter()}
        <div class="topbar-actions">
          ${state.headerCollapsed ? "" : renderStopButton("pause-button stop-button")}
          <button class="control-button reset-button" type="button" data-action="reset-site" aria-label="Reset SpellTracker">
            ${iconSvg("reset")}
          </button>
          <button class="view-switch ${state.viewMode === "timeline" ? "is-timeline" : "is-scoreboard"}" type="button" data-action="toggle-view" role="switch" aria-checked="${state.viewMode === "timeline"}" aria-label="${state.viewMode === "timeline" ? "Switch to scoreboard view" : "Switch to timeline view"}">
            <span class="view-switch-option">${iconSvg("scoreboard")}</span>
            <span class="view-switch-option">${iconSvg("timeline")}</span>
            <span class="view-switch-thumb" aria-hidden="true"></span>
          </button>
          <button class="control-button flash-button" type="button" data-action="toggle-flash-key" aria-label="Flash on ${escapeHtml(state.flashKey)}">
            <img src="${FLASH_ICON}" alt=""><span>${escapeHtml(state.flashKey)}</span>
          </button>
          <button class="control-button theme-button" type="button" data-action="toggle-theme" aria-label="${state.theme === "dark" ? "Use light mode" : "Use dark mode"}">
            ${state.theme === "dark" ? iconSvg("moon") : iconSvg("sun")}
          </button>
          <button class="control-button mode-button ${state.mode === "aram" ? "is-aram" : ""}" type="button" data-action="toggle-mode">
            ${escapeHtml(MODES[state.mode].label)}
          </button>
          <button class="control-button info-button" type="button" data-action="toggle-help" aria-label="SpellTracker help">
            ${iconSvg("info")}
          </button>
          <a class="control-button donate-button" href="https://ko-fi.com/psyopgirl" target="_blank" rel="noopener noreferrer" aria-label="Donate on Ko-fi">$</a>
        </div>
      </div>
    </header>
  `;
}

function renderCooldownCounter() {
  const total = counterDisplayTotal();
  return `
    <div class="cooldown-counter ${ui.counterAnimating ? "is-updating" : ""}" aria-label="${escapeHtml(formatCompactNumber(total))} cooldowns tracked">
      <span data-counter-value>${escapeHtml(formatCounterNumber(total))}</span>
      <span>Cooldowns tracked</span>
    </div>
  `;
}

function renderStopButton(extraClass = "") {
  return `
    <button class="control-button ${extraClass} ${state.paused ? "is-resume" : ""}" type="button" data-action="toggle-pause" aria-label="${state.paused ? "Resume SpellTracker" : "Stop SpellTracker"}">
      ${state.paused ? iconSvg("play") : iconSvg("stop")}
    </button>
  `;
}

function renderGameTimer() {
  const running = isGameTimerAdvancing();
  const clockActive = isClockControlActive();
  const displayedTime = formatGameTime(currentGameTimeMs());
  return `
    <section class="game-timer" aria-label="Game timer">
      <div class="game-time-readout ${clockActive ? "is-adjustable" : ""} ${ui.gameTimeEditing ? "is-editing" : ""}" data-game-time-readout>
        ${ui.gameTimeEditing
          ? `<input class="game-time-input" data-action="game-time-input" inputmode="numeric" autocomplete="off" spellcheck="false" value="${escapeHtml(ui.gameTimeDraft || displayedTime)}" aria-label="Set game time">`
          : `<span data-game-time>${displayedTime}</span>`}
        <small data-game-timer-state>${gameTimerStateText()}</small>
      </div>
      <div class="game-timer-actions">
        <button class="control-button game-start-button ${running ? "is-on" : ""}" type="button" data-action="toggle-game-timer" aria-label="${running ? "Pause game timer" : "Start game timer"}">
          ${running ? iconSvg("pause") : iconSvg("play")}
        </button>
        <button class="control-button game-reset-button" type="button" data-action="reset-game-timer" aria-label="Reset game timer">${iconSvg("reset")}</button>
        <span class="game-clock-wrap">
          <button class="control-button game-clock-button ${clockActive ? "is-on" : ""}" type="button" data-action="toggle-game-time-menu" aria-label="Adjust game timer" aria-expanded="${ui.gameTimerMenuOpen}">${iconSvg("clock")}</button>
          ${ui.gameTimerMenuOpen || ui.gameTimerMenuClosing ? renderGameTimeMenu() : ""}
        </span>
      </div>
    </section>
  `;
}

function renderGameTimeMenu() {
  return `
    <div class="game-time-popover ${ui.gameTimerMenuClosing ? "is-closing" : ""}" role="menu" aria-label="Adjust game time">
      ${ADJUSTMENTS.map((amount) => `
        <button type="button" data-action="adjust-game-time" data-delta="${amount}" aria-label="${amount > 0 ? "Add" : "Subtract"} ${Math.abs(amount)} seconds game time">
          ${amount > 0 ? "+" : ""}${amount}
        </button>
      `).join("")}
    </div>
  `;
}

function isClockControlActive(event = null) {
  return Boolean(ui.gameTimerMenuOpen || ui.ctrlClockHeld || event?.ctrlKey);
}

function gameTimerStateText() {
  if (state.paused) return "Stopped";
  return isGameTimerAdvancing() ? "Live" : "Paused";
}

function openGameTimeMenu() {
  clearTimeout(ui.gameTimerMenuCloseTimer);
  ui.gameTimerMenuOpen = true;
  ui.gameTimerMenuClosing = false;
  render();
}

function closeGameTimeMenu({ immediate = false, renderAfter = true } = {}) {
  clearTimeout(ui.gameTimerMenuCloseTimer);
  if (!ui.gameTimerMenuOpen && !ui.gameTimerMenuClosing) return;
  ui.gameTimerMenuOpen = false;
  if (immediate) {
    ui.gameTimerMenuClosing = false;
    if (renderAfter) render();
    return;
  }
  ui.gameTimerMenuClosing = true;
  if (renderAfter) render();
  ui.gameTimerMenuCloseTimer = setTimeout(() => {
    ui.gameTimerMenuClosing = false;
    render();
  }, GAME_TIME_MENU_FADE_MS);
}

function openHelp() {
  clearTimeout(ui.helpCloseTimer);
  ui.helpVisible = true;
  ui.helpClosing = false;
}

function closeHelp({ immediate = false, renderAfter = true } = {}) {
  clearTimeout(ui.helpCloseTimer);
  if (!ui.helpVisible && !ui.helpClosing) return;
  ui.helpVisible = false;
  if (immediate) {
    ui.helpClosing = false;
    if (renderAfter) renderOverlaysOnly();
    return;
  }
  ui.helpClosing = true;
  if (renderAfter) renderOverlaysOnly();
  ui.helpCloseTimer = setTimeout(() => {
    ui.helpClosing = false;
    renderOverlaysOnly();
  }, OVERLAY_FADE_MS);
}

function closeResetConfirm({ immediate = false, renderAfter = true } = {}) {
  clearTimeout(ui.resetConfirmCloseTimer);
  if (!ui.resetConfirmVisible && !ui.resetConfirmClosing) return;
  ui.resetConfirmVisible = false;
  if (immediate) {
    ui.resetConfirmClosing = false;
    if (renderAfter) renderOverlaysOnly();
    return;
  }
  ui.resetConfirmClosing = true;
  if (renderAfter) renderOverlaysOnly();
  ui.resetConfirmCloseTimer = setTimeout(() => {
    ui.resetConfirmClosing = false;
    renderOverlaysOnly();
  }, OVERLAY_FADE_MS);
}

function renderStopPrompt() {
  if (!ui.stopPromptVisible && !ui.stopPromptClosing) return "";
  return `
    <div class="stop-prompt ${ui.stopPromptClosing ? "is-closing" : ""}" role="status" aria-live="polite">
      ${iconSvg("play")}
      <span>Press play to resume SpellTracker.</span>
    </div>
  `;
}

function renderResetConfirm() {
  if (!ui.resetConfirmVisible && !ui.resetConfirmClosing) return "";
  return `
    <div class="reset-confirm-backdrop ${ui.resetConfirmClosing ? "is-closing" : ""}" data-action="close-reset-confirm">
      <section class="reset-confirm-dialog" data-reset-panel role="dialog" aria-modal="true" aria-labelledby="reset-confirm-title">
        <button class="icon-button reset-confirm-close" type="button" data-action="cancel-reset-site" aria-label="Cancel reset">x</button>
        <div class="reset-confirm-icon">${iconSvg("reset")}</div>
        <div class="reset-confirm-copy">
          <h2 id="reset-confirm-title">Reset SpellTracker?</h2>
          <p>This clears champions, spells, modifiers, cooldowns, and game time.</p>
        </div>
        <div class="reset-confirm-actions">
          <button class="control-button reset-confirm-cancel" type="button" data-action="cancel-reset-site">Cancel</button>
          <button class="control-button reset-confirm-accept" type="button" data-action="confirm-reset-site">Reset</button>
        </div>
      </section>
    </div>
  `;
}

function renderHelpDialog() {
  if (!ui.helpVisible && !ui.helpClosing) return "";
  return `
    <div class="help-backdrop ${ui.helpClosing ? "is-closing" : ""}" data-action="close-help">
      <section class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" data-help-panel>
        <button class="icon-button help-close" type="button" data-action="close-help" aria-label="Close help">x</button>
        <h2 id="help-title">SpellTracker Controls</h2>
        <div class="help-grid">
          <section>
            <h3>Scoreboard</h3>
            <p>Tap a summoner spell icon as soon as it is used. The icon starts its accurate cooldown and shows the remaining time.</p>
            <p>Use <kbd>...</kbd> beside a spell to replace it, reset it, adjust by <kbd>1</kbd>, <kbd>5</kbd>, or <kbd>15</kbd> seconds, and toggle summoner spell haste modifiers.</p>
          </section>
          <section>
            <h3>Time Control</h3>
            <p>Open the clock button, or hold <kbd>Ctrl</kbd>, then scroll over game time or a cooldown value. Small scrolls adjust precisely; larger scrolls move faster.</p>
            <p>With the clock active, click game time and type <kbd>12:34</kbd> or <kbd>1234</kbd>. Press <kbd>Enter</kbd> to apply or <kbd>Esc</kbd> to cancel.</p>
          </section>
          <section>
            <h3>Timeline</h3>
            <p>Timeline view shows active cooldowns as time-scaled bars. The white line is current game time and upcoming chips show the next spells becoming ready.</p>
            <p><strong>Start game time first.</strong> Timeline accuracy depends on the game timer being enabled and aligned with the match clock.</p>
          </section>
          <section>
            <h3>Global Controls</h3>
            <p>The view slider swaps Scoreboard and Timeline. <kbd>SR</kbd>/<kbd>ARAM</kbd> changes mode, the Flash button swaps <kbd>D</kbd>/<kbd>F</kbd>, and the red square freezes tracking until play resumes.</p>
          </section>
        </div>
      </section>
    </div>
  `;
}

function showStopPrompt() {
  clearTimeout(ui.stopPromptTimer);
  clearTimeout(ui.stopShakeTimer);
  const wasVisible = ui.stopPromptVisible;
  ui.stopPromptVisible = true;
  ui.stopPromptClosing = false;
  ui.interactionDenied = true;
  if (!wasVisible) {
    renderOverlaysOnly();
  }

  const shell = app.querySelector(".tracker-shell");
  if (shell) {
    shell.classList.remove("is-denied");
    void shell.offsetWidth;
    shell.classList.add("is-denied");
  }

  ui.stopShakeTimer = setTimeout(() => {
    ui.interactionDenied = false;
    app.querySelector(".tracker-shell")?.classList.remove("is-denied");
  }, 360);
  ui.stopPromptTimer = setTimeout(closeStopPrompt, STOP_PROMPT_MS);
}

function closeStopPrompt({ immediate = false } = {}) {
  clearTimeout(ui.stopPromptTimer);
  if (!ui.stopPromptVisible && !ui.stopPromptClosing) return;
  ui.stopPromptVisible = false;
  ui.interactionDenied = false;
  if (immediate) {
    ui.stopPromptClosing = false;
    renderOverlaysOnly();
    return;
  }
  ui.stopPromptClosing = true;
  renderOverlaysOnly();
  ui.stopPromptTimer = setTimeout(() => {
    ui.stopPromptClosing = false;
    renderOverlaysOnly();
  }, OVERLAY_FADE_MS);
}

function isActionBlockedWhileStopped(action) {
  return ![
    "toggle-pause",
    "toggle-header",
    "toggle-view",
    "toggle-flash-key",
    "toggle-theme",
    "toggle-help",
    "close-help",
    "reset-site",
    "confirm-reset-site",
    "dismiss-ad",
    "cancel-reset-site",
    "close-reset-confirm",
    "close-champion-picker",
    "close-spell-context"
  ].includes(action);
}

function renderPrimaryView() {
  if (state.viewMode === "timeline") {
    return renderTimelineView();
  }

  return `
    <main class="team-board" data-mode="${state.mode}">
      ${state.players.map(renderPlayer).join("")}
    </main>
  `;
}

function renderTimelineView() {
  return `
    <main class="timeline-view" data-timeline-view>
      ${timelineInnerHtml()}
    </main>
  `;
}

function timelineInnerHtml() {
  const { gameNow, windowStart, windowEnd, nowLeft } = timelineWindow();

  return `
    <section class="upcoming-strip" aria-label="Upcoming cooldowns">
      ${renderUpcomingCooldowns()}
    </section>
    <section class="timeline-board" style="--now-left:${nowLeft}%;" aria-label="Summoner spell timeline">
      <span class="timeline-board-current" data-timeline-current aria-hidden="true"></span>
      <div class="timeline-scale" aria-hidden="true">
        <span>${formatGameTime(windowStart)}</span>
        <span>${formatGameTime(gameNow)}</span>
        <span>${formatGameTime(windowEnd)}</span>
      </div>
      ${state.players.map((player, playerIndex) => renderTimelineRow(player, playerIndex, windowStart, windowEnd)).join("")}
    </section>
  `;
}

function renderUpcomingCooldowns() {
  const upcoming = collectUpcomingCooldowns().slice(0, 10);
  if (!upcoming.length) {
    return `<span class="upcoming-empty">No active enemy summoner spell cooldowns.</span>`;
  }

  return upcoming.map((entry) => `
    <span class="upcoming-chip" aria-label="${escapeHtml(`${entry.championName} ${entry.spell.name} ${formatGameTime(entry.endGameMs)}`)}">
      <span class="upcoming-icons">
        <img class="upcoming-owner" src="${entry.ownerImage}" alt="">
        <img class="upcoming-spell" src="${entry.spell.image}" alt="">
      </span>
      <span class="upcoming-times">
        <span><small>CD</small><b>${escapeHtml(formatSeconds(entry.remainingMs / 1000, "ceil"))}</b></span>
        <span><small>RDY</small><em>${escapeHtml(formatGameTime(entry.endGameMs))}</em></span>
      </span>
    </span>
  `).join("");
}

function renderTimelineRow(player, playerIndex, windowStart, windowEnd) {
  const champion = championById(player.championId);
  const championImage = champion?.image || EMPTY_CHAMPION_IMAGE;
  const championName = championDisplayName(champion, playerIndex);
  const displayRole = displayRoleForPlayer(playerIndex);
  const roleIcon = ROLE_ICONS[displayRole.id];
  const haste = getTotalHaste(player);
  const nowLeft = percentBetween(currentGameTimeMs(), windowStart, windowEnd);

  return `
    <article class="timeline-row" data-player="${playerIndex}">
      <div class="timeline-loadout">
        <button class="timeline-champion" type="button" data-action="open-champion-picker" data-player="${playerIndex}" aria-label="${displayRole.label} champion">
          <img src="${championImage}" alt="${champion ? escapeHtml(champion.name) : "No champion selected"}">
          ${roleIcon ? `<span><img class="role-icon" src="${roleIcon}" alt=""></span>` : ""}
        </button>
        <div class="timeline-identity">
          <strong>${escapeHtml(championName)}</strong>
          <span>${renderHasteValue(haste)}</span>
        </div>
        <div class="timeline-spells">
          ${player.slots.map((slot, slotIndex) => renderTimelineSpell(player, playerIndex, slot, slotIndex)).join("")}
        </div>
      </div>
      <div class="timeline-tracks">
        <span class="timeline-row-current" style="left:${nowLeft}%;" aria-hidden="true"></span>
        ${player.slots.map((slot, slotIndex) => renderTimelineTrack(player, playerIndex, slot, slotIndex, windowStart, windowEnd)).join("")}
      </div>
    </article>
  `;
}

function championDisplayName(champion, playerIndex) {
  if (champion) return champion.name;
  const lane = LANES[playerIndex];
  if (state.mode === "classic" && lane) {
    return ROLE_PLACEHOLDER_LABELS[lane.id] || "No champion";
  }
  return "No champion";
}

function renderTimelineSpell(player, playerIndex, slot, slotIndex) {
  const spell = spellById(slot.spellId) || spellPool()[0];
  const status = getSlotStatus(player, slot);
  const fallback = spell.name.slice(0, 2).toUpperCase();
  const contextOpen = ui.spellContext?.playerIndex === playerIndex && ui.spellContext?.slotIndex === slotIndex;

  return `
    <section class="timeline-spell ${status.isCooling ? "is-cooling" : ""}" data-player="${playerIndex}" data-slot="${slotIndex}" style="--cooldown-fill:${status.progressPercent}%">
      <button class="spell-button" type="button" data-action="fire-spell" data-player="${playerIndex}" data-slot="${slotIndex}" aria-label="${escapeHtml(spell.name)}">
        <span class="spell-art">
          ${spell.image ? `<img src="${spell.image}" alt="">` : `<span>${escapeHtml(fallback)}</span>`}
        </span>
        <span class="spell-timer" data-spell-timer>${escapeHtml(status.timerText)}</span>
      </button>
      <button class="context-toggle ${contextOpen ? "is-open" : ""}" type="button" data-action="toggle-spell-context" data-player="${playerIndex}" data-slot="${slotIndex}" aria-label="Open ${escapeHtml(spell.name)} menu">...</button>
    </section>
  `;
}

function renderTimelineTrack(player, playerIndex, slot, slotIndex, windowStart, windowEnd) {
  const spell = spellById(slot.spellId) || spellPool()[0];
  const now = referenceNow();
  const gameNow = currentGameTimeMs();
  const nowLeft = percentBetween(gameNow, windowStart, windowEnd);
  const color = spellColor(spell);
  const textColor = readableTextColor(color);
  const active = activeCooldowns(slot, now);
  const blocks = active.map((cooldown, cooldownIndex) => {
    const durationMs = cooldownDurationMs(cooldown, spell, player);
    const endGameMs = cooldownGameEndMs(cooldown, now, gameNow);
    const startGameMs = cooldownGameStartMs(cooldown, endGameMs, durationMs);
    const left = percentBetween(Math.max(startGameMs, windowStart), windowStart, windowEnd);
    const right = percentBetween(Math.min(endGameMs, windowEnd), windowStart, windowEnd);
    const width = clamp(right - left, 1.5, 100);
    const readyAt = formatGameTime(endGameMs);
    const remainingText = formatSeconds((cooldownEndAt(cooldown) - now) / 1000, "ceil");
    const tooltip = timelineBlockTooltip(spell, remainingText, readyAt);
    return `
      <span class="timeline-block timeline-block-${slotIndex}" data-player="${playerIndex}" data-slot="${slotIndex}" data-cooldown-index="${cooldownIndex}" data-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}" style="left:${left}%; width:${width}%; --spell-color:${color}; --spell-text:${textColor};">
        <b>${escapeHtml(spell.name)}</b>
        <em>${escapeHtml(remainingText)}</em>
      </span>
    `;
  }).join("");

  return `
    <div class="timeline-track" data-player="${playerIndex}" data-slot="${slotIndex}" aria-label="${escapeHtml(spell.name)} timeline">
      <span class="timeline-track-current" style="left:${nowLeft}%;" aria-hidden="true"></span>
      ${blocks || `<span class="timeline-ready">Ready</span>`}
    </div>
  `;
}

function renderPlayer(player, playerIndex) {
  const lane = LANES[playerIndex];
  const displayRole = displayRoleForPlayer(playerIndex);
  const champion = championById(player.championId);
  const haste = getTotalHaste(player);
  const championImage = champion?.image || EMPTY_CHAMPION_IMAGE;
  const championName = championDisplayName(champion, playerIndex);
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

function renderAdBanner(position) {
  if (position === "top" && isSkinnyLayout()) {
    return "";
  }
  if (isAdDismissed(position)) {
    return "";
  }
  const ad = adForPosition(position);
  if (!ad) {
    return "";
  }

  return `
    <aside class="ad-banner ad-banner-${position}" data-ad-id="${escapeHtml(ad.id || position)}" data-ad-position="${position}" aria-label="Advertisement">
      <a class="ad-creative" href="${escapeHtml(ad.href || "mailto:admin@spelltracker.lol")}" target="_blank" rel="noopener noreferrer" data-action="ad-click" data-ad-id="${escapeHtml(ad.id || position)}" data-ad-position="${position}" aria-label="${escapeHtml(ad.label || "Advertise with SpellTracker")}">
        <img src="${escapeHtml(ad.src)}" alt="${escapeHtml(ad.label || "Advertisement")}">
      </a>
      <button class="ad-close" type="button" data-action="dismiss-ad" data-ad-id="${position}" aria-label="Close advertisement">X</button>
    </aside>
  `;
}

function renderModifierButton({ modifier, selected, playerIndex }) {
  return `
    <button class="modifier-button ${selected ? "is-selected" : ""}" type="button" data-action="toggle-modifier" data-player="${playerIndex}" data-modifier-id="${modifier.id}" aria-pressed="${selected}">
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

function iconSvg(name) {
  const paths = {
    play: `<path d="M8 5v14l11-7z"></path>`,
    pause: `<path d="M7 5h4v14H7z"></path><path d="M13 5h4v14h-4z"></path>`,
    stop: `<path d="M7 7h10v10H7z"></path>`,
    reset: `<path d="M20 6v5h-5"></path><path d="M4 18v-5h5"></path><path d="M18.1 9A7 7 0 0 0 6.8 6.8L4 9.5"></path><path d="M5.9 15A7 7 0 0 0 17.2 17.2L20 14.5"></path>`,
    clock: `<circle cx="12" cy="12" r="7.5"></circle><path d="M12 7.5V12l3 2"></path>`,
    moon: `<path d="M17.5 14.8A7 7 0 0 1 9.2 6.5 7.2 7.2 0 1 0 17.5 14.8z"></path>`,
    sun: `<circle cx="12" cy="12" r="4"></circle><path d="M12 2.5v2"></path><path d="M12 19.5v2"></path><path d="m4.9 4.9 1.4 1.4"></path><path d="m17.7 17.7 1.4 1.4"></path><path d="M2.5 12h2"></path><path d="M19.5 12h2"></path><path d="m4.9 19.1 1.4-1.4"></path><path d="m17.7 6.3 1.4-1.4"></path>`,
    scoreboard: `<rect x="5" y="5" width="3.2" height="14" rx="0.7" fill="currentColor" stroke="none"></rect><rect x="10.4" y="5" width="3.2" height="14" rx="0.7" fill="currentColor" stroke="none"></rect><rect x="15.8" y="5" width="3.2" height="14" rx="0.7" fill="currentColor" stroke="none"></rect>`,
    timeline: `<rect x="5" y="5" width="14" height="3.2" rx="0.7" fill="currentColor" stroke="none"></rect><rect x="5" y="10.4" width="14" height="3.2" rx="0.7" fill="currentColor" stroke="none"></rect><rect x="5" y="15.8" width="14" height="3.2" rx="0.7" fill="currentColor" stroke="none"></rect>`,
    info: `<circle cx="12" cy="12" r="8"></circle><path d="M12 10.5v5"></path><path d="M12 7.6h.01"></path>`
  };
  return `
    <svg class="ui-icon ui-icon-${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${paths[name] || ""}
    </svg>
  `;
}

function renderChampionModal() {
  if (ui.championPickerIndex === null && !ui.championPickerClosing) {
    return "";
  }

  return `
    <div class="modal-backdrop ${ui.championPickerClosing ? "is-closing" : ""}" data-action="close-champion-picker">
      <section class="champion-modal ${ui.championPickerClosing ? "is-closing" : ""}" role="dialog" aria-modal="true" aria-label="Select champion" data-modal-panel>
        <div class="modal-head">
          <h2>Select Champion</h2>
          <button type="button" class="icon-button" data-action="close-champion-picker" aria-label="Close">X</button>
        </div>
        <input class="champion-search" type="search" placeholder="Search champion" value="${escapeHtml(ui.championQuery)}" data-action="champion-search" autocomplete="off">
        <div class="champion-grid ${ui.championGridRefreshing ? "is-refreshing" : ""}" data-champion-grid>
          ${championGridHtml(ui.championQuery)}
        </div>
      </section>
    </div>
  `;
}

function renderSpellContext() {
  const context = ui.spellContext;
  if (!context && !ui.spellContextClosing) {
    return "";
  }

  const player = state.players[context.playerIndex];
  const slot = player?.slots[context.slotIndex];
  const spell = slot ? spellById(slot.spellId) : null;
  const displayRole = displayRoleForPlayer(context.playerIndex);
  if (!player || !slot || !spell) {
    return "";
  }
  const status = getSlotStatus(player, slot);

  return `
    <div class="context-backdrop ${ui.spellContextClosing ? "is-closing" : ""}" data-action="close-spell-context">
      <section class="spell-context ${ui.spellContextClosing ? "is-closing" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(spell.name)} spell menu" data-context-panel>
        <div class="context-head">
          <div class="context-title">
            ${spell.image ? `<img src="${spell.image}" alt="">` : ""}
            <div>
              <h2>${escapeHtml(spell.name)}</h2>
              <span>${escapeHtml(displayRole.label)} Slot ${context.slotIndex + 1}${status.isCooling ? ` <b class="context-cooldown-pill" data-context-timer>${escapeHtml(status.timerText)}</b>` : ""}</span>
            </div>
          </div>
          <button type="button" class="icon-button" data-action="close-spell-context" aria-label="Close">X</button>
        </div>

        <div class="context-section context-spells">
          <div class="context-label">Spell</div>
          <div class="spell-option-grid">
            ${spellPool().map((option) => renderSpellOption(option, spell.id, context)).join("")}
          </div>
        </div>
        <div class="context-tools">
          <section class="context-section">
            <div class="context-label">Timing</div>
            <div class="context-timer-buttons">
              ${ADJUSTMENTS.map((amount) => `
                <button type="button" data-action="adjust-cooldown" data-player="${context.playerIndex}" data-slot="${context.slotIndex}" data-delta="${amount}" aria-label="${amount > 0 ? "Add" : "Subtract"} ${Math.abs(amount)} seconds ${escapeHtml(spell.name)}">
                  ${amount > 0 ? "+" : ""}${amount}
                </button>
              `).join("")}
              <button class="context-reset-button" type="button" data-action="clear-slot" data-player="${context.playerIndex}" data-slot="${context.slotIndex}" aria-label="Reset ${escapeHtml(spell.name)} cooldown">
                Reset CD
              </button>
            </div>
          </section>
          <section class="context-section">
            <div class="context-label">Modifiers</div>
            <div class="context-modifier-grid">
              <div class="haste-total" aria-label="${getTotalHaste(player)} summoner spell haste">
                ${renderHasteValue(getTotalHaste(player))}
              </div>
              ${renderModifierButtons(player, context.playerIndex)}
            </div>
          </section>
        </div>
      </section>
    </div>
  `;
}

function renderSpellOption(spell, selectedSpellId, context) {
  const fallback = spell.name.slice(0, 2).toUpperCase();
  return `
    <button class="spell-option ${spell.id === selectedSpellId ? "is-selected" : ""}" type="button" data-action="replace-spell" data-player="${context.playerIndex}" data-slot="${context.slotIndex}" data-spell-id="${spell.id}" aria-label="${escapeHtml(spell.name)}">
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
  grid.classList.add("is-refreshing");
  const champions = getChampionSearchResults(ui.championQuery);
  ui.championActiveIndex = champions.length
    ? clamp(ui.championActiveIndex, 0, champions.length - 1)
    : 0;
  requestAnimationFrame(() => {
    grid.innerHTML = championGridHtml(ui.championQuery);
    grid.classList.remove("is-refreshing");
  });
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

function focusGameTimeInput() {
  const input = app.querySelector(".game-time-input");
  if (input) {
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }
}

function startGameTimeEdit() {
  const text = formatGameTime(currentGameTimeMs());
  ui.gameTimeEditing = true;
  ui.gameTimeDraft = text;
  ui.gameTimeEditInitialText = text;
  render();
}

function commitGameTimeEdit({ renderAfter = true } = {}) {
  if (!ui.gameTimeEditing) return;
  const draft = ui.gameTimeDraft;
  const unchanged = normalizeGameTimeDraft(draft) === normalizeGameTimeDraft(ui.gameTimeEditInitialText);
  const parsedMs = parseGameTimeInput(ui.gameTimeDraft);
  ui.gameTimeEditing = false;
  ui.gameTimeDraft = "";
  ui.gameTimeEditInitialText = "";
  if (unchanged) {
    if (renderAfter) render();
    return;
  }
  if (parsedMs === null) {
    if (renderAfter) render();
    return;
  }
  const currentTime = currentGameTimeMs();
  const nextTime = Math.max(0, Math.min(parsedMs, MAX_GAME_TIME_MS));
  shiftAllCooldownGameTimes(nextTime - currentTime);
  state.gameTimeMs = nextTime;
  state.gameStartedAt = state.gameTimerRunning && !state.paused ? Date.now() : null;
  saveState();
  if (renderAfter) render();
}

function cancelGameTimeEdit() {
  ui.gameTimeEditing = false;
  ui.gameTimeDraft = "";
  ui.gameTimeEditInitialText = "";
  render();
}

function parseGameTimeInput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text.replace(/[^\d:]/g, "");
  if (!normalized) return null;
  if (!normalized.includes(":")) {
    const digits = normalized.replace(/\D/g, "");
    if (digits.length <= 2) {
      return Math.max(0, Math.floor(Number(digits) || 0)) * 1000;
    }
    const seconds = Math.min(59, Math.floor(Number(digits.slice(-2)) || 0));
    const minutes = Math.floor(Number(digits.slice(0, -2)) || 0);
    return Math.max(0, (minutes * 60 + seconds) * 1000);
  }
  const parts = normalized.split(":").filter((part) => part !== "").map((part) => Math.floor(Number(part) || 0));
  if (!parts.length) return null;
  const seconds = parts.pop() || 0;
  const minutes = parts.pop() || 0;
  const hours = parts.pop() || 0;
  return Math.max(0, ((hours * 60 + minutes) * 60 + Math.min(seconds, 59)) * 1000);
}

function normalizeGameTimeDraft(value) {
  return String(value || "").replace(/[^\d:]/g, "").replace(/^0+(?=\d)/, "");
}

function syncClockHeldClass() {
  document.documentElement.classList.toggle("is-ctrl-clock", ui.ctrlClockHeld);
  app.querySelector(".game-clock-button")?.classList.toggle("is-on", isClockControlActive());
}

function handleClick(event) {
  if (isClockControlActive(event) && event.target.closest("[data-game-time-readout]") && !event.target.closest(".game-time-input")) {
    if (state.paused) {
      showStopPrompt();
      return;
    }
    startGameTimeEdit();
    return;
  }
  const actionTarget = event.target.closest("[data-action]");
  if (ui.gameTimerMenuOpen && !event.target.closest(".game-timer")) {
    closeGameTimeMenu();
    return;
  }
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  if (action === "ad-click") {
    trackAdClick(actionTarget.dataset.adId, actionTarget.dataset.adPosition);
    return;
  }

  if (action === "dismiss-ad") {
    const adId = actionTarget.dataset.adId;
    dismissAd(adId);
    return;
  }

  if (action === "close-champion-picker" && event.target.closest("[data-modal-panel]") && actionTarget.classList.contains("modal-backdrop")) {
    return;
  }
  if (action === "close-spell-context" && event.target.closest("[data-context-panel]") && actionTarget.classList.contains("context-backdrop")) {
    return;
  }
  if (action === "close-reset-confirm" && event.target.closest("[data-reset-panel]") && actionTarget.classList.contains("reset-confirm-backdrop")) {
    return;
  }
  if (action === "close-help" && event.target.closest("[data-help-panel]") && actionTarget.classList.contains("help-backdrop")) {
    return;
  }

  if (state.paused && isActionBlockedWhileStopped(action)) {
    showStopPrompt();
    return;
  }

  if (action === "toggle-pause") {
    togglePause();
    return;
  }

  if (action === "toggle-header") {
    state.headerCollapsed = !state.headerCollapsed;
    saveAndRender();
    return;
  }

  if (action === "toggle-view") {
    state.viewMode = state.viewMode === "timeline" ? "scoreboard" : "timeline";
    closeSpellContext({ immediate: true, renderAfter: false });
    ui.viewTransition = true;
    closeGameTimeMenu({ immediate: true, renderAfter: false });
    saveAndRender();
    return;
  }

  if (action === "toggle-game-timer") {
    toggleGameTimer();
    return;
  }

  if (action === "toggle-game-time-menu") {
    if (ui.gameTimerMenuOpen) {
      closeGameTimeMenu();
    } else {
      openGameTimeMenu();
    }
    return;
  }

  if (action === "reset-game-timer") {
    resetGameTimer();
    return;
  }

  if (action === "adjust-game-time") {
    adjustGameTime(Number(actionTarget.dataset.delta));
    return;
  }

  if (action === "toggle-mode") {
    setMode(state.mode === "classic" ? "aram" : "classic");
    return;
  }

  if (action === "toggle-help") {
    if (ui.helpVisible) {
      closeHelp();
      return;
    }
    openHelp();
    closeSpellContext({ immediate: true, renderAfter: false });
    closeChampionPicker({ immediate: true, renderAfter: false });
    closeGameTimeMenu({ immediate: true, renderAfter: false });
    renderOverlaysOnly();
    return;
  }

  if (action === "close-help") {
    closeHelp();
    return;
  }

  if (action === "reset-site") {
    ui.resetConfirmVisible = true;
    ui.resetConfirmClosing = false;
    closeSpellContext({ immediate: true, renderAfter: false });
    closeChampionPicker({ immediate: true, renderAfter: false });
    closeGameTimeMenu({ immediate: true, renderAfter: false });
    renderOverlaysOnly();
    return;
  }

  if (action === "cancel-reset-site" || action === "close-reset-confirm") {
    closeResetConfirm();
    return;
  }

  if (action === "confirm-reset-site") {
    ui.resetConfirmVisible = false;
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
    clearTimeout(ui.championPickerCloseTimer);
    ui.championPickerIndex = Number(actionTarget.dataset.player);
    ui.championPickerClosing = false;
    ui.championQuery = "";
    ui.championActiveIndex = 0;
    closeSpellContext({ immediate: true, renderAfter: false });
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
    clearTimeout(ui.spellContextCloseTimer);
    const next = {
      playerIndex: Number(actionTarget.dataset.player),
      slotIndex: Number(actionTarget.dataset.slot)
    };
    const current = ui.spellContext;
    if (current?.playerIndex === next.playerIndex && current?.slotIndex === next.slotIndex && !ui.spellContextClosing) {
      closeSpellContext();
      return;
    }
    ui.spellContextClosing = false;
    ui.spellContext = next;
    render();
    return;
  }

  if (action === "close-spell-context") {
    closeSpellContext();
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
    ui.timelineRefreshBlockedUntil = Date.now() + 900;
    saveCooldownChange();
    return;
  }

  if (action === "start-full-cooldown") {
    startFullCooldown(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot));
    saveCooldownChange();
    return;
  }

  if (action === "adjust-cooldown") {
    adjustCooldown(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot), Number(actionTarget.dataset.delta));
    saveCooldownChange();
    return;
  }

  if (action === "clear-slot") {
    clearSlot(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot));
    saveCooldownChange();
    return;
  }

  if (action === "replace-spell") {
    replaceSpell(Number(actionTarget.dataset.player), Number(actionTarget.dataset.slot), actionTarget.dataset.spellId);
    closeSpellContext({ immediate: true, renderAfter: false });
    saveAndRender();
  }
}

function handleChange() {}

function handleWheel(event) {
  const gameReadout = event.target.closest(".game-time-readout");
  if (isClockControlActive(event) && gameReadout) {
    event.preventDefault();
    if (state.paused) {
      showStopPrompt();
      return;
    }
    adjustGameTime(wheelSecondsFromDelta(event.deltaY));
    return;
  }

  const cooldownTarget = event.target.closest("[data-spell-timer], .timeline-block em");
  if (!isClockControlActive(event)) return;
  if (!cooldownTarget) return;
  const source = cooldownTarget.closest(".spell-panel[data-player][data-slot], .timeline-spell[data-player][data-slot], .timeline-block[data-player][data-slot]");
  if (!source) return;
  event.preventDefault();
  if (state.paused) {
    showStopPrompt();
    return;
  }
  adjustCooldown(Number(source.dataset.player), Number(source.dataset.slot), wheelSecondsFromDelta(event.deltaY));
  saveState();
  updateTimers();
}

function wheelSecondsFromDelta(deltaY) {
  const direction = deltaY < 0 ? 1 : -1;
  const distance = Math.abs(Number(deltaY) || 0);
  const magnitude = clamp(Math.floor(Math.max(1, Math.pow(distance / 90, 1.42))), 1, 45);
  return direction * magnitude;
}

function handleInput(event) {
  const target = event.target;
  if (target.dataset.action === "game-time-input") {
    ui.gameTimeDraft = target.value;
    return;
  }
  if (target.dataset.action !== "champion-search") return;
  ui.championQuery = target.value;
  ui.championActiveIndex = 0;
  refreshChampionGrid();
}

function handleKeydown(event) {
  if (event.key === "Control" && !ui.ctrlClockHeld) {
    ui.ctrlClockHeld = true;
    syncClockHeldClass();
  }

  if (ui.gameTimeEditing) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitGameTimeEdit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelGameTimeEdit();
      return;
    }
  }

  if (event.key === "Escape") {
    if (ui.helpVisible) {
      closeHelp();
    } else if (ui.spellContext) {
      closeSpellContext();
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

function handleKeyup(event) {
  if (event.key !== "Control") return;
  ui.ctrlClockHeld = false;
  syncClockHeldClass();
}

function handleFocusOut(event) {
  if (event.target?.dataset?.action === "game-time-input") {
    setTimeout(() => commitGameTimeEdit(), 0);
  }
}

function closeChampionPicker(options = {}) {
  const config = typeof options === "boolean" ? { alreadySaved: options } : options;
  const { alreadySaved = false, immediate = false, renderAfter = true } = config;
  clearTimeout(ui.championPickerCloseTimer);
  if (ui.championPickerIndex === null && !ui.championPickerClosing) return;

  const finish = () => {
    ui.championPickerIndex = null;
    ui.championQuery = "";
    ui.championActiveIndex = 0;
    ui.championPickerClosing = false;
    if (alreadySaved) {
      saveAndRender();
    } else if (renderAfter) {
      render();
    }
  };

  if (immediate) {
    finish();
    return;
  }

  ui.championPickerClosing = true;
  if (renderAfter) render();
  ui.championPickerCloseTimer = setTimeout(finish, OVERLAY_FADE_MS);
}

function closeSpellContext({ immediate = false, renderAfter = true } = {}) {
  clearTimeout(ui.spellContextCloseTimer);
  if (!ui.spellContext && !ui.spellContextClosing) return;

  const finish = () => {
    ui.spellContext = null;
    ui.spellContextClosing = false;
    if (renderAfter) render();
  };

  if (immediate) {
    finish();
    return;
  }

  ui.spellContextClosing = true;
  if (renderAfter) render();
  ui.spellContextCloseTimer = setTimeout(finish, OVERLAY_FADE_MS);
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
  closeSpellContext({ immediate: true, renderAfter: false });
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
  const counterTotal = parseCounterValue(state?.counterTotal).toString();
  const counterPending = Math.max(0, Number(state?.counterPending) || 0);
  const counterLastFetchAt = Math.max(0, Number(state?.counterLastFetchAt) || 0);
  const theme = state?.theme === "light" ? "light" : "dark";
  const flashKey = state?.flashKey === "F" ? "F" : "D";
  state = makeDefaultState();
  state.theme = theme;
  state.flashKey = flashKey;
  state.counterTotal = counterTotal;
  state.counterPending = counterPending;
  state.counterLastFetchAt = counterLastFetchAt;
  for (const player of state.players) {
    applyFlashPreferenceToPlayer(player, flashKey);
  }
  ui.championPickerIndex = null;
  ui.championQuery = "";
  ui.championActiveIndex = 0;
  ui.spellContext = null;
  ui.resetConfirmVisible = false;
  ui.resetConfirmClosing = false;
  ui.helpVisible = false;
  ui.helpClosing = false;
  ui.gameTimeEditing = false;
  ui.gameTimeDraft = "";
  ui.gameTimeEditInitialText = "";
  closeGameTimeMenu({ immediate: true, renderAfter: false });
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

function toggleGameTimer() {
  if (state.paused) {
    showStopPrompt();
    return;
  }
  if (isGameTimerAdvancing()) {
    state.gameTimeMs = currentGameTimeMs();
    state.gameStartedAt = null;
    state.gameTimerRunning = false;
  } else {
    if (state.paused) {
      resumeTrackingClock();
    }
    state.gameTimerRunning = true;
    state.gameStartedAt = Date.now();
  }
  saveAndRender();
}

function resetGameTimer() {
  if (state.paused) {
    showStopPrompt();
    return;
  }
  closeGameTimeMenu({ immediate: true, renderAfter: false });
  const deltaMs = -currentGameTimeMs();
  shiftAllCooldownGameTimes(deltaMs);
  state.gameTimeMs = 0;
  state.gameStartedAt = state.gameTimerRunning && !state.paused ? Date.now() : null;
  saveAndRender();
}

function adjustGameTime(seconds) {
  if (state.paused) {
    showStopPrompt();
    return;
  }
  ui.gameTimeEditing = false;
  ui.gameTimeDraft = "";
  const currentTime = currentGameTimeMs();
  const nextTime = Math.max(0, currentTime + seconds * 1000);
  shiftAllCooldownGameTimes(nextTime - currentTime);
  state.gameTimeMs = nextTime;
  state.gameStartedAt = state.gameTimerRunning && !state.paused ? Date.now() : null;
  saveAndRender();
}

function isGameTimerAdvancing() {
  return Boolean(state?.gameTimerRunning && !state.paused && state.gameStartedAt);
}

function currentGameTimeMs() {
  if (!state) return 0;
  const currentMs = rawGameTimeMs();
  if (currentMs > MAX_GAME_TIME_MS) {
    resetExpiredGameTimer();
    return 0;
  }
  return currentMs;
}

function rawGameTimeMs() {
  if (isGameTimerAdvancing()) {
    return Math.max(0, (Number(state.gameTimeMs) || 0) + Date.now() - Number(state.gameStartedAt));
  }
  return Math.max(0, Number(state.gameTimeMs) || 0);
}

function resetExpiredGameTimer() {
  state.gameTimeMs = 0;
  state.gameStartedAt = null;
  state.gameTimerRunning = false;
  saveState();
}

function updateGameTimerDisplay() {
  const timer = app.querySelector("[data-game-time]");
  const stateText = app.querySelector("[data-game-timer-state]");
  if (timer) timer.textContent = formatGameTime(currentGameTimeMs());
  if (stateText) stateText.textContent = gameTimerStateText();
}

function resumeTrackingClock() {
  const delta = Date.now() - (state.pausedAt || Date.now());
  for (const player of state.players) {
    for (const slot of player.slots) {
      slot.cooldowns = slot.cooldowns.map((cooldown) => shiftCooldown(cooldown, delta));
    }
  }
  state.paused = false;
  state.pausedAt = null;
}

function shiftAllCooldownGameTimes(deltaMs) {
  if (!deltaMs) return;
  for (const player of state.players) {
    for (const slot of player.slots) {
      slot.cooldowns = slot.cooldowns.map((cooldown) => shiftCooldownGameTime(cooldown, deltaMs));
    }
  }
}

function togglePause() {
  if (state.paused) {
    ui.stopPromptVisible = false;
    resumeTrackingClock();
    if (state.gameTimerRunning) {
      state.gameStartedAt = Date.now();
    }
  } else {
    closeGameTimeMenu({ immediate: true, renderAfter: false });
    state.gameTimeMs = currentGameTimeMs();
    state.gameStartedAt = null;
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
  const active = activeCooldowns(slot, now);
  const durationMs = effectiveCooldown(spell, player) * 1000;
  const nextCooldown = createCooldown(now, durationMs);

  if (maxAmmo === 1 && active.length > 0) {
    slot.cooldowns = [nextCooldown];
    return;
  }

  if (active.length < maxAmmo) {
    active.push(nextCooldown);
  } else {
    active[0] = nextCooldown;
  }
  slot.cooldowns = sortCooldowns(active);
}

function startFullCooldown(playerIndex, slotIndex) {
  clearSlot(playerIndex, slotIndex);
  fireSpell(playerIndex, slotIndex);
}

function adjustCooldown(playerIndex, slotIndex, seconds) {
  const player = state.players[playerIndex];
  const slot = player.slots[slotIndex];
  const spell = spellById(slot.spellId);
  const now = referenceNow();
  const active = activeCooldowns(slot, now);

  if (active.length === 0) {
    if (seconds > 0) {
      slot.cooldowns = [createCooldown(now, seconds * 1000)];
    }
    return;
  }

  const adjusted = adjustCooldownEntry(active[0], seconds * 1000, now);
  if (cooldownEndAt(adjusted) <= now) {
    if (isCountableCooldown(adjusted, spell, player, now)) {
      addPendingCooldownCompletions(1);
    }
    active.shift();
  } else {
    active[0] = adjusted;
  }
  slot.cooldowns = sortCooldowns(active.filter((cooldown) => cooldownEndAt(cooldown) > now));
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

function normalizeCooldownEntry(entry) {
  if ((typeof entry === "number" || typeof entry === "string") && Number.isFinite(Number(entry))) {
    return {
      startAt: null,
      endAt: Number(entry),
      startGameMs: null,
      endGameMs: null,
      durationMs: null,
      originalDurationMs: null
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const endAt = Number(entry.endAt);
  if (!Number.isFinite(endAt)) {
    return null;
  }

  return {
    startAt: Number.isFinite(Number(entry.startAt)) ? Number(entry.startAt) : null,
    endAt,
    startGameMs: Number.isFinite(Number(entry.startGameMs)) ? Number(entry.startGameMs) : null,
    endGameMs: Number.isFinite(Number(entry.endGameMs)) ? Number(entry.endGameMs) : null,
    durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.max(0, Number(entry.durationMs)) : null,
    originalDurationMs: Number.isFinite(Number(entry.originalDurationMs))
      ? Math.max(0, Number(entry.originalDurationMs))
      : Number.isFinite(Number(entry.durationMs))
        ? Math.max(0, Number(entry.durationMs))
        : null
  };
}

function createCooldown(now, durationMs) {
  const safeDuration = Math.max(0, Number(durationMs) || 0);
  const gameNow = currentGameTimeMs();
  return {
    startAt: now,
    endAt: now + safeDuration,
    startGameMs: gameNow,
    endGameMs: gameNow + safeDuration,
    durationMs: safeDuration,
    originalDurationMs: safeDuration
  };
}

function shiftCooldown(cooldown, deltaMs) {
  const entry = normalizeCooldownEntry(cooldown);
  if (!entry) return cooldown;
  return {
    ...entry,
    startAt: Number.isFinite(Number(entry.startAt)) ? entry.startAt + deltaMs : entry.startAt,
    endAt: entry.endAt + deltaMs
  };
}

function shiftCooldownGameTime(cooldown, deltaMs) {
  const entry = normalizeCooldownEntry(cooldown);
  if (!entry) return cooldown;
  return {
    ...entry,
    startGameMs: Number.isFinite(Number(entry.startGameMs)) ? Math.max(0, entry.startGameMs + deltaMs) : entry.startGameMs,
    endGameMs: Number.isFinite(Number(entry.endGameMs)) ? Math.max(0, entry.endGameMs + deltaMs) : entry.endGameMs
  };
}

function adjustCooldownEntry(cooldown, deltaMs, now) {
  const entry = normalizeCooldownEntry(cooldown);
  if (!entry) return cooldown;
  const nextEndAt = Math.max(now, entry.endAt + deltaMs);
  const nextEndGameMs = Number.isFinite(Number(entry.endGameMs))
    ? Math.max(currentGameTimeMs(), entry.endGameMs + deltaMs)
    : currentGameTimeMs() + Math.max(0, nextEndAt - now);
  const startAt = Number.isFinite(Number(entry.startAt)) ? entry.startAt : now;
  const startGameMs = Number.isFinite(Number(entry.startGameMs)) ? entry.startGameMs : currentGameTimeMs();

  return {
    ...entry,
    startAt,
    endAt: nextEndAt,
    startGameMs,
    endGameMs: nextEndGameMs,
    durationMs: Math.max(Number(entry.durationMs) || 0, Math.max(0, nextEndAt - startAt)),
    originalDurationMs: Math.max(Number(entry.originalDurationMs) || 0, Number(entry.durationMs) || 0, Math.max(0, nextEndAt - startAt))
  };
}

function cooldownEndAt(cooldown) {
  return Number(normalizeCooldownEntry(cooldown)?.endAt) || 0;
}

function cooldownDurationMs(cooldown, spell, player) {
  const entry = normalizeCooldownEntry(cooldown);
  if (Number.isFinite(Number(entry?.durationMs)) && entry.durationMs > 0) {
    return entry.durationMs;
  }
  const endAt = cooldownEndAt(cooldown);
  const startAt = Number(entry?.startAt);
  if (Number.isFinite(startAt) && endAt > startAt) {
    return endAt - startAt;
  }
  return Math.max(1, effectiveCooldown(spell, player) * 1000);
}

function cooldownGameEndMs(cooldown, now = referenceNow(), gameNow = currentGameTimeMs()) {
  const entry = normalizeCooldownEntry(cooldown);
  if (Number.isFinite(Number(entry?.endGameMs))) {
    return Math.max(0, entry.endGameMs);
  }
  return Math.max(0, gameNow + Math.max(0, cooldownEndAt(cooldown) - now));
}

function cooldownGameStartMs(cooldown, endGameMs, durationMs) {
  const entry = normalizeCooldownEntry(cooldown);
  if (Number.isFinite(Number(entry?.startGameMs))) {
    return Math.max(0, entry.startGameMs);
  }
  return Math.max(0, endGameMs - Math.max(0, durationMs));
}

function activeCooldowns(slot, now = referenceNow()) {
  return sortCooldowns((slot?.cooldowns || [])
    .map(normalizeCooldownEntry)
    .filter((cooldown) => cooldown && cooldown.endAt > now));
}

function sortCooldowns(cooldowns) {
  return cooldowns.sort((a, b) => cooldownEndAt(a) - cooldownEndAt(b));
}

function collectUpcomingCooldowns() {
  const now = referenceNow();
  const gameNow = currentGameTimeMs();
  const entries = [];
  for (const [playerIndex, player] of state.players.entries()) {
    const champion = championById(player.championId);
    for (const [slotIndex, slot] of player.slots.entries()) {
      const spell = spellById(slot.spellId);
      const cooldown = activeCooldowns(slot, now)[0];
      if (!spell || !cooldown) continue;
      const displayRole = displayRoleForPlayer(playerIndex);
      entries.push({
        playerIndex,
        slotIndex,
        spell,
        championName: champion?.name || displayRole.label,
        ownerImage: champion?.image || ROLE_ICONS[displayRole.id] || EMPTY_CHAMPION_IMAGE,
        endGameMs: cooldownGameEndMs(cooldown, now, gameNow),
        remainingMs: cooldownEndAt(cooldown) - now
      });
    }
  }
  return entries.sort((a, b) => a.remainingMs - b.remainingMs);
}

function updateTimers() {
  if (!state || !appData) return;
  pruneAllCooldowns();
  updateGameTimerDisplay();
  const panels = app.querySelectorAll(".spell-panel[data-player][data-slot], .timeline-spell[data-player][data-slot]");
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

  const contextTimer = app.querySelector("[data-context-timer]");
  if (contextTimer && ui.spellContext) {
    const player = state.players[ui.spellContext.playerIndex];
    const slot = player?.slots[ui.spellContext.slotIndex];
    const status = player && slot ? getSlotStatus(player, slot) : null;
    contextTimer.textContent = status?.isCooling ? status.timerText : "";
  }

  const timeline = app.querySelector("[data-timeline-view]");
  if (timeline) {
    updateTimelineLiveContent(timeline);
  }
}

function timelineWindow() {
  const gameNow = currentGameTimeMs();
  const windowStart = Math.max(0, gameNow - TIMELINE_PAST_MS);
  const windowEnd = Math.max(windowStart + 60 * 1000, gameNow + TIMELINE_FUTURE_MS);
  const nowLeft = percentBetween(gameNow, windowStart, windowEnd);
  return { gameNow, windowStart, windowEnd, nowLeft };
}

function updateTimelineLiveContent(timeline) {
  const { gameNow, windowStart, windowEnd, nowLeft } = timelineWindow();
  const scale = timeline.querySelector(".timeline-scale");
  if (scale) {
    const labels = scale.querySelectorAll("span");
    if (labels[0]) labels[0].textContent = formatGameTime(windowStart);
    if (labels[1]) labels[1].textContent = formatGameTime(gameNow);
    if (labels[2]) labels[2].textContent = formatGameTime(windowEnd);
  }

  for (const marker of timeline.querySelectorAll(".timeline-row-current, .timeline-track-current")) {
    marker.style.left = `${nowLeft}%`;
  }
  updateTimelineCurrentLine();

  const needsRender = updateTimelineTracksInPlace(timeline, windowStart, windowEnd);
  const nowMs = Date.now();
  if (needsRender && nowMs > ui.timelineRefreshBlockedUntil && !isTimelinePointerActive(timeline)) {
    ui.lastTimelineRenderAt = nowMs;
    timeline.innerHTML = timelineInnerHtml();
    requestAnimationFrame(updateTimelineCurrentLine);
    return;
  }

  const strip = timeline.querySelector(".upcoming-strip");
  if (strip && nowMs - ui.lastTimelineRenderAt > 1000 && !strip.matches(":hover")) {
    ui.lastTimelineRenderAt = nowMs;
    strip.innerHTML = renderUpcomingCooldowns();
  }
}

function updateTimelineTracksInPlace(timeline, windowStart, windowEnd) {
  const now = referenceNow();
  const gameNow = currentGameTimeMs();
  let needsRender = false;

  for (const track of timeline.querySelectorAll(".timeline-track[data-player][data-slot]")) {
    const playerIndex = Number(track.dataset.player);
    const slotIndex = Number(track.dataset.slot);
    const player = state.players[playerIndex];
    const slot = player?.slots[slotIndex];
    const spell = spellById(slot?.spellId);
    if (!player || !slot || !spell) {
      needsRender = true;
      continue;
    }

    const active = activeCooldowns(slot, now);
    const blocks = track.querySelectorAll(".timeline-block");
    const ready = track.querySelector(".timeline-ready");
    if (active.length !== blocks.length || (active.length === 0) !== Boolean(ready)) {
      needsRender = true;
      continue;
    }

    active.forEach((cooldown, cooldownIndex) => {
      const block = blocks[cooldownIndex];
      if (!block) {
        needsRender = true;
        return;
      }
      const durationMs = cooldownDurationMs(cooldown, spell, player);
      const endGameMs = cooldownGameEndMs(cooldown, now, gameNow);
      const startGameMs = cooldownGameStartMs(cooldown, endGameMs, durationMs);
      const left = percentBetween(Math.max(startGameMs, windowStart), windowStart, windowEnd);
      const right = percentBetween(Math.min(endGameMs, windowEnd), windowStart, windowEnd);
      const width = clamp(right - left, 1.5, 100);
      const readyAt = formatGameTime(endGameMs);
      const remainingText = formatSeconds((cooldownEndAt(cooldown) - now) / 1000, "ceil");
      const tooltip = timelineBlockTooltip(spell, remainingText, readyAt);

      block.style.left = `${left}%`;
      block.style.width = `${width}%`;
      block.dataset.tooltip = tooltip;
      block.setAttribute("aria-label", tooltip);
      const remaining = block.querySelector("em");
      if (remaining) remaining.textContent = remainingText;
    });
  }

  return needsRender;
}

function isTimelinePointerActive(timeline) {
  return Boolean(timeline.querySelector(".timeline-block:hover, .timeline-block:focus-visible, .timeline-spell:hover, .timeline-spell:focus-within, .spell-context:hover"));
}

function updateTimelineCurrentLine() {
  const board = app.querySelector(".timeline-board");
  const line = board?.querySelector("[data-timeline-current]");
  const firstTracks = board?.querySelector(".timeline-tracks");
  const allTracks = board ? [...board.querySelectorAll(".timeline-tracks")] : [];
  const lastTracks = allTracks[allTracks.length - 1];
  if (!board || !line || !firstTracks || !lastTracks) return;

  const { nowLeft } = timelineWindow();
  const boardRect = board.getBoundingClientRect();
  const firstRect = firstTracks.getBoundingClientRect();
  const lastRect = lastTracks.getBoundingClientRect();
  const x = firstRect.left - boardRect.left + (firstRect.width * nowLeft) / 100;
  board.style.setProperty("--timeline-current-x", `${x}px`);
  board.style.setProperty("--timeline-current-top", `${Math.max(0, firstRect.top - boardRect.top)}px`);
  board.style.setProperty("--timeline-current-bottom", `${Math.max(0, boardRect.bottom - lastRect.bottom)}px`);
}

function timelineBlockTooltip(spell, remainingText, readyAt) {
  return `${spell.name}: ${remainingText} left. Ready at ${readyAt}`;
}

function getSlotStatus(player, slot) {
  const spell = spellById(slot.spellId);
  const now = referenceNow();
  const active = activeCooldowns(slot, now);
  const maxAmmo = Math.max(1, spell?.maxAmmo || 1);
  const available = Math.max(0, maxAmmo - active.length);
  const nextEnd = active[0] ? cooldownEndAt(active[0]) : 0;
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
  let completedCount = 0;
  let changed = false;
  for (const player of state.players) {
    for (const slot of player.slots) {
      const spell = spellById(slot.spellId);
      const nextCooldowns = [];
      for (const cooldown of slot.cooldowns.map(normalizeCooldownEntry)) {
        if (!cooldown) {
          changed = true;
          continue;
        }
        if (cooldownEndAt(cooldown) > now) {
          nextCooldowns.push(cooldown);
        } else {
          completedCount += isCountableCooldown(cooldown, spell, player, now) ? 1 : 0;
          changed = true;
        }
      }
      slot.cooldowns = sortCooldowns(nextCooldowns);
    }
  }
  if (completedCount > 0) {
    addPendingCooldownCompletions(completedCount);
  } else if (changed) {
    saveState();
  }
}

function isCountableCooldown(cooldown, spell, player, now = referenceNow()) {
  const entry = normalizeCooldownEntry(cooldown);
  if (!entry || !spell || !player) return false;
  const startAt = Number(entry.startAt);
  if (!Number.isFinite(startAt)) return false;
  const requiredMs = Math.max(1, effectiveCooldown(spell, player) * 1000);
  const trackedMs = Math.max(0, Math.min(now, cooldownEndAt(entry)) - startAt);
  const originalMs = Math.max(0, Number(entry.originalDurationMs) || Number(entry.durationMs) || 0);
  return trackedMs >= requiredMs * MIN_TRACKED_COOLDOWN_RATIO
    && originalMs >= requiredMs * MIN_TRACKED_COOLDOWN_RATIO;
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
  const modeHaste = MODE_BASE_SUMMONER_SPELL_HASTE[state?.mode] || 0;
  const selectedHaste = selectedModifierIds(player)
    .map((modifierId) => modifierById(modifierId)?.haste || 0)
    .reduce((total, haste) => total + haste, 0);
  return Math.round(modeHaste + selectedHaste);
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

function activeAds() {
  const now = Date.now();
  return (Array.isArray(adConfig?.ads) ? adConfig.ads : [])
    .filter((ad) => ad && ad.enabled !== false && ad.src)
    .filter((ad) => {
      const startsAt = ad.startsAt ? Date.parse(ad.startsAt) : null;
      const endsAt = ad.endsAt ? Date.parse(ad.endsAt) : null;
      return (!Number.isFinite(startsAt) || startsAt <= now)
        && (!Number.isFinite(endsAt) || endsAt >= now);
    });
}

function adForPosition(position) {
  if (ui.adSlots[position]) {
    return ui.adSlots[position];
  }

  const used = new Set(Object.values(ui.adSlots).filter(Boolean).map((ad) => ad.id));
  const candidates = activeAds().filter((ad) => !used.has(ad.id));
  if (!candidates.length) {
    return null;
  }

  const index = Math.floor(Math.random() * candidates.length);
  ui.adSlots[position] = candidates[index];
  return ui.adSlots[position];
}

function spellColor(spell) {
  return SPELL_COLORS[spell?.id] || "#dcdcdc";
}

function readableTextColor(hexColor) {
  const hex = String(hexColor || "").replace("#", "");
  if (hex.length !== 6) return "#111111";
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? "#111111" : "#ffffff";
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

function defaultHeaderCollapsed() {
  return isSkinnyLayout();
}

function isSkinnyLayout() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(max-width: 760px), (max-width: 1020px) and (min-height: 640px), (max-aspect-ratio: 0.8), (max-height: 520px) and (orientation: landscape)")?.matches;
}

function percentBetween(value, start, end) {
  return clamp(((value - start) / Math.max(1, end - start)) * 100, 0, 100);
}

function formatGameTime(valueMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(valueMs) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function formatCounterNumber(value) {
  return formatCompactNumber(value);
}

function formatCompactNumber(value) {
  return parseCounterValue(value).toLocaleString("en-US");
}

function parseCounterValue(value) {
  try {
    if (typeof value === "bigint") return value < 0n ? 0n : value;
    const text = String(value ?? "0").replace(/[^\d]/g, "");
    return text ? BigInt(text) : 0n;
  } catch {
    return 0n;
  }
}

function maxCounterString(left, right) {
  const leftValue = parseCounterValue(left);
  const rightValue = parseCounterValue(right);
  return (rightValue > leftValue ? rightValue : leftValue).toString();
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

function preventDefaultSiteMenu(event) {
  if (event.target.closest("#app")) {
    event.preventDefault();
  }
}

function preventSiteSelection(event) {
  if (event.target.closest("input, textarea")) return;
  if (event.target.closest("#app")) {
    event.preventDefault();
  }
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
