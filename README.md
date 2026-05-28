# SpellTracker

League of Legends enemy summoner spell cooldown tracker by `psyopgirl`.

SpellTracker is a static GitHub Pages-friendly app for `https://spelltracker.gg`. It uses local Riot Dragon Tail or Data Dragon files as its source of truth for champions, summoner spells, images, and summoner spell haste modifiers.

## Features

- Five enemy role cards: top, jungle, mid, bot, support.
- Optional champion selection with every champion from Riot data.
- Spell replacement through icon-only summoner spell menus.
- Tap or click a spell to put it on cooldown.
- Per-card timer controls for `-1`, `-5`, `-30`, `+1`, `+5`, and `+30` seconds.
- Classic and ARAM spell pools.
- Per-player Summoner Spell Haste modifiers from local Riot data.
- Dark and light themes, fixed Flash-on-D/F preference, and mobile-first full-screen layout.
- Static files only, suitable for GitHub Pages.

## Local Use

```powershell
npm run dev
```

Then open the printed local URL.

## Refreshing Riot Data

From this project folder:

```powershell
npm run update:data
npm run check
```

The update command runs `scripts/update_data.py`. By default it finds the newest sibling `dragontail-*` folder, copies any changed champion, summoner spell, item, and perk images into `assets`, regenerates `data/lol.json`, records the current LoL patch in `package.json`, and detects app-ready Summoner Spell Haste modifiers. You can target a specific drop with:

```powershell
python scripts/update_data.py --source ..\dragontail-16.11.1
```

Conditional or stacking Summoner Spell Haste sources are recorded in `data/lol.json` but are not surfaced as flat toggles unless they can be applied accurately.

## GitHub Pages

This repository is ready to publish from the repository root with no build step. Keep `.nojekyll` and `CNAME` in the root so GitHub Pages serves the static assets directly and maps the custom domain to `spelltracker.gg`.

The app includes:

- `CNAME` for `spelltracker.gg`
- `robots.txt`
- `sitemap.xml`
- `site.webmanifest`
- canonical, Open Graph, Twitter card, and JSON-LD metadata in `index.html`
- an optimized Un Dotum WOFF2 subset for fast first render
