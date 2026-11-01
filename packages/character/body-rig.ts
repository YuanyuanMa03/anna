import type { Rig } from 'mesh-avatar'

/**
 * Binding for Anna's frontal illustration. A single view has no painted side planes:
 * the runtime's elliptical turn field stretches cheek and hair pixels to invent them.
 * Keep skull rotation, neck blending, eyes and drawn mouths, but remove that elastic
 * pseudo-depth translation. Apply to a copy so hit regions and the archive stay intact.
 */
export function stabilizeBodyRig(source: Rig): Rig {
  const rig = structuredClone(source)
  rig.rigidFace = true
  rig.head.shiftX = 0
  rig.head.shiftY = 0
  rig.head.maxRoll = Math.min(rig.head.maxRoll, 0.065)
  if (rig.strands) {
    for (const strand of rig.strands)
      strand.max = Math.min(strand.max * 0.35, 3)
  }
  return rig
}

/** Frame-rate independent eye lead and slower head follow; cap sudden pointer reversals. */
export function followBodyLook(current: Record<string, number>, target: Record<string, number>, seconds: number) {
  const dt = Math.min(0.05, Math.max(0, seconds))
  for (const [key, value] of Object.entries(target)) {
    const eye = key.startsWith('gaze')
    const step = (value - (current[key] ?? 0)) * (1 - Math.exp(-dt / (eye ? 0.09 : 0.3)))
    const limit = (eye ? 3 : 12) * dt
    current[key] = (current[key] ?? 0) + Math.max(-limit, Math.min(limit, step))
  }
}
