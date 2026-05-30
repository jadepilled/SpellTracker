# SpellTracker

SpellTracker is a fast, static League of Legends summoner spell cooldown tracker hosted at https://spelltracker.lol. It is built for players who want a clean second-screen tool for tracking enemy Flash, Teleport, Smite, Heal, Barrier, Ignite, and other summoner spells with accurate cooldowns and summoner spell haste handling.

The tracker itself is designed to run on GitHub Pages. It has no account system and no Riot API dependency. All champion, spell, icon, and modifier data is generated from local Riot Dragon Tail/Data Dragon source files. The optional global "cooldowns tracked" counter is served by a tiny Cloudflare Worker backed by a free-tier SQLite Durable Object.

## Features

- Scoreboard view with five enemy slots in role order: top, jungle, mid, bot, support.
- Optional champion selection using all champions from Riot data.
- Default Summoner's Rift (`SR`) and ARAM summoner spell loadouts.
- One-click or one-tap cooldown activation for each enemy summoner spell.
- Context menus for replacing spells, adjusting cooldowns by `-1`, `-5`, `-30`, `+1`, `+5`, and `+30` seconds, resetting a spell cooldown, and toggling summoner spell haste modifiers.
- Correct summoner spell haste calculation, including selectable haste sources and ARAM's mode-specific `+70` base summoner spell haste.
- Flash-on-D / Flash-on-F preference that keeps Flash in the preferred slot.
- Stop/resume support that freezes timers and interactions until tracking is resumed.
- Shared simulated game timer with reset, button, and scroll-wheel adjustment controls.
- Timeline view showing enemy summoner cooldown windows as time-scaled blocks, current game time, and upcoming cooldown completions.
- Dark and light themes.
- Responsive full-screen UI for desktop browsers, mobile browsers, iOS, Android, portrait layouts, and landscape layouts.
- Configurable ad rotation through `data/ads.json`.
- Global cooldown completion counter powered by Cloudflare Durable Objects.
- Lightweight Cloudflare analytics for site views, ad clicks, and ad clickthrough rate.

## Local Development

Run the local static dev server:

```powershell
npm run dev
```

Then open the printed local URL. The app is currently developed against the local server used by Codex, usually:

```text
http://127.0.0.1:4173/
```

Validate generated data:

```powershell
npm run check
```

Run the Cloudflare counter Worker locally:

```powershell
npm run counter:dev
```

## Riot Data Updates

SpellTracker keeps generated app data in `data/lol.json`. To regenerate it from the newest available sibling Dragon Tail folder:

```powershell
npm run update:data
```

To target a specific Dragon Tail folder:

```powershell
python scripts/update_data.py --source ..\dragontail-16.11.1
```

The update script refreshes champions, summoner spells, spell images, role metadata, item/perk icons, and app-ready summoner spell haste modifiers. Conditional or stacking summoner spell haste sources are retained in data where possible, but are only surfaced as simple toggles when they can be applied accurately.

## Publishing

The GitHub Pages deployment is updated by committing and pushing the repository. A helper script is intended to live one folder above this repository:

```powershell
python ..\publish_spelltracker.py
```

The script:

- Locates the SpellTracker repository from the parent folder.
- Optionally regenerates Riot data.
- Runs validation.
- Shows Git status.
- Prompts for a commit title and optional commit body.
- Commits changes.
- Pushes to the configured Git remote so GitHub Pages can deploy.

This repository is static and requires no build step for GitHub Pages.

Deploy the Cloudflare counter Worker and its Durable Object:

```powershell
npm run counter:deploy
```

The Worker currently deploys to `https://spelltracker-counter.jade-431.workers.dev`, which the static site calls directly for `/api/cooldowns` and `/api/analytics`. A same-origin `spelltracker.lol/api/cooldowns*` route is left commented in `counter-worker/wrangler.jsonc` for later use if the `spelltracker.lol` Cloudflare zone is added to this account.

## GitHub Pages Files

Keep these files in the repository root:

- `.nojekyll`, so GitHub Pages serves static assets directly.
- `CNAME`, configured for `spelltracker.lol`.
- `robots.txt` and `sitemap.xml`.
- `site.webmanifest`.
- SEO, Open Graph, Twitter card, canonical, and JSON-LD metadata in `index.html`.

## Ads

Ads are configured in `data/ads.json`. Each ad can define:

- `enabled`
- `src`
- `href`
- `startsAt`
- `endsAt`

Date windows are optional. A `null` start or end means the ad is not bounded on that side. The app avoids showing the same ad twice on the same page.

Ad click and site view analytics are counted by the Cloudflare Durable Object. Current totals can be checked with:

```powershell
Invoke-RestMethod https://spelltracker-counter.jade-431.workers.dev/api/analytics
```

## Project Structure

- `index.html` - static page shell and metadata.
- `src/main.js` - app state, rendering, cooldown logic, timeline logic, and interactions.
- `src/styles.css` - responsive layout, themes, and UI styling.
- `data/lol.json` - generated League of Legends data used by the app.
- `data/ads.json` - ad rotation config.
- `assets/` - champion, spell, role, modifier, font, favicon, and ad assets.
- `scripts/update_data.py` - Riot data refresh script.
- `scripts/validate-data.mjs` - generated data validation.
- `scripts/dev-server.mjs` - local static development server.
- `counter-worker/` - Cloudflare Worker and Durable Object counter endpoint.

## Attribution

SpellTracker is authored by `psyopgirl`.

SpellTracker and spelltracker.lol copyright (c) SpellTracker 2026. League of Legends, all champions, icons, names, and images are copyright (c) Riot Games. SpellTracker is not endorsed by, affiliated with, partnered with, or approved by Riot Games.
