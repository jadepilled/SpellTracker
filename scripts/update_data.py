#!/usr/bin/env python3
r"""Update SpellTracker data and assets from a local Riot Dragon Tail drop.

Run from the project root:
  python scripts/update_data.py

By default the script looks beside the project for the newest dragontail-* folder.
You can also point it at a specific Dragon Tail root, version folder, or legacy
LoL Data folder:
  python scripts/update_data.py --source ..\dragontail-16.11.1
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LANE_ORDER = ["top", "jungle", "mid", "bot", "support"]
ABILITY_HASTE_ICON = "perk-images/StatMods/StatModsCDRScalingIcon.png"
ROLE_OVERRIDES = {
    "Aatrox": ["top"],
    "Ahri": ["mid"],
    "Akali": ["mid", "top"],
    "Akshan": ["mid", "bot"],
    "Alistar": ["support"],
    "Ambessa": ["top", "mid"],
    "Amumu": ["jungle", "support"],
    "Anivia": ["mid"],
    "Annie": ["mid", "support"],
    "Aphelios": ["bot"],
    "Ashe": ["bot", "support"],
    "AurelionSol": ["mid"],
    "Aurora": ["mid", "top"],
    "Azir": ["mid"],
    "Bard": ["support"],
    "Belveth": ["jungle"],
    "Blitzcrank": ["support"],
    "Brand": ["support", "mid", "jungle"],
    "Braum": ["support"],
    "Briar": ["jungle"],
    "Caitlyn": ["bot"],
    "Camille": ["top", "support"],
    "Cassiopeia": ["mid", "top"],
    "Chogath": ["top", "mid"],
    "Corki": ["mid"],
    "Darius": ["top"],
    "Diana": ["jungle", "mid"],
    "Draven": ["bot"],
    "DrMundo": ["top", "jungle"],
    "Ekko": ["jungle", "mid"],
    "Elise": ["jungle"],
    "Evelynn": ["jungle"],
    "Ezreal": ["bot"],
    "Fiddlesticks": ["jungle"],
    "Fiora": ["top"],
    "Fizz": ["mid"],
    "Galio": ["mid", "support"],
    "Gangplank": ["top"],
    "Garen": ["top"],
    "Gnar": ["top"],
    "Gragas": ["jungle", "top", "support"],
    "Graves": ["jungle"],
    "Gwen": ["top", "jungle"],
    "Hecarim": ["jungle"],
    "Heimerdinger": ["mid", "top", "support"],
    "Hwei": ["mid", "support"],
    "Illaoi": ["top"],
    "Irelia": ["top", "mid"],
    "Ivern": ["jungle"],
    "Janna": ["support"],
    "JarvanIV": ["jungle"],
    "Jax": ["top", "jungle"],
    "Jayce": ["top", "mid"],
    "Jhin": ["bot"],
    "Jinx": ["bot"],
    "Kaisa": ["bot"],
    "Kalista": ["bot"],
    "Karma": ["support", "mid"],
    "Karthus": ["jungle", "mid"],
    "Kassadin": ["mid"],
    "Katarina": ["mid"],
    "Kayle": ["top", "mid"],
    "Kayn": ["jungle"],
    "Kennen": ["top", "mid"],
    "Khazix": ["jungle"],
    "Kindred": ["jungle"],
    "Kled": ["top"],
    "KogMaw": ["bot", "mid"],
    "KSante": ["top"],
    "Leblanc": ["mid"],
    "LeeSin": ["jungle"],
    "Leona": ["support"],
    "Lillia": ["jungle", "top"],
    "Lissandra": ["mid"],
    "Lucian": ["bot", "mid"],
    "Lulu": ["support"],
    "Lux": ["support", "mid"],
    "Malphite": ["top", "mid", "support"],
    "Malzahar": ["mid"],
    "Maokai": ["support", "jungle", "top"],
    "MasterYi": ["jungle"],
    "Mel": ["mid", "support"],
    "Milio": ["support"],
    "MissFortune": ["bot"],
    "MonkeyKing": ["top", "jungle"],
    "Mordekaiser": ["top"],
    "Morgana": ["support", "jungle", "mid"],
    "Naafiri": ["mid"],
    "Nami": ["support"],
    "Nasus": ["top"],
    "Nautilus": ["support"],
    "Neeko": ["mid", "support"],
    "Nidalee": ["jungle"],
    "Nilah": ["bot"],
    "Nocturne": ["jungle"],
    "Nunu": ["jungle"],
    "Olaf": ["top", "jungle"],
    "Orianna": ["mid"],
    "Ornn": ["top"],
    "Pantheon": ["support", "top", "mid"],
    "Poppy": ["top", "jungle", "support"],
    "Pyke": ["support"],
    "Qiyana": ["mid", "jungle"],
    "Quinn": ["top"],
    "Rakan": ["support"],
    "Rammus": ["jungle"],
    "RekSai": ["jungle"],
    "Rell": ["support", "jungle"],
    "Renata": ["support"],
    "Renekton": ["top"],
    "Rengar": ["jungle", "top"],
    "Riven": ["top"],
    "Rumble": ["top", "mid", "jungle"],
    "Ryze": ["mid", "top"],
    "Samira": ["bot"],
    "Sejuani": ["jungle", "top"],
    "Senna": ["support", "bot"],
    "Seraphine": ["support", "bot", "mid"],
    "Sett": ["top", "support"],
    "Shaco": ["jungle", "support"],
    "Shen": ["top", "support"],
    "Shyvana": ["jungle"],
    "Singed": ["top"],
    "Sion": ["top"],
    "Sivir": ["bot"],
    "Skarner": ["jungle", "top"],
    "Smolder": ["bot", "mid"],
    "Sona": ["support"],
    "Soraka": ["support"],
    "Swain": ["support", "mid"],
    "Sylas": ["mid", "jungle"],
    "Syndra": ["mid"],
    "TahmKench": ["support", "top"],
    "Taliyah": ["jungle", "mid"],
    "Talon": ["mid", "jungle"],
    "Taric": ["support"],
    "Teemo": ["top"],
    "Thresh": ["support"],
    "Tristana": ["bot", "mid"],
    "Trundle": ["jungle", "top"],
    "Tryndamere": ["top"],
    "TwistedFate": ["mid"],
    "Twitch": ["bot", "jungle"],
    "Udyr": ["jungle", "top"],
    "Urgot": ["top"],
    "Varus": ["bot", "mid"],
    "Vayne": ["bot", "top"],
    "Veigar": ["mid", "support", "bot"],
    "Velkoz": ["support", "mid"],
    "Vex": ["mid"],
    "Vi": ["jungle"],
    "Viego": ["jungle"],
    "Viktor": ["mid"],
    "Vladimir": ["mid", "top"],
    "Volibear": ["top", "jungle"],
    "Warwick": ["jungle", "top"],
    "Xayah": ["bot"],
    "Xerath": ["support", "mid"],
    "XinZhao": ["jungle"],
    "Yasuo": ["mid", "top", "bot"],
    "Yone": ["mid", "top"],
    "Yorick": ["top"],
    "Yunara": ["bot"],
    "Yuumi": ["support"],
    "Zaahen": ["top"],
    "Zac": ["jungle", "top", "support"],
    "Zed": ["mid", "jungle"],
    "Zeri": ["bot"],
    "Ziggs": ["bot", "mid"],
    "Zilean": ["support", "mid"],
    "Zoe": ["mid"],
    "Zyra": ["support", "jungle", "mid"],
}
SUMMONER_HASTE_RE = re.compile(
    r"(?:\+|gain(?:s)?|grant(?:s)?|instead gain(?:s)?|instead grant(?:s)?)?\s*"
    r"(\d+(?:\.\d+)?)\s+Summoner Spell Haste",
    re.IGNORECASE,
)


@dataclass
class DataSource:
    source_root: Path
    version_root: Path
    data_root: Path
    image_root: Path
    version: str


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def strip_tags(value: Any) -> str:
    text = re.sub(r"<[^>]*>", " ", str(value or ""))
    text = re.sub(r"\{\{[^}]*\}\}", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def version_key(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value))


def choose_latest_dragontail(search_root: Path) -> Path:
    candidates = [
        path for path in search_root.glob("dragontail-*")
        if path.is_dir() and re.search(r"\d+\.\d+(?:\.\d+)?", path.name)
    ]
    if not candidates:
        raise FileNotFoundError(f"No dragontail-* folders found in {search_root}")
    return max(candidates, key=lambda path: version_key(path.name))


def resolve_source(source_arg: str | None, locale: str) -> DataSource:
    raw_source = Path(source_arg).expanduser() if source_arg else PROJECT_ROOT.parent
    source = raw_source if raw_source.is_absolute() else (PROJECT_ROOT / raw_source).resolve()

    if source.is_dir() and source.name.lower().startswith("dragontail-"):
        version_dirs = [child for child in source.iterdir() if child.is_dir() and (child / "data").exists()]
        if not version_dirs:
            raise FileNotFoundError(f"No Dragon Tail version folder found in {source}")
        version_root = max(version_dirs, key=lambda path: version_key(path.name))
        data_root = version_root / "data" / locale
        if not data_root.exists():
            data_root = version_root / "data" / "en_US"
        return DataSource(source, version_root, data_root, version_root / "img", version_root.name)

    if source.is_dir() and (source / "data").exists() and (source / "img").exists():
        data_root = source / "data" / locale
        if not data_root.exists():
            data_root = source / "data" / "en_US"
        return DataSource(source, source, data_root, source / "img", source.name)

    if source.is_dir() and (source / locale).exists() and (source / "img").exists():
        data_root = source / locale
        champion = read_json(data_root / "champion.json")
        return DataSource(source, source, data_root, source / "img", champion.get("version", source.name))

    if source.is_dir():
        latest = choose_latest_dragontail(source)
        return resolve_source(str(latest), locale)

    raise FileNotFoundError(f"Could not resolve data source: {source}")


def copy_asset(image_root: Path, relative_path: str | None, destination_root: Path = PROJECT_ROOT / "assets") -> str | None:
    if not relative_path:
        return None
    normalized = relative_path.replace("\\", "/").lstrip("/")
    source = image_root.joinpath(*normalized.split("/"))
    destination = destination_root.joinpath(*normalized.split("/"))
    if source.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        return f"./assets/{normalized}"
    if destination.exists():
        return f"./assets/{normalized}"
    return None


def has_tag(champion: dict[str, Any], tag: str) -> bool:
    return tag.lower() in {str(entry).lower() for entry in champion.get("tags", [])}


def roles_from_recommended(detail: dict[str, Any] | None) -> list[str]:
    recommended = (detail or {}).get("recommended") or []
    if not recommended:
        return []
    found: list[str] = []
    aliases = {
        "top": "top",
        "solo": "top",
        "jungle": "jungle",
        "jungler": "jungle",
        "middle": "mid",
        "mid": "mid",
        "bottom": "bot",
        "bot": "bot",
        "marksman": "bot",
        "support": "support",
    }
    for block in recommended:
        text = strip_tags(json.dumps(block, ensure_ascii=False)).lower()
        for needle, role in aliases.items():
            if re.search(rf"\b{re.escape(needle)}\b", text) and role not in found:
                found.append(role)
    return [role for role in LANE_ORDER if role in found]


def infer_preferred_roles(champion: dict[str, Any], detail: dict[str, Any] | None) -> list[str]:
    if champion.get("id") in ROLE_OVERRIDES:
        return ROLE_OVERRIDES[champion["id"]]

    official_roles = roles_from_recommended(detail)
    if official_roles:
        return official_roles[:3]

    stats = champion.get("stats", {})
    info = champion.get("info", {})
    text = strip_tags(" ".join([
        champion.get("title", ""),
        champion.get("blurb", ""),
        *((detail or {}).get("allytips") or []),
        *((detail or {}).get("enemytips") or []),
        *[spell.get("description", "") for spell in (detail or {}).get("spells", [])],
        *[spell.get("tooltip", "") for spell in (detail or {}).get("spells", [])],
    ])).lower()

    scores = dict.fromkeys(LANE_ORDER, 0.0)

    if has_tag(champion, "Fighter"):
        scores["top"] += 6
        scores["jungle"] += 3
        scores["mid"] += 1
    if has_tag(champion, "Tank"):
        scores["top"] += 5
        scores["jungle"] += 2
        scores["support"] += 2
    if has_tag(champion, "Mage"):
        scores["mid"] += 7
        scores["support"] += 1 if has_tag(champion, "Support") else 0
    if has_tag(champion, "Assassin"):
        scores["mid"] += 6
        scores["jungle"] += 2
    if has_tag(champion, "Marksman"):
        scores["bot"] += 9
        scores["mid"] += 1
    if has_tag(champion, "Support"):
        scores["support"] += 10

    attack_range = float(stats.get("attackrange") or 0)
    if attack_range >= 525:
        scores["bot"] += 2
        if has_tag(champion, "Mage"):
            scores["mid"] += 1
        if has_tag(champion, "Support"):
            scores["support"] += 2
    elif attack_range and attack_range <= 200:
        scores["top"] += 2
        scores["jungle"] += 1

    if float(info.get("magic") or 0) >= 7:
        scores["mid"] += 2
    if float(info.get("attack") or 0) >= 7 and attack_range >= 500:
        scores["bot"] += 3
    if float(info.get("defense") or 0) >= 6:
        scores["top"] += 2
        scores["support"] += 2

    if re.search(r"\b(monsterminiondamage|monsterhealing|epic monster|large monster|jungle monster|damage[^.]{0,80}monsters?)\b", text):
        scores["jungle"] += 5
    elif re.search(r"\b(monster|monsters|jungle|camp|smite)\b", text):
        scores["jungle"] += 2

    if not has_tag(champion, "Support"):
        scores["support"] = max(0, scores["support"] - 5)
    if not re.search(r"\b(monster|monsters|jungle|camp|smite)\b", text):
        scores["jungle"] = max(0, scores["jungle"] - 1)

    ordered = sorted(scores.items(), key=lambda entry: (-entry[1], LANE_ORDER.index(entry[0])))
    best = ordered[0][1]
    if best <= 0:
        return ["mid"]
    threshold = max(5.0, best * 0.78)
    roles = [role for role, score in ordered if score >= threshold]
    return roles[:3] or [ordered[0][0]]


def parse_summoner_haste(text: str) -> dict[str, Any] | None:
    clean = strip_tags(text)
    matches = list(SUMMONER_HASTE_RE.finditer(clean))
    if not matches:
        return None

    match = matches[0]
    haste = float(match.group(1))
    if haste.is_integer():
        haste = int(haste)
    window = clean[max(0, match.start() - 120):match.end() + 120].lower()
    is_scaling = bool(re.search(r"\b(each|per|stack|stacks|stacking|collected|memento|up to|instead)\b", window))
    result: dict[str, Any] = {
        "haste": haste,
        "flat": not is_scaling,
    }
    if is_scaling:
        max_match = re.search(r"up to\s+(\d+)", window)
        result["ui"] = False
        result["scaling"] = {
            "perStack": haste,
            "maxStacks": int(max_match.group(1)) if max_match else None,
        }
        if "instead" in window:
            result["appliesWhen"] = "no-trinket-mode"
    else:
        result["ui"] = True
    return result


def build_champions(source: DataSource) -> list[dict[str, Any]]:
    champion_json = read_json(source.data_root / "champion.json")
    champion_full_path = source.data_root / "championFull.json"
    champion_full = read_json(champion_full_path) if champion_full_path.exists() else {"data": {}}

    champions = []
    for champion in champion_json["data"].values():
        image_full = champion["image"]["full"]
        image = copy_asset(source.image_root, f"champion/{image_full}")
        detail = champion_full.get("data", {}).get(champion["id"])
        official_roles = roles_from_recommended(detail)
        roles = infer_preferred_roles(champion, detail)
        if official_roles:
            role_source = "recommended"
        elif champion["id"] in ROLE_OVERRIDES:
            role_source = "curated"
        else:
            role_source = "inferred"
        champions.append({
            "id": champion["id"],
            "key": champion["key"],
            "name": champion["name"],
            "title": champion.get("title", ""),
            "tags": champion.get("tags", []),
            "roles": roles,
            "roleSource": role_source,
            "image": image or f"./assets/champion/{image_full}",
        })
    return sorted(champions, key=lambda entry: entry["name"])


def build_spells(source: DataSource) -> list[dict[str, Any]]:
    summoner_json = read_json(source.data_root / "summoner.json")
    spells = []
    for spell in summoner_json["data"].values():
        cooldown = float((spell.get("cooldown") or [0])[0] or 0)
        if cooldown <= 0 or re.search("placeholder", spell.get("id", ""), re.IGNORECASE):
            continue
        image_full = spell.get("image", {}).get("full")
        image = copy_asset(source.image_root, f"spell/{image_full}") if image_full else None
        spells.append({
            "id": spell["id"],
            "key": spell["key"],
            "name": spell["name"],
            "description": strip_tags(spell.get("description", "")),
            "cooldown": int(cooldown) if cooldown.is_integer() else cooldown,
            "maxAmmo": int(spell.get("maxammo") or 1) if int(spell.get("maxammo") or 1) > 0 else 1,
            "modes": spell.get("modes", []),
            "isClassic": "CLASSIC" in spell.get("modes", []),
            "image": image,
            "imageFull": image_full,
        })
    return sorted(spells, key=lambda entry: (not entry["isClassic"], entry["name"], entry["id"]))


def build_rune_modifiers(source: DataSource) -> list[dict[str, Any]]:
    rune_path = source.data_root / "runesReforged.json"
    if not rune_path.exists():
        return []
    runes = read_json(rune_path)
    modifiers = []
    for tree in runes:
        for slot in tree.get("slots", []):
            for rune in slot.get("runes", []):
                parsed = parse_summoner_haste(f"{rune.get('name', '')} {rune.get('shortDesc', '')} {rune.get('longDesc', '')}")
                if not parsed:
                    continue
                image_full = rune.get("icon")
                image = copy_asset(source.image_root, image_full)
                modifiers.append({
                    "id": str(rune["id"]),
                    "key": rune.get("key", ""),
                    "kind": "rune",
                    "name": rune.get("name", ""),
                    "source": tree.get("name", ""),
                    "haste": parsed["haste"],
                    "flat": parsed["flat"],
                    "ui": parsed["ui"],
                    "exclusiveGroup": "",
                    "description": strip_tags(rune.get("longDesc", "")),
                    "image": image,
                    "imageFull": image_full,
                    **({"scaling": parsed["scaling"]} if "scaling" in parsed else {}),
                    **({"appliesWhen": parsed["appliesWhen"]} if "appliesWhen" in parsed else {}),
                })
    return sorted(modifiers, key=lambda entry: (not entry["ui"], entry["source"], entry["name"]))


def item_modes(item: dict[str, Any]) -> list[str]:
    maps = item.get("maps") or {}
    modes = []
    if maps.get("11"):
        modes.append("classic")
    if maps.get("12"):
        modes.append("aram")
    return modes


def build_item_modifiers(source: DataSource) -> list[dict[str, Any]]:
    item_json = read_json(source.data_root / "item.json")
    modifiers = []
    seen = set()
    for item_id, item in item_json["data"].items():
        parsed = parse_summoner_haste(f"{item.get('name', '')} {item.get('plaintext', '')} {item.get('description', '')}")
        if not parsed:
            continue
        modes = item_modes(item)
        if not modes or item.get("hideFromAll") or item.get("inStore") is False:
            parsed["ui"] = False
        image_full = item.get("image", {}).get("full")
        key = (item.get("name", ""), parsed["haste"], tuple(modes), parsed["ui"])
        if key in seen:
            continue
        seen.add(key)
        image = copy_asset(source.image_root, f"item/{image_full}") if image_full else None
        is_boots = "Boots" in (item.get("tags") or [])
        modifiers.append({
            "id": str(item_id),
            "kind": "item",
            "name": item.get("name", ""),
            "source": "Items",
            "haste": parsed["haste"],
            "flat": parsed["flat"],
            "ui": parsed["ui"] and parsed["flat"],
            "exclusiveGroup": "boots" if is_boots else "",
            "modes": modes,
            "description": strip_tags(item.get("description", "")),
            "image": image,
            "imageFull": image_full,
        })
    return sorted(modifiers, key=lambda entry: (not entry["ui"], entry["exclusiveGroup"], entry["name"], str(entry["id"])))


def update_package_version(version: str) -> None:
    package_path = PROJECT_ROOT / "package.json"
    package = read_json(package_path)
    package["lolPatch"] = version
    scripts = package.setdefault("scripts", {})
    scripts["prepare:data"] = "python scripts/update_data.py"
    scripts["update:data"] = "python scripts/update_data.py"
    write_json(package_path, package)


def build_data(source: DataSource) -> dict[str, Any]:
    champion_json = read_json(source.data_root / "champion.json")
    version = champion_json.get("version") or source.version
    champions = build_champions(source)
    spells = build_spells(source)
    rune_modifiers = build_rune_modifiers(source)
    item_modifiers = build_item_modifiers(source)
    all_modifiers = [
        *[modifier for modifier in rune_modifiers if modifier.get("ui")],
        *[modifier for modifier in item_modifiers if modifier.get("ui")],
    ]

    ability_haste_icon = copy_asset(source.image_root, ABILITY_HASTE_ICON)
    if not ability_haste_icon and (PROJECT_ROOT / "assets" / ABILITY_HASTE_ICON).exists():
        ability_haste_icon = f"./assets/{ABILITY_HASTE_ICON}"

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "version": version,
        "source": {
            "root": str(source.source_root),
            "versionRoot": str(source.version_root),
            "locale": source.data_root.name,
            "champion": f"{source.data_root.name}/champion.json",
            "summoner": f"{source.data_root.name}/summoner.json",
            "runes": f"{source.data_root.name}/runesReforged.json",
            "items": f"{source.data_root.name}/item.json",
        },
        "formula": {
            "summonerSpellHaste": "cooldown / (1 + haste / 100)"
        },
        "icons": {
            "abilityHaste": ability_haste_icon
        },
        "champions": champions,
        "spells": spells,
        "modifiers": {
            "all": all_modifiers,
            "runes": rune_modifiers,
            "items": item_modifiers,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Update SpellTracker data from Riot Dragon Tail files.")
    parser.add_argument("--source", help="Dragon Tail folder, version folder, legacy LoL Data folder, or parent search folder.")
    parser.add_argument("--locale", default="en_AU", help="Locale to read from Dragon Tail. Defaults to en_AU.")
    args = parser.parse_args()

    source = resolve_source(args.source, args.locale)
    data = build_data(source)
    write_json(PROJECT_ROOT / "data" / "lol.json", data)
    update_package_version(data["version"])

    print(f"Updated SpellTracker to League of Legends patch {data['version']}.")
    print(f"Champions: {len(data['champions'])}; summoner spells: {len(data['spells'])}.")
    print(
        "Summoner spell haste modifiers: "
        f"{len(data['modifiers']['all'])} app-ready, "
        f"{len(data['modifiers']['runes']) + len(data['modifiers']['items'])} detected."
    )


if __name__ == "__main__":
    main()
