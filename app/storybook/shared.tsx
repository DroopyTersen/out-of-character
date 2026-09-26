import { characters, characterById, type Character } from '../../core/characters';
import comparison from '../../ai/evals/comparison.json';

export const savedComparison = { ...comparison, rows: comparison.rows.filter(row => !row.expected || characterById[row.expected]) };
export const defaultCharacter = characters[4]!;
export const sampleScenes = [
  'Walk the team through your architecture diagram.',
  'Explain your proposed system design to a project manager.',
];
export const characterFor = (id: string): Character => characterById[id] ?? defaultCharacter;
export function CharacterPicker({ value, onChange, disabled = false }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return <label>Character<select aria-label="Character" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{characters.map(character => <option value={character.id} key={character.id}>{character.name}</option>)}</select></label>;
}
export function savedReadings(id = 'architecture', mode = 'noul'): Record<string, number> {
  return savedComparison.rows.find(row => row.id === id && row.mode === mode)?.readings ?? {};
}
