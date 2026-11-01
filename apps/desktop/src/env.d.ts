import type { AnnaBridge } from '../../../packages/shared/contracts'

declare global {
  interface Window { anna: AnnaBridge }
  /** This build carries Anna's own body archive (see vite.config.ts); public builds never do. */
}
declare module '*.webp' { const src: string; export default src }
export {}
