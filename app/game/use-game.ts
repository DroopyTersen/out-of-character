import { useCallback, useEffect, useRef, useState } from "react";
import { useActorRef, useSelector } from "@xstate/react";
import { characters, characterById, CAST_VERSION, JUDGING_VERSION, type Character } from "../../core/characters";
import { combineReadings, acceptReading, emptyStreak, judgingEvidence, upsertSegment, type WordSegment } from "../../core/performance";
import { startCapture } from "../audio/capture";
import { gameMachine } from "./machine";
import { useHighlights } from './use-highlights';

type History = { characterId: string; scene: string }[];
type SceneState = { status: "empty" | "loading" | "ready" | "error"; text: string; error?: string };
type Reading = { attemptId: string; snapshotId: number; castVersion: string; judgingVersion: string; readings: Record<string, number>; recentReadings: Record<string, number>; fullReadings: Record<string, number> };

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(path === "/api/judge" ? 5000 : 15000)]) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "The service could not respond. Please try again.");
  return data;
}

export function useGame() {
  const actor = useActorRef(gameMachine);
  const phase = useSelector(actor, snapshot => snapshot.value);
  const [character, setCharacter] = useState<Character | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinNumber, setSpinNumber] = useState(0);
  const [scene, setScene] = useState<SceneState>({ status: "empty", text: "" });
  const [source, setSource] = useState<"microphone" | "tab">("microphone");
  const [deviceId, setDevice] = useState("");
  const [segments, setSegments] = useState<WordSegment[]>([]);
  const [readings, setReadings] = useState<Record<string, number>>({});
  const [readingCurrent, setReadingCurrent] = useState(false);
  const [peaks, setPeaks] = useState<Record<string, number>>({});
  const lastReadings = useRef<Record<string, number>>({});
  const [result, setResult] = useState({ attemptId: '', readings: {} as Record<string, number>, transcript: '' });
  const highlights = useHighlights(result.attemptId, character?.id ?? '', result.transcript);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState("Ready when you are");
  const [error, setError] = useState("");
  const [won, setWon] = useState(false);
  const history = useRef<History>([]);
  const recordedScene = useRef("");
  const sceneController = useRef<AbortController | null>(null);
  const sceneRequest = useRef("");
  const session = useRef({ attemptId: "", controller: new AbortController(), stop: null as null | (() => Promise<void>), startedAt: 0, segments: [] as WordSegment[], streak: emptyStreak(), busy: false, nextSubmit: 0, fingerprint: "", snapshotId: 0, correction: 0 });

  const stop = useCallback(() => {
    session.current.controller.abort();
    void session.current.stop?.();
    session.current.stop = null;
    setLevel(0);
  }, []);

  const interrupt = useCallback((message: string) => {
    if (!["starting", "performing"].includes(String(actor.getSnapshot().value))) return;
    stop();
    session.current.streak = emptyStreak();
    setProgress(0);
    setError(message);
    actor.send({ type: "FAIL" });
  }, [actor, stop]);

  useEffect(() => {
    try {
      setDevice(localStorage.getItem("ooc-device") || "");
      const saved: unknown = JSON.parse(localStorage.getItem("ooc-scenes") || "[]");
      if (Array.isArray(saved)) history.current = saved.filter((entry): entry is History[number] => entry && typeof entry.characterId === "string" && Boolean(characterById[entry.characterId]) && typeof entry.scene === "string" && entry.scene.length <= 1000).slice(-20);
    } catch { /* History is optional when storage is unavailable. */ }
    const visibility = () => { if (document.hidden) interrupt("The game was paused when you left the tab. Try the same scene again."); };
    document.addEventListener("visibilitychange", visibility);
    return () => { session.current.controller.abort(); void session.current.stop?.(); sceneController.current?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [actor, interrupt]);

  const setDeviceId = (id: string) => { setDevice(id); try { localStorage.setItem("ooc-device", id); } catch { /* Preference is optional. */ } };

  const requestScene = useCallback(async (target: Character, avoid = "") => {
    sceneController.current?.abort();
    const controller = new AbortController();
    sceneController.current = controller;
    const requestId = crypto.randomUUID();
    sceneRequest.current = requestId;
    setScene({ status: "loading", text: "" });
    try {
      const data = await post<{ requestId: string; attemptId: string; scene: string }>("/api/scene", { attemptId: session.current.attemptId, requestId, characterId: target.id, history: history.current, currentScene: avoid || undefined }, controller.signal);
      if (controller.signal.aborted || data.requestId !== sceneRequest.current || data.attemptId !== session.current.attemptId) return;
      setScene({ status: "ready", text: data.scene });
    } catch (failure) {
      if (!controller.signal.aborted) setScene({ status: "error", text: "", error: failure instanceof Error ? failure.message : "Couldn’t set the scene." });
    }
  }, []);

  const spin = () => {
    const phase = actor.getSnapshot().value;
    if ((phase !== "idle" && phase !== "preparing") || spinning) return;
    const available = characters.filter(candidate => candidate.id !== character?.id);
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const target = available[Math.floor((bytes[0]! / 2 ** 32) * available.length)]!;
    session.current.attemptId = crypto.randomUUID();
    setCharacter(target);
    setSpinning(true);
    setSpinNumber(value => value + 1);
    setError("");
    actor.send({ type: "SPIN" });
    void requestScene(target);
  };

  const finish = useCallback((victory: boolean) => {
    if (actor.getSnapshot().value !== "performing") return;
    setElapsed((performance.now() - session.current.startedAt) / 1000);
    setWon(victory);
    setResult({ attemptId: session.current.attemptId, readings: lastReadings.current, transcript: session.current.segments.map(segment => segment.text).join('\n\n').trim() });
    if (victory) setProgress(10);
    stop();
    actor.send({ type: victory ? "WIN" : "GIVE_UP" });
  }, [actor, stop]);

  const start = async () => {
    const currentPhase = actor.getSnapshot().value;
    if (!character || scene.status !== "ready" || spinning || (currentPhase !== "preparing" && currentPhase !== "interrupted")) return;
    stop();
    actor.send({ type: currentPhase === "interrupted" ? "RETRY" : "START" });
    setError(""); setReadings({}); setPeaks({}); setSegments([]); setElapsed(0); setProgress(0); setWon(false); setStatus("Connecting audio…");
    lastReadings.current = {};
    setReadingCurrent(false);
    const active = { attemptId: crypto.randomUUID(), controller: new AbortController(), stop: null as null | (() => Promise<void>), startedAt: 0, segments: [] as WordSegment[], streak: emptyStreak(), busy: false, nextSubmit: 0, fingerprint: "", snapshotId: 0, correction: 0 };
    session.current = active;
    try {
      const capture = await startCapture({
        deviceId, source, signal: active.controller.signal,
        onLevel: setLevel,
        onError: failure => { if (session.current === active) interrupt(failure.message); },
        onTranscript: segment => {
          if (session.current !== active || actor.getSnapshot().value !== "performing") return;
          const update = upsertSegment(active.segments, segment, (performance.now() - active.startedAt) / 1000);
          active.segments = update.segments;
          if (update.revised || update.corrected) active.correction++;
          if (update.revised || update.corrected) setReadingCurrent(false);
          if (update.corrected) {
            setStatus("Transcript changed — Jev is checking again");
          }
          setSegments(update.segments);
        },
      });
      if (active.controller.signal.aborted) { void capture.stop(); return; }
      active.stop = capture.stop;
      active.startedAt = capture.startedAt;
      actor.send({ type: "READY" });
      setStatus("Listening — make it unmistakable");
      const sceneKey = `${character.id}:${scene.text}`;
      if (recordedScene.current !== sceneKey) {
        recordedScene.current = sceneKey;
        history.current = [...history.current, { characterId: character.id, scene: scene.text }].slice(-20);
        try { localStorage.setItem("ooc-scenes", JSON.stringify(history.current)); } catch { /* Continue with in-memory history. */ }
      }
    } catch (failure) {
      if (!active.controller.signal.aborted) interrupt(failure instanceof Error ? failure.message : "Couldn’t start listening.");
    }
  };

  useEffect(() => {
    if (phase !== "performing" || !character) return;
    const active = session.current;
    const tick = async () => {
      if (active.controller.signal.aborted) return;
      const now = (performance.now() - active.startedAt) / 1000;
      setElapsed(now);
      let evidence: ReturnType<typeof judgingEvidence>;
      try { evidence = judgingEvidence(active.segments, now); }
      catch (failure) { interrupt(failure instanceof Error ? failure.message : "Couldn’t read settled speech."); return; }
      if (!evidence.enough) {
        setReadingCurrent(false);
        if (now - evidence.speechThrough > 3) {
          setStatus(active.segments.length ? "Keep talking — waiting for fresh speech" : "Listening — make it unmistakable");
        }
        return;
      }
      if (active.busy || now < active.nextSubmit || evidence.fingerprint === active.fingerprint) return;
      active.busy = true;
      active.nextSubmit = now + 1;
      active.fingerprint = evidence.fingerprint;
      const snapshotId = ++active.snapshotId;
      const correction = active.correction;
      setStatus("Jev is listening between the lines…");
      try {
        const response = await post<Reading>("/api/judge", { attemptId: active.attemptId, snapshotId, castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION, transcript: evidence.text, fullTranscript: evidence.fullTranscript }, active.controller.signal);
        if (session.current !== active || active.controller.signal.aborted || correction !== active.correction || response.attemptId !== active.attemptId || response.snapshotId !== snapshotId || response.castVersion !== CAST_VERSION || response.judgingVersion !== JUDGING_VERSION) return;
        const receivedAt = (performance.now() - active.startedAt) / 1000;
        const latest = judgingEvidence(active.segments, receivedAt);
        const speechThrough = Math.min(evidence.speechThrough, latest.speechThrough);
        if (!latest.enough || receivedAt - speechThrough > 3) { setReadingCurrent(false); setStatus("Waiting for fresh speech"); return; }
        const values = response.readings;
        for (const vector of [values, response.recentReadings, response.fullReadings]) {
          if (!vector || Object.keys(vector).length !== characters.length || characters.some(item => !Number.isFinite(vector[item.id]) || vector[item.id]! < 0 || vector[item.id]! > 1)) throw new Error("Jev returned an incomplete reading. Try the scene again.");
        }
        if (characters.some(item => Math.abs(values[item.id]! - combineReadings(response.fullReadings[item.id]!, response.recentReadings[item.id]!)) > 1e-9)) throw new Error("Jev returned an invalid combined reading. Try the scene again.");
        setReadings(values);
        setReadingCurrent(true);
        lastReadings.current = values;
        setPeaks(previous => Object.fromEntries(characters.map(item => [item.id, Math.max(previous[item.id] ?? 0, values[item.id]!)])));
        active.streak = acceptReading(active.streak, values[character.id]!, snapshotId);
        setProgress(active.streak.count);
        setStatus(active.streak.count > 0 ? "That’s the character. Keep the streak going!" : "Listening — commit to the bit");
        if (active.streak.won) finish(true);
      } catch (failure) {
        if (!active.controller.signal.aborted) interrupt(failure instanceof Error ? failure.message : "Judging was interrupted. Try again.");
      } finally { active.busy = false; }
    };
    const timer = setInterval(() => void tick(), 100);
    return () => clearInterval(timer);
  }, [phase, character, finish, interrupt]);

  const reset = () => {
    stop(); sceneController.current?.abort(); actor.send({ type: "RESET" }); setCharacter(null); setSpinning(false); setScene({ status: "empty", text: "" }); setError(""); setReadings({}); setSegments([]); setElapsed(0); setProgress(0); recordedScene.current = "";
    lastReadings.current = {};
    setReadingCurrent(false);
    setResult({ attemptId: '', readings: {}, transcript: '' });
  };
  return { phase, character, spinning, spinNumber, scene, source, setSource, deviceId, setDeviceId, segments, readings, readingCurrent, peaks, result, highlights, elapsed, progress, level, status, error, won, spin, land: () => setSpinning(false), start, refreshScene: () => character && void requestScene(character, scene.text), giveUp: () => finish(false), reset };
}
