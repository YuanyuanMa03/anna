import { expect, it } from 'vitest'
import { createEndpointer } from '../apps/desktop/src/endpointer'

/** Feed `ms` of a constant level in 20 ms frames; return the events in order. */
function feed(endpointer: ReturnType<typeof createEndpointer>, level: number, ms: number, gain = 1) {
  const events: string[] = []
  for (let t = 0; t < ms; t += 20) {
    const event = endpointer.push(level, gain)
    if (event)
      events.push(event)
  }
  return events
}

it('hears a sentence: starts after a moment of speech, ends after a pause', () => {
  const vad = createEndpointer({ frameMs: 20 })
  expect(feed(vad, 0.002, 1000)).toEqual([])
  expect(feed(vad, 0.2, 400)).toEqual(['start'])
  expect(feed(vad, 0.002, 500)).toEqual([])
  expect(feed(vad, 0.002, 500)).toEqual(['end'])
})

it('ignores a click or a cough too short to be speech', () => {
  const vad = createEndpointer({ frameMs: 20 })
  feed(vad, 0.002, 600)
  expect(feed(vad, 0.3, 100)).toEqual([])
  expect(feed(vad, 0.002, 1000)).toEqual([])
})

it('keeps listening through short pauses inside a sentence', () => {
  const vad = createEndpointer({ frameMs: 20 })
  feed(vad, 0.002, 600)
  expect([...feed(vad, 0.2, 400), ...feed(vad, 0.002, 400), ...feed(vad, 0.2, 400)]).toEqual(['start'])
})

it('learns a steady background noise instead of hearing it as speech', () => {
  const vad = createEndpointer({ frameMs: 20 })
  expect(feed(vad, 0.03, 3000)).toEqual([])
  expect(feed(vad, 0.3, 400)).toEqual(['start'])
})

it('ends an utterance that runs too long', () => {
  const vad = createEndpointer({ frameMs: 20, maxMs: 2000 })
  feed(vad, 0.002, 600)
  // Speech that keeps going simply starts the next utterance.
  expect(feed(vad, 0.2, 2600).slice(0, 2)).toEqual(['start', 'end'])
})

it('needs a louder voice to interrupt her while she speaks', () => {
  const vad = createEndpointer({ frameMs: 20 })
  feed(vad, 0.002, 600)
  expect(feed(vad, 0.04, 400, 4)).toEqual([])
  expect(feed(vad, 0.3, 400, 4)).toEqual(['start'])
})

it('does not let her own voice raise the bar for the next quiet sentence', () => {
  const vad = createEndpointer({ frameMs: 20 })
  feed(vad, 0.002, 600)
  // Her voice: louder than a normal start, quieter than the raised bar, for a long time.
  expect(feed(vad, 0.04, 5000, 4)).toEqual([])
  expect(feed(vad, 0.04, 400)).toEqual(['start'])
})
