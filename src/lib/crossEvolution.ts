import type {EvolutionRecord, SpeciesRecord, Stats, TypeChange} from '../types';

export const statOrder: Array<keyof Stats> = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export function clampStat(value: number) {
  return Math.max(1, Math.min(255, Math.trunc(value)));
}

export function calculateBst(stats: Stats) {
  return statOrder.reduce((sum, stat) => sum + stats[stat], 0);
}

export function applyTypeChange(baseTypes: string[], typeChange: TypeChange) {
  const nextTypes = [...baseTypes];

  switch (typeChange.mode) {
    case 'identity':
      return nextTypes;
    case 'replace-primary':
      return [typeChange.to, nextTypes[1]].filter(Boolean);
    case 'replace-secondary':
      if (nextTypes.length === 1) {
        return [nextTypes[0], typeChange.to];
      }
      return [nextTypes[0], typeChange.to];
    case 'replace-both':
      return [typeChange.primary, typeChange.secondary];
    case 'add-secondary':
      if (nextTypes.length === 1) {
        return [nextTypes[0], typeChange.to];
      }
      return [nextTypes[0], typeChange.to];
    case 'replace-primary-add-secondary':
      return [typeChange.primary, typeChange.secondary];
    case 'drop-secondary':
      return [nextTypes[0]];
    case 'collapse-secondary':
      return [typeChange.to];
    default:
      return nextTypes;
  }
}

export function buildCrossEvolution(base: SpeciesRecord, evolution: EvolutionRecord) {
  const baseStats = statOrder.reduce(
    (stats, stat) => {
      stats[stat] = clampStat(base.baseStats[stat] + evolution.statDelta[stat]);
      return stats;
    },
    {} as Stats
  );

  const types = applyTypeChange(base.types, evolution.typeChange);

  return {
    name: `${base.name} x ${evolution.name}`,
    speciesLabel: `${base.name} -> ${evolution.name}`,
    spriteUrl: base.spriteUrl,
    types,
    abilities: evolution.abilities,
    baseStats,
    bst: calculateBst(baseStats),
    base,
    evolution,
  };
}
