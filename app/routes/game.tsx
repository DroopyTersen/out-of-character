import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { useGame } from "../game/use-game";
import { formatElapsed } from "../../core/performance";
import { GameHeader } from "../ui/game-header";
import { DrawScreen } from "../ui/draw-screen";
import { AudioSettings } from "../ui/audio-settings";
import { PerformanceScreen } from "../ui/performance-screen";
import { ResultScreen } from "../ui/result-screen";

export const meta = () => [{ title: "Out of Character — Consultancy Edition" }, { name: "description", content: "Draw a character. Commit to the bit. An improv game with a very opinionated AI judge." }];
export default function Game() {
  const game = useGame();
  return <div className="app-shell"><GameHeader>{game.phase === "performing" ? <><div className="elapsed"><span>ELAPSED</span><strong>{formatElapsed(game.elapsed)}</strong></div><button className="give-up" onClick={game.giveUp}>Give up</button></> : <AudioSettings source={game.source} setSource={game.setSource} deviceId={game.deviceId} setDeviceId={game.setDeviceId} disabled={game.phase === "starting"} />}</GameHeader>
    <main className={`game-main phase-${game.phase}`}>
      {(game.phase === "idle" || game.phase === "preparing" || game.phase === "starting") && <><DrawScreen character={game.character} spinning={game.spinning} spinNumber={game.spinNumber} onLand={game.land} onSpin={game.spin} scene={game.scene} onNewScene={game.refreshScene} onStart={() => void game.start()} connecting={game.phase === "starting"} />{game.phase === "starting" && <button className="cancel-audio" onClick={game.reset}>Cancel connection</button>}</>}
      {game.phase === "performing" && game.character && <PerformanceScreen character={game.character} scene={game.scene.text} readings={game.readings} progress={game.progress} segments={game.segments} level={game.level} status={game.status} readingCurrent={game.readingCurrent} />}
      {game.phase === "result" && game.character && <ResultScreen character={game.character} won={game.won} elapsed={game.elapsed} peaks={game.peaks} readings={game.result.readings} transcript={game.result.transcript} highlights={game.highlights.state} onRetryHighlights={game.highlights.retry} onAgain={game.reset} />}
      {game.phase === "interrupted" && <section className="interruption arcade-panel"><AlertTriangle size={42} /><span className="eyebrow">TECHNICAL DIFFICULTIES. NOT A CHARACTER FLAW.</span><h1>Let’s take that again.</h1><p role="alert">{game.error}</p><p className="muted">Your character and scene are waiting. This attempt doesn’t count.</p><div><button className="arcade-button primary" onClick={() => void game.start()}><RotateCw size={18} /> Try the same scene</button><button className="quiet-button" onClick={game.reset}><ArrowLeft size={17} /> Back to the draw</button></div></section>}
    </main>
  </div>;
}
