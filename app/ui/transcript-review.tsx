import { highlightedPassages, type HighlightState } from '../../core/highlights';

export function TranscriptReview({ transcript, highlights, onRetry }: { transcript: string; highlights: HighlightState; onRetry?: () => void }) {
  const review = highlights.status === 'ready' ? highlights.review : null;
  const selected = review ? highlightedPassages(review) : new Set<string>();
  return <section className="arcade-panel transcript-review">
    <header><span className="eyebrow">YOUR PERFORMANCE</span><h2>The words that landed.</h2></header>
    <p className="recap-note" role="status">
      {!transcript ? 'No speech was captured this time.' : highlights.status === 'loading' ? 'Jev is finding your strongest character moments…' : highlights.status === 'error' ? 'Highlights couldn’t load. Your transcript is still here.' : selected.size ? 'Highlighted passages are Jev’s strongest evidence for your character.' : 'No clear character moments stood out in this transcript.'}
    </p>
    {highlights.status === 'error' && onRetry && <button className="quiet-button" onClick={onRetry}>Retry highlights</button>}
    {transcript && <p className="review-transcript">{review ? review.passages.map(passage => selected.has(passage.id)
      ? <mark key={passage.id} title="A strong character moment">{transcript.slice(passage.start, passage.end)}</mark>
      : <span key={passage.id}>{transcript.slice(passage.start, passage.end)}</span>) : transcript}</p>}
    {selected.size > 0 && <p className="recap-note highlight-legend"><i />Strong character evidence · These highlights don’t change your score.</p>}
  </section>;
}
