import { expect, it } from 'vitest'
import { workMethod } from '../packages/character/work-methods'
import cases from './fixtures/life-benchmark/cases.json'

const names = { files: '文件整理', text: '文本处理', project: '项目讲解', code: '小范围修复' }
it.each(cases)('loads the relevant method for $id without treating read-only code explanations as repairs', (item) => {
  expect(workMethod(item.prompt)).toContain(names[item.category as keyof typeof names])
})
