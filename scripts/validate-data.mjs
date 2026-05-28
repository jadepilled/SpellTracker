import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(await readFile(join(projectRoot, "data", "lol.json"), "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(data.champions.length >= 170, `Expected every champion, found ${data.champions.length}.`);
assert(data.spells.some((spell) => spell.id === "SummonerFlash" && spell.cooldown === 300), "Flash cooldown missing or changed.");
assert(data.spells.some((spell) => spell.id === "SummonerTeleport" && spell.cooldown === 300), "Teleport cooldown missing or changed.");
assert(data.spells.some((spell) => spell.id === "SummonerSmite" && spell.maxAmmo === 2), "Smite max ammo missing.");
assert(data.modifiers.runes.some((modifier) => modifier.key === "CosmicInsight" && modifier.haste === 18), "Cosmic Insight haste missing.");
assert(data.modifiers.items.some((modifier) => modifier.name === "Ionian Boots of Lucidity" && modifier.haste === 10), "Ionian Boots haste missing.");
assert(data.modifiers.items.some((modifier) => modifier.name === "Crimson Lucidity" && modifier.haste === 20), "Crimson Lucidity haste missing.");
assert(data.modifiers.all.some((modifier) => modifier.key === "CosmicInsight" && modifier.ui !== false), "Cosmic Insight should be app-ready.");
assert(data.modifiers.all.some((modifier) => modifier.name === "Ionian Boots of Lucidity" && modifier.exclusiveGroup === "boots"), "Ionian Boots should be app-ready.");
assert(data.modifiers.runes.some((modifier) => modifier.key === "GrislyMementos" && modifier.ui === false && modifier.scaling?.perStack === 3), "Conditional Grisly Mementos haste should be detected but not flat-toggled.");
assert(data.icons?.abilityHaste, "Ability Haste icon missing.");
assert(data.modifiers.runes.some((modifier) => modifier.key === "CosmicInsight" && modifier.image), "Cosmic Insight icon missing.");
assert(data.champions.every((champion) => Array.isArray(champion.roles) && champion.roles.length > 0), "Champion preferred roles missing.");
assert(data.champions.some((champion) => champion.id === "Aatrox" && champion.roles.includes("top")), "Aatrox should be shortlisted for top.");
assert(data.champions.some((champion) => champion.id === "Caitlyn" && champion.roles.includes("bot")), "Caitlyn should be shortlisted for bot.");
assert(data.champions.some((champion) => champion.id === "Ahri" && champion.roles.includes("mid")), "Ahri should be shortlisted for mid.");
assert(data.champions.some((champion) => champion.id === "Alistar" && champion.roles.includes("support")), "Alistar should be shortlisted for support.");

for (const champion of data.champions) {
  await access(join(projectRoot, champion.image.replace("./", "")));
}

await access(join(projectRoot, "assets", "champion", "None.png"));
for (const roleIcon of ["Top_icon.png", "Jungle_icon.png", "Middle_icon.png", "Bottom_icon.png", "Support_icon.png"]) {
  await access(join(projectRoot, "assets", "role-icons", roleIcon));
}

for (const spell of data.spells.filter((entry) => entry.image)) {
  await access(join(projectRoot, spell.image.replace("./", "")));
}

await access(join(projectRoot, data.icons.abilityHaste.replace("./", "")));
for (const modifier of data.modifiers.runes.filter((entry) => entry.image)) {
  await access(join(projectRoot, modifier.image.replace("./", "")));
}

console.log(`Validated ${data.champions.length} champions and ${data.spells.length} summoner spells from patch ${data.version}.`);
