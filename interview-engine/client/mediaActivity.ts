import type { MediaActivity, MediaBatch } from '../shared/mediaActivity';

/** Private meter transitions. Acknowledged batches leave the queue; failed polls retry them. */
export class MediaActivityCapture {
  private readonly captureId = crypto.randomUUID();
  private events: MediaActivity[] = [];
  private last: MediaActivity | undefined;
  private sequence = 0;
  private epoch = 0;
  private dropped = 0;
  private clock: MediaBatch['clock'];

  connect() { this.epoch++; this.last = undefined; this.clock = undefined; }
  observe(inputActive: boolean, outputActive: boolean, atMs: number) {
    if (this.last?.inputActive === inputActive && this.last.outputActive === outputActive) return;
    this.last = { sequence: ++this.sequence, epoch: this.epoch, atMs, inputActive, outputActive };
    this.events.push(this.last);
    if (this.events.length > 256) { this.events.shift(); this.dropped++; }
  }
  synchronize(sentAtMs: number, receivedAtMs: number, serverAt: number) {
    const roundTripMs = receivedAtMs - sentAtMs;
    if (!Number.isFinite(serverAt) || roundTripMs < 0 || roundTripMs > 60_000 || (this.clock && roundTripMs >= this.clock.roundTripMs)) return;
    this.clock = { epoch: this.epoch, atMs: (sentAtMs + receivedAtMs) / 2, serverAt, roundTripMs };
  }
  batch(): MediaBatch { return { captureId: this.captureId, events: this.events.slice(0, 32), dropped: this.dropped, observed: this.sequence, ...(this.clock ? { clock: this.clock } : {}) }; }
  acknowledge(batch: MediaBatch) {
    const through = batch.events.at(-1)?.sequence ?? 0;
    this.events = this.events.filter(event => event.sequence > through);
  }
}
