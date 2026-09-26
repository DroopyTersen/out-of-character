import { useEffect, useRef, useState } from "react";
import { Mic, Radio, Settings2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../shadcn/components/ui/dialog";
import { MicSelector, MicSelectorTrigger, MicSelectorValue, MicSelectorContent, MicSelectorInput, MicSelectorList, MicSelectorItem, MicSelectorLabel, MicSelectorEmpty } from "../ai-elements/mic-selector";
import { SpeechInput } from "../ai-elements/speech-input";
import { startCapture } from "../audio/capture";

export function AudioSettings({ source, setSource, deviceId, setDeviceId, disabled = false }: { source: "microphone" | "tab"; setSource: (source: "microphone" | "tab") => void; deviceId: string; setDeviceId: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [canShareTab, setCanShareTab] = useState(false);
  useEffect(() => { setCanShareTab(typeof navigator.mediaDevices?.getDisplayMedia === "function"); }, []);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [caption, setCaption] = useState("");
  const [level, setLevel] = useState(0);
  const control = useRef<AbortController | null>(null);
  const stop = () => { control.current?.abort(); setTesting(false); setConnecting(false); setLevel(0); };
  useEffect(() => () => control.current?.abort(), []);
  const test = async () => {
    if (testing || connecting) { stop(); return; }
    const controller = new AbortController(); control.current = controller;
    setConnecting(true); setCaption("Connecting to speech recognition…");
    try {
      await startCapture({ source, deviceId, signal: controller.signal, onLevel: setLevel, onTranscript: segment => setCaption(segment.text), onError: error => { setCaption(error.message); stop(); } });
      if (controller.signal.aborted) return;
      setTesting(true); setConnecting(false); setCaption("Say a few words. You should see them here.");
      setTimeout(() => { if (control.current === controller) stop(); }, 12000);
    } catch (error) { if (!controller.signal.aborted) { setCaption(error instanceof Error ? error.message : "Couldn’t connect audio."); stop(); } }
  };
  return <Dialog open={open} onOpenChange={value => { stop(); setOpen(value); }}><DialogTrigger asChild><button className="quiet-button settings-button" disabled={disabled}><Settings2 size={17} /><span>Audio</span></button></DialogTrigger>
    <DialogContent className="audio-dialog"><DialogTitle className="pixel-heading">Sound check</DialogTitle><DialogDescription>Choose what the game hears. One performer at a time.</DialogDescription>
      <div className="source-options"><button className={source === "microphone" ? "selected" : ""} onClick={() => { stop(); setSource("microphone"); }}><Mic size={20} /><strong>Microphone</strong><small>You, live and unfiltered.</small></button><button disabled={!canShareTab} className={source === "tab" ? "selected" : ""} onClick={() => { stop(); setSource("tab"); }}><Radio size={20} /><strong>Chrome tab</strong><small>{canShareTab ? "Try a call in another tab." : "Available on desktop Chrome."}</small></button></div>
      {source === "microphone" ? <MicSelector value={deviceId} onValueChange={id => { stop(); setDeviceId(id ?? ""); }}><MicSelectorTrigger className="w-full justify-between"><MicSelectorValue /></MicSelectorTrigger><MicSelectorContent><MicSelectorInput placeholder="Find a microphone…" /><MicSelectorList>{devices => devices.map(device => <MicSelectorItem key={device.deviceId} value={device.deviceId}><MicSelectorLabel device={device} /></MicSelectorItem>)}</MicSelectorList><MicSelectorEmpty>No microphones found. Check browser permission.</MicSelectorEmpty></MicSelectorContent></MicSelector> : <p className="audio-note">Select a Chrome tab and turn on <strong>Share tab audio</strong>. Native Teams and whole-system audio aren’t supported here. Headphones help prevent feedback.</p>}
      <div className="audio-test"><SpeechInput listening={testing} connecting={connecting} onClick={() => void test()} /><div className="audio-meter" aria-label="Microphone level"><span style={{ width: `${Math.min(100, level * 500)}%` }} /></div></div>
      <p className="audio-test-caption" role="status">{caption || "A quick test gives your microphone its moment before you get yours."}</p>
      <p className="privacy-note">Audio goes to Cloudflare’s speech service for transcription. Your words go to Jev for character matching. This app doesn’t save audio or transcripts.</p>
    </DialogContent>
  </Dialog>;
}
