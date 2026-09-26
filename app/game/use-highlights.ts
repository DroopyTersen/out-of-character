import { useEffect, useState } from 'react';
import { CAST_VERSION, JUDGING_VERSION } from '../../core/characters';
import { validateHighlightReview, type HighlightReview, type HighlightState } from '../../core/highlights';

export function useHighlights(attemptId: string, characterId: string, transcript: string) {
  const [state, setState] = useState<HighlightState>({ status: transcript.trim() ? 'loading' : 'empty' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!transcript.trim()) { setState({ status: 'empty' }); return; }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void (async () => {
      try {
        const response = await fetch('/api/highlights', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attemptId, characterId, transcript, castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        if (!response.ok) throw new Error('Highlights unavailable.');
        const data = await response.json() as { attemptId: string; characterId: string; review: HighlightReview };
        if (data.attemptId !== attemptId || data.characterId !== characterId) throw new Error('Wrong performance highlights.');
        validateHighlightReview(data.review, transcript);
        if (!controller.signal.aborted) setState({ status: 'ready', review: data.review });
      } catch { if (!controller.signal.aborted) setState({ status: 'error' }); }
    })();
    return () => controller.abort();
  }, [attemptId, characterId, transcript, retry]);
  return { state, retry: () => setRetry(value => value + 1) };
}
