const DATA_URL = "./data/lol.json";
const ADS_URL = "./data/ads.json";
const STATE_SCHEMA = 10;
const STORE_KEY = "spelltracker:v7";
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
const TIMELINE_PAST_MS = 30 * 1000;
const TIMELINE_FUTURE_MS = 5 * 60 * 1000;
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
  gameTimerMenuOpen: false,
  dismissedAds: new Set(),
  adSlots: {},
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
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("resize", () => requestAnimationFrame(updateTimelineCurrentLine));
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
    viewMode: "scoreboard",
    headerCollapsed: defaultHeaderCollapsed(),
    paused: false,
    pausedAt: null,
    gameTimeMs: 0,
    gameStartedAt: null,
    gameTimerRunning: false,
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
  if (!saved || ![5, 6, 7, 8, STATE_SCHEMA].includes(saved.schema) || !Array.isArray(saved.players)) {
    return fallback;
  }

  const mode = saved.mode === "aram" ? "aram" : "classic";
  const theme = saved.theme === "light" ? "light" : "dark";
  const flashKey = saved.flashKey === "F" ? "F" : "D";
  const viewMode = saved.viewMode === "timeline" ? "timeline" : "scoreboard";
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

function render() {
  pruneAllCooldowns();
  applyTheme();
  const topAd = renderAdBanner("top");
  const bottomAd = renderAdBanner("bottom");
  app.innerHTML = `
    <div class="tracker-shell ${state.headerCollapsed ? "is-header-collapsed" : ""} ${topAd ? "has-top-ad" : ""}" data-view="${state.viewMode}">
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
    ${renderChampionModal()}
    ${renderSpellContext()}
  `;

  focusChampionSearch();
  requestAnimationFrame(updateTimelineCurrentLine);
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
      <div class="topbar-content">
        <div class="brand">
          <div class="brand-mark"><img src="${BRAND_ICON}" alt=""></div>
          <div>
            <h1>SpellTracker</h1>
            <p>Patch ${escapeHtml(appData.version)} &middot; by psyopgirl</p>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="control-button pause-button ${state.paused ? "is-on" : ""}" type="button" data-action="toggle-pause">
            ${state.paused ? "Resume" : "Pause"}
          </button>
          <button class="control-button reset-button" type="button" data-action="reset-site">Reset</button>
          <button class="control-button view-button ${state.viewMode === "timeline" ? "is-on" : ""}" type="button" data-action="toggle-view">
            ${state.viewMode === "timeline" ? "Timeline" : "Scoreboard"}
          </button>
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
      </div>
    </header>
  `;
}

function renderGameTimer() {
  const running = isGameTimerAdvancing();
  return `
    <section class="game-timer" aria-label="Game timer">
      <div class="game-time-readout">
        <span data-game-time>${formatGameTime(currentGameTimeMs())}</span>
        <small data-game-timer-state>${running ? "Live" : "Paused"}</small>
      </div>
      <div class="game-timer-actions">
        <button class="control-button game-start-button ${running ? "is-on" : ""}" type="button" data-action="toggle-game-timer" aria-label="${running ? "Pause game timer" : "Start game timer"}">
          ${running ? "&#9208;" : "&#9654;"}
        </button>
        <button class="control-button game-reset-button" type="button" data-action="reset-game-timer" aria-label="Reset game timer">&#8634;</button>
        <button class="control-button game-clock-button ${ui.gameTimerMenuOpen ? "is-on" : ""}" type="button" data-action="toggle-game-time-menu" aria-label="Adjust game timer" aria-expanded="${ui.gameTimerMenuOpen}">&#9201;</button>
      </div>
      ${ui.gameTimerMenuOpen ? renderGameTimeMenu() : ""}
    </section>
  `;
}

function renderGameTimeMenu() {
  return `
    <div class="game-time-popover" role="menu" aria-label="Adjust game time">
      ${ADJUSTMENTS.map((amount) => `
        <button type="button" data-action="adjust-game-time" data-delta="${amount}" aria-label="${amount > 0 ? "Add" : "Subtract"} ${Math.abs(amount)} seconds game time">
          ${amount > 0 ? "+" : ""}${amount}
        </button>
      `).join("")}
    </div>
  `;
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
      <img class="upcoming-owner" src="${entry.ownerImage}" alt="">
      <img class="upcoming-spell" src="${entry.spell.image}" alt="">
      <b>${formatGameTime(entry.endGameMs)}</b>
    </span>
  `).join("");
}

function renderTimelineRow(player, playerIndex, windowStart, windowEnd) {
  const champion = championById(player.championId);
  const championImage = champion?.image || EMPTY_CHAMPION_IMAGE;
  const championName = champion ? champion.name : "No champion";
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
    <aside class="ad-banner ad-banner-${position}" data-ad-id="${position}" aria-label="Advertisement">
      <a class="ad-creative" href="${escapeHtml(ad.href || "mailto:admin@spelltracker.lol")}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(ad.label || "Advertise with SpellTracker")}">
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
    ui.spellContext = null;
    saveAndRender();
    return;
  }

  if (action === "toggle-game-timer") {
    toggleGameTimer();
    return;
  }

  if (action === "toggle-game-time-menu") {
    ui.gameTimerMenuOpen = !ui.gameTimerMenuOpen;
    render();
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
    ui.timelineRefreshBlockedUntil = Date.now() + 900;
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

function toggleGameTimer() {
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
  ui.gameTimerMenuOpen = false;
  const deltaMs = -currentGameTimeMs();
  shiftAllCooldownGameTimes(deltaMs);
  state.gameTimeMs = 0;
  state.gameStartedAt = state.gameTimerRunning && !state.paused ? Date.now() : null;
  saveAndRender();
}

function adjustGameTime(seconds) {
  ui.gameTimerMenuOpen = false;
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
  if (isGameTimerAdvancing()) {
    return Math.max(0, (Number(state.gameTimeMs) || 0) + Date.now() - Number(state.gameStartedAt));
  }
  return Math.max(0, Number(state.gameTimeMs) || 0);
}

function updateGameTimerDisplay() {
  const timer = app.querySelector("[data-game-time]");
  const stateText = app.querySelector("[data-game-timer-state]");
  if (timer) timer.textContent = formatGameTime(currentGameTimeMs());
  if (stateText) stateText.textContent = isGameTimerAdvancing() ? "Live" : "Paused";
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
    resumeTrackingClock();
    if (state.gameTimerRunning) {
      state.gameStartedAt = Date.now();
    }
  } else {
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
  const now = referenceNow();
  const active = activeCooldowns(slot, now);

  if (active.length === 0) {
    if (seconds > 0) {
      slot.cooldowns = [createCooldown(now, seconds * 1000)];
    }
    return;
  }

  active[0] = adjustCooldownEntry(active[0], seconds * 1000, now);
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
      durationMs: null
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
    durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.max(0, Number(entry.durationMs)) : null
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
    durationMs: safeDuration
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
    durationMs: Math.max(0, nextEndAt - startAt)
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
  for (const player of state.players) {
    for (const slot of player.slots) {
      slot.cooldowns = sortCooldowns(slot.cooldowns
        .map(normalizeCooldownEntry)
        .filter((cooldown) => cooldown && cooldownEndAt(cooldown) > now));
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
