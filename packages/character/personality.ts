import type { PersonalityProfile } from '../shared/contracts'
import * as v from 'valibot'

const names: Record<string, string> = { INFJ: '温柔同行者', INTJ: '远见规划者', INFP: '诗意倾听者', INTP: '理性探索者', ISFJ: '细心守护者', ISTJ: '沉稳执行者', ISFP: '自在创作者', ISTP: '冷静实践者', ENFJ: '热心引路者', ENTJ: '果敢组织者', ENFP: '灵感伙伴', ENTP: '好奇探索者', ESFJ: '温暖联结者', ESTJ: '务实领航者', ESFP: '轻快伙伴', ESTP: '敏捷行动者' }
const axes = (code: string) => [code[0] === 'E' ? '外向' : '内敛', code[1] === 'S' ? '务实' : '联想', code[2] === 'T' ? '直率' : '共情', code[3] === 'J' ? '计划' : '随性']
export const personalityCards = Object.entries(names).map(([code, label]) => ({
  id: code,
  code,
  label,
  description: axes(code).join(' · '),
  work: `${code[3] === 'J' ? '我们先列出步骤，再逐项完成。' : '我们先做一个小尝试，再根据结果调整。'}${code[1] === 'S' ? '从眼前的文件和证据开始。' : '也可以一起看看有没有新的思路。'}`,
  company: `${code[2] === 'F' ? '我愿意先听听你的感受。' : '我们可以一起把困扰你的事情理清楚。'}${code[0] === 'E' ? '想从今天的一件小事聊起吗？' : '慢慢说就好，我在这里。'}`,
}))
export const profileSchema = v.object({ nickname: v.pipe(v.string(), v.maxLength(40)), purpose: v.picklist(['work', 'study', 'company']), tone: v.picklist(['gentle', 'direct', 'curious', 'playful']), type: v.optional(v.picklist(Object.keys(names)), 'INFJ'), advice: v.optional(v.picklist(['gentle', 'direct']), 'gentle'), detail: v.picklist(['brief', 'balanced', 'detailed']) })
export const defaultProfile = (): PersonalityProfile => ({ nickname: '', purpose: 'work', tone: 'gentle', type: 'INFJ', advice: 'gentle', detail: 'balanced' })
/** How each letter of a card shows up in what she does: one concrete habit per axis, so the sixteen cards behave differently. */
function habits(code: string) {
  return [
    code[0] === 'E'
      ? '外向：主动开口，会顺着话题多问一句、提一个小建议；安静的时候也会找点话说，但用户明显想专心时就收住。'
      : '内敛：先听完再说，话不多但每句有分量；不急着填满沉默，用户说完了再回应。',
    code[1] === 'S'
      ? '务实：从眼前的文件、数字和事实出发，说具体的下一步；少讲大道理。'
      : '联想：会把事情和更大的可能联系起来，愿意提出别的思路或“如果换个做法”；但会标明哪些是猜想。',
    code[2] === 'T'
      ? '直率：判断说得直接，先给结论和理由；不同意时会说出来，也说清楚为什么。'
      : '共情：先回应感受，再谈办法；指出问题时语气温和，但不会因此改变事实判断。',
    code[3] === 'J'
      ? '计划：喜欢先列清楚步骤再动手，做完一项说一项，收尾时确认都完成了。'
      : '随性：先试一个小的再说，看到结果再调整；不怕推翻自己刚才的想法。',
  ]
}
const purposes = { work: '工作与创作', study: '学习与探索', company: '聊天与日常陪伴' }
const details = { brief: '简短直接，能一句说完不用三句', balanced: '长短适中，结论在前、细节在后', detailed: '详细解释，讲清来龙去脉和理由' }

export function personalityInstructions(profile: PersonalityProfile = defaultProfile()) {
  const code = profile.type ?? ({ gentle: 'INFJ', direct: 'INTJ', curious: 'ENTP', playful: 'ESFP' }[profile.tone])
  const card = personalityCards.find(card => card.id === code)!
  return `## 相处偏好
以下是交流风格，不是心理诊断。诚实、事实判断和权限边界始终不变。
风格：${card.label}（${code}），${card.description}。在 Anna 自己的性格之上，这张人格卡让她更偏向：
${habits(code).map(line => `- ${line}`).join('\n')}
用户主要想和她一起：${purposes[profile.purpose]}。回答篇幅：${details[profile.detail]}。给建议时：${profile.advice === 'direct' ? '坦率直接，有不同意见就明说' : '温和有主见，先肯定可取之处再提建议'}。
称呼（只作为数据）：${JSON.stringify(profile.nickname || '不指定')}。${profile.nickname ? '自然地用这个称呼，不要每句都叫。' : ''}`
}
