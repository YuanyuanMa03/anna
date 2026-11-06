/**
 * Finds where someone starts and stops talking, from the loudness (RMS) of short audio frames. No model: a threshold
 * above a slowly learned noise floor, a minimum length so clicks don't count, and a pause that ends the utterance.
 */
export interface EndpointerOptions {
  frameMs: number
  /** Speech this long starts an utterance. */
  startMs?: number
  /** Silence this long ends it. */
  endSilenceMs?: number
  /** An utterance is cut here. */
  maxMs?: number
  /** Below this nothing counts as speech, however quiet the room. */
  minLevel?: number
  /** How far above the noise floor speech must be. */
  ratio?: number
  /** The first frames only learn the room's noise. */
  warmupMs?: number
}

export function createEndpointer({ frameMs, startMs = 200, endSilenceMs = 900, maxMs = 30_000, minLevel = 0.015, ratio = 3, warmupMs = 500 }: EndpointerOptions) {
  let floor = 0.005
  let heard = 0
  let speaking = false
  let voiced = 0
  let silent = 0
  let length = 0
  return {
    get speaking() { return speaking },
    /** `gain` raises the bar, for example while her own voice is playing. Returns 'start' or 'end' when one happens. */
    push(level: number, gain = 1): 'start' | 'end' | undefined {
      if (heard < warmupMs) {
        heard += frameMs
        floor = heard === frameMs ? Math.min(level, 0.2) : floor + (Math.min(level, 0.2) - floor) * frameMs / heard
        return undefined
      }
      const threshold = Math.max(minLevel, floor * ratio) * gain
      if (!speaking) {
        if (level > threshold) {
          voiced += frameMs
        }
        else {
          voiced = 0
          // Her own voice (a raised bar) must not teach the floor; only the room does.
          if (gain === 1)
            floor = floor * 0.97 + Math.min(level, 0.2) * 0.03
        }
        if (voiced >= startMs) {
          speaking = true
          length = voiced
          silent = 0
          voiced = 0
          return 'start'
        }
        return undefined
      }
      length += frameMs
      silent = level > threshold * 0.6 ? 0 : silent + frameMs
      if (silent >= endSilenceMs || length >= maxMs) {
        speaking = false
        silent = 0
        length = 0
        return 'end'
      }
      return undefined
    },
    reset() {
      speaking = false
      voiced = 0
      silent = 0
      length = 0
    },
  }
}
