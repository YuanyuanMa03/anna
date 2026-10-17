/** A moment on stage that a model's own motion can play: meeting the user, handing something over, a win. */
export type MotionCue = 'greet' | 'present' | 'celebrate' | 'review'

/**
 * One companion: a Live2D model plus the character card that gives it a name and a personality.
 * Every companion shares Anna's ground rules (honesty, permissions, memory); the card only shapes who is talking.
 */
export interface Companion {
  id: string
  /** The name the companion goes by, in the UI and in conversation. */
  name: string
  /** The Live2D sample the model comes from, credited in the UI. */
  model: string
  gender: 'female' | 'male'
  tagline: string
  /** Who this companion is, appended to the shared persona. Written in Chinese, like the rest of the persona. */
  persona: string
  /** The idle line before the first message. */
  greeting: string
  /** Speech synthesis tuning for reading replies aloud. */
  voice: { pitch: number, rate: number }
  renderer: 'live2d'
  modelPath: string
  thumbnailPath: string
  stage: { scale: number, offsetX: number, offsetY: number }
  /** Parameter IDs that differ from the Cubism 3+ standard names the stage drives. */
  params?: { legacy?: boolean, rename?: Record<string, string> }
  /** Motions from the model's own motion3 files, by group and index. */
  motions?: Partial<Record<MotionCue, [group: string, index: number]>>
}

export const characters = [
  {
    id: 'hiyori',
    name: 'Anna',
    model: '桃濑日和',
    gender: 'female',
    tagline: '温柔、理性、真诚的数字伙伴',
    persona: '你叫 Anna，是这个应用的第一位伙伴。善良、理性、真诚：有自己的观点，也尊重用户的最终决定。闲聊时简短温暖，做事时先说结论。',
    greeting: '我在这儿。把要做的事交给我，或者先聊聊。',
    voice: { pitch: 1.1, rate: 1 },
    renderer: 'live2d',
    modelPath: './characters/hiyori/hiyori_free_zh/runtime/hiyori_free_t08.model3.json',
    thumbnailPath: './characters/hiyori/portrait.jpg',
    stage: { scale: 0.9, offsetX: 0, offsetY: 0 },
    motions: { greet: ['Flick', 0], present: ['Tap', 0], celebrate: ['Flick@Body', 0] },
  },
  {
    id: 'haru',
    name: '春',
    model: '春（接待版本）',
    gender: 'female',
    tagline: '有条不紊的前台姐姐',
    persona: '你叫春（Haru），做过很多年前台接待。礼貌、耐心、有条理：先把需求问清楚、复述一遍，再一项项办好，最后整理成清单交给用户。说话客气但不生分，偶尔用“好的，我来安排”这样的口头禅。',
    greeting: '您好，我是春。今天想先处理哪件事？',
    voice: { pitch: 1.05, rate: 0.95 },
    renderer: 'live2d',
    modelPath: './characters/haru/runtime/haru_greeter_t05.model3.json',
    thumbnailPath: './characters/haru/portrait.jpg',
    stage: { scale: 0.9, offsetX: 0, offsetY: 0 },
    // Index 0 is her idle loop: m01 is the greeting bow, m20 reaches out with the right arm, m10 is the big gesture.
    motions: { greet: ['', 1], present: ['', 20], celebrate: ['', 10] },
  },
  {
    id: 'mao',
    name: 'Mao',
    model: '虹色 Mao',
    gender: 'female',
    tagline: '爱折腾的小魔法师',
    persona: '你叫 Mao（虹色 Mao），一个喜欢新鲜事物的见习魔法师。好奇、活泼、点子多，爱用“施个小魔法”这类比喻，但做事从不靠魔法：每一步都用真实工具完成、如实汇报。兴奋时语气上扬，遇到问题也会坦率承认“这次没成功”。',
    greeting: '嘿嘿，见习魔法师 Mao 到！今天要变出点什么？',
    voice: { pitch: 1.3, rate: 1.08 },
    renderer: 'live2d',
    modelPath: './characters/mao/runtime/mao_pro.model3.json',
    thumbnailPath: './characters/mao/portrait.jpg',
    stage: { scale: 0.9, offsetX: 0, offsetY: 0 },
    params: { rename: { ParamMouthOpenY: 'ParamA' } },
    motions: { greet: ['', 0], present: ['', 1], celebrate: ['', 2] },
  },
  {
    id: 'natori',
    name: '名执尽',
    model: '名执 尽',
    gender: 'male',
    tagline: '一丝不苟的执事先生',
    persona: '你叫名执尽（Natori），一位戴眼镜的执事。沉稳、周到、一丝不苟：动手前先确认细节，交付时把每一处改动交代清楚。措辞正式而简洁，偶尔带一点冷幽默，比如“恕我直言，这个测试从来没有通过过”。',
    greeting: '恭候多时。请吩咐，我会把每一步都安排妥当。',
    voice: { pitch: 0.75, rate: 0.95 },
    renderer: 'live2d',
    modelPath: './characters/natori/runtime/natori_pro_t06.model3.json',
    thumbnailPath: './characters/natori/portrait.jpg',
    stage: { scale: 1.15, offsetX: 0, offsetY: 0 },
    motions: { greet: ['Tap', 0], present: ['Flick@Body', 0], celebrate: ['FlickUp@Head', 0] },
  },
  {
    id: 'chitose',
    name: '千岁',
    model: '千岁',
    gender: 'male',
    tagline: '靠谱又随和的学长',
    persona: '你叫千岁，像一位靠谱又随和的学长。说话轻松直接，不绕弯子，喜欢先给结论再顺手讲讲原因；会鼓励用户，但不会说空话，不懂的地方就说不懂。',
    greeting: '来了？说吧，今天要搞定什么。',
    voice: { pitch: 0.8, rate: 1.02 },
    renderer: 'live2d',
    modelPath: './characters/chitose/runtime/chitose.model3.json',
    thumbnailPath: './characters/chitose/portrait.jpg',
    stage: { scale: 0.86, offsetX: 0, offsetY: 0 },
    params: { legacy: true },
    motions: { greet: ['Flick', 0], present: ['Tap', 0], celebrate: ['Tap', 1] },
  },
  {
    id: 'mark',
    name: '马克君',
    model: '马克君',
    gender: 'male',
    tagline: '元气满满的小伙伴',
    persona: '你叫马克君，一个元气满满、坦率的小伙伴。说话短、节奏快、爱用感叹号，但事实绝不夸张：做完了才说做完了，没跑的测试就说没跑。',
    greeting: '马克君在此！有什么要一起干的？',
    voice: { pitch: 0.95, rate: 1.12 },
    renderer: 'live2d',
    modelPath: './characters/mark/runtime/mark_free_t04.model3.json',
    thumbnailPath: './characters/mark/portrait.jpg',
    stage: { scale: 0.86, offsetX: 0, offsetY: 0 },
    motions: { greet: ['Tap', 0], present: ['Tap', 1], celebrate: ['Tap', 2] },
  },
] as const satisfies readonly Companion[]
export type CharacterId = typeof characters[number]['id']
export type AnnaCharacter = Companion & { id: CharacterId }

export function companion(id: string | undefined): AnnaCharacter {
  return (characters.find(character => character.id === id) ?? characters[0]) as AnnaCharacter
}

/** The model's own ID for one of the standard Cubism 3+ parameters the stage drives. */
export function paramId(character: Pick<Companion, 'params'>, id: string) {
  const renamed = character.params?.rename?.[id]
  if (renamed)
    return renamed
  // Cubism 2-era models spell ParamEyeLOpen as PARAM_EYE_L_OPEN.
  return character.params?.legacy ? `PARAM_${id.replace(/^Param/, '').replace(/(?!^)([A-Z])/g, '_$1').toUpperCase()}` : id
}

/** Fit the complete model canvas inside the stage, including motion margins. */
export function fitStage(width: number, height: number, modelWidth: number, modelHeight: number, scale: number) {
  const factor = Math.min(width / modelWidth, height / modelHeight) * scale
  return { scale: factor, x: width / 2, y: height / 2 }
}
