import { useEffect, useRef, useState } from 'react'

export type UseAudioGraphResult = {
  audioElRef: React.MutableRefObject<HTMLAudioElement | null>
  audioCtxRef: React.MutableRefObject<AudioContext | null>
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  gainRef: React.MutableRefObject<GainNode | null>
  scratchGainRef: React.MutableRefObject<GainNode | null>
  scratchHPFRef: React.MutableRefObject<BiquadFilterNode | null>
  scratchPeakRef: React.MutableRefObject<BiquadFilterNode | null>
  durationRef: React.MutableRefObject<{ current: number; total: number }>
  songChangeCounter: number
  playing: boolean
  volume: number
  hasMedia: boolean
  err: string | null
  ensureGraph: () => Promise<void>
  togglePlay: () => Promise<void>
  onPickFile: React.ChangeEventHandler<HTMLInputElement>
  onChangeVolume: (v: number) => void
}

export function useAudioGraph(initialVolume = 0.5): UseAudioGraphResult {
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const interfererRef = useRef<BiquadFilterNode | null>(null)
  const compRef = useRef<DynamicsCompressorNode | null>(null)
  const durationRef = useRef({ current: 0, total: 0 })
  const scratchGainRef = useRef<GainNode | null>(null)
  const scratchHPFRef = useRef<BiquadFilterNode | null>(null)
  const scratchPeakRef = useRef<BiquadFilterNode | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const suppressInitialErrorRef = useRef(true)

  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(initialVolume)
  const [err, setErr] = useState<string | null>(null)
  const [songChangeCounter, setSongChangeCounter] = useState(0)
  const [hasMedia, setHasMedia] = useState(false)

  useEffect(() => {
    // Create the HTMLAudioElement once
    if (!audioElRef.current) {
      const el = new Audio()
      el.loop = false
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      // choose a default source: ?audio=foo.ext in /test_audio, else default.wav if present
      const pickDefault = async () => {
        try {
          const params = new URLSearchParams(window.location.search)
          const q = params.get('audio')
          if (q) {
            el.src = `/test_audio/${encodeURIComponent(q)}`
            return
          }
          // Attempt single default name; if missing, we leave src unset (no error shown)
          try {
            const url = `/test_audio/${encodeURIComponent('default.wav')}`
            // Try a quick GET request and ensure it's audio/*; if not, silently skip
            const res = await fetch(url, { method: 'GET', cache: 'no-store' })
            const ctype = res.headers.get('content-type') || ''
            if (res.ok && ctype.toLowerCase().startsWith('audio/')) {
              el.src = url
              try { setHasMedia(true) } catch {}
            }
          } catch {}
        } catch {
          // ignore
        }
      }
      pickDefault()
      // Surface useful error messages
      el.addEventListener('error', () => {
        // Suppress errors during initial default probing
        if (!suppressInitialErrorRef.current) {
          setErr('Audio failed to load. Use a supported file (mp3/wav) or pick a local file.')
          setPlaying(false)
        }
        setHasMedia(false)
      })
      el.addEventListener('canplay', () => {
        setErr(null)
        // Once something is playable, allow future errors to surface
        suppressInitialErrorRef.current = false
        setHasMedia(true)
      })
      el.addEventListener('loadedmetadata', () => { setHasMedia(true) })
      audioElRef.current = el
    }
  }, [])

  // Keep time updated
  useEffect(() => {
    const el = audioElRef.current
    if (!el) return
    const onTime = () => {
      durationRef.current.current = el.currentTime
      durationRef.current.total = el.duration || 0
    }
    el.addEventListener('timeupdate', onTime)
    const onMeta = () => {
      onTime()
      setSongChangeCounter((c) => c + 1)
    }
    el.addEventListener('loadedmetadata', onMeta)
    const onEnded = () => {
      // hold at last frame; do not loop (triggers UI fade-to-white)
      try { el.pause() } catch {}
      setPlaying(false)
      durationRef.current.current = el.duration || durationRef.current.current
    }
    el.addEventListener('ended', onEnded)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
    }
  }, [])

  // Revoke any created object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  const ensureGraph = async () => {
    if (!audioElRef.current) return
    if (!audioCtxRef.current) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      audioCtxRef.current = new Ctx()
    }
    const ctx = audioCtxRef.current!
    if (ctx.state === 'suspended') await ctx.resume()

    if (!sourceRef.current) {
      const src = ctx.createMediaElementSource(audioElRef.current)
      const gain = ctx.createGain()
      const analyser = ctx.createAnalyser()
      const interferer = ctx.createBiquadFilter()
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -18
      compressor.knee.value = 20
      compressor.ratio.value = 3
      compressor.attack.value = 0.005
      compressor.release.value = 0.12
      // Subtle LFO setup for doppler/duck when dragging quickly
      interferer.type = 'peaking'
      interferer.frequency.value = 1200
      interferer.Q.value = 1.2
      interferer.gain.value = 0
      analyser.fftSize = 1024
      // Slightly reduce smoothing so beat detection and reverse gating remain responsive under noise
      analyser.smoothingTimeConstant = 0.75
      // Scratch chain
      const scratchGain = ctx.createGain()
      scratchGain.gain.value = 0
      const scratchHPF = ctx.createBiquadFilter()
      scratchHPF.type = 'highpass'
      scratchHPF.frequency.value = 900
      const scratchPeak = ctx.createBiquadFilter()
      scratchPeak.type = 'peaking'
      scratchPeak.frequency.value = 2500
      scratchPeak.Q.value = 1.2
      scratchPeak.gain.value = 0

      // graph: src -> gain -> interferer -> compressor -> analyser -> dest
      // plus scratch send: src -> scratchGain -> HPF -> peaking -> destination (mixed in)
      src.connect(gain)
      gain.connect(interferer)
      interferer.connect(compressor)
      src.connect(scratchGain)
      scratchGain.connect(scratchHPF)
      scratchHPF.connect(scratchPeak)
      scratchPeak.connect(ctx.destination)
      compressor.connect(analyser)
      analyser.connect(ctx.destination)
      gain.gain.value = volume
      sourceRef.current = src
      gainRef.current = gain
      analyserRef.current = analyser
      interfererRef.current = interferer
      compRef.current = compressor
      scratchGainRef.current = scratchGain
      scratchHPFRef.current = scratchHPF
      scratchPeakRef.current = scratchPeak
    } else if (gainRef.current) {
      try {
        gainRef.current.gain.setTargetAtTime(volume, ctx.currentTime, 0.015)
      } catch {}
    }
  }

  const togglePlay = async () => {
    setErr(null)
    try {
      await ensureGraph()
      if (!audioElRef.current) return
      if (playing) {
        audioElRef.current.pause()
        setPlaying(false)
      } else {
        // If source not yet ready, attempt a load first
        if (audioElRef.current.readyState < 2) {
          audioElRef.current.load()
        }
        await audioElRef.current.play()
        setPlaying(true)
      }
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  const onPickFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0]
    if (!f || !audioElRef.current) return
    const url = URL.createObjectURL(f)
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = url
    audioElRef.current.src = url
    ;(audioElRef.current as any).__originalFileName = f.name
    // From now on, show errors for user-picked files
    suppressInitialErrorRef.current = false
    setHasMedia(true)
    try {
      await ensureGraph()
      // Wait for canplay if needed
      if (audioElRef.current.readyState < 2) {
        await new Promise<void>((resolve) => {
          const onReady = () => { audioElRef.current?.removeEventListener('canplay', onReady); resolve() }
          audioElRef.current?.addEventListener('canplay', onReady)
          audioElRef.current?.load()
        })
      }
      await audioElRef.current.play()
      setPlaying(true)
      setHasMedia(true)
      setSongChangeCounter((c) => c + 1)
    } catch (e: any) {
      setErr(e?.message || String(e))
      setHasMedia(false)
    }
  }

  const onChangeVolume = (v: number) => {
    const next = Math.max(0, Math.min(1, v))
    setVolume(next)
    if (gainRef.current && audioCtxRef.current) {
      try {
        gainRef.current.gain.setTargetAtTime(next, audioCtxRef.current.currentTime, 0.015)
      } catch {}
    }
  }

  return {
    audioElRef,
    audioCtxRef,
    analyserRef,
    gainRef,
    scratchGainRef,
    scratchHPFRef,
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
  }
}


