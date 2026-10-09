import { useObject } from '@ai-sdk/react';
import { useRef, useState } from 'react';
import type { DeepPartial } from 'ai';
import type { z } from 'zod';
import type { SessionSnapshot } from '../../core/simulator/types';
import { idleReport, reportSchema, REPORT_MAX_STARTS, REPORT_DEADLINE_MS, type CoachingReport, type ReportState } from '../../core/simulator/report';

export type ReportTarget = { id: string; url: string; headers: Record<string, string> };
type ReportData<T = CoachingReport, S = SessionSnapshot> = { state: ReportState<T>; draft?: DeepPartial<T>; loadError?: boolean; snapshot?: S | null };
export type ReportStage = 'compiling' | 'writing' | 'completed' | 'failed' | 'exhausted' | 'ineligible' | 'unavailable' | 'status-error';
export type StreamedReportView<T, S = SessionSnapshot> = ReportData<T, S> & { stage: ReportStage; canRetry: boolean };
export type ReportView = StreamedReportView<CoachingReport>;
export type ReportActions = { prepare(target: ReportTarget): void; begin(id: string): void; cancel(): void };

/** One presentation policy for the live hook and Storybook examples. */
export function reportView(data: ReportData): ReportView {
  return streamedReportView(data, !!data.draft?.overview);
}

export function streamedReportView<T, S = SessionSnapshot>(data: ReportData<T, S>, hasContent: boolean): StreamedReportView<T, S> {
  const { state, loadError } = data;
  let stage: ReportStage;
  if (loadError) stage = 'status-error';
  else switch (state.status) {
    case 'running': stage = hasContent ? 'writing' : 'compiling'; break;
    case 'idle': stage = 'failed'; break;
    case 'failed': stage = state.starts >= REPORT_MAX_STARTS ? 'exhausted' : 'failed'; break;
    default: stage = state.status;
  }
  return { ...data, stage, canRetry: !loadError && (state.status === 'idle' || state.status === 'failed') && state.starts < REPORT_MAX_STARTS };
}

export function useSessionReport() {
  return useStreamedReport(reportSchema, draft => !!draft?.overview);
}

export function useStreamedReport<T, S = SessionSnapshot>(schema: z.ZodType<T>, hasContent: (draft: DeepPartial<T> | undefined) => boolean) {
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [state, setState] = useState(idleReport<T>);
  const [loadError, setLoadError] = useState(false);
  const [snapshot, setSnapshot] = useState<S | null>(null);
  const current = useRef<ReportTarget | null>(null);
  const submitted = useRef(false);
  const statusRead = useRef<AbortController | null>(null);
  const statusReadStarted = useRef(false);

  async function readFinal(forTarget: ReportTarget | null) {
    if (!forTarget || current.current !== forTarget || statusReadStarted.current) return;
    statusReadStarted.current = true;
    const controller = new AbortController();
    statusRead.current = controller;
    try {
      const response = await fetch(`${forTarget.url}/poll`, { method: 'POST', headers: { ...forTarget.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false, audio: false }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REPORT_DEADLINE_MS + 10_000)]) });
      if (current.current !== forTarget) return;
      if ([404, 410].includes(response.status)) {
        setState({ status: 'unavailable', starts: 0, report: null, failure: null });
        return;
      }
      if (!response.ok) throw new Error('Report status unavailable.');
      const value = await response.json() as S & { report?: ReportState<T> };
      const { report: finalState, ...finalSnapshot } = value;
      if (!finalState) throw new Error('Report status unavailable.');
      if (current.current === forTarget) {
        setState(finalState); setSnapshot(finalSnapshot as S); setLoadError(false);
      }
    } catch {
      if (current.current === forTarget && !controller.signal.aborted) setLoadError(true);
    }
  }

  const sdk = useObject({
    api: target ? `${target.url}/report` : '/api/simulator/sessions', schema,
    id: target?.id, headers: target?.headers,
    onFinish: () => readFinal(target), onError: () => { void readFinal(target); },
  });

  const draft = state.status === 'running' ? sdk.object : undefined;
  const view = streamedReportView({ state, draft, loadError, snapshot }, hasContent(draft));

  function cancel() {
    if (state.status === 'running') setLoadError(true);
    current.current = null;
    sdk.stop();
    statusRead.current?.abort();
  }
  function prepare(next: ReportTarget) {
    cancel();
    sdk.clear();
    current.current = next;
    setTarget(next); setState(idleReport<T>()); setLoadError(false); setSnapshot(null);
    submitted.current = false; statusReadStarted.current = false;
  }
  function begin(id: string) {
    if (!target || current.current !== target || target.id !== id || submitted.current) return;
    submitted.current = true;
    setState({ status: 'running', starts: 1, report: null, failure: null });
    sdk.submit({});
  }
  function retry() {
    if (!target || !view.canRetry) return;
    current.current = target;
    statusReadStarted.current = false;
    setState({ status: 'running', starts: state.starts + 1, report: null, failure: null });
    sdk.submit({});
  }
  function checkStatus() {
    // A Back/Forward cache restore keeps this target after pagehide stopped work.
    current.current = target;
    statusReadStarted.current = false; setLoadError(false); void readFinal(target);
  }
  return { view, prepare, begin, retry, checkStatus, cancel };
}
