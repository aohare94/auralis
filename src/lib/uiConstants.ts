// Shared UI constants for colors and geometry

// Global UI scale 120% relative to previous base
export const UI_SCALE = 1.7 * 1.2
export const SLIDER_DOMINANCE = 1.68
export const EDGE_BLEED = 48

// Thin remainder bar color (under everything)
export const GREY_TRACK = '#9ca3af'
export const WHITE = '#ffffff'

export const BAND_COLORS = {
  bass: '#fbbf24',
  mid: '#ef4444',
  treble: '#3b82f6',
} as const

// Sensitivity parameters for direction reversal and rhythm gating
export const REVERSE_PARAMS = {
  // Rhythm threshold below which reverse should start building
  lowThresh: 0.18,
  // Rhythm threshold above which reverse should decay faster
  highThresh: 0.26,
  // Base build-up rate (s⁻¹) for reverse desire under low rhythm/paused
  buildRateBase: 1.45,
  // Base decay rate (s⁻¹) when rhythm is strong
  decayBase: 0.28,
  // Minimum beat strength to consider for forward impulse
  beatGateMin: 0.08,
  // Sticky hysteresis thresholds to enter/exit reverse visually
  stickyEnter: 0.16,
  stickyExit: 0.10,
  // Extra reversal speed multiplier up to +120% under low rhythm/paused
  reverseExtraMax: 1.6,
  // Global reverse speed boost (+30%)
  reverseGlobalBoost: 2.0,
  // Additional boost: remove resistance when paused or near-silent
  reversePausedOrSilentBoost: 2.6,
} as const


