import { useEffect, useState } from 'react';
import { characters, type Character } from '../../core/characters';
import { characterGrounding } from '../../core/character-grounding';
import { DrawScreen, type DrawScreenProps } from '../ui/draw-screen';
import { CharacterReel, Lever } from '../ui/character-reel';
import { CharacterArt } from '../ui/character-art';
import { CharacterPicker, characterFor, defaultCharacter, sampleScenes } from './shared';

export function DrawStory() {
  const [id, setId] = useState(defaultCharacter.id as string);
  const [character, setCharacter] = useState<Character | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinNumber, setSpinNumber] = useState(0);
  const [timing, setTiming] = useState('fast');
  const [scene, setScene] = useState<DrawScreenProps['scene']>({ status: 'empty', text: '' });
  const [connecting, setConnecting] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  useEffect(() => {
    if (!spinNumber || timing !== 'slow') return;
    const timer = setTimeout(() => setScene({ status: 'ready', text: sampleScenes[sceneIndex % sampleScenes.length]! }), 7500);
    return () => clearTimeout(timer);
  }, [spinNumber, timing, sceneIndex]);
  const spin = () => {
    setCharacter(characterFor(id)); setSpinning(true); setConnecting(false); setSpinNumber(number => number + 1);
    setScene(timing === 'fast' ? { status: 'ready', text: sampleScenes[sceneIndex % sampleScenes.length]! } : timing === 'failed' ? { status: 'error', text: '', error: 'The scene service could not respond. Try again.' } : { status: 'loading', text: '' });
  };
  const reset = () => { setCharacter(null); setSpinning(false); setConnecting(false); setScene({ status: 'empty', text: '' }); setSpinNumber(0); };
  return <>
    <div className="workshop-controls"><CharacterPicker value={id} onChange={setId} disabled={spinning} /><label>Scene timing<select value={timing} onChange={event => { setTiming(event.target.value); reset(); }}><option value="fast">Ready before landing</option><option value="slow">Ready after landing</option><option value="failed">Failed scene</option></select></label><button onClick={spin} disabled={spinning}>Replay draw</button><button onClick={reset}>Idle</button></div>
    <div className="workshop-stage"><DrawScreen character={character} spinning={spinning} spinNumber={spinNumber} onLand={() => setSpinning(false)} onSpin={spin} scene={scene} connecting={connecting} onStart={() => setConnecting(true)} onNewScene={() => { setSceneIndex(index => index + 1); setScene({ status: 'ready', text: sampleScenes[(sceneIndex + 1) % sampleScenes.length]! }); }} /></div>
    <p className="workshop-note" role="status">{connecting ? 'Connecting state preview. Choose Idle or Replay draw to reset.' : 'Authored scene fixtures. The reel and reveal are the actual game components.'}</p>
  </>;
}

export function ReelStory() {
  const [id, setId] = useState(defaultCharacter.id as string);
  const [character, setCharacter] = useState<Character | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinNumber, setSpinNumber] = useState(0);
  const spin = () => { setCharacter(characterFor(id)); setSpinNumber(number => number + 1); setSpinning(true); };
  return <><div className="workshop-controls"><CharacterPicker value={id} onChange={setId} disabled={spinning} /><button onClick={spin} disabled={spinning}>Replay spin</button><button onClick={() => { setCharacter(null); setSpinning(false); }} disabled={spinning}>Idle reel</button></div><div className="workshop-reel arcade-panel"><CharacterReel character={character} spinning={spinning} spinNumber={spinNumber} onLand={() => setSpinning(false)} /><Lever onSpin={spin} disabled={spinning} /><p role="status">{spinning ? 'Spinning…' : character ? `Landed on ${character.name}` : 'Ready to spin'}</p></div></>;
}

export function GalleryStory() {
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState(defaultCharacter.id as string);
  const filtered = characters.filter(character => `${character.name} ${character.backstory} ${characterGrounding[character.id]}`.toLowerCase().includes(search.toLowerCase()));
  const preview = characterFor(hovered ?? pinned);
  return <><div className="workshop-controls"><label>Search the cast<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, trait, or bad habit" /></label><span>{filtered.length} / {characters.length} characters</span></div><div className="workshop-gallery-layout"><div className="workshop-gallery">{filtered.map(character => <button key={character.id} className={`workshop-character ${pinned === character.id ? 'pinned' : ''}`} onMouseEnter={() => setHovered(character.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(character.id)} onBlur={() => setHovered(null)} onClick={() => setPinned(character.id)} aria-pressed={pinned === character.id}><CharacterArt character={character} decorative /><strong>{character.name.replace(/^The /, '')}</strong></button>)}{!filtered.length && <p>No characters match that search.</p>}</div><section className="arcade-panel workshop-character-detail" aria-label="Character backstory"><CharacterArt character={preview} /><span className="eyebrow">{preview.id === pinned ? 'PINNED CHARACTER' : 'CHARACTER PREVIEW'}</span><h2>{preview.name}</h2><p>{preview.backstory.replace(/[*`]/g, '')}</p><div className="workshop-judge-description"><h3>Judge-facing description</h3><p>{characterGrounding[preview.id]}</p></div></section></div></>;
}
