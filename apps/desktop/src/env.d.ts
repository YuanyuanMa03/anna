import type { AnnaBridge } from '../../../packages/shared/contracts'

declare global { interface Window { anna: AnnaBridge } }
declare module '*.webp' { const src: string; export default src }
export {}
