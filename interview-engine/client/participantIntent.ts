import type { SubmitTextInput } from '../shared/protocol';

/**
 * What the participant means for one attempt, apart from any one media connection: the microphone is off, a typed
 * draft is open, and one typed answer is still awaiting the server's receipt. A replacement connection, opened after
 * an unanswered end, receives this before its media resumes. An answer keeps its identity until a receipt names it,
 * across transport retries and a later manual retry, so an answer the server saved but never acknowledged is not
 * saved twice; new or edited text is a new answer. The draft itself stays in the host and is never transmitted.
 */
export class ParticipantIntent {
  muted = false;
  composing = false;
  private pending: SubmitTextInput | undefined;

  /** The answer to send for this text: the unacknowledged one when the text is unchanged, otherwise a new one. */
  answer(text: string): SubmitTextInput {
    if (this.pending?.text !== text) this.pending = { id: crypto.randomUUID(), text };
    return this.pending;
  }

  /** The server acknowledged this answer; the same text sent again is a new answer. */
  acknowledged(id: string) {
    if (this.pending?.id === id) this.pending = undefined;
  }

  /** Puts the current intent on a connection; done before its media resumes so the replacement starts as the participant left it. */
  apply(connection: { mute(muted: boolean): void; setComposing(value: boolean): void }) {
    connection.mute(this.muted);
    connection.setComposing(this.composing);
  }
}
