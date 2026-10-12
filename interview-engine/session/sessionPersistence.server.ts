import { FencedError, type SessionStore } from '../seams.server';
import type { Checkpoint, Lease } from './sessionCheckpoint';

/** Saves one owner's session state and keeps checkpoint writes and removal in order. */
export class SessionPersistence {
  private lost = false;
  private cleared = false;
  private nextWake: number | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly store: SessionStore, private readonly onOwnershipLost: () => void) {}

  get ownershipLost(): boolean { return this.lost; }
  get wakeAt(): number | null { return this.nextWake; }
  /** The store no longer holds the attempt: its owner has nothing left to do. */
  get forgotten(): boolean { return this.cleared; }

  loseOwnership() {
    if (this.lost) return;
    this.lost = true;
    this.onOwnershipLost();
  }

  private async guarded(write: () => Promise<void>) {
    if (this.lost) throw new FencedError();
    try { await write(); }
    catch (error) {
      if (error instanceof FencedError) this.loseOwnership();
      throw error;
    }
  }

  save(patch: { lease?: Lease; checkpoint?: Checkpoint | null }) {
    return this.guarded(() => this.store.save(patch));
  }

  setWake(at: number | null) {
    return this.guarded(() => { this.nextWake = at; return this.store.wake(at); });
  }

  /** The coordinator is handling the due wake; any next wake must be scheduled explicitly. */
  consumeWake() { this.nextWake = null; }

  /** A failure belongs to its caller; subsequent writes still get their turn. */
  ordered(write: () => Promise<void>): Promise<void> {
    const link = this.writes.then(write);
    this.writes = link.catch(() => {});
    return link;
  }

  /** Capture the current session when the save runs, after all earlier checkpoint writes. */
  saveCheckpoint(build: () => Checkpoint): Promise<void> {
    return this.ordered(() => this.save({ checkpoint: build() }));
  }

  async clear() {
    if (this.lost) throw new FencedError();
    this.nextWake = null;
    // A late checkpoint write must not restore the attempt after its removal.
    await this.ordered(() => this.guarded(() => this.store.clear()));
    this.cleared = true;
  }
}
