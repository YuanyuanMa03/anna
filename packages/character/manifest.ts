/** Visual assets remain independent of the agent session, persona, voice, and provider. */
export const characters = [
  { id: 'hiyori', name: 'Hiyori', label: '桃濑日和', description: '轻盈的日常陪伴', renderer: 'live2d', modelPath: './characters/hiyori/hiyori_free_zh/runtime/hiyori_free_t08.model3.json', thumbnailPath: './characters/hiyori/portrait.jpg', stage: { scale: 0.9, offsetX: 0, offsetY: 0 } },
  { id: 'haru', name: 'Haru', label: '春 · 接待版本', description: '温柔而从容的相遇', renderer: 'live2d', modelPath: './characters/haru/runtime/haru_greeter_t05.model3.json', thumbnailPath: './characters/haru/portrait.jpg', stage: { scale: 0.9, offsetX: 0, offsetY: 0 } },
  { id: 'mark', name: 'Mark', label: '马克君', description: '活泼、坦率，始终在场', renderer: 'live2d', modelPath: './characters/mark/runtime/mark_free_t04.model3.json', thumbnailPath: './characters/mark/portrait.jpg', stage: { scale: 0.86, offsetX: 0, offsetY: 0 } },
] as const
export type CharacterId = typeof characters[number]['id']
export type AnnaCharacter = typeof characters[number]

/** Fit the complete model canvas inside the stage, including motion margins. */
export function fitStage(width: number, height: number, modelWidth: number, modelHeight: number, scale: number) {
  const factor = Math.min(width / modelWidth, height / modelHeight) * scale
  return { scale: factor, x: width / 2, y: height / 2 }
}
