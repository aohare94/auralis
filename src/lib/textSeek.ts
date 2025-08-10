// Pure helpers for measuring text and mapping x to a 0..1 seek ratio

export type MeasureCtx = Pick<CanvasRenderingContext2D, 'measureText' | 'font'>

export function computeDisplayName(originalFileName: string | undefined, srcUrl: string | undefined, fallback = './auralis'): string {
  if (originalFileName && originalFileName.trim()) {
    const base = originalFileName.replace(/\.[^/.]+$/, '')
    return base || fallback
  }
  if (srcUrl) {
    try {
      const u = new URL(srcUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
      // Use brand name for bundled demo audio
      if (u.pathname.includes('/test_audio/')) return fallback
      const raw = decodeURIComponent(u.pathname.split('/').pop() || '')
      const base = raw.replace(/\.[^/.]+$/, '')
      return base || fallback
    } catch {
      // ignore
    }
  }
  return fallback
}

export function computeGlyphSpan(ctx: MeasureCtx, text: string, font: string): number {
  const prev = ctx.font
  ;(ctx as any).font = font
  const span = ctx.measureText(text).width
  ;(ctx as any).font = prev
  return span
}

export function xToSeekRatio(x: number, leftPad: number, glyphSpan: number): number {
  if (glyphSpan <= 0) return 0
  const rel = (x - leftPad) / glyphSpan
  return Math.max(0, Math.min(1, rel))
}


