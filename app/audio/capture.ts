import { emptyTurn, observeTurn, settledTranscript, type FluxTurn, type FluxTurnInfo, type TranscriptSegment } from './transcript';
export type { TranscriptSegment } from './transcript';

export type CaptureOptions = {
  deviceId?: string;
  source: 'microphone' | 'tab';
  signal?: AbortSignal;
  onTranscript: (segment: TranscriptSegment) => void;
  onLevel?: (level: number) => void;
  onError: (error: Error) => void;
};

export async function startCapture(options: CaptureOptions): Promise<{ stop: () => Promise<void>; startedAt: number }> {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: AudioWorkletNode | undefined;
  let socket: WebSocket | undefined;
  let meter: ReturnType<typeof setInterval> | undefined;
  let duration: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;
  let cancelReady: ((error: Error) => void) | undefined;
  let startedAt = 0;
  const turns = new Map<number, FluxTurn>();
  const published = new Map<number, string>();

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    clearInterval(meter); clearTimeout(duration);
    cancelReady?.(new Error('Audio capture canceled.')); cancelReady = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close(1000, 'Listening stopped');
    }
    if (context) context.onstatechange = null;
    source?.disconnect();
    if (processor) { processor.onprocessorerror = null; processor.port.onmessage = null; processor.port.postMessage('stop'); processor.port.close(); processor.disconnect(); }
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stopPromise = (context?.close().catch(() => {}) ?? Promise.resolve()).then(() => options.signal?.removeEventListener('abort', abort));
    return stopPromise;
  };
  const abort = () => { void stop(); };
  const assertActive = () => { if (stopped || options.signal?.aborted) throw new Error('Audio capture canceled.'); };
  const fail = (message: string) => {
    if (stopped) return;
    const error = new Error(message);
    if (cancelReady) cancelReady(error);
    else options.onError(error);
    void stop();
  };
  const publish = () => {
    if (stopped || !startedAt) return;
    const now = (performance.now() - startedAt) / 1000;
    for (const [index, turn] of turns) {
      const segment = settledTranscript(turn, now);
      const fingerprint = JSON.stringify(segment);
      if (fingerprint === published.get(index)) continue;
      published.set(index, fingerprint);
      options.onTranscript(segment);
    }
  };
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    assertActive();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable. Open this game over HTTPS in Safari or Chrome.');
    // Resume during the Start button's gesture, before a permission dialog awaits.
    context = new AudioContext();
    context.onstatechange = () => { if (startedAt && !stopped && context?.state !== 'running') fail('Audio was paused by the browser. Restart listening to continue.'); };
    const audioContext = context;
    const resumed = audioContext.resume();
    // WebKit may finish resume after an immediate denial/cancel closes audio.
    // Close that late completion without waiting on a gesture-blocked promise.
    void resumed.then(() => {
      if (stopped && audioContext.state !== 'closed') return audioContext.close();
    }).catch(() => {});
    if (options.source === 'tab') {
      if (!navigator.mediaDevices.getDisplayMedia) throw new Error('Tab audio is unavailable in this browser. Choose Microphone instead.');
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { deviceId: options.deviceId ? { exact: options.deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    }
    assertActive();
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('No audio was shared. Select a desktop browser tab and enable Share tab audio, or choose Microphone.');
    stream.getTracks().forEach(track => { track.onended = () => fail('Audio sharing stopped. Restart listening to continue.'); });
    await resumed;
    assertActive();
    if (!context.audioWorklet) throw new Error('Audio processing is unavailable. Update Safari or Chrome and try again.');
    await context.audioWorklet.addModule('/audio-worklet.js');
    assertActive();
    processor = new AudioWorkletNode(context, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    processor.onprocessorerror = () => fail('Audio processing stopped. Try listening again.');
    source = context.createMediaStreamSource(new MediaStream([track]));
    const url = new URL('/api/speech', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => fail('Speech connection timed out. Try listening again.'), 15000);
      cancelReady = error => { clearTimeout(timeout); reject(error); };
      socket!.onerror = () => fail('Speech could not connect. Check your connection and try again.');
      socket!.onclose = () => fail('Speech connection ended. Restart listening to continue.');
      socket!.onmessage = event => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; message?: string };
          if (message.type === 'Error') { fail(message.message?.slice(0, 300) || 'Speech was interrupted. Try listening again.'); return; }
          if (message.type === 'Connected') { clearTimeout(timeout); cancelReady = undefined; resolve(); return; }
          if (message.type !== 'TurnInfo' || !startedAt || stopped) return;
          const turn = message as FluxTurnInfo;
          const next = observeTurn(turns.get(turn.turn_index) ?? emptyTurn(`flux-${turn.turn_index}`), turn, (performance.now() - startedAt) / 1000);
          turns.set(turn.turn_index, next);
          if (turns.size > 300 || [...turns.values()].reduce((total, value) => total + value.text.length, 0) > 80000) throw new Error('Listening reached the transcript limit. Restart listening to continue.');
          publish();
        } catch (error) { fail(error instanceof Error ? error.message : 'Speech returned an invalid transcript. Try again.'); }
      };
    });
    assertActive();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => fail('Audio processing timed out. Try listening again.'), 5000);
      cancelReady = error => { clearTimeout(timeout); reject(error); };
      processor!.port.onmessage = event => {
        if (stopped) return;
        if (event.data.ready) { clearTimeout(timeout); cancelReady = undefined; resolve(); return; }
        if (!(event.data.pcm instanceof ArrayBuffer)) return;
        if (socket!.readyState !== WebSocket.OPEN || socket!.bufferedAmount > 64000) { fail('Speech connection fell behind. Check your connection and try again.'); return; }
        socket!.send(event.data.pcm);
        options.onLevel?.(event.data.level);
      };
      startedAt = performance.now();
      processor!.port.postMessage('start');
      processor!.connect(context!.destination);
      source!.connect(processor!);
    });
    assertActive();
    meter = setInterval(() => { try { publish(); } catch (error) { fail(error instanceof Error ? error.message : 'Speech was interrupted.'); } }, 100);
    duration = setTimeout(() => fail('Listening reached the ten-minute limit. Restart listening to continue.'), 10 * 60 * 1000);
    return { stop, startedAt };
  } catch (error) {
    // Permission dialogs cannot be aborted; dispose tracks that arrive after cancel.
    stream?.getTracks().forEach(track => track.stop());
    await stop();
    if (error instanceof DOMException) {
      const message: Record<string, string> = {
        NotAllowedError: 'Audio permission was denied or canceled. Allow microphone access in your browser and try again.',
        NotFoundError: 'The selected audio device was not found. Choose another microphone.',
        NotReadableError: 'The browser could not open this audio device. Check whether another app is using it.',
        OverconstrainedError: 'The selected microphone is unavailable. Choose another device.',
      };
      if (message[error.name]) throw new Error(message[error.name]);
    }
    throw error;
  }
}
