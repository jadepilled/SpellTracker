import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(process.argv[2] || join(projectRoot, "..", "LoL Data"));
const localeRoot = join(sourceRoot, "en_AU");

function readJson(path) {
  return readFile(path, "utf8").then(JSON.parse);
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHaste(text) {
  const clean = stripTags(text);
  const match = clean.match(/(?:\+\s*|Gain\s+)(\d+(?:\.\d+)?)\s+Summoner Spell Haste/i);
  return match ? Number(match[1]) : 0;
}

function hasTag(champion, tag) {
  return (champion.tags || []).some((entry) => entry.toLowerCase() === tag.toLowerCase());
}

function inferPreferredRoles(champion, championDetails) {
  const detail = championDetails || champion;
  const stats = champion.stats || {};
  const info = champion.info || {};
  const roleOrder = ["top", "jungle", "mid", "bot", "support"];
  const text = stripTags([
    champion.title,
    champion.blurb,
    ...(detail.allytips || []),
    ...(detail.enemytips || []),
    ...(detail.spells || []).flatMap((spell) => [spell.description, spell.tooltip])
  ].join(" ")).toLowerCase();

  const scores = {
    top: 0,
    jungle: 0,
    mid: 0,
    bot: 0,
    support: 0
  };

  if (hasTag(champion, "Fighter")) {
    scores.top += 6;
    scores.jungle += 4;
    scores.mid += 1;
  }
  if (hasTag(champion, "Tank")) {
    scores.top += 5;
    scores.jungle += 3;
    scores.support += 1;
  }
  if (hasTag(champion, "Mage")) {
    scores.mid += 6;
    scores.bot += 1;
  }
  if (hasTag(champion, "Assassin")) {
    scores.mid += 5;
    scores.jungle += 3;
  }
  if (hasTag(champion, "Marksman")) {
    scores.bot += 8;
    scores.mid += 1;
    scores.top += 1;
  }
  if (hasTag(champion, "Support")) {
    scores.support += 10;
    if (hasTag(champion, "Mage")) scores.mid += 1;
    if (hasTag(champion, "Tank")) scores.top += 1;
  }

  if (Number(stats.attackrange) >= 500) {
    scores.bot += 2;
    if (hasTag(champion, "Mage")) scores.mid += 1;
    if (hasTag(champion, "Support")) scores.support += 1;
  } else if (Number(stats.attackrange) <= 200) {
    scores.top += 2;
    scores.jungle += 2;
  }

  if (Number(info.magic) >= 7) {
    scores.mid += 2;
  }
  if (Number(info.attack) >= 7 && Number(stats.attackrange) >= 500) {
    scores.bot += 3;
  }
  if (Number(info.defense) >= 6) {
    scores.top += 2;
    scores.jungle += 1;
    scores.support += 2;
  }
  if (/\b(monsterminiondamage|monsterhealing|bonus[^.]{0,80}monsters?|against a minion or jungle monster|damage[^.]{0,80}to monsters?|jungle monster)\b/.test(text)) {
    scores.jungle += 4;
  } else if (/\b(monster|monsters|jungle|camp|epic monster|large monster)\b/.test(text)) {
    scores.jungle += 1;
  }

  if (!hasTag(champion, "Support")) {
    scores.support = Math.max(0, scores.support - 4);
  }

  const ordered = Object.entries(scores).sort(
    (a, b) => b[1] - a[1] || roleOrder.indexOf(a[0]) - roleOrder.indexOf(b[0])
  );
  const bestScore = ordered[0]?.[1] || 0;
  const threshold = Math.max(4, bestScore - 3);
  const roles = ordered.filter(([, score]) => score >= threshold).slice(0, 2).map(([role]) => role);
  return roles.length ? roles : ["mid"];
}

async function copyIfPresent(from, to) {
  if (!existsSync(from)) {
    return false;
  }
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  return true;
}

async function copyImageAsset(relativePath) {
  if (!relativePath) {
    return null;
  }
  const normalized = relativePath.replaceAll("\\", "/");
  const copied = await copyIfPresent(
    join(sourceRoot, "img", ...normalized.split("/")),
    join(projectRoot, "assets", ...normalized.split("/"))
  );
  return copied ? `./assets/${normalized}` : null;
}

const [championJson, championFullJson, summonerJson, runeJson, itemJson] = await Promise.all([
  readJson(join(localeRoot, "champion.json")),
  existsSync(join(localeRoot, "championFull.json")) ? readJson(join(localeRoot, "championFull.json")) : Promise.resolve(null),
  readJson(join(localeRoot, "summoner.json")),
  readJson(join(localeRoot, "runesReforged.json")),
  readJson(join(localeRoot, "item.json"))
]);

const champions = Object.values(championJson.data)
  .map((champion) => ({
    id: champion.id,
    key: champion.key,
    name: champion.name,
    title: champion.title,
    tags: champion.tags || [],
    roles: inferPreferredRoles(champion, championFullJson?.data?.[champion.id]),
    image: `./assets/champion/${champion.image.full}`
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const spells = Object.values(summonerJson.data)
  .filter((spell) => Number(spell.cooldown?.[0] || 0) > 0)
  .filter((spell) => !/placeholder/i.test(spell.id))
  .map((spell) => {
    const imageSource = join(sourceRoot, "img", "spell", spell.image.full);
    const image = existsSync(imageSource) ? `./assets/spell/${spell.image.full}` : null;
    return {
      id: spell.id,
      key: spell.key,
      name: spell.name,
      description: stripTags(spell.description),
      cooldown: Number(spell.cooldown[0]),
      maxAmmo: Number(spell.maxammo) > 0 ? Number(spell.maxammo) : 1,
      modes: spell.modes,
      isClassic: spell.modes.includes("CLASSIC"),
      image,
      imageFull: spell.image.full
    };
  })
  .sort((a, b) => {
    if (a.isClassic !== b.isClassic) return a.isClassic ? -1 : 1;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });

const runeModifiers = [];
for (const tree of runeJson) {
  for (const slot of tree.slots) {
    for (const rune of slot.runes) {
      const haste = parseHaste(`${rune.shortDesc} ${rune.longDesc}`);
      if (haste > 0) {
        const image = await copyImageAsset(rune.icon);
        runeModifiers.push({
          id: String(rune.id),
          key: rune.key,
          name: rune.name,
          source: tree.name,
          haste,
          description: stripTags(rune.longDesc),
          image,
          imageFull: rune.icon
        });
      }
    }
  }
}

const abilityHasteIcon = await copyImageAsset("perk-images/StatMods/StatModsCDRScalingIcon.png");

const itemCandidates = Object.entries(itemJson.data)
  .map(([id, item]) => ({
    id,
    name: item.name,
    haste: parseHaste(item.description),
    description: stripTags(item.description),
    imageFull: item.image?.full || null
  }))
  .filter((item) => item.haste > 0);

const seenItemNames = new Set();
const itemModifiers = [];
for (const item of itemCandidates.sort((a, b) => Number(a.id) - Number(b.id))) {
  const key = `${item.name}:${item.haste}`;
  if (seenItemNames.has(key)) continue;
  seenItemNames.add(key);
  itemModifiers.push({
    id: item.id,
    name: item.name,
    haste: item.haste,
    description: item.description,
    image: item.imageFull ? `./assets/item/${item.imageFull}` : null,
    imageFull: item.imageFull
  });
}

await mkdir(join(projectRoot, "data"), { recursive: true });
await mkdir(join(projectRoot, "assets", "champion"), { recursive: true });
await mkdir(join(projectRoot, "assets", "spell"), { recursive: true });
await mkdir(join(projectRoot, "assets", "item"), { recursive: true });

await Promise.all(
  champions.map((champion) =>
    copyIfPresent(
      join(sourceRoot, "img", "champion", champion.image.split("/").pop()),
      join(projectRoot, "assets", "champion", champion.image.split("/").pop())
    )
  )
);

await Promise.all(
  spells.map((spell) =>
    copyIfPresent(
      join(sourceRoot, "img", "spell", spell.imageFull),
      join(projectRoot, "assets", "spell", spell.imageFull)
    )
  )
);

await Promise.all(
  itemModifiers.map((item) =>
    item.imageFull
      ? copyIfPresent(
          join(sourceRoot, "img", "item", item.imageFull),
          join(projectRoot, "assets", "item", item.imageFull)
        )
      : false
  )
);

const data = {
  generatedAt: new Date().toISOString(),
  version: championJson.version,
  source: {
    champion: "en_AU/champion.json",
    summoner: "en_AU/summoner.json",
    runes: "en_AU/runesReforged.json",
    items: "en_AU/item.json"
  },
  formula: {
    summonerSpellHaste: "cooldown / (1 + haste / 100)"
  },
  icons: {
    abilityHaste: abilityHasteIcon
  },
  champions,
  spells,
  modifiers: {
    runes: runeModifiers,
    items: itemModifiers
  }
};

await writeFile(join(projectRoot, "data", "lol.json"), `${JSON.stringify(data, null, 2)}\n`);

console.log(`Generated ${champions.length} champions, ${spells.length} summoner spells.`);
console.log(`Found ${runeModifiers.length} rune modifiers and ${itemModifiers.length} item modifiers.`);
