import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: [
    'src/components/ui/**',
    'src/components/layout/app-title.tsx',
    // Legacy typed API surface retained while monitor pages are modularized.
    'src/lib/monitor-api.ts',
  ],
}

export default config
