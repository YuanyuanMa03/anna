import { cp } from 'node:fs/promises'
import { build } from 'vite'

await build({ configFile: 'website/vite.config.ts' })
for (const name of ['characters', 'live2dcubismcore.min.js', 'licenses', 'anna-body', 'stage']) await cp(`assets/${name}`, `website/dist/${name}`, { recursive: true })
