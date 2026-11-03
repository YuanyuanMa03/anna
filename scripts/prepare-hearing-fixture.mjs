import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const home = resolve('.data/hearing-fixture')
const pack = join(home, 'pack')
const prefix = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en'
const raw = join(home, 'raw')
const source = join(raw, prefix)
const archive = process.argv[2] ? resolve(process.argv[2]) : join(home, 'source.tar.bz2')
const archiveSize = 1047319737
const archiveHash = '5462a1fce42693deae572af1e8c4687124b12aa85fe61ff4d3168bb5280e205f'
const modelHash = 'c129b662000dc429d2058048b752081c1cfb39224f9e1ea52e0fa661a7540190'
const audioHash = '7d93384ca14702cc584a7a33fe2fed92e89e708549161cb12ea38c916882103b'
const audio = join(source, 'test_wavs', '0.wav')
const data = join(pack, 'preload.data')
const files = [
  { filename: 'encoder.onnx', original: 'encoder.int8.onnx', start: 0, end: 165462184 },
  { filename: 'decoder.onnx', original: 'decoder.int8.onnx', start: 165462184, end: 237126745 },
  { filename: 'tokens.txt', original: 'tokens.txt', start: 237126745, end: 237202501 },
]
async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function matches(path, hash) { return sha256(path).then(value => value === hash, () => false) }
await mkdir(pack, { recursive: true })
if (!(await matches(data, modelHash)) || !(await matches(audio, audioHash))) {
  if (!(await matches(archive, archiveHash))) {
    if (process.argv[2])
      throw new Error('The supplied archive does not match the pinned public fixture')
    const partial = `${archive}.partial`
    await rm(partial, { force: true })
    try {
      const signal = AbortSignal.timeout(15 * 60 * 1000)
      const response = await fetch(`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${prefix}.tar.bz2`, { signal })
      if (!response.ok || !response.body)
        throw new Error(`Public fixture download failed: HTTP ${response.status}`)
      let size = 0
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length
        callback(size > archiveSize ? new Error('Public fixture exceeds its pinned size') : null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(partial, { flags: 'wx' }), { signal })
      if (size !== archiveSize || !(await matches(partial, archiveHash)))
        throw new Error('Public fixture size or SHA-256 does not match')
      await rename(partial, archive)
    }
    finally { await rm(partial, { force: true }) }
  }
  await mkdir(raw, { recursive: true })
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-xjf', archive, '-C', raw, ...files.map(file => `${prefix}/${file.original}`), `${prefix}/README.md`, `${prefix}/test_wavs/0.wav`], { stdio: 'inherit' })
  const license = await readFile(join(source, 'README.md'), 'utf8')
  if (!license.includes('license: apache-2.0'))
    throw new Error('The pinned model license metadata is missing')
  const partial = `${data}.partial`
  await rm(partial, { force: true })
  const output = await open(partial, 'wx', 0o600)
  try {
    for (const file of files) {
      const input = join(source, file.original)
      if ((await stat(input)).size !== file.end - file.start)
        throw new Error(`Unexpected model file size: ${file.original}`)
      for await (const chunk of createReadStream(input)) await output.writeFile(chunk)
    }
    await output.sync()
  }
  finally { await output.close() }
  if (!(await matches(partial, modelHash)) || !(await matches(audio, audioHash)))
    throw new Error('Prepared model or audio SHA-256 does not match')
  await rename(partial, data)
}
await writeFile(join(pack, 'preload.js.metadata'), JSON.stringify({ remote_package_size: 237202501, files: files.map(({ original: _original, ...file }) => file) }))
process.stdout.write(`${JSON.stringify({ modelDirectory: pack, audio, modelSha256: modelHash, audioSha256: audioHash })}\n`)
