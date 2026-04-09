import {useDeferredValue, useEffect, useRef, useState, type KeyboardEvent} from 'react';
import data from './data/showdown-data.generated.json';
import {buildCrossEvolution, statOrder} from './lib/crossEvolution';
import type {EvolutionRecord, GeneratedData, SpeciesRecord, Stats, TeamSlot} from './types';

const dataset = data as GeneratedData;
const storageKey = 'cross-evolution-team';
const baseUrl = import.meta.env.BASE_URL;

function publicAsset(path: string) {
  return `${baseUrl}${path.replace(/^\/+/, '')}`;
}

const emptySlot = (): TeamSlot => ({baseId: null, evolutionId: null});

const statLabels: Record<(typeof statOrder)[number], string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

const typeMap = new Map(
  Array.from(new Set(dataset.bases.flatMap(candidate => candidate.types)))
    .sort((a, b) => a.localeCompare(b))
    .map(type => [type.toLowerCase(), type])
);

const abilityMap = new Map(
  Array.from(new Set([...dataset.bases, ...dataset.evolutions].flatMap(candidate => candidate.abilities)))
    .sort((a, b) => a.localeCompare(b))
    .map(ability => [ability.toLowerCase(), ability])
);

const moveMap = new Map(
  Array.from(new Set([...dataset.bases, ...dataset.evolutions].flatMap(candidate => candidate.moves)))
    .sort((a, b) => a.localeCompare(b))
    .map(move => [move.toLowerCase(), move])
);

const speciesMap = new Map(
  Array.from(new Set([...dataset.bases, ...dataset.evolutions].map(candidate => candidate.name)))
    .sort((a, b) => a.localeCompare(b))
    .map(name => [name.toLowerCase(), name])
);

function getPhraseTokens(term: string) {
  return term
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

type FilterKind = 'Type' | 'Ability' | 'Move' | 'Pokemon' | 'Search';

function classifyFilter(term: string): {kind: FilterKind; label: string} {
  const key = term.toLowerCase();

  if (typeMap.has(key)) {
    return {kind: 'Type', label: typeMap.get(key) ?? term};
  }

  if (abilityMap.has(key)) {
    return {kind: 'Ability', label: abilityMap.get(key) ?? term};
  }

  if (moveMap.has(key)) {
    return {kind: 'Move', label: moveMap.get(key) ?? term};
  }

  if (speciesMap.has(key)) {
    return {kind: 'Pokemon', label: speciesMap.get(key) ?? term};
  }

  return {kind: 'Search', label: term};
}

function getSuggestionMatches(term: string, source: Map<string, string>, kind: FilterKind) {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return [];

  return Array.from(source.entries())
    .filter(([key]) => key.startsWith(normalized))
    .slice(0, 6)
    .map(([, label]) => ({kind, label}));
}

function getSuggestions(term: string) {
  if (!term.trim()) return [];

  const suggestions = [
    ...getSuggestionMatches(term, speciesMap, 'Pokemon'),
    ...getSuggestionMatches(term, typeMap, 'Type'),
    ...getSuggestionMatches(term, abilityMap, 'Ability'),
    ...getSuggestionMatches(term, moveMap, 'Move'),
  ];

  const seen = new Set<string>();
  return suggestions.filter(suggestion => {
    const key = `${suggestion.kind}:${suggestion.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function matchesLooseText(value: string, term: string) {
  const normalized = value.toLowerCase();
  return getPhraseTokens(term).every(token => normalized.includes(token));
}

function matchesDynamicPrefix(candidate: SpeciesRecord | EvolutionRecord, term: string) {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return true;

  const fields = [
    candidate.name,
    ...candidate.types,
    ...candidate.abilities,
    ...candidate.moves,
  ];

  return fields.some(field => field.toLowerCase().startsWith(normalized));
}

function matchesFilter(candidate: SpeciesRecord | EvolutionRecord, term: string) {
  const filter = classifyFilter(term);

  switch (filter.kind) {
    case 'Type':
      return candidate.types.some(type => type.toLowerCase() === filter.label.toLowerCase());
    case 'Ability':
      return candidate.abilities.some(ability => ability.toLowerCase() === filter.label.toLowerCase());
    case 'Move':
      return candidate.moves.some(move => move.toLowerCase() === filter.label.toLowerCase());
    case 'Pokemon':
      return candidate.name.toLowerCase() === filter.label.toLowerCase();
    default:
      return matchesLooseText(candidate.searchIndex, term);
  }
}

function matchesQuery(candidate: SpeciesRecord | EvolutionRecord, selectedFilters: string[], liveInput: string) {
  if (!selectedFilters.length && !liveInput.trim()) return true;

  const liveTerm = liveInput.trim();
  if (!selectedFilters.length && liveTerm) {
    return matchesDynamicPrefix(candidate, liveTerm);
  }

  return selectedFilters.every(filter => matchesFilter(candidate, filter)) &&
    (!liveTerm || matchesDynamicPrefix(candidate, liveTerm));
}

function buildExportText(team: TeamSlot[]) {
  const lines = team
    .map((slot, index) => {
      if (!slot.baseId || !slot.evolutionId) return null;

      const base = dataset.bases.find(candidate => candidate.id === slot.baseId);
      const evolution = dataset.evolutions.find(candidate => candidate.id === slot.evolutionId);
      if (!base || !evolution) return null;

      return `Slot ${index + 1}: /ce ${base.name}, ${evolution.name}`;
    })
    .filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

function renderWaveLabel(text: string) {
  return Array.from(text).map((character, index) => (
    <span
      key={`${character}-${index}`}
      className="export-letter"
      style={{['--letter-index' as string]: index}}
    >
      {character === ' ' ? '\u00A0' : character}
    </span>
  ));
}

function TypeBadge({type}: {type: string}) {
  return <span className={`type-badge type-${type.toLowerCase()}`}>{type}</span>;
}

function normalizeTypeSlots(types: string[]) {
  const primary = types[0] ?? null;
  const secondaryCandidate = types.find((type, index) => {
    if (index === 0 || !primary) return false;
    return type.toLowerCase() !== primary.toLowerCase();
  }) ?? null;

  return {primary, secondary: secondaryCandidate};
}

function TypeSlotFrames({
  types,
  className = '',
}: {
  types: string[];
  className?: string;
}) {
  const slots = normalizeTypeSlots(types);

  return (
    <div className={['type-shift-grid', className].filter(Boolean).join(' ')}>
      {slots.primary ? (
        <span className="type-shift-slot">
          <TypeBadge type={slots.primary} />
        </span>
      ) : (
        <span className="type-shift-slot empty" />
      )}
      {slots.secondary ? (
        <span className="type-shift-slot">
          <TypeBadge type={slots.secondary} />
        </span>
      ) : (
        <span className="type-shift-slot empty" />
      )}
    </div>
  );
}

function TypeChangeFrames({
  typeChange,
  className = '',
}: {
  typeChange: EvolutionRecord['typeChange'];
  className?: string;
}) {
  const slots = getTypeShiftSlots(typeChange);

  return (
    <div className={['type-shift-grid', className].filter(Boolean).join(' ')}>
      {slots.primary ? (
        <span className="type-shift-slot">
          <TypeBadge type={slots.primary} />
        </span>
      ) : (
        <span className="type-shift-slot empty" />
      )}
      {slots.secondary ? (
        <span className="type-shift-slot">
          <TypeBadge type={slots.secondary} />
        </span>
      ) : (
        <span className="type-shift-slot empty" />
      )}
    </div>
  );
}

function isEvolutionRecord(candidate: SpeciesRecord | EvolutionRecord): candidate is EvolutionRecord {
  return 'typeChange' in candidate;
}

function formatStage(stage: number) {
  return `${stage}`;
}

function Sprite({name, spriteUrl, className = ''}: {name: string; spriteUrl: string; className?: string}) {
  const classes = ['pokemon-sprite', className].filter(Boolean).join(' ');
  return (
    <span className="sprite-frame" aria-hidden="true">
      <img className={classes} src={spriteUrl} alt={name} loading="lazy" />
    </span>
  );
}

function LayeredSprite({
  baseName,
  baseSpriteUrl,
  evolutionName,
  evolutionSpriteUrl,
}: {
  baseName: string;
  baseSpriteUrl: string;
  evolutionName: string;
  evolutionSpriteUrl: string;
}) {
  return (
    <div className="layered-sprite sprite-frame" aria-hidden="true">
      <img className="pokemon-sprite sprite-back" src={evolutionSpriteUrl} alt={evolutionName} loading="lazy" />
      <img className="pokemon-sprite sprite-front" src={baseSpriteUrl} alt={baseName} loading="lazy" />
    </div>
  );
}

function getTypeShiftSlots(typeChange: EvolutionRecord['typeChange']) {
  switch (typeChange.mode) {
    case 'identity':
      return {primary: null, secondary: null};
    case 'replace-primary':
      return {primary: typeChange.to, secondary: null};
    case 'replace-secondary':
      return {primary: null, secondary: typeChange.to};
    case 'replace-both':
      return {primary: typeChange.primary, secondary: typeChange.secondary};
    case 'add-secondary':
      return {primary: null, secondary: typeChange.to};
    case 'replace-primary-add-secondary':
      return {primary: typeChange.primary, secondary: typeChange.secondary};
    case 'drop-secondary':
      return {primary: null, secondary: null};
    case 'collapse-secondary':
      return {primary: typeChange.to, secondary: null};
    default:
      return {primary: null, secondary: null};
  }
}

function StatGrid({
  stats,
  compareStats,
  deltaMode = false,
}: {
  stats: Stats;
  compareStats?: Stats;
  deltaMode?: boolean;
}) {
  return (
    <div className="stat-grid">
      {statOrder.map(stat => {
        const current = stats[stat];
        const compare = compareStats?.[stat];
        const delta = compare === undefined ? undefined : current - compare;

        return (
          <div key={stat} className="stat-cell">
            <span className="stat-inline-label">{statLabels[stat]}</span>
            <span className="stat-inline-value">
              {deltaMode && current > 0 ? '+' : ''}
              {current}
            </span>
            {delta !== undefined ? (
              <span className={`stat-inline-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
                {delta > 0 ? `+${delta}` : delta}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TeamSlotCard({
  slot,
  index,
  isActive,
  onClick,
}: {
  slot: TeamSlot;
  index: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const base = slot.baseId ? dataset.bases.find(candidate => candidate.id === slot.baseId) : null;
  const evolution = slot.evolutionId ? dataset.evolutions.find(candidate => candidate.id === slot.evolutionId) : null;
  const preview = base && evolution ? buildCrossEvolution(base, evolution) : null;
  const partial = base ?? evolution;

  return (
    <button type="button" className={`team-slot ${isActive ? 'active' : ''}`} onClick={onClick}>
      {preview ? (
        <>
          <TypeSlotFrames types={preview.types} className="top-slot-types" />
          <div className="slot-header">
            <LayeredSprite
              baseName={preview.base.name}
              baseSpriteUrl={preview.base.spriteUrl}
              evolutionName={preview.evolution.name}
              evolutionSpriteUrl={preview.evolution.spriteUrl}
            />
            <div>
              <strong>{preview.base.name}</strong>
              <span className="slot-subtitle">x {preview.evolution.name}</span>
            </div>
          </div>
        </>
      ) : partial ? (
        <>
          {isEvolutionRecord(partial) ? (
            <TypeChangeFrames typeChange={partial.typeChange} className="top-slot-types" />
          ) : (
            <TypeSlotFrames types={partial.types} className="top-slot-types" />
          )}
          <div className="slot-header">
            <Sprite name={partial.name} spriteUrl={partial.spriteUrl} />
            <div>
              <strong>{partial.name}</strong>
              <span className="slot-subtitle">{base ? 'Base selected' : 'Evolution selected'}</span>
            </div>
          </div>
        </>
      ) : (
        <span className="slot-placeholder centered">Slot {index + 1}</span>
      )}
    </button>
  );
}

function CandidateRow({
  candidate,
  selected,
  onClick,
  mode,
  selectedEvolution,
}: {
  candidate: SpeciesRecord | EvolutionRecord;
  selected: boolean;
  onClick: () => void;
  mode: 'base' | 'evolution';
  selectedEvolution?: EvolutionRecord | null;
}) {
  const isEvolution = mode === 'evolution';
  const stageLabel = formatStage(candidate.stage);
  const basePreview = !isEvolution && selectedEvolution ? buildCrossEvolution(candidate as SpeciesRecord, selectedEvolution) : null;
  const statSource = isEvolution
    ? (candidate as EvolutionRecord).statDelta
    : (basePreview?.baseStats ?? candidate.baseStats);
  const typeSource = !isEvolution && basePreview ? basePreview.types : candidate.types;
  const bstLabel = isEvolution
    ? `BST ${candidate.bst > 0 ? '+' : ''}${(candidate as EvolutionRecord).deltaBst}`
    : `BST ${basePreview?.bst ?? candidate.bst}`;

  return (
    <button type="button" className={`candidate-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <Sprite name={candidate.name} spriteUrl={candidate.spriteUrl} />
      <div className="candidate-copy">
        <strong>{candidate.name} ({stageLabel})</strong>
        {isEvolution ? (
          <span className="candidate-abilities-line">{candidate.abilities.join(' / ')}</span>
        ) : null}
        <div className="candidate-stats-line">
          {statOrder.map(stat => (
            <span key={`${candidate.id}-${stat}`} className="candidate-stat-pill">
              {statLabels[stat]} {isEvolution && statSource[stat] > 0 ? '+' : ''}
              {statSource[stat]}
            </span>
          ))}
        </div>
      </div>
      <div className="candidate-meta">
        <span>{bstLabel}</span>
        {isEvolution ? (
          <TypeChangeFrames typeChange={(candidate as EvolutionRecord).typeChange} className="compact" />
        ) : (
          <TypeSlotFrames types={typeSource} className="compact" />
        )}
      </div>
    </button>
  );
}

function PanelCard({
  title,
  subtitle,
  species,
  compareStats,
  deltaMode = false,
  onClear,
  hideAbilities = false,
  typeChange,
}: {
  title: string;
  subtitle: string;
  species: {
    name: string;
    spriteUrl: string;
    types: string[];
    abilities: string[];
    baseStats: SpeciesRecord['baseStats'];
    bst: number;
    baseSpriteUrl?: string;
    evolutionSpriteUrl?: string;
    evolutionName?: string;
  } | null;
  compareStats?: SpeciesRecord['baseStats'];
  deltaMode?: boolean;
  onClear?: (() => void) | null;
  hideAbilities?: boolean;
  typeChange?: EvolutionRecord['typeChange'];
}) {
  if (!species) {
    return (
      <section className="panel-card empty">
        <header>
          <span className="eyebrow">{title}</span>
          <h2>{subtitle}</h2>
        </header>
      </section>
    );
  }

  return (
      <section className="panel-card">
      {onClear ? (
        <button type="button" className="panel-clear" onClick={onClear} aria-label={`Clear ${title.toLowerCase()}`}>
          <img src={publicAsset('x.svg')} alt="" className="x-icon" />
        </button>
      ) : null}
      <header className="panel-card-header">
        <div>
          <span className="eyebrow">{title}</span>
          <h2>{species.name}</h2>
        </div>
        {species.baseSpriteUrl && species.evolutionSpriteUrl && species.evolutionName ? (
          <LayeredSprite
            baseName={species.name}
            baseSpriteUrl={species.baseSpriteUrl}
            evolutionName={species.evolutionName}
            evolutionSpriteUrl={species.evolutionSpriteUrl}
          />
        ) : (
          <Sprite name={species.name} spriteUrl={species.spriteUrl} />
        )}
      </header>
      <div className="panel-meta-row">
        {typeChange ? (
          <TypeChangeFrames typeChange={typeChange} className="panel-type-frames" />
        ) : (
          <TypeSlotFrames types={species.types} className="panel-type-frames" />
        )}
        {!hideAbilities ? <p className="ability-line inline">{species.abilities.join(' / ')}</p> : null}
      </div>
      <StatGrid stats={species.baseStats} compareStats={compareStats} deltaMode={deltaMode} />
    </section>
  );
}

export default function App() {
  const selectionSoundRef = useRef<HTMLAudioElement | null>(null);
  const exportHoverSoundRef = useRef<HTMLAudioElement | null>(null);
  const [team, setTeam] = useState<TeamSlot[]>(() => {
    if (typeof window === 'undefined') {
      return Array.from({length: 6}, emptySlot);
    }

    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return Array.from({length: 6}, emptySlot);

    try {
      const parsed = JSON.parse(saved) as TeamSlot[];
      if (Array.isArray(parsed) && parsed.length === 6) {
        return parsed.map(slot => ({
          baseId: slot.baseId ?? null,
          evolutionId: slot.evolutionId ?? null,
        }));
      }
    } catch {
      return Array.from({length: 6}, emptySlot);
    }

    return Array.from({length: 6}, emptySlot);
  });
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [baseInput, setBaseInput] = useState('');
  const [evolutionInput, setEvolutionInput] = useState('');
  const [baseFilters, setBaseFilters] = useState<string[]>([]);
  const [evolutionFilters, setEvolutionFilters] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [exportBurstKey, setExportBurstKey] = useState(0);
  const [soundMuted, setSoundMuted] = useState(false);

  const deferredBaseInput = useDeferredValue(baseInput);
  const deferredEvolutionInput = useDeferredValue(evolutionInput);

  const selectedSlot = team[selectedSlotIndex];
  const selectedBase = selectedSlot.baseId
    ? dataset.bases.find(candidate => candidate.id === selectedSlot.baseId) ?? null
    : null;
  const selectedEvolution = selectedSlot.evolutionId
    ? dataset.evolutions.find(candidate => candidate.id === selectedSlot.evolutionId) ?? null
    : null;
  const currentPreview = selectedBase && selectedEvolution
    ? {
        ...buildCrossEvolution(selectedBase, selectedEvolution),
        baseSpriteUrl: selectedBase.spriteUrl,
        evolutionSpriteUrl: selectedEvolution.spriteUrl,
        evolutionName: selectedEvolution.name,
      }
    : null;

  const allowedBaseStage = selectedEvolution ? selectedEvolution.stage - 1 : null;
  const allowedEvolutionStage = selectedBase ? selectedBase.stage + 1 : null;

  const filteredBases = dataset.bases.filter(candidate =>
    matchesQuery(candidate, baseFilters, deferredBaseInput) &&
    (!allowedBaseStage || candidate.stage === allowedBaseStage)
  );
  const filteredEvolutions = dataset.evolutions.filter(candidate =>
    matchesQuery(candidate, evolutionFilters, deferredEvolutionInput) &&
    (!allowedEvolutionStage || candidate.stage === allowedEvolutionStage)
  );
  const baseFilterChips = baseFilters.map(classifyFilter);
  const evolutionFilterChips = evolutionFilters.map(classifyFilter);
  const baseSuggestions = getSuggestions(baseInput).filter(
    suggestion => !baseFilters.some(filter => filter.toLowerCase() === suggestion.label.toLowerCase())
  );
  const evolutionSuggestions = getSuggestions(evolutionInput).filter(
    suggestion => !evolutionFilters.some(filter => filter.toLowerCase() === suggestion.label.toLowerCase())
  );

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(team));
  }, [team]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    selectionSoundRef.current = new Audio(publicAsset('scroll-sound.wav'));
    selectionSoundRef.current.preload = 'auto';
    exportHoverSoundRef.current = new Audio(publicAsset('hover.mp3'));
    exportHoverSoundRef.current.preload = 'auto';
    exportHoverSoundRef.current.volume = 0.4;

    return () => {
      selectionSoundRef.current = null;
      exportHoverSoundRef.current = null;
    };
  }, []);

  function updateSlot(patch: Partial<TeamSlot>) {
    setTeam(current =>
      current.map((slot, index) => (index === selectedSlotIndex ? {...slot, ...patch} : slot))
    );
  }

  function playSelectionSound() {
    if (soundMuted) return;
    const sound = selectionSoundRef.current;
    if (!sound) return;

    sound.currentTime = 0;
    void sound.play().catch(() => {});
  }

  function playExportHoverSound() {
    if (soundMuted) return;
    const sound = exportHoverSoundRef.current;
    if (!sound) return;

    sound.volume = 0.4;
    sound.currentTime = 0;
    void sound.play().catch(() => {});
  }

  function stopExportHoverSound() {
    const sound = exportHoverSoundRef.current;
    if (!sound) return;

    sound.pause();
    sound.currentTime = 0;
  }

  function addFilter(side: 'base' | 'evolution', label: string) {
    if (side === 'base') {
      setBaseFilters(current => current.some(filter => filter.toLowerCase() === label.toLowerCase()) ? current : [...current, label]);
      setBaseInput('');
      return;
    }

    setEvolutionFilters(current => current.some(filter => filter.toLowerCase() === label.toLowerCase()) ? current : [...current, label]);
    setEvolutionInput('');
  }

  function removeFilter(side: 'base' | 'evolution', label: string) {
    if (side === 'base') {
      setBaseFilters(current => current.filter(filter => filter !== label));
      return;
    }

    setEvolutionFilters(current => current.filter(filter => filter !== label));
  }

  function handleSearchKeyDown(side: 'base' | 'evolution', event: KeyboardEvent<HTMLInputElement>) {
    const value = side === 'base' ? baseInput : evolutionInput;
    const suggestions = side === 'base' ? baseSuggestions : evolutionSuggestions;
    const currentFilters = side === 'base' ? baseFilters : evolutionFilters;

    if (event.key === 'Backspace' && !value && currentFilters.length) {
      removeFilter(side, currentFilters[currentFilters.length - 1]);
      return;
    }

    if ((event.key === 'Enter' || event.key === ',') && value.trim()) {
      event.preventDefault();
      const firstSuggestion = suggestions[0];
      addFilter(side, firstSuggestion?.label ?? value.trim());
    }
  }

  async function exportTeam() {
    const exportText = buildExportText(team);
    if (!exportText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(exportText);
      setCopyStatus('copied');
      setExportBurstKey(current => current + 1);
    } catch {
      setCopyStatus('failed');
      window.prompt('Copy this Cross Evolution export:', exportText);
    }

    window.setTimeout(() => setCopyStatus('idle'), 1800);
  }

  const evolverBonusCard = selectedEvolution
    ? {
        name: `${selectedEvolution.name} bonuses`,
        spriteUrl: selectedEvolution.spriteUrl,
        types: selectedEvolution.types,
        abilities: selectedEvolution.abilities,
        baseStats: selectedEvolution.statDelta,
        bst: selectedEvolution.deltaBst,
      }
    : null;

  return (
    <main className="app-shell">
      <section className="team-bar">
        {team.map((slot, index) => (
          <TeamSlotCard
            key={`slot-${index}`}
            slot={slot}
            index={index}
            isActive={selectedSlotIndex === index}
            onClick={() => setSelectedSlotIndex(index)}
          />
        ))}
      </section>

      <section className="preview-toolbar">
        <div className="toolbar-copy">
          <span className="eyebrow">Editing Slot {selectedSlotIndex + 1}</span>
          <h2>
            {selectedBase && selectedEvolution
              ? `${selectedBase.name} / ${selectedEvolution.name}`
              : 'Choose a base and an evolution'}
          </h2>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className={`sound-toggle ${soundMuted ? 'muted' : ''}`}
            onClick={() => {
              setSoundMuted(current => {
                const next = !current;
                if (next) {
                  stopExportHoverSound();
                }
                return next;
              });
            }}
            aria-label={soundMuted ? 'Unmute sounds' : 'Mute sounds'}
            title={soundMuted ? 'Unmute sounds' : 'Mute sounds'}
          >
            <span className="sound-toggle-icon" aria-hidden="true">
              {soundMuted ? 'Volume Is Off' : 'Volume Is On'}
            </span>
          </button>
          <div className={`export-button-shell ${copyStatus}`}>
            <button
              type="button"
              className={`export-button ${copyStatus}`}
              onClick={exportTeam}
              onMouseEnter={playExportHoverSound}
              onMouseLeave={stopExportHoverSound}
              aria-live="polite"
            >
              <span className="export-button-sheen" />
              <span className="export-button-spectrum" />
              <span className="export-button-ripple export-button-ripple-a" />
              <span className="export-button-ripple export-button-ripple-b" />
              <span className="export-button-label">
                {renderWaveLabel(copyStatus === 'copied' ? 'Copied!' : copyStatus === 'failed' ? 'Manual Copy' : 'Export')}
              </span>
              <span key={exportBurstKey} className={`export-fireworks ${copyStatus === 'copied' ? 'active' : ''}`} aria-hidden="true">
                {Array.from({length: 14}, (_, index) => (
                  <span key={`spark-${index}`} className={`firework firework-${index + 1}`} />
                ))}
              </span>
            </button>
            <span className="export-hover-sparks" aria-hidden="true">
              {Array.from({length: 16}, (_, index) => (
                <span key={`hover-spark-${index}`} className={`hover-spark hover-spark-${index + 1}`} />
              ))}
            </span>
          </div>
        </div>
      </section>

      <section className="preview-grid">
        <PanelCard
          title="Base"
          subtitle=""
          species={selectedBase}
          onClear={selectedBase ? () => updateSlot({baseId: null}) : null}
          hideAbilities
        />
        <PanelCard
          title="Evolution"
          subtitle=""
          species={evolverBonusCard}
          deltaMode
          onClear={selectedEvolution ? () => updateSlot({evolutionId: null}) : null}
          typeChange={selectedEvolution?.typeChange}
        />
        <PanelCard
          title="Result"
          subtitle={currentPreview ? currentPreview.speciesLabel : ''}
          species={currentPreview}
          compareStats={selectedBase?.baseStats}
          onClear={null}
        />
      </section>

      <section className="selector-grid">
        <div className="selector-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Bases</span>
            </div>
            <span>{filteredBases.length} results</span>
          </div>
          <div className="search-stack">
            <div className="search-wrap">
              <input
                className="search-input"
                type="text"
                value={baseInput}
                onChange={event => setBaseInput(event.target.value)}
                onKeyDown={event => handleSearchKeyDown('base', event)}
                placeholder="Search"
              />
              {baseInput ? (
                <button type="button" className="search-clear" onClick={() => setBaseInput('')} aria-label="Clear base search">
                  <img src={publicAsset('x.svg')} alt="" className="x-icon" />
                </button>
              ) : null}
            </div>
            {baseSuggestions.length ? (
              <div className="search-suggestions">
                {baseSuggestions.map(suggestion => (
                  <button
                    key={`base-suggestion-${suggestion.kind}-${suggestion.label}`}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => addFilter('base', suggestion.label)}
                  >
                    <strong>{suggestion.kind}</strong>
                    {suggestion.label}
                  </button>
                ))}
              </div>
            ) : null}
            {baseFilterChips.length ? (
              <div className="filter-pills">
                {baseFilterChips.map(filter => (
                  <button
                    key={`base-${filter.kind}-${filter.label}`}
                    type="button"
                    className="filter-pill"
                    onClick={() => removeFilter('base', filter.label)}
                  >
                    <strong>{filter.kind}</strong>
                    {filter.label}
                    <img src={publicAsset('x.svg')} alt="" className="x-icon filter-pill-x" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="candidate-list">
            {filteredBases.map(candidate => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                selected={candidate.id === selectedBase?.id}
                onClick={() => {
                  playSelectionSound();
                  updateSlot({baseId: candidate.id});
                }}
                mode="base"
                selectedEvolution={selectedEvolution}
              />
            ))}
          </div>
        </div>

        <div className="selector-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Evolution</span>
            </div>
            <span>{filteredEvolutions.length} results</span>
          </div>
          <div className="search-stack">
            <div className="search-wrap">
              <input
                className="search-input"
                type="text"
                value={evolutionInput}
                onChange={event => setEvolutionInput(event.target.value)}
                onKeyDown={event => handleSearchKeyDown('evolution', event)}
                placeholder="Search"
              />
              {evolutionInput ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setEvolutionInput('')}
                  aria-label="Clear evolution search"
                >
                  <img src={publicAsset('x.svg')} alt="" className="x-icon" />
                </button>
              ) : null}
            </div>
            {evolutionSuggestions.length ? (
              <div className="search-suggestions">
                {evolutionSuggestions.map(suggestion => (
                  <button
                    key={`evo-suggestion-${suggestion.kind}-${suggestion.label}`}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => addFilter('evolution', suggestion.label)}
                  >
                    <strong>{suggestion.kind}</strong>
                    {suggestion.label}
                  </button>
                ))}
              </div>
            ) : null}
            {evolutionFilterChips.length ? (
              <div className="filter-pills">
                {evolutionFilterChips.map(filter => (
                  <button
                    key={`evo-${filter.kind}-${filter.label}`}
                    type="button"
                    className="filter-pill"
                    onClick={() => removeFilter('evolution', filter.label)}
                  >
                    <strong>{filter.kind}</strong>
                    {filter.label}
                    <img src={publicAsset('x.svg')} alt="" className="x-icon filter-pill-x" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="candidate-list">
            {filteredEvolutions.map(candidate => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                selected={candidate.id === selectedEvolution?.id}
                onClick={() => {
                  playSelectionSound();
                  updateSlot({evolutionId: candidate.id});
                }}
                mode="evolution"
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
