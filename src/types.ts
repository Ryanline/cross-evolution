export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export type Stats = Record<StatKey, number>;

export type SpeciesRecord = {
  id: string;
  name: string;
  stage: number;
  num: number;
  types: string[];
  abilities: string[];
  moves: string[];
  baseStats: Stats;
  bst: number;
  prevo: string | null;
  spriteUrl: string;
  searchIndex: string;
};

export type TypeChange =
  | {mode: 'identity'; summary: string; types?: string[]}
  | {mode: 'replace-primary'; from: string; to: string; summary: string}
  | {mode: 'replace-secondary'; from: string; to: string; summary: string}
  | {mode: 'replace-both'; primary: string; secondary: string; summary: string}
  | {mode: 'add-secondary'; to: string; summary: string}
  | {mode: 'replace-primary-add-secondary'; primary: string; secondary: string; summary: string}
  | {mode: 'drop-secondary'; from: string; summary: string}
  | {mode: 'collapse-secondary'; to: string; summary: string};

export type EvolutionRecord = SpeciesRecord & {
  prevoName: string;
  statDelta: Stats;
  deltaBst: number;
  typeChange: TypeChange;
  previewBaseStats: Stats;
};

export type TeamSlot = {
  baseId: string | null;
  evolutionId: string | null;
};

export type GeneratedData = {
  meta: {
    generatedAt: string;
    source: string;
    baseCount: number;
    evolutionCount: number;
  };
  bases: SpeciesRecord[];
  evolutions: EvolutionRecord[];
};
