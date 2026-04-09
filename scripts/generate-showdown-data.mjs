import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Papa from 'papaparse';
import showdownPkg from 'pokemon-showdown';

const {Dex, toID} = showdownPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const inputDir = path.join(repoRoot, 'data-input');
const outputFile = path.join(repoRoot, 'src', 'data', 'showdown-data.generated.json');
const spreadsheetId = '1idc6fA2TOnhQgpwDMzMK_KqmCaW5VVDWPTQmZhu6cGA';

const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function isUsableSpecies(species) {
  return species.exists &&
    !species.battleOnly &&
    !species.cosmeticFormes &&
    species.name &&
    !species.isNonstandard &&
    !species.isTotem;
}

function bst(baseStats) {
  return statKeys.reduce((sum, stat) => sum + (baseStats[stat] ?? 0), 0);
}

function clampStat(value) {
  return Math.max(1, Math.min(255, Math.trunc(value)));
}

function getStage(speciesById, species) {
  let stage = 1;
  let current = species;

  while (current?.prevo) {
    const prevo = speciesById.get(toID(current.prevo));
    if (!prevo) break;
    stage += 1;
    current = prevo;
  }

  return stage;
}

function getSpriteUrl(species) {
  return `https://play.pokemonshowdown.com/sprites/gen5/${species.spriteid}.png`;
}

function toNumber(value) {
  return Number.parseInt(String(value ?? '').trim(), 10) || 0;
}

function buildStatsFromSheetRow(row) {
  return {
    hp: toNumber(row.stat_hp),
    atk: toNumber(row.stat_atk),
    def: toNumber(row.stat_def),
    spa: toNumber(row.stat_spatk),
    spd: toNumber(row.stat_spdef),
    spe: toNumber(row.stat_speed),
  };
}

function getTypesFromSheetRow(row) {
  return [row.type_one, row.type_two].map(value => String(value ?? '').trim()).filter(Boolean);
}

function getAbilitiesFromSheetRow(row) {
  return [row.ability_one, row.ability_two, row.ability_three]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
}

function getMoves(species) {
  const learnsetData = Dex.species.getLearnsetData(species.id);
  const moveIds = Object.keys(learnsetData?.learnset ?? {});
  return moveIds
    .map(id => Dex.moves.get(id))
    .filter(move => move.exists && !move.isNonstandard)
    .map(move => move.name)
    .sort((a, b) => a.localeCompare(b));
}

function buildSearchIndex(species, moves) {
  const tokens = [
    species.name,
    ...species.types,
    ...Object.values(species.abilities).filter(Boolean),
    ...moves,
  ];
  return tokens.join(' | ').toLowerCase();
}

function getTypeChange(prevo, evolution) {
  const prevoTypes = prevo?.types ?? [];
  const evolutionTypes = evolution.types;

  if (!prevoTypes.length) {
    return {
      mode: 'identity',
      types: evolutionTypes,
      summary: evolutionTypes.join('/'),
    };
  }

  if (prevoTypes.length === 1 && evolutionTypes.length === 1) {
    if (prevoTypes[0] !== evolutionTypes[0]) {
      return {
        mode: 'replace-primary',
        from: prevoTypes[0],
        to: evolutionTypes[0],
        summary: `${prevoTypes[0]} -> ${evolutionTypes[0]}`,
      };
    }
    return {mode: 'identity', summary: 'No type change'};
  }

  if (prevoTypes.length === 1 && evolutionTypes.length === 2) {
    if (evolutionTypes[0] === prevoTypes[0]) {
      return {
        mode: 'add-secondary',
        to: evolutionTypes[1],
        summary: `+ ${evolutionTypes[1]}`,
      };
    }

    return {
      mode: 'replace-primary-add-secondary',
      primary: evolutionTypes[0],
      secondary: evolutionTypes[1],
      summary: `${prevoTypes[0]} -> ${evolutionTypes[0]}/${evolutionTypes[1]}`,
    };
  }

  if (prevoTypes.length === 2 && evolutionTypes.length === 1) {
    if (evolutionTypes[0] === prevoTypes[0]) {
      return {
        mode: 'drop-secondary',
        from: prevoTypes[1],
        summary: `- ${prevoTypes[1]}`,
      };
    }

    if (evolutionTypes[0] === prevoTypes[1]) {
      return {
        mode: 'collapse-secondary',
        to: evolutionTypes[0],
        summary: `${prevoTypes.join('/')} -> ${evolutionTypes[0]}`,
      };
    }

    return {
      mode: 'replace-primary',
      from: prevoTypes[0],
      to: evolutionTypes[0],
      summary: `${prevoTypes.join('/')} -> ${evolutionTypes[0]}`,
    };
  }

  if (prevoTypes.length === 2 && evolutionTypes.length === 2) {
    const primaryChanged = prevoTypes[0] !== evolutionTypes[0];
    const secondaryChanged = prevoTypes[1] !== evolutionTypes[1];

    if (primaryChanged && secondaryChanged) {
      return {
        mode: 'replace-both',
        primary: evolutionTypes[0],
        secondary: evolutionTypes[1],
        summary: `${prevoTypes.join('/')} -> ${evolutionTypes.join('/')}`,
      };
    }

    if (primaryChanged) {
      return {
        mode: 'replace-primary',
        from: prevoTypes[0],
        to: evolutionTypes[0],
        summary: `${prevoTypes[0]} -> ${evolutionTypes[0]}`,
      };
    }

    if (secondaryChanged) {
      return {
        mode: 'replace-secondary',
        from: prevoTypes[1],
        to: evolutionTypes[1],
        summary: `${prevoTypes[1]} -> ${evolutionTypes[1]}`,
      };
    }
  }

  return {mode: 'identity', summary: 'No type change'};
}

function buildSpeciesRecord(species, speciesById, overrides = {}) {
  const moves = getMoves(species);
  const abilities = overrides.abilities ?? Object.values(species.abilities).filter(Boolean);
  const types = overrides.types ?? species.types;
  const baseStats = overrides.baseStats ?? species.baseStats;
  const stage = overrides.stage ?? getStage(speciesById, species);

  return {
    id: species.id,
    name: species.name,
    stage,
    num: species.num,
    types,
    abilities,
    moves,
    baseStats,
    bst: overrides.bst ?? bst(baseStats),
    prevo: species.prevo ? toID(species.prevo) : null,
    spriteUrl: getSpriteUrl(species),
    searchIndex: buildSearchIndex({...species, types, abilities: Object.fromEntries(abilities.map((ability, index) => [index, ability]))}, moves),
  };
}

async function readSheetIds(filename, allSpecies) {
  try {
    const raw = await fs.readFile(path.join(inputDir, filename), 'utf8');
    const parsed = Papa.parse(raw, {header: true, skipEmptyLines: true});
    const rows = parsed.data.filter(Boolean);
    if (!rows.length) return null;

    const ids = new Set();
    for (const row of rows) {
      const values = Object.values(row)
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(Boolean);

      for (const value of values) {
        const exact = allSpecies.get(toID(value));
        if (exact) {
          ids.add(exact.id);
          break;
        }
      }
    }

    return ids.size ? ids : null;
  } catch {
    return null;
  }
}

async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch sheet ${sheetName}: ${response.status}`);
  const raw = await response.text();
  const parsed = Papa.parse(raw, {header: true, skipEmptyLines: true});
  return parsed.data.filter(Boolean);
}

function buildEvolutionRecord(species, allSpecies, row) {
  const prevo = species.prevo ? allSpecies.get(toID(species.prevo)) : null;
  if (!prevo) return null;

  const deltas = buildStatsFromSheetRow(row);
  const types = getTypesFromSheetRow(row);
  const abilities = getAbilitiesFromSheetRow(row);

  return {
    ...buildSpeciesRecord(species, allSpecies, {
      stage: toNumber(row.stage),
      types,
      abilities,
      baseStats: species.baseStats,
      bst: toNumber(row.stat_bst),
    }),
    prevoName: prevo.name,
    statDelta: deltas,
    deltaBst: toNumber(row.stat_bst),
    typeChange: getTypeChange(prevo, species),
    previewBaseStats: Object.fromEntries(
      statKeys.map(stat => [stat, clampStat(prevo.baseStats[stat] + deltas[stat])])
    ),
  };
}

await fs.mkdir(path.dirname(outputFile), {recursive: true});

const allUsableSpecies = Dex.species.all().filter(isUsableSpecies);
const speciesById = new Map(allUsableSpecies.map(species => [species.id, species]));
const liveBases = await fetchSheet('bases');
const liveEvolutions = await fetchSheet('evolutions');

const bases = liveBases
  .map(row => {
    const species = Dex.species.get(String(row.name ?? '').trim());
    if (!species.exists) return null;

    return buildSpeciesRecord(species, speciesById, {
      stage: toNumber(row.stage),
      types: getTypesFromSheetRow(row),
      baseStats: buildStatsFromSheetRow(row),
      bst: toNumber(row.stat_bst),
    });
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name));

const evolutions = liveEvolutions
  .map(row => {
    const species = Dex.species.get(String(row.name ?? '').trim());
    if (!species.exists) return null;
    return buildEvolutionRecord(species, speciesById, row);
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name));

const meta = {
  generatedAt: new Date().toISOString(),
  source: 'google-sheet+showdown',
  baseCount: bases.length,
  evolutionCount: evolutions.length,
};

await fs.writeFile(outputFile, JSON.stringify({meta, bases, evolutions}, null, 2));

console.log(`Generated ${bases.length} bases and ${evolutions.length} evolutions to ${outputFile}`);
