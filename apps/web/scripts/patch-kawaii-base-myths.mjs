// One-time curation: enrich the BASE entries of item-map.json with their
// mythical-creature origin (creature, country, flag, scope, region) and rewrite
// each `desc` as the folk story. Neutral skin bases are left as plain bases.
//
// Idempotent — safe to re-run. The generator (gen-kawaii-item-map.mjs) preserves
// `desc` and `origin`, so this curation survives asset regeneration.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../lib/kawaii/item-map.json");
const map = JSON.parse(readFileSync(OUT, "utf8"));

// scope: "country" (one nation) | "regional" (a region) | "global" (worldwide)
const MYTHS = {
  "chupacabra.png": {
    name: "Chupacabra", origin: { creature: "Chupacabra", country: "Puerto Rico", flag: "🇵🇷", scope: "regional", region: "LATAM" },
    desc: "The 'goat-sucker' first terrorized Puerto Rico in 1995, draining livestock dry overnight. Sightings spread across Latin America — Mexico to Chile — making it the New World's most modern monster.",
  },
  "curupira.png": {
    name: "Curupira", origin: { creature: "Curupira", country: "Brazil", flag: "🇧🇷", scope: "country" },
    desc: "Guardian of the Amazon, the Curupira has flaming red hair and backwards-facing feet that send hunters in circles. Tupi-Guaraní peoples have warned for centuries: harm the forest and he'll lead you astray forever.",
  },
  "dokkaebi.png": {
    name: "Dokkaebi", origin: { creature: "Dokkaebi", country: "South Korea", flag: "🇰🇷", scope: "country" },
    desc: "Korean goblins born from discarded objects, Dokkaebi are mischievous nature spirits who love games, wrestling, and tricking the greedy. Their magic clubs conjure anything — but cross one and you'll regret it.",
  },
  "drop_bear.png": {
    name: "Drop Bear", origin: { creature: "Drop Bear", country: "Australia", flag: "🇦🇺", scope: "country" },
    desc: "Australia's most fearsome (and most fictional) predator: a carnivorous koala that drops from gum trees onto unsuspecting tourists. Locals swear Vegemite behind the ears keeps you safe.",
  },
  "duende.png": {
    name: "Duende", origin: { creature: "Duende", country: "Spain", flag: "🇪🇸", scope: "regional", region: "Iberia & LATAM" },
    desc: "A small house-goblin of Spanish and Portuguese lore who slips into homes to tidy, meddle, or snatch misbehaving children. The legend sailed to Latin America and the Philippines, where every village still knows him.",
  },
  "frankenstein.png": {
    name: "Frankenstein's Monster", origin: { creature: "Frankenstein's Monster", country: "United Kingdom", flag: "🇬🇧", scope: "country" },
    desc: "Stitched together and shocked to life in Mary Shelley's 1818 novel, the Creature is science's first cautionary tale — born near Geneva in the story, but a wholly British literary monster.",
  },
  "goblin.png": {
    name: "Goblin", origin: { creature: "Goblin", country: "Europe", flag: "🇪🇺", scope: "regional", region: "Europe" },
    desc: "Greedy, grotesque little tricksters from medieval European folklore, goblins haunt caves, mines, and crossroads. Every culture from England to the Black Forest has its own.",
  },
  "kitsune.png": {
    name: "Kitsune", origin: { creature: "Kitsune", country: "Japan", flag: "🇯🇵", scope: "country" },
    desc: "Japan's shape-shifting fox spirit grows a new tail every century — up to nine — gaining wisdom and power with each. A Kitsune can take human form: lover, trickster, or guardian.",
  },
  "la_llorona.png": {
    name: "La Llorona", origin: { creature: "La Llorona", country: "Mexico", flag: "🇲🇽", scope: "regional", region: "LATAM" },
    desc: "The Weeping Woman drowned her children and now roams rivers at night, wailing for them forever. From Mexico through all of Latin America, parents warn: stay home after dark, or she'll take you for her own.",
  },
  "minotaur.png": {
    name: "Minotaur", origin: { creature: "Minotaur", country: "Greece", flag: "🇬🇷", scope: "country" },
    desc: "Half-man, half-bull, the Minotaur prowled the Labyrinth beneath Crete, devouring those sent in as tribute — until Theseus followed a thread to slay him. Greek myth's original maze-monster.",
  },
  "mr_hyde_base.png": {
    name: "Mr Hyde", origin: { creature: "Mr Hyde", country: "United Kingdom", flag: "🇬🇧", scope: "country" },
    desc: "The monstrous alter-ego from Stevenson's 1886 tale, unleashed by a respectable doctor's potion. Born in foggy Victorian London — the original split personality.",
  },
  "nahual.png": {
    name: "Nahual", origin: { creature: "Nahual", country: "Mexico", flag: "🇲🇽", scope: "regional", region: "Mesoamerica" },
    desc: "In Mesoamerican belief a Nahual is a human sorcerer who shape-shifts into an animal — jaguar, owl, or coyote — to roam at night. The tradition runs from ancient Mexico through Central America.",
  },
  "oni.png": {
    name: "Oni", origin: { creature: "Oni", country: "Japan", flag: "🇯🇵", scope: "country" },
    desc: "Towering horned ogres of Japanese folklore, Oni wield iron clubs and guard the gates of hell. Each spring families throw beans to drive them out: 'Oni wa soto!' — demons out!",
  },
  "saci_pere.png": {
    name: "Saci-Pererê", origin: { creature: "Saci-Pererê", country: "Brazil", flag: "🇧🇷", scope: "country" },
    desc: "A one-legged, pipe-smoking trickster in a magic red cap, Saci spins through Brazil as dust-devils, hiding keys and spooking travelers. Catch his cap and he must grant you a wish.",
  },
  "sasquatch.png": {
    name: "Sasquatch", origin: { creature: "Sasquatch (Bigfoot)", country: "Canada & United States", flag: "🇨🇦🇺🇸", scope: "regional", region: "North America" },
    desc: "Bigfoot — a giant ape-man said to roam the Pacific Northwest, leaving huge prints and blurry photos. A staple of Canadian and US wilderness lore for over a century.",
  },
  "tengu.png": {
    name: "Tengu", origin: { creature: "Tengu", country: "Japan", flag: "🇯🇵", scope: "country" },
    desc: "Long-nosed, red-faced mountain spirits of Japan, Tengu are fierce warriors and martial-arts masters who guard sacred peaks. Once feared as demons, now revered as protectors.",
  },
  "vampire.png": {
    name: "Vampire", origin: { creature: "Vampire", country: "Romania", flag: "🇷🇴", scope: "regional", region: "Eastern Europe" },
    desc: "The blood-drinking undead of Transylvanian legend, immortalized as Dracula. Slavic and Romanian folklore gave the world garlic, stakes, and a fear of the night that never dies.",
  },
  "werewolf.png": {
    name: "Werewolf", origin: { creature: "Werewolf (Loup-garou)", country: "France", flag: "🇫🇷", scope: "regional", region: "Europe" },
    desc: "The loup-garou: a cursed soul that transforms into a wolf under the full moon. From France across all of Europe, only silver could end its bloodlust.",
  },
  // Aliens — not from any single nation; global UFO lore (a couple have a hotspot).
  "cosmic_alien.png": {
    name: "Cosmic Alien", origin: { creature: "Cosmic Visitor", country: "Worldwide", flag: "🛸", scope: "global", region: "Global UFO lore" },
    desc: "Not from any one country — the cosmic visitor belongs to the whole sky, reported on every continent since the dawn of the UFO age.",
  },
  "gray_alien.png": {
    name: "Gray Alien", origin: { creature: "The Gray", country: "United States", flag: "🇺🇸", scope: "global", region: "Global UFO lore" },
    desc: "The classic big-eyed 'Gray' — burned into pop culture by the 1947 Roswell incident in New Mexico, now the world's default image of an extraterrestrial.",
  },
  "green_classic_alien.png": {
    name: "Little Green Man", origin: { creature: "Little Green Men", country: "Worldwide", flag: "🛸", scope: "global", region: "Global sci-fi lore" },
    desc: "The 'little green men' of golden-age sci-fi and pulp comics — humanity's playful shorthand for life from another planet. Global, and proudly fictional.",
  },
  "reptilian_alien.png": {
    name: "Reptilian", origin: { creature: "Reptilian", country: "Worldwide", flag: "🛸", scope: "global", region: "Global conspiracy lore" },
    desc: "Shape-shifting reptilian overlords of modern conspiracy lore, said to secretly run the world from the shadows. A 20th-century myth that went planet-wide online.",
  },
  // Tribute base — a meme, not a myth (no origin badge).
  "mcduck-avatar.png": {
    name: "McDuck", desc: "A tribute base — the legendary money duck himself. Not a myth, just a meme.",
  },
};

let patched = 0;
for (const [file, data] of Object.entries(MYTHS)) {
  const key = `base/${file}`;
  const e = map.items[key];
  if (!e) { console.warn(`! missing ${key}`); continue; }
  if (data.name) e.name = data.name;
  if (data.desc) e.desc = data.desc;
  if (data.origin) e.origin = data.origin;
  patched++;
}
writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n");
console.log(`Patched ${patched} base myths → ${OUT}`);
