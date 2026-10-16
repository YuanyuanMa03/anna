import type { AnnaBridge } from '../../../packages/shared/contracts'

declare global { interface Window { anna: AnnaBridge } }
export {}
