import type { MediaBatch, MediaDiagnostics } from '../shared/mediaActivity';

/** Bounded diagnostic observations only; these never participate in floor or lease decisions. */
export class SessionMediaDiagnostics {
  private value: MediaDiagnostics = { events: [], captures: [], discarded: 0 };
  private seen = new Map<string, Set<number>>();
  get snapshot(): MediaDiagnostics { return structuredClone(this.value); }
  restore(value?: MediaDiagnostics) {
    if (!value) return;
    this.value = structuredClone(value);
    for (const event of value.events) this.remember(event.captureId, event.sequence);
  }
  append(batch: MediaBatch, receivedAt: number) {
    let capture = this.value.captures.find(item => item.captureId === batch.captureId);
    if (!capture) {
      // Reloads get new capture ids; keep a finite archive even for a broken client.
      if (this.value.captures.length >= 32) { this.value.discarded += batch.events.length; return; }
      capture = { captureId: batch.captureId, dropped: 0, observed: 0, received: 0, clocks: [] };
      this.value.captures.push(capture);
    }
    capture.observed = Math.max(capture.observed, batch.observed);
    capture.dropped = Math.max(capture.dropped, batch.dropped);
    if (batch.clock) {
      const previous = capture.clocks.findIndex(clock => clock.epoch === batch.clock!.epoch);
      if (previous < 0 && capture.clocks.length < 32) capture.clocks.push(batch.clock);
      else if (previous >= 0 && batch.clock.roundTripMs < capture.clocks[previous]!.roundTripMs) capture.clocks[previous] = batch.clock;
    }
    for (const event of batch.events) {
      if (this.seen.get(batch.captureId)?.has(event.sequence)) continue;
      this.remember(batch.captureId, event.sequence);
      capture.received++;
      this.value.events.push({ ...event, captureId: batch.captureId, receivedAt });
    }
    const excess = Math.max(0, this.value.events.length - 2048);
    this.value.events.splice(0, excess);
    this.value.discarded += excess;
  }
  private remember(id: string, sequence: number) {
    let seen = this.seen.get(id);
    if (!seen) this.seen.set(id, seen = new Set());
    seen.add(sequence);
    // The browser retries at most 256 queued events; retain ample duplicate history.
    if (seen.size > 4096) seen.delete(Math.min(...seen));
  }
}
