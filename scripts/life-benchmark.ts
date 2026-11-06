import type { BenchmarkCase } from '../packages/evaluation/execution'
import { execFile } from 'node:child_process'
import { createHash, randomInt } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { validateModel } from '../packages/anna-host/settings'
import { blindReview, resolveVotes } from '../packages/evaluation/blind-review'
import { compareRuns } from '../packages/evaluation/compare'
import { prepareCase } from '../packages/evaluation/execution'
import { runPiCase } from '../packages/evaluation/pi-run'
import cases from '../tests/fixtures/life-benchmark/cases.json'

const exec = promisify(execFile)
const args = process.argv.slice(2)
const command = args.shift()
async function json(path: string) { return JSON.parse(await readFile(resolve(path), 'utf8')) }
async function save(path: string, value: unknown) { await writeFile(path, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }) }
async function sourceIdentity(root: string) {
  const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  const names = (await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'packages', 'plugins', 'package.json', 'pnpm-lock.yaml'], { cwd: root })).stdout.split('\0').filter(Boolean).sort()
  const hash = createHash('sha256')
  for (const name of names) {
    hash.update(`${name}\0`)
    hash.update(await readFile(join(root, name)))
  }
  return { root, commit, sourceSha256: hash.digest('hex') }
}

if (command === 'run') {
  const [baselinePath, configPath, outputPath, consent] = args
  if (!baselinePath || !configPath || !outputPath || consent !== '--allow-model-calls')
    throw new Error('用法：run <优化前源码目录> <不含密钥的模型配置.json> <新输出目录> --allow-model-calls；会执行72次真实任务并消耗模型额度')
  const key = process.env.ANNA_BENCHMARK_KEY
  delete process.env.ANNA_BENCHMARK_KEY
  if (!key)
    throw new Error('请通过 ANNA_BENCHMARK_KEY 提供本次模型凭据，工具不会读取或改写 Anna 的凭据库')
  if (Object.keys(process.env).some(name => name.startsWith('ANNA_TEST_')))
    throw new Error('真实对照不能在模拟模型环境下运行')
  const candidate = await realpath(resolve('.'))
  const baseline = await realpath(resolve(baselinePath))
  const model = validateModel(await json(configPath))
  const [before, after] = await Promise.all([sourceIdentity(baseline), sourceIdentity(candidate)])
  if (before.sourceSha256 === after.sourceSha256)
    throw new Error('优化前基线与候选源码必须不同')
  const output = resolve(outputPath)
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output)
  const settings = { kernel: 'pi', model, permission: 'edit', approvals: 'reject', memory: 'fresh', timeoutMs: 300_000 }
  const configuration = createHash('sha256').update(JSON.stringify(settings)).digest('hex')
  await save(join(output, 'manifest.json'), { at: new Date().toISOString(), baseline: before, candidate: after, settings, configuration, plannedRuns: 72 })
  const runs = []
  for (const item of cases as unknown as BenchmarkCase[]) {
    for (const repetition of [1, 2, 3]) {
      const variants = randomInt(2) ? ['baseline', 'candidate'] as const : ['candidate', 'baseline'] as const
      for (const variant of variants) {
        const id = `${item.id}-${repetition}-${variant}`
        const directory = join(output, id)
        await mkdir(directory)
        const workspace = join(directory, 'workspace')
        await prepareCase(item, workspace)
        console.log(`Running ${id}`)
        const result = await runPiCase(variant === 'baseline' ? baseline : candidate, item, workspace, join(directory, 'data'), model, key)
        if (result.actualModel !== model.model)
          throw new Error('运行时实际模型与固定模型不符，已停止对照')
        const run = { caseId: item.id, repetition, variant, model: model.model, configuration, workspace, ...result }
        await save(join(directory, 'result.json'), run)
        runs.push(run)
      }
    }
  }
  await save(join(output, 'runs.json'), runs)
  const review = blindReview(runs)
  await save(join(output, 'review-packet.json'), review.packets.map(packet => ({ ...packet, prompt: cases.find(item => item.id === packet.caseId)!.prompt, rubric: cases.find(item => item.id === packet.caseId)!.rubric })))
  await save(join(output, 'review-key.private.json'), review.key)
  await save(join(output, 'review-votes.json'), review.packets.map(packet => ({ id: packet.id, winner: null })))
  await save(join(output, 'comparison.json'), compareRuns(runs))
  console.log('完成72次。只向评审提供 review-packet.json；请在 review-votes.json 填写 A、B 或 tie，再执行 compare。')
}
else if (command === 'compare') {
  const [directory] = args
  if (!directory)
    throw new Error('用法：compare <输出目录>')
  const votes = await json(join(directory, 'review-votes.json'))
  const reviews = resolveVotes(votes, await json(join(directory, 'review-key.private.json')))
  console.log(JSON.stringify(compareRuns(await json(join(directory, 'runs.json')), reviews), null, 2))
}
else {
  console.log('真实对照：pnpm exec tsx scripts/life-benchmark.ts run <优化前源码> <模型配置.json> <新输出目录> --allow-model-calls\n人工盲评后：pnpm exec tsx scripts/life-benchmark.ts compare <输出目录>\n密钥仅通过 ANNA_BENCHMARK_KEY 传入，不写入结果文件。')
}
