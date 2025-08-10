import React, { useEffect, useRef } from 'react'
import { UI_SCALE as S, SLIDER_DOMINANCE as SL, EDGE_BLEED, GREY_TRACK, WHITE, BAND_COLORS, REVERSE_PARAMS } from '../lib/uiConstants'

export type SineVolumeSliderProps = {
  value: number
  onChange: (next: number) => void
  analyser: AnalyserNode | null
  playing: boolean
  onTogglePlay: () => void
  effectiveVolume: number
  songChangeCounter: number
  ensureGraph?: () => Promise<void>
  disabled?: boolean
}

export default function SineVolumeSlider({ value, onChange, analyser, playing, onTogglePlay, effectiveVolume, songChangeCounter, ensureGraph, disabled }: SineVolumeSliderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const iconCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  // imported constants
  const draggingRef = useRef(false)
  const rmsRef = useRef(0)
  const phasesRef = useRef({ bass: 0, mid: 0, treble: 0 })
  const valueRef = useRef(value)
  const effectiveVolRef = useRef(effectiveVolume)
  const pointerXRef = useRef<number | null>(null)
  const pointerYRef = useRef<number | null>(null)
  const interferenceRef = useRef(0)
  const onChangeRef = useRef(onChange)
  const activityRef = useRef(0)
  const prevPxRef = useRef<number | null>(null)
  const springXRef = useRef(0)
  const springVRef = useRef(0)
  const lastFrameRef = useRef<number | null>(null)
  const bassPrevRef = useRef(0)
  const plucksRef = useRef<{ x: number; t: number; intensity: number }[]>([])
  const flowDirRef = useRef(1)
  const vocalEnvRef = useRef(0)
  const reverseBuildRef = useRef(0)
  const beatImpulseRef = useRef(0)
  const stickyDirRef = useRef<1 | -1>(1)
  const flowRateRef = useRef(0)
  const energyEnvRef = useRef(0)
  const energyPrevRef = useRef(0)
  const lowSlowDurRef = useRef(0)
  const iconRectRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 })
  const iconDownRef = useRef(false)
  const iconStartRef = useRef({ x: 0, y: 0, t: 0 })
  const iconMovedRef = useRef(false)
  const lastToggleAtRef = useRef(0)
  const onTogglePlayRef = useRef(onTogglePlay)
  const ensureGraphRef = useRef(ensureGraph)
  const suppressClickRef = useRef(false)
  const iconPulseRef = useRef(0)
  const iconBeatEnvRef = useRef(0)
  const playBlendRef = useRef(playing ? 1 : 0)
  const lastPlayingRef = useRef<boolean | null>(null)
  const resumeStabilizeUntilRef = useRef(0)
  const colorFrontRef = useRef(0)
  const disabledRef = useRef(!!disabled)
  const iconHalfWRef = useRef<number>(0)

  useEffect(() => { valueRef.current = value }, [value])
  useEffect(() => { effectiveVolRef.current = effectiveVolume }, [effectiveVolume])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onTogglePlayRef.current = onTogglePlay }, [onTogglePlay])
  useEffect(() => { ensureGraphRef.current = ensureGraph }, [ensureGraph])
  useEffect(() => { disabledRef.current = !!disabled }, [disabled])
  useEffect(() => {
    phasesRef.current = { bass: 0, mid: 0, treble: 0 }
    bassPrevRef.current = 0
    activityRef.current = 0
  }, [songChangeCounter])

  // On play/pause toggles, stabilize direction and pulse. Paused → strong reverse; Play → forward bias
  useEffect(() => {
    if (lastPlayingRef.current !== null && lastPlayingRef.current !== playing) {
      iconBeatEnvRef.current = Math.min(1, iconBeatEnvRef.current + 0.25)
      if (playing) {
        resumeStabilizeUntilRef.current = performance.now() + 800
        // Bias forward on resume to prevent immediate reverse flick
        reverseBuildRef.current = Math.min(reverseBuildRef.current, 0.2)
        stickyDirRef.current = 1
        flowDirRef.current = Math.max(0.3, Math.abs(flowDirRef.current))
      }
      if (!playing) {
        // Favor reverse immediately on pause so slide-out looks correct
        reverseBuildRef.current = Math.max(reverseBuildRef.current, 0.9)
        stickyDirRef.current = -1
        flowDirRef.current = -Math.max(0.3, Math.abs(flowDirRef.current))
      }
    }
    lastPlayingRef.current = playing
  }, [playing])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // create overlay icon canvas next to main canvas for unclipped icon drawing
    // Ensure parent contains overlay
    try { if (canvas.parentElement) canvas.parentElement.style.position = 'relative' } catch {}
    let iconCanvas = iconCanvasRef.current
    if (!iconCanvas) {
      iconCanvas = document.createElement('canvas')
      iconCanvasRef.current = iconCanvas
      canvas.parentElement?.appendChild(iconCanvas)
      iconCanvas.style.position = 'absolute'
      iconCanvas.style.left = '0'
      iconCanvas.style.top = '0'
      iconCanvas.style.pointerEvents = 'none'
      // match size and stacking
      const s = getComputedStyle(canvas)
      iconCanvas.style.width = s.width
      iconCanvas.style.height = s.height
      iconCanvas.style.zIndex = '1'
    }
    const ictx = iconCanvas.getContext('2d')
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const resize = () => {
      const { clientWidth, clientHeight } = canvas
      canvas.width = Math.floor(clientWidth * dpr)
      canvas.height = Math.floor(clientHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (iconCanvas && ictx) {
        const extra = Math.round(48 * S)
        iconCanvas.width = Math.floor((clientWidth + extra) * dpr)
        iconCanvas.height = Math.floor(clientHeight * dpr)
        ictx.setTransform(dpr, 0, 0, dpr, 0, 0)
        // ensure overlay matches element size
        iconCanvas.style.width = `${clientWidth + extra}px`
        iconCanvas.style.height = `${clientHeight}px`
      }
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    let timeData: Uint8Array<ArrayBuffer> | null = null
    let freqData: Uint8Array<ArrayBuffer> | null = null

    const draw = () => {
      if (analyser) {
        if (!timeData || timeData.length !== analyser.fftSize) {
          timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize)) as unknown as Uint8Array<ArrayBuffer>
        }
        analyser.getByteTimeDomainData(timeData)
        let sum = 0
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / timeData.length)
        rmsRef.current = rmsRef.current * 0.8 + rms * 0.2
        if (!freqData || freqData.length !== analyser.frequencyBinCount) {
          freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) as unknown as Uint8Array<ArrayBuffer>
        }
        analyser.getByteFrequencyData(freqData)
      } else {
        rmsRef.current *= 0.96
      }

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      ctx.clearRect(0, 0, width, height)

      const rms = rmsRef.current
      const now = performance.now()
      const last = lastFrameRef.current ?? now
      const dt = Math.min(0.05, Math.max(0.0, (now - last) / 1000))
      lastFrameRef.current = now
      const k = 6.0
      const c = 4.0
      const ax = -k * springXRef.current - c * springVRef.current
      springVRef.current += ax * dt
      springXRef.current += springVRef.current * dt
      const midY = Math.floor(height * 0.5)
      const points = Math.round(140 * S * SL * 1.5)
      let vol = Math.max(0, Math.min(1, valueRef.current))
      if (vol < 0.005) vol = 0
      const sliderL = 0
      const sliderRVisual = width
      const sliderW = Math.max(1, sliderRVisual - sliderL)
      // activity updated after band energies are computed
      const isActive = activityRef.current > 0.08
      const targetPlay = playing ? 1 : 0
      // smoother fade between color and white (more gradual to avoid snaps)
      playBlendRef.current += (targetPlay - playBlendRef.current) * 0.015

      let bass = 0, mid = 0, treble = 0
      let vocal = 0
      let bassCentroidHz = 80
      let crestFlatness = 2
      if (analyser && freqData) {
        const data = freqData
        const len = data.length
        const nyquist = analyser.context.sampleRate / 2
        // Compute mean and peak across a broad band to estimate noisiness (spectral flatness proxy)
        let sumAll = 0
        let peakAll = 0
        for (let i = 0; i < len; i++) {
          const v = data[i]
          sumAll += v
          if (v > peakAll) peakAll = v
        }
        const meanAll = sumAll / Math.max(1, len)
        const peakNorm = peakAll / 255
        const meanNorm = meanAll / 255
        const eps = 1e-6
        crestFlatness = peakNorm / Math.max(eps, meanNorm)
        const rangeAvg = (minHz: number, maxHz: number) => {
          const start = Math.max(0, Math.floor((minHz / nyquist) * len))
          const end = Math.min(len - 1, Math.floor((maxHz / nyquist) * len))
          if (end < start) return 0
          let s = 0
          for (let i = start; i <= end; i++) s += data[i]
          return (s / Math.max(1, end - start + 1)) / 255
        }
        const centroid = (minHz: number, maxHz: number) => {
          const start = Math.max(0, Math.floor((minHz / nyquist) * len))
          const end = Math.min(len - 1, Math.floor((maxHz / nyquist) * len))
          let sum = 0
          let weighted = 0
          for (let i = start; i <= end; i++) {
            const mag = data[i]
            const hz = (i / len) * nyquist
            sum += mag
            weighted += mag * hz
          }
          return sum > 0 ? weighted / sum : (minHz + maxHz) / 2
        }
        bass = rangeAvg(20, 250)
        mid = rangeAvg(250, 2000)
        treble = rangeAvg(2000, 8000)
        // vocal presence (formants) ~300-3400 Hz
        vocal = rangeAvg(300, 3400)
        bassCentroidHz = centroid(20, 250)
      }

      const overallAvg = (bass + mid + treble) / Math.max(1e-6, 3)
      const bassNorm = overallAvg > 0 ? bass / overallAvg : bass
      const bassDeltaInstant = Math.max(0, bassNorm - bassPrevRef.current)
        // Noise handling: when spectrum is flat (low crest), de-emphasize beat impulses
        const noiseFactor = Math.max(0, Math.min(1, (1.6 - crestFlatness) / 0.7))
        const heavyKick = (bassNorm > 1.1 && bassDeltaInstant > 0.035)
        const normalKick = (bassNorm > 0.65 && bassDeltaInstant > 0.02)
        if ((heavyKick || normalKick) && activityRef.current > 0.04) {
          const addCore = (heavyKick ? 1.0 : 0.65)
          const add = addCore * (1 - 0.6 * noiseFactor)
          iconBeatEnvRef.current = Math.min(1, iconBeatEnvRef.current + add)
        // forward pull on beats; reduce reverse build slightly
          const pull = (heavyKick ? 0.55 : 0.35) * (1 - 0.5 * noiseFactor)
          beatImpulseRef.current = Math.min(1, beatImpulseRef.current + pull)
          reverseBuildRef.current *= (1 - 0.25 * pull)
      }
      iconBeatEnvRef.current *= 0.92
      beatImpulseRef.current *= 0.92
      // energy envelope for intro/outro fade detection (biases toward bass)
      const energyInstant = Math.max(0, Math.min(1, 0.6 * bass + 0.3 * mid + 0.1 * treble + 0.25 * rms))
      energyEnvRef.current = energyEnvRef.current * 0.9 + energyInstant * 0.1
      const energySlope = energyEnvRef.current - energyPrevRef.current
      energyPrevRef.current = energyEnvRef.current
      // NOTE: slow-section accumulation moved below rhythm computation
      // vocal envelope for splitting
      const vocalDom = overallAvg > 0 ? vocal / overallAvg : vocal
      vocalEnvRef.current = vocalEnvRef.current * 0.85 + vocalDom * 0.15

      const targetActivity = Math.min(1, (0.65 * bass + 0.35 * rms) * 4.5)
      activityRef.current = activityRef.current * 0.9 + targetActivity * 0.1
      // rhythm emphasizes bass/drums; vocals shape forward pull nonlinearly
      const trebleDom = overallAvg > 0 ? treble / overallAvg : treble
      const v = Math.max(0, Math.min(1, vocalEnvRef.current))
      const weak = Math.max(0, (0.5 - v) / 0.5) // 1 at very weak vocals, 0 at >=0.5
      const strong = Math.max(0, (v - 0.7) / 0.3) // 0 below 0.7, up to 1 at 1.0
      const vocalFactor = 1 - 0.20 * weak + 0.08 * strong
      const rhythmRaw = (0.78 * bass + 0.25 * rms + 0.54 * bassDeltaInstant) * vocalFactor - 0.25 * Math.max(0, trebleDom - 0.3)
      const rhythm = Math.max(0.0, Math.min(1.0, rhythmRaw))

      // accumulate duration of clearly slow sections (few beats, low rhythm)
      const beatLevel = Math.max(0, Math.min(1, beatImpulseRef.current))
      const isClearlySlow = rhythm < (REVERSE_PARAMS.lowThresh * 0.95) && beatLevel < 0.18 && bassNorm < 0.9
      // Accumulating reverse build: short low-rhythm breaks won't flip immediately; sustained slow parts build reverse strength
      const lowThresh = REVERSE_PARAMS.lowThresh
      const highThresh = REVERSE_PARAMS.highThresh
      const wantReverse = (!playing || rhythm < lowThresh) ? 1 : 0
      const underAmt = !playing ? 1 : Math.max(0, (lowThresh - rhythm) / lowThresh)
      // reduce resistance to reverse further (overall up to ~40% stronger build)
      let buildUpRate = REVERSE_PARAMS.buildRateBase * (0.6 + 1.2 * underAmt)
      // decay faster (especially when rhythm is strong) to bias toward normal flow
      const decayBase = REVERSE_PARAMS.decayBase
      const decayBoost = (playing && rhythm > highThresh) ? 0.45 : 0
      let decayRate = decayBase + decayBoost
      // escape reverse ~50% easier when beats are present
      decayRate *= (1 + 0.5 * Math.max(0, Math.min(1, beatImpulseRef.current)))
      if (wantReverse) {
        reverseBuildRef.current = Math.min(1, reverseBuildRef.current + buildUpRate * dt)
      } else {
        reverseBuildRef.current = Math.max(0, reverseBuildRef.current - decayRate * dt)
      }
      // Additional reverse encouragement on intros/outros: low energy and falling (quicker reversals on fades)
      if (!playing || (energyEnvRef.current < 0.26 && energySlope < -0.004)) {
        const fadeBoost = (0.26 - Math.max(0, energyEnvRef.current)) * 1.4
        reverseBuildRef.current = Math.min(1, reverseBuildRef.current + fadeBoost * dt)
      }
      // Sticky hysteresis so flow sustains direction pleasantly (easier to enter/exit reverse)
      if (stickyDirRef.current === 1 && reverseBuildRef.current > REVERSE_PARAMS.stickyEnter) stickyDirRef.current = -1
      if (stickyDirRef.current === -1 && reverseBuildRef.current < REVERSE_PARAMS.stickyExit && (playing || rhythm > REVERSE_PARAMS.lowThresh)) stickyDirRef.current = 1

      let dirWanted = 1 - 2 * reverseBuildRef.current // 1 forward, -1 full reverse
      // beats/vocals bias, but reduced so reverse can still occur under sustained low rhythm
      const vocalPull = Math.max(0, vocalEnvRef.current - 0.2) * 0.10
      const rawBeat = Math.max(0, Math.min(1, beatImpulseRef.current))
      const beatGate = playing ? (rawBeat > REVERSE_PARAMS.beatGateMin ? (rawBeat - REVERSE_PARAMS.beatGateMin) / (1 - REVERSE_PARAMS.beatGateMin) : 0) : 0
      // inject robustness under noisy spectra: damp beat influence when flat
      const beatStrengthRaw = Math.pow(beatGate, 0.75)
      const beatStrength = beatStrengthRaw * (1 - 0.6 * Math.max(0, Math.min(1, (1.6 - crestFlatness) / 0.7)))
      // reduce vocal steering and remove forward bias; center around current intent
      const impulse = (beatStrength * 0.70 + vocalPull * 0.8)
      // mix sticky with instantaneous desire (less sticky to allow flips)
      dirWanted = 0.55 * stickyDirRef.current + 0.45 * dirWanted
      // symmetrical impulse nudges toward dirWanted rather than absolute +1
      const headroom = 1 - Math.abs(dirWanted)
      dirWanted += Math.sign(dirWanted || 1) * headroom * Math.max(0, Math.min(1, impulse))
      // smoother but more eager directional easing
      // If we're within the resume stabilization window, bias toward forward and reduce ease to avoid instant flip
      if (playing && performance.now() < resumeStabilizeUntilRef.current) {
        dirWanted = Math.max(dirWanted, 0.4)
      }
      const ease = dirWanted > flowDirRef.current ? 0.16 : 0.12
      flowDirRef.current += (dirWanted - flowDirRef.current) * ease
      let dir = Math.max(-1, Math.min(1, flowDirRef.current))
      // Stronger tempo scaling: very slow at low rhythm, fast at high rhythm
      const tempoScaled = Math.pow(rhythm, 1.5)
      const baseSpeed = (playing ? 0.24 : 0.12) + tempoScaled * (playing ? 0.90 : 0.42)
      const hoverSlow = 1 - 0.3375 * Math.min(1, interferenceRef.current)
      let speedFactor = baseSpeed * Math.max(0.8, hoverSlow)
      const playMod = playing ? (0.38 + 0.62 * playBlendRef.current) : 0.62
      speedFactor *= playMod
      // boost reverse magnitude globally by 30%; paused uses at least 50% more than before
      // Prevent stalling: enforce a minimum absolute direction based on reverse build
      const minAbsDir = 0.08 + 0.38 * reverseBuildRef.current
      if (Math.abs(dir) < minAbsDir) {
        // favor reverse earlier and under sustained low rhythm
        const preferReverse = (!playing) || reverseBuildRef.current > 0.48 || rhythm < 0.16
        dir = (preferReverse ? -1 : 1) * minAbsDir
        flowDirRef.current = dir
      }

      if (dir < 0) {
        // make reverse more eager and fun; allow up to +120% extra under low rhythm/paused
        const reverseExtra = REVERSE_PARAMS.reverseExtraMax * Math.max(0, 1 - rhythm)
        let reverseGain = (1.12 + 0.55 * reverseBuildRef.current) * (1 + 0.6 * reverseExtra)
        // Global reverse boost (+30%)
        reverseGain *= REVERSE_PARAMS.reverseGlobalBoost
        // bias reverse speed by vocals/treble presence (notes) rather than drums
        const revVocalBias = Math.max(0, Math.min(1, (vocalEnvRef.current - 0.1)))
        const revTrebleBias = trebleDom
        const revBiasMul = 1 + 0.50 * revVocalBias + 0.25 * revTrebleBias
        reverseGain *= revBiasMul
        // Additional +30% when paused or near-silent
        const nearSilent = rmsRef.current < 0.06 || rhythm < 0.08
        if (!playing || nearSilent) {
          // remove resistance entirely when near silent
          reverseGain *= REVERSE_PARAMS.reversePausedOrSilentBoost
        }
        speedFactor *= reverseGain
        // cap should be higher when rhythm is low, lower when high to avoid racing on peaks (and +15% max)
        const cap = 1.15 * baseSpeed * (1.8 - 0.5 * Math.max(0, Math.min(1, rhythm)))
        speedFactor = Math.min(speedFactor, cap)
      }
      // slight resistance to forward (left) flow; drums help march it along
      if (dir > 0) {
        // Apply up to 40% slowdown when near silent, smoothly via gradient
        const silenceGrad = Math.max(0, Math.min(1, 1 - Math.max(rhythm, Math.min(1, rms * 6))))
        const slowMul = 1 - 0.40 * silenceGrad
        speedFactor *= 0.95 * slowMul
        speedFactor += 0.10 * beatStrength
      }
      // beats push proportionally in pulses (both directions), helps reach max
      speedFactor += 0.30 * beatStrength
      if (!playing || rhythm < 0.05) {
        // paused reverse should still flow; nudge speed up while paused
        speedFactor = Math.max(0.26, speedFactor * (playing ? 1 : 1.35))
      }
      // never stop completely; keep subtle motion even when paused/quiet
      speedFactor = Math.max(0.12, speedFactor)
      // Smooth signed flow rate to avoid stutter
      const targetRate = dir * speedFactor
      // faster response but smooth
      flowRateRef.current += (targetRate - flowRateRef.current) * 0.14
      const rate = flowRateRef.current
      // Update color front position: when playing, color slides from the icon (right side) toward left at flow speed; when paused, retracts
      {
        const flowMag = Math.min(2.0, Math.abs(rate))
        const baseSpeed = 0.55
        // Speed scales with flow; reverse retract is even faster
        let speedMul = baseSpeed * (1 + 0.8 * flowMag)
        const dirFront = playing ? 1 : -1
        if (!playing) speedMul *= 6.125
        if (lastPlayingRef.current !== playing) {
          colorFrontRef.current = playing ? 0.02 : 0.98
        }
        colorFrontRef.current = Math.max(0, Math.min(1, colorFrontRef.current + dirFront * flowMag * dt * speedMul))
      }
      phasesRef.current.bass += (0.005 + bass * 0.016 + rms * 0.008) * rate
      phasesRef.current.mid += (0.008 + mid * 0.020 + rms * 0.009) * rate
      phasesRef.current.treble += (0.010 + treble * 0.025 + rms * 0.010) * rate

      const computeBand = (
        cycles: number,
        ampPx: number,
        phase: number,
        splitSign: number,
        endX: number,
        baseWidth: number,
        bandKey: 'bass' | 'mid' | 'treble'
      ) => {
        const xs: number[] = []
        const ys: number[] = []
        const ws: number[] = []
        const ts: number[] = []
        if (endX <= sliderL) return { xs, ys, ws, ts }
        for (let i = 0; i <= points; i++) {
          const x = sliderL + (i / points) * Math.max(0, endX - sliderL)
          const prog = (x - sliderL) / sliderW
          const px = pointerXRef.current
          const shift = draggingRef.current ? 0 : (springXRef.current * 0.5)
          const pulledProg = ((x + shift) - sliderL) / sliderW
          const wv = 2 * Math.PI * (pulledProg * cycles + phase)
          const span = Math.max(1, endX - sliderL)
          const envBase = (x - sliderL) / span
          const env = Math.sin(Math.PI * Math.min(1, envBase)) ** 1.05
          let ripple = 0
          if (px != null) {
            const dx = x - px
            // Band-specific proximity primarily moves the wave instead of wiggling
            const bandSigmaMul = bandKey === 'bass' ? 1.25 : bandKey === 'mid' ? 1.1 : 0.95
            const bandAmpMul = bandKey === 'bass' ? 0.7 : bandKey === 'mid' ? 0.55 : 0.45
            const sigma = Math.max(36, sliderW * 0.36 * bandSigmaMul)
            const g = Math.exp(-(dx * dx) / (2 * sigma * sigma))
            // favor displacement (low freq wobble) over high-frequency wiggle
            // Stronger, wider X-axis influence: increase amplitude and widen sigma response via exp power
            const gWide = Math.pow(g, 0.8)
            const jiggle = Math.sin(2 * Math.PI * (pulledProg * 1.2 + phase * 0.18))
            // Reduce overall sensitivity by ~20% and add low-pass blend with previous y to avoid harsh jiggles
            const amp = 7.4 * gWide * Math.min(1.4, interferenceRef.current) * bandAmpMul
            ripple += jiggle * amp
          }
          // traveling pluck waves (both directions) emanating from last plucks
          if (plucksRef.current.length > 0) {
            const tempo = rhythm
            const speedPx = (36 + 340 * tempo) * (0.8 + 0.2 * playBlendRef.current)
            const sigmaPluck = Math.max(18, sliderW * (0.10 - 0.05 * tempo))
            for (const p of plucksRef.current) {
              const age = Math.max(0, (now - p.t) / 1000)
              const decay = Math.exp(-age / 0.9)
              const bandAmp = bandKey === 'bass' ? 1.0 : bandKey === 'mid' ? 0.85 : 0.7
              const amp = bandAmp * p.intensity * (0.5 + 0.8 * tempo) * decay
              const fronts = [p.x - speedPx * age, p.x + speedPx * age]
              for (const fx of fronts) {
                const dxf = x - fx
                const gf = Math.exp(-(dxf * dxf) / (2 * sigmaPluck * sigmaPluck))
                ripple += gf * amp * Math.sin(2 * Math.PI * (age * (1.2 + 1.8 * tempo) + phase * 0.15))
              }
            }
          }
          // Widen separation across more of the span; keep tight only at extreme ~5% ends
          const progEdge = (x - sliderL) / sliderW
          const edgeGate = Math.max(0, Math.min(1, (progEdge - 0.05) / 0.90))
          const centerW = Math.sin(Math.PI * edgeGate)
          const splitEnv = Math.sin(Math.PI * Math.min(1, envBase)) ** 1.8
          // reduce vocal effect by ~30% and keep it purely a split visual (no speed coupling)
          const vocalSplitMul = 1 + 0.63 * Math.max(0, vocalEnvRef.current - 0.15) * (0.5 + 0.5 * playBlendRef.current)
          const split = splitSign * (centerW ** 1.15) * splitEnv * (px != null ? 7.5 : 6.5) * volGate * vocalSplitMul
          const yNoRipple = midY + (Math.sin(wv) * ampPx) * env + split
          // focus effect on the band nearest to pointer Y
          const py = pointerYRef.current
          const yWeight = py != null ? Math.exp(-((yNoRipple - py) * (yNoRipple - py)) / (2 * Math.max(6, (trackH * 2)) ** 2)) : 1
          // ensure ends stay converged: gate ripple strongly near both ends
          const edgeGate2 = Math.sin(Math.PI * Math.min(1, (x - sliderL) / Math.max(1, endX - sliderL))) ** 3
          xs.push(x)
          ys.push(yNoRipple + (ripple * yWeight * edgeGate2))
          const thicknessEnv = Math.max(0, Math.sin(Math.PI * envBase) ** 1.25)
          const minW = trackH
          const bandInflateMul = bandKey === 'bass' ? 0.4 : bandKey === 'mid' ? 0.35 : 0.3
          const localInflate = px != null ? Math.exp(-((x - px) * (x - px)) / (2 * Math.max(28, sliderW * 0.14) ** 2)) : 0
          const lw = (minW + (baseWidth - minW) * thicknessEnv) * (1 + bandInflateMul * localInflate)
          ws.push(lw)
          ts.push(envBase)
        }
        return { xs, ys, ws, ts }
      }

      const strokeSegments = (baseColor: string, alpha: number, band: { xs: number[]; ys: number[]; ws: number[]; ts: number[] }) => {
        ctx.save()
        const activity = Math.max(0, Math.min(1, activityRef.current))
        const baseAlpha = Math.max(0.2, alpha * (0.35 + 0.65 * activity))
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        const { xs, ys, ws, ts } = band
        const volEff = Math.max(0, Math.min(1, effectiveVolRef.current))
        const signal = Math.max(0, Math.min(1, rmsRef.current * 4))
        const smoothstepSat = (a: number, b: number, x: number) => {
          const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
          return t * t * (3 - 2 * t)
        }
        // Full saturation by ~15% effective volume; also consider signal but never below volume gate
        const volSat = smoothstepSat(0.0, 0.15, volEff)
        const sigSat = smoothstepSat(0.10, 0.45, signal)
        const sat = Math.max(0, Math.min(1, Math.max(volSat, sigSat * volSat)))
        const hexToRgb = (hex: string) => {
          const h = hex.replace('#', '')
          const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
          return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
        }
        const { r: br, g: bg, b: bb } = hexToRgb(baseColor)
        const mix = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t))
        const smoothstepSeg = (a: number, b: number, x: number) => {
          const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
          return t * t * (3 - 2 * t)
        }
        // Spatial color gate based on sliding front position
        const front = Math.max(0, Math.min(1, colorFrontRef.current))
        // t is 0 at left, 1 at right; the icon sits at the right side where waves end
        // frontT is the transition position sliding left from the icon
        const frontT = 1 - front
        const softness = 0.08
        const colorGateAt = (tx: number) => {
          const tt = Math.max(0, Math.min(1, (tx - (frontT - softness)) / (2 * softness)))
          return tt * tt * (3 - 2 * tt)
        }
        for (let i = 1; i < xs.length; i++) {
          ctx.lineWidth = ws[i]
          const t = ts[i]
          // Shorten and dim white tips during playback
          const tipLen = 0.18 * 0.75
          const leftW = 1 - smoothstepSeg(0.02, tipLen, t)
          const rightW = 1 - smoothstepSeg(0.02, tipLen, 1 - t)
          const tipWhite = Math.max(leftW, rightW)
          const quietBoost = Math.max(0, 1 - sat)
          const edgeWhitenBase = 0.38 * 0.7 // 30% less brightness
          const edgeWhiten = Math.max(tipWhite * (edgeWhitenBase + 0.16 * quietBoost), 0)
          const centerBoost = Math.sin(Math.PI * Math.max(0, Math.min(1, t)))
          const baseGrey = 215
          const peakGrey = 248
          const pausedGrey = Math.round(mix(baseGrey, peakGrey, 0.45))
          const playBlend = playing ? 1 : 0
          // Gate color by the spatial front; add a subtle leading trail ahead of the front
          const spatialGate = colorGateAt(t)
          const leadWidth = softness * 1.4
          const ttLead = Math.max(0, Math.min(1, (t - (frontT - leadWidth)) / (2 * leadWidth)))
          const leadGate = ttLead * ttLead * (3 - 2 * ttLead)
          let colorMix = Math.max(0, Math.min(1, sat * (1 - edgeWhiten))) * spatialGate
          // enforce at least 80% saturation while playing, except near tips and at very low volume
          const volEff = Math.max(0, Math.min(1, effectiveVolRef.current))
          // Gradual saturation that reaches max at higher volume; extend to 16 (normalized ~1.0)
          const minWhilePlaying = 0.8 * Math.max(0, Math.min(1, (volEff - 0.01) / 0.99))
          const tipDeemphasis = 1 - tipWhite
          const minMix = (playing ? minWhilePlaying * tipDeemphasis : 0)
          // Only allow a small minimum color ahead of the front as a leading glow
          const minMixEffective = 0.18 * minMix * leadGate
          colorMix = Math.max(colorMix, minMixEffective)
          // proximity-driven glow: stronger near cursor, not instant max
          const px = pointerXRef.current
          let glow = 0
          if (px != null) {
            const dx = xs[i] - px
            const sigma = Math.max(14, sliderW * 0.16)
            const gx = Math.exp(-(dx * dx) / (2 * sigma * sigma))
            // include vertical proximity for stronger localization
            const py = pointerYRef.current
            const gy = py != null ? Math.exp(-((ys[i] - py) * (ys[i] - py)) / (2 * Math.max(12, trackH * 2.2) ** 2)) : 1
            const prox = gx * gy * Math.min(4.2, interferenceRef.current)
            glow = Math.min(1, Math.pow(prox, 1.10))
          }
          // Reduce glow while paused by 40%
          const alphaLocal = baseAlpha * (1 + 0.24 * glow) * (playing ? 1 : 0.6)
          ctx.globalAlpha = alphaLocal
          // band-specific glow lift so they don't brighten equally
          const bandLift = baseColor === BAND_COLORS.bass ? 0.16 : baseColor === BAND_COLORS.mid ? 0.13 : 0.10
          colorMix = Math.min(1, colorMix + bandLift * glow)
          // Always derive final RGB from spatial colorMix so slide is spatial, not global
          const widen = Math.pow(Math.max(0, Math.sin(Math.PI * Math.max(0, Math.min(1, t)))), 0.6)
          const greyAmt = 0.12 * widen
          const baseWhite = Math.round(mix(255, pausedGrey, greyAmt))
          const rCol = Math.round(mix(255, br, colorMix * 0.9))
          const gCol = Math.round(mix(255, bg, colorMix * 0.9))
          const bCol = Math.round(mix(255, bb, colorMix * 0.9))
          let r = Math.round(mix(baseWhite, rCol, colorMix))
          let g = Math.round(mix(baseWhite, gCol, colorMix))
          let b = Math.round(mix(baseWhite, bCol, colorMix))
          ctx.strokeStyle = `rgb(${r},${g},${b})`
          ctx.beginPath()
          ctx.moveTo(xs[i - 1], ys[i - 1])
          ctx.lineTo(xs[i], ys[i])
          ctx.stroke()
        }
        ctx.restore()
      }

      const inactiveScale = 0.65 + activityRef.current * 0.35
      const tighten = 0.64
      const gate = (v: number) => {
        const t = Math.max(0, Math.min(1, (v - 0.03) / (0.1 - 0.03)))
        return t * t * (3 - 2 * t)
      }
      const volGate = gate(vol)
      const pauseAmpScale = 1 - 0.35 * (1 - playBlendRef.current)
      // richer band dynamics for more diversity
      const ampBass = pauseAmpScale * (0.25 + 0.75 * volGate) * 0.70 * (tighten * inactiveScale * Math.min(24, 10 + bass * 12 + rms * 9))
      const ampMid = pauseAmpScale * (0.25 + 0.75 * volGate) * 0.68 * (tighten * inactiveScale * Math.min(20, 8 + mid * 9 + rms * 7))
      const ampTreble = pauseAmpScale * (0.25 + 0.75 * volGate) * 0.66 * (tighten * inactiveScale * Math.min(16, 6 + treble * 7 + rms * 6))

      // rotate which band is "top" over time by slightly phase-shifting cycles
      const rot = (now / 24000) % 1
      // slightly wider cycle variation for visual diversity
      const cycBass = 0.58 + bass * 0.55 + rms * 0.07 + rot * 0.15
      const cycMid = 0.98 + mid * 0.80 + rms * 0.09 + rot * 0.15
      const cycTreble = 1.68 + treble * 1.10 + rms * 0.11 + rot * 0.15

      const knobY = midY
      const iconH = 18 * S * 0.75 * 1.5 * 0.7
      const iconW = 18 * S * 0.75 * 1.5 * 0.7
      const broad = 0.35 * bass + 0.35 * mid + 0.30 * treble
      const targetPulse = Math.min(1, (broad * 1.0 + rms * 0.30) * 1.25)
      iconPulseRef.current = iconPulseRef.current * 0.82 + targetPulse * 0.18
      // increase pause icon reaction by ~15% and raise max size slightly
      const basePulse = 0.06 * 1.15
      const beatBoost = 0.16 * 1.15
      const pauseBoost = 0.10
      const pulseScale = playing
        ? 1 + basePulse * iconPulseRef.current + beatBoost * iconBeatEnvRef.current
        : 1 + pauseBoost
      const halfWScaled = (iconW * pulseScale) / 2
      iconHalfWRef.current = halfWScaled
      const halfHScaled = (iconH * pulseScale) / 2
      const sliderEnd = sliderRVisual
      const targetEnd = sliderL + vol * (sliderEnd - sliderL)
      // allow icon to overhang so left face reaches exact 0%/100%
      const waveEndX = Math.max(sliderL, Math.min(sliderEnd, targetEnd))
      // drawX centers the icon; the left face must align exactly with waveEndX
      const drawX = waveEndX + halfWScaled
      const ixScaled = drawX - halfWScaled

      const trackH = 1 * S * (SL * 0.55)
      const trackY = midY - trackH / 2
      // ultra-thin remainder line from icon right edge to end; never draw under the icon
      ctx.save()
      const segments = 200
      const startX = waveEndX
      // Compute precise right edge for both play triangle and pause bars
      let iconRight = ixScaled
      if (playing) {
        const barW = Math.max(4 * S * 0.75, 4)
        const gap = Math.max(4 * S * 0.75, 4)
        const rightLocal = (barW + gap + barW)
        iconRight = ixScaled + rightLocal * pulseScale
      } else {
        // play triangle apex ends at approx two-bars width minus padding
        const barW = Math.max(4 * S * 0.75, 4)
        const gap = Math.max(4 * S * 0.75, 4)
        const triW = (barW + gap + barW) - 3
        iconRight = ixScaled + triW * pulseScale
      }
      const startRender = Math.max(startX, iconRight)
      if (startRender < sliderEnd) {
        ctx.beginPath()
        for (let i = 0; i <= segments; i++) {
          const t = i / segments
          const x = startRender + t * (sliderEnd - startRender)
          const y = midY
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = GREY_TRACK
        ctx.lineWidth = Math.max(1, trackH * 0.65)
        ctx.lineCap = 'round'
        ctx.globalAlpha = 0.5
        ctx.stroke()
        // joiner to ensure flush with icon right edge
        ctx.beginPath()
        ctx.moveTo(iconRight, midY)
        ctx.lineTo(iconRight + 0.01, midY)
        ctx.stroke()
      }
      ctx.restore()

      const bandBass = computeBand(cycBass, ampBass, phasesRef.current.bass + 0.00, -1, waveEndX, 1.2 * S, 'bass')
      const bandMid = computeBand(cycMid, ampMid, phasesRef.current.mid + 0.28, 0, waveEndX, 1.0 * S, 'mid')
      const bandTreble = computeBand(cycTreble, ampTreble, phasesRef.current.treble + 0.56, +1, waveEndX, 0.85 * S, 'treble')
      // Rotate draw order so one band isn't always on top
      const orders = [
        [ ['bass', bandBass], ['mid', bandMid], ['treble', bandTreble] ],
        [ ['mid', bandMid], ['treble', bandTreble], ['bass', bandBass] ],
        [ ['treble', bandTreble], ['bass', bandBass], ['mid', bandMid] ],
      ] as const
      const idx = Math.floor((now / 4000) % 3)
      for (const [name, band] of orders[idx] as any) {
        const color = (BAND_COLORS as any)[name]
        strokeSegments(color, 1, band)
      }

      ctx.save()
      const knobYExact = Math.round(knobY) + 0.5
      // draw icon on overlay to avoid clipping at right edge
      const iconCanvas = iconCanvasRef.current
      const ictx = iconCanvas?.getContext('2d') || null
      if (ictx && iconCanvas) {
        ictx.clearRect(0, 0, iconCanvas.width, iconCanvas.height)
        ictx.save()
        ictx.translate(ixScaled, knobYExact)
        ictx.scale(pulseScale, pulseScale)
        ictx.fillStyle = WHITE
        const halfH = iconH / 2
        if (playing) {
          const barW = Math.max(4 * S * 0.75, 4)
          const gap = Math.max(4 * S * 0.75, 4)
          ictx.fillRect(0, -halfH + 3 * S * 0.75, barW, iconH - 6 * S * 0.75)
          ictx.fillRect(barW + gap, -halfH + 3 * S * 0.75, barW, iconH - 6 * S * 0.75)
        } else {
          ictx.beginPath()
          ictx.moveTo(0, -halfH + 3)
          ictx.lineTo(iconW - 3, 0)
          ictx.lineTo(0, halfH - 3)
          ictx.closePath()
          ictx.fill()
        }
        ictx.restore()
      }
      ctx.restore()
      const iyScaledRounded = knobYExact - halfHScaled
      iconRectRef.current = { x: ixScaled, y: iyScaledRounded, w: iconW * pulseScale, h: halfHScaled * 2 }
      // ensure waves visually flush to icon face: draw a 1px joiner to cover subpixel gaps
      ctx.save()
      ctx.strokeStyle = WHITE
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(waveEndX, knobYExact)
      ctx.lineTo(waveEndX + 0.01, knobYExact)
      ctx.stroke()
      ctx.restore()
      ctx.restore()

      bassPrevRef.current = bassNorm

      interferenceRef.current = Math.max(0, Math.min(1.2, interferenceRef.current * 0.93))
      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [analyser, playing])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

      const getValFromEvent = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const usable = Math.max(1, rect.width)
        const clamped = Math.max(0, Math.min(rect.width, x))
        const pct = clamped / usable
        return Math.max(0, Math.min(1, pct))
      }

    const onDown = async (e: PointerEvent) => {
      if (disabledRef.current) return
      try { await ensureGraphRef.current?.() } catch {}
      suppressClickRef.current = false
      const rectHit = canvas.getBoundingClientRect()
      const hx = e.clientX - rectHit.left
      const hy = e.clientY - rectHit.top
      const { x: ix, y: iy, w: iw, h: ih } = iconRectRef.current as any
      const m = 3
      if (hx >= ix - m && hx <= ix + iw + m && hy >= iy - m && hy <= iy + ih + m) {
        iconDownRef.current = true
        iconMovedRef.current = false
        iconStartRef.current = { x: hx, y: hy, t: performance.now() }
        try { canvas.setPointerCapture(e.pointerId) } catch {}
        return
      }
      iconDownRef.current = false
      iconMovedRef.current = false
      draggingRef.current = true
      try { canvas.setPointerCapture(e.pointerId) } catch {}
      canvas.style.cursor = 'ew-resize'
      // lock icon center under cursor during drag
      const usable = Math.max(1, rectHit.width)
      const v = Math.max(0, Math.min(1, (hx - iconHalfWRef.current) / usable))
      onChangeRef.current(v)
      const rect0 = canvas.getBoundingClientRect()
      const normX0 = Math.max(0, Math.min(1, (e.clientX - rect0.left) / rect0.width))
      const target0 = normX0 * 2 - 1
      springXRef.current = target0
      springVRef.current = 0
    }
    const onMove = (e: PointerEvent) => {
      const rectHit = canvas.getBoundingClientRect()
      const hx = e.clientX - rectHit.left
      const hy = e.clientY - rectHit.top
      const { x: ix, y: iy, w: iw, h: ih } = iconRectRef.current as any
      if (hx >= ix && hx <= ix + iw && hy >= iy && hy <= iy + ih) {
        canvas.style.cursor = 'pointer'
      } else if (!draggingRef.current) {
        canvas.style.cursor = 'auto'
      }
      if (iconDownRef.current) {
        const d = Math.hypot(hx - iconStartRef.current.x, hy - iconStartRef.current.y)
        if (d > 6 && !draggingRef.current) {
          draggingRef.current = true
          iconMovedRef.current = true
          suppressClickRef.current = true
        }
        if (draggingRef.current) {
          // keep icon center under cursor X
          const usable = Math.max(1, rectHit.width)
          const clamped = Math.max(0, Math.min(rectHit.width, hx))
          const v = Math.max(0, Math.min(1, (clamped - iconHalfWRef.current) / usable))
          onChangeRef.current(v)
          const normX = v
          const target = normX * 2 - 1
          springXRef.current = target
          springVRef.current = 0
        }
        return
      }
      if (!draggingRef.current) return
      // lock X-axis like wordmark; place icon center under cursor
      const v = Math.max(0, Math.min(1, ((hx - iconHalfWRef.current) / Math.max(1, rectHit.width))))
      onChangeRef.current(v)
      const target2 = v * 2 - 1
      springXRef.current = target2
      springVRef.current = 0
    }
    const onUp = (e: PointerEvent) => {
      if (iconDownRef.current) {
        if (!iconMovedRef.current) {
          onTogglePlayRef.current()
          lastToggleAtRef.current = performance.now()
        } else {
          suppressClickRef.current = true
        }
        draggingRef.current = false
        iconDownRef.current = false
        iconMovedRef.current = false
        canvas.style.cursor = 'auto'
        return
      }
      if (draggingRef.current) {
        suppressClickRef.current = true
      }
      draggingRef.current = false
      try { canvas.releasePointerCapture(e.pointerId) } catch {}
      canvas.style.cursor = 'auto'
    }

    const onClick = async (e: MouseEvent) => {
      if (disabledRef.current) return
      if (suppressClickRef.current) { suppressClickRef.current = false; return }
      if (performance.now() - lastToggleAtRef.current < 200) return
      try { await ensureGraphRef.current?.() } catch {}
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const { x: ix, y: iy, w: iw, h: ih } = iconRectRef.current
      const m = 3
      if (x >= ix - m && x <= ix + iw + m && y >= iy - m && y <= iy + ih + m) {
        onTogglePlayRef.current()
        lastToggleAtRef.current = performance.now()
      }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('click', onClick)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('click', onClick)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const toLocalX = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return e.clientX - r.left
    }
    const toLocalY = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return e.clientY - r.top
    }
    const onHover = (e: PointerEvent) => {
      if (disabledRef.current) return
      // Use viewport coords so we can compute position even when outside canvas
      const r = canvas.getBoundingClientRect()
      pointerXRef.current = e.clientX - r.left
      pointerYRef.current = e.clientY - r.top
      const px = pointerXRef.current
      const py = pointerYRef.current
      if (px == null || py == null) { interferenceRef.current = 0; return }
      // extend interaction beyond canvas bounds (50% larger)
      const bleed = Math.max(24, EDGE_BLEED * 2.4)
      const sliderLLocal = -bleed
      const sliderRInteractiveLocal = (canvas.clientWidth + bleed)
      const clampX = Math.max(sliderLLocal, Math.min(sliderRInteractiveLocal, px))
      const dx = clampX - px
      const ry = Math.abs(py - (canvas.clientHeight * 0.5))
      const dist = Math.hypot(dx, ry)
      const radius0 = Math.max(12, (canvas.clientWidth + bleed * 2) * 0.22)
      const t0 = Math.max(0, 1 - dist / radius0)
      // stronger and more localized effect; influence begins before canvas bounds
      // expand the interactive corridor beyond the visual bounds
      const pxBleed = Math.max(-bleed, Math.min(canvas.clientWidth + bleed, px))
      const dxBleed = pxBleed - px
      const distBleed = Math.hypot(dx + dxBleed, ry)
      // Shrink glow radius by 40% for stronger localization
      const radius1 = Math.max(12, (canvas.clientWidth + bleed * 2) * 0.22 * 0.6)
      const t1 = Math.max(0, 1 - distBleed / radius1)
      const targetInterf = Math.min(4.2, Math.pow(t1, 1.0) * 4.2)
      interferenceRef.current += (targetInterf - interferenceRef.current) * 0.30
      const prev = prevPxRef.current
      if (prev != null) {
        const dx = pointerXRef.current - prev
        const width = canvas.clientWidth
        const offset = Math.max(-0.12, Math.min(0.12, (dx / Math.max(1, width)) * 6))
        springVRef.current += (offset - springXRef.current) * 0.23
        if (Math.abs(dx) > width * 0.2) {
          springVRef.current += -Math.sign(springXRef.current) * 0.4
        }
        const magnet = (t1 * 0.25)
        springVRef.current += (magnet - springXRef.current) * 0.10
      }
      prevPxRef.current = pointerXRef.current
    }
    const onLeave = () => {
      pointerXRef.current = null
      pointerYRef.current = null
      springVRef.current += -springXRef.current * 0.8
    }
    const onClickPluck = (e: PointerEvent) => {
      const x = toLocalX(e)
      const intensity = Math.min(1, 0.6 + Math.abs(springXRef.current) * 0.5)
      plucksRef.current.push({ x, t: performance.now(), intensity })
      if (plucksRef.current.length > 6) plucksRef.current.shift()
    }
    canvas.addEventListener('pointermove', onHover)
    canvas.addEventListener('pointerenter', onHover)
    canvas.addEventListener('pointerleave', onLeave)
    // Listen globally so hover effects work when cursor is near/outside canvas
    window.addEventListener('pointermove', onHover)
    window.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onClickPluck)
    return () => {
      canvas.removeEventListener('pointermove', onHover)
      canvas.removeEventListener('pointerenter', onHover)
      canvas.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointermove', onHover)
      window.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onClickPluck)
    }
  }, [])

  return (
    <div className="w-full flex justify-center">
      <canvas ref={canvasRef} className="w-full h-[56px] max-w-4xl block bg-transparent select-none touch-none overflow-visible" />
      <input
        aria-label="Volume"
        className="sr-only"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChangeRef.current(Number(e.target.value))}
      />
    </div>
  )
}


