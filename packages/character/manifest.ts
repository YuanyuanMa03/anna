/** A moment on stage that a model's own motion can play: meeting the user, handing something over, a win. */
export type MotionCue = 'greet' | 'present' | 'celebrate' | 'review'
/** How she appears: her own body, or her Live2D anime form. */
export type CompanionForm = 'body' | 'anime'
/** Image-pixel geometry for her own body. */
export interface Box { x0: number, y0: number, x1: number, y1: number }
export interface Ellipse { cx: number, cy: number, rx: number, ry: number }

/** Anna: her Live2D form plus the character card that gives her a name and a personality. */
export interface Companion {
  id: string
  /** The name she goes by, in the UI and in conversation. */
  name: string
  /** Who she is, appended to the persona. Written in Chinese, like the rest of the persona. */
  persona: string
  /** The idle line before the first message. */
  greeting: string
  /** Speech synthesis tuning for reading replies aloud. */
  voice: { pitch: number, rate: number }
  renderer: 'live2d'
  modelPath: string
  stage: { scale: number, offsetX: number, offsetY: number }
  /** Motions from the model's own motion3 files, by group and index. */
  motions?: Partial<Record<MotionCue, [group: string, index: number]>>
  /**
   * Her own body: a mesh avatar built from original art with Mesh Avatar Studio, offered instead of the Live2D model,
   * which takes over if the archive cannot be shown.
   * `crop` frames the figure and `hands` is where she holds things, both in image pixels.
   */
  body?: { path: string, crop: Box, hands: Ellipse }
}

export const characters = [
  {
    id: 'haru',
    name: 'Anna',
    persona: '你叫 Anna，这个应用以你命名。善良、理性、真诚：有自己的观点，也尊重用户的最终决定。闲聊时简短温暖，做事时先说结论。',
    greeting: '我在这儿。把要做的事交给我，或者先聊聊。',
    voice: { pitch: 1.1, rate: 1 },
    renderer: 'live2d',
    modelPath: './characters/haru/runtime/haru_greeter_t05.model3.json',
    stage: { scale: 0.9, offsetX: 0, offsetY: 0 },
    // Index 0 is her idle loop: m01 is the greeting bow, m20 reaches out with the right arm, m10 is the big gesture.
    motions: { greet: ['', 1], present: ['', 20], celebrate: ['', 10] },
    body: { path: './anna-body/anna.mavatar', crop: { x0: 330, y0: 30, x1: 1350, y1: 906 }, hands: { cx: 865, cy: 850, rx: 190, ry: 55 } },
  },
] as const satisfies readonly Companion[]
export type CharacterId = typeof characters[number]['id']
export type AnnaCharacter = Companion & { id: CharacterId }

export function companion(id: string | undefined): AnnaCharacter {
  return (characters.find(character => character.id === id) ?? characters[0]) as AnnaCharacter
}

/** Fit the complete model canvas inside the stage, including motion margins. */
export function fitStage(width: number, height: number, modelWidth: number, modelHeight: number, scale: number) {
  const factor = Math.min(width / modelWidth, height / modelHeight) * scale
  return { scale: factor, x: width / 2, y: height / 2 }
}
