import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: [
    'src/components/ui/**',
    'src/components/layout/app-title.tsx',
    // Product-template modules intentionally kept for future screens.
    'src/components/layout/nav-user.tsx',
    'src/components/layout/team-switcher.tsx',
    'src/components/layout/top-nav.tsx',
    'src/features/dashboard/**',
    'src/features/settings/components/sidebar-nav.tsx',
    'src/features/settings/index.tsx',
    'src/features/settings/profile/**',
    // Legacy typed API surface retained while monitor pages are modularized.
    'src/lib/monitor-api.ts',
  ],
}

export default config
