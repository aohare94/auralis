import React from 'react'
import { useAudioGraph } from './audio/useAudioGraph'
import SineVolumeSlider from './components/SineVolumeSlider'
import WordmarkBarFullBounds from './components/WordmarkBarFullBounds'
import DropZone from './components/DropZone'

export default function App() {
  const {
    audioElRef,
    audioCtxRef,
    analyserRef,
    gainRef,
    scratchGainRef,
    scratchPeakRef,
    durationRef,
    songChangeCounter,
    playing,
    volume,
    hasMedia,
    err,
    ensureGraph,
    togglePlay,
    onPickFile,
    onChangeVolume,
  } = useAudioGraph(0.5)
  const mainGainBeforeScratchRef = React.useRef<number | null>(null)

  return (
    <div className="min-h-screen bg-[#0b0b0e] text-slate-200 text-[120%]">
      <div className="max-w-4xl mx-auto py-6 px-4 grid gap-4">
        <DropZone onFile={(e) => { onPickFile(e); }} asWordmark hasMedia={hasMedia}>
          <WordmarkBarFullBounds
            audioElRef={audioElRef}
            durationRef={durationRef}
            ensureGraph={ensureGraph}
            songChangeCounter={songChangeCounter}
            onScratchBegin={(wasPlaying) => {
              const ctx = audioCtxRef.current
              const sG = scratchGainRef.current
              const sP = scratchPeakRef.current
              const mainG = gainRef.current
              if (!ctx || !sG || !sP || !mainG) return
              const at = ctx.currentTime
              // store main gain and duck main path to avoid choppy artifacts while scrubbing
              if (mainGainBeforeScratchRef.current == null) mainGainBeforeScratchRef.current = mainG.gain.value as number
              mainG.gain.setTargetAtTime(Math.max(0.04, (mainG.gain.value as number) * 0.15), at, 0.02)
              sG.gain.setTargetAtTime(0.6, at, 0.008)
              sP.gain.setTargetAtTime(4, at, 0.01)
            }}
            onScratchUpdate={(speed) => {
              const ctx = audioCtxRef.current
              const sG = scratchGainRef.current
              const sP = scratchPeakRef.current
              const mainG = gainRef.current
              if (!ctx || !sG || !sP || !mainG) return
              const at = ctx.currentTime
              // Emphasize scratch send, further duck main on faster drags
              const duck = 0.12 + 0.20 * speed
              const targetMain = Math.max(0.02, (mainGainBeforeScratchRef.current ?? volume) * duck)
              mainG.gain.setTargetAtTime(targetMain, at, 0.015)
              sG.gain.setTargetAtTime(0.25 + 0.6 * speed, at, 0.01)
              sP.gain.setTargetAtTime(2 + 4 * speed, at, 0.02)
            }}
            onScratchEnd={(resume) => {
              const ctx = audioCtxRef.current
              const sG = scratchGainRef.current
              const sP = scratchPeakRef.current
              const mainG = gainRef.current
              if (!ctx || !sG || !sP || !mainG) return
              const at = ctx.currentTime
              sG.gain.setTargetAtTime(0, at, 0.06)
              sP.gain.setTargetAtTime(0, at, 0.06)
              // restore main gain smoothly to the current volume
              const restore = mainGainBeforeScratchRef.current ?? volume
              mainG.gain.setTargetAtTime(Math.max(0, Math.min(1, restore)), at, 0.05)
              mainGainBeforeScratchRef.current = null
            }}
          />
        </DropZone>

        <div className="w-full flex justify-center">
          <SineVolumeSlider
            value={volume}
            onChange={onChangeVolume}
            analyser={analyserRef.current}
            playing={playing}
            onTogglePlay={togglePlay}
            effectiveVolume={gainRef.current ? (gainRef.current.gain.value as number) : volume}
            songChangeCounter={songChangeCounter}
            ensureGraph={ensureGraph}
            disabled={!hasMedia}
          />
        </div>

        {err && <div className="text-sm text-rose-300">{err}</div>}
      </div>
    </div>
  )
}


