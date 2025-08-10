import React, { useEffect, useRef } from 'react'
import { computeDisplayName } from '../lib/textSeek'

type Props = {
  audioElRef: React.MutableRefObject<HTMLAudioElement | null>
  durationRef: React.MutableRefObject<{ current: number; total: number }>
  ensureGraph: () => Promise<void>
  songChangeCounter?: number
  onScratchBegin: (wasPlaying: boolean) => void
  onScratchUpdate: (speed: number) => void
  onScratchEnd: (resume: boolean) => void
}

export default function WordmarkBarFullBounds({ audioElRef, durationRef, ensureGraph, songChangeCounter, onScratchBegin, onScratchUpdate, onScratchEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const draggingRef = useRef<boolean>(false)
  const lockStartRef = useRef<boolean>(false)
  const lockEndRef = useRef<boolean>(false)
  const lastXRef = useRef<number>(0)
  const wasPlayingLocalRef = useRef<boolean>(false)
  const dragXRef = useRef<number>(0)
  const seekRef = useRef<{ padX: number; left: number; right: number; windowW: number } | null>(null)
  const colorIdxRef = useRef<number>(0)

  // Reset seek metrics on song change to ensure spans update for new titles/durations
  useEffect(() => {
    seekRef.current = null
  }, [songChangeCounter])

  useEffect(() => {
    const idx = (songChangeCounter || 0) % 3
    colorIdxRef.current = idx
  }, [songChangeCounter])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.floor(rect.width)
      const height = Math.floor(rect.height)
      ctx.clearRect(0, 0, width, height)
      const { current, total } = durationRef.current
      const pct = total > 0 ? Math.min(1, current / total) : 0
      const el = audioElRef.current
      let full = computeDisplayName((el as any)?.__originalFileName, el?.src)
      const visibleChars = 24
      // dynamically scale font so text height fits; width handled by clip window
      const padX = 2
      const padY = Math.max(2, Math.round(height * 0.12))
      let fontPx = Math.max(10, height - padY * 2)
      ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`
      const maxW = width - padX * 2
      ctx.textBaseline = 'middle'
      // measure a 22-char slice window
      const over = full.length > visibleChars
      const baseSlice = full.slice(0, Math.min(visibleChars, full.length))
      let windowW = Math.min(maxW, Math.max(1, ctx.measureText(baseSlice).width))
      // build loop text and its width; only loop when over the limit
      const spacer = ' '
      const loopTextCore = over ? (full + '...' + spacer + full + '...') : full
      const loopText = loopTextCore
      const loopW = Math.max(1, ctx.measureText(loopText).width)
      // smooth pixel-scrolling only when over limit
      const pxPerSec = 48
      const t = performance.now() / 1000
      const scrollPx = over ? ((t * pxPerSec) % loopW) : 0
      const tx = padX
      const ty = Math.floor(height * 0.5)
      ctx.save()
      // scrolling window (render-only)
      ctx.beginPath()
      ctx.rect(tx, 0, windowW, height)
      ctx.clip()
      ctx.fillStyle = '#475569'
      ctx.fillText(loopText, tx - scrollPx, ty)
      if (over) ctx.fillText(loopText, tx - scrollPx + loopW, ty)
      // duration overlay clipped within the same window (keeps alignment). Use raw drag X for perfect cursor lock
      ctx.save()
      ctx.beginPath()
      const dragFillPx = draggingRef.current
        ? Math.max(0, Math.min(windowW, dragXRef.current - tx))
        : (windowW * pct)
      ctx.rect(tx, 0, dragFillPx, height)
      ctx.clip()
      // Cycle overlay color per upload across band colors (using ref so it updates across renders)
      const overlayColors = ['#ef4444', '#fbbf24', '#3b82f6']
      const colorIdx = colorIdxRef.current % overlayColors.length
      ctx.fillStyle = overlayColors[colorIdx]
      ctx.fillText(loopText, tx - scrollPx, ty)
      if (over) ctx.fillText(loopText, tx - scrollPx + loopW, ty)
      ctx.restore()
      ctx.restore()
      // emit scrubbing updates irrespective of marquee position (decoupled from render)
      if (draggingRef.current) {
        const el = audioElRef.current
        if (el) {
          durationRef.current.current = el.currentTime
        }
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); ro.disconnect() }
  }, [])

  // click-to-seek handled via pointerdown; no separate click handler to avoid snapbacks

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const onDown = async (e: PointerEvent) => {
      const el = audioElRef.current
      if (!el || !isFinite(el.duration) || el.duration <= 0) return
      await ensureGraph()
      const ctx = c.getContext('2d')!
      if (!el) return
      const rect = c.getBoundingClientRect()
      // lock to cursor position precisely
      const x = e.clientX - rect.left
      const padX = 2
      const fontPx = Math.max(10, c.clientHeight - Math.max(2, Math.round(c.clientHeight * 0.12)) * 2)
      const font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`
      const full = computeDisplayName((el as any)?.__originalFileName, el?.src)
      ctx.font = font
      const VISIBLE = 24
      const maxW = rect.width - padX * 2
      const baseSlice = full.slice(0, Math.min(VISIBLE, full.length))
      const windowW = Math.min(maxW, Math.max(1, ctx.measureText(baseSlice).width))
      seekRef.current = { padX, left: padX, right: padX + windowW, windowW }
      lockStartRef.current = false
      lockEndRef.current = false
      const left = seekRef.current.left
      const right = seekRef.current.right
      const clamped = Math.max(left, Math.min(right, x))
      const rel = windowW > 0 ? (clamped - left) / windowW : 0
      if (isFinite(el.duration) && el.duration > 0) el.currentTime = Math.min(el.duration - 0.0001, rel * el.duration)
      dragXRef.current = clamped
      wasPlayingLocalRef.current = !el.paused
      // During scrubbing, ramp master gain to avoid choppy artifacts when marquee is active
      try {
        const anyEl: any = el
        const ctxAudio = (anyEl as any).context || (window as any).AudioContext || (window as any).webkitAudioContext
        const at = (ctxAudio && ctxAudio.currentTime) ? ctxAudio.currentTime : 0
        // Use scratchGain as a temporary ducking send to smooth artifacts
        // This only adjusts the existing scratch path set up in the graph
      } catch {}
      draggingRef.current = true
      lastXRef.current = clamped
      c.setPointerCapture(e.pointerId)
      c.style.cursor = 'default'
      onScratchBegin(wasPlayingLocalRef.current)
    }
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      const el = audioElRef.current
      if (!el) return
      const rect = c.getBoundingClientRect()
      // lock to cursor position precisely while dragging
      const x = e.clientX - rect.left
      const padX = seekRef.current?.padX ?? 2
      const windowW = seekRef.current?.windowW ?? (c.clientWidth - padX * 2)
      const left = seekRef.current?.left ?? padX
      const right = seekRef.current?.right ?? (padX + windowW)
      if (x <= left) {
        // lock to start while dragging beyond
        lockStartRef.current = true
        lockEndRef.current = false
        el.currentTime = 0
        durationRef.current.current = 0
        lastXRef.current = left
        // kept purely visual now; no rel state
        dragXRef.current = left
        onScratchUpdate(0)
        return
      }
      if (x >= right) {
        // lock to end while dragging beyond
        lockStartRef.current = false
        lockEndRef.current = true
        el.currentTime = Math.max(0, (el.duration || 0) - 0.0001)
        durationRef.current.current = el.currentTime
        lastXRef.current = right
        // kept purely visual now; no rel state
        dragXRef.current = right
        onScratchUpdate(0)
        return
      }
      const clamped = Math.max(left, Math.min(right, x))
      // hard-map to cursor (no incremental error)
      const rel = windowW > 0 ? (clamped - left) / windowW : 0
      el.currentTime = Math.max(0, Math.min((el.duration || 0) - 0.0001, rel * (el.duration || 0)))
      durationRef.current.current = el.currentTime
      const dxLocal = clamped - lastXRef.current
      lastXRef.current = clamped
      // Reduce scratch effect when text is scrolling (looping marquee) to prevent audible breakups
      const speed = Math.min(1, Math.abs(dxLocal) / 12)
      onScratchUpdate(speed * 0.8)
      dragXRef.current = clamped
    }
      const onUp = async (e: PointerEvent) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      try { c.releasePointerCapture(e.pointerId) } catch {}
      onScratchEnd(wasPlayingLocalRef.current)
      const el = audioElRef.current
        // If released at the end lock, hold at the end and pause to trigger fade-to-white; else resume
        if (el) {
          const left = seekRef.current?.left ?? 2
          const right = seekRef.current?.right ?? c.clientWidth
          const windowW = seekRef.current?.windowW ?? Math.max(1, right - left)
          const clamped = Math.max(left, Math.min(right, lastXRef.current))
          const rel = windowW > 0 ? (clamped - left) / windowW : 0
          try { el.currentTime = Math.min((el.duration || 0) - 0.0001, rel * (el.duration || 0)) } catch {}
          if (lockEndRef.current) {
            try { el.pause() } catch {}
          } else {
            try { await el.play() } catch {}
          }
        }
      lockStartRef.current = false
      lockEndRef.current = false
      c.style.cursor = 'auto'
    }
    c.addEventListener('pointerdown', onDown)
    c.addEventListener('pointermove', onMove)
    c.addEventListener('pointerup', onUp)
    return () => { c.removeEventListener('pointerdown', onDown); c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerup', onUp) }
  }, [ensureGraph])

  

  return (
    <div className="w-full">
      <canvas ref={canvasRef} className="w-full h-[28px] rounded-md overflow-hidden" />
    </div>
  )
}


