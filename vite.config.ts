import { defineConfig } from 'vite-plus'

// workspace 级格式 / 静态检查基准，`vp check` 会从各子包向上读取它。
// 格式口径与既有 .prettierrc.json 对齐（单引号、无分号、printWidth 80）。
export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 80,
    // `packages/contract` 的生成物（JSON / NDJSON）与原生端源码（Swift / Kotlin / Gradle）
    // 不由本项目的 TypeScript 格式器管理——生成物是多行 JSON（生成器确定，格式器压缩会导致重跑 diff），
    // 原生端代码有各自的格式器。NDJSON 对 MD 编辑器不友好，不在此列。
    ignorePatterns: [
      'packages/contract/**',
      'apps/macos/**',
      'apps/android/**',
      '.github/**',
    ],
  },
  lint: {
    // 必须显式排除，否则 vp lint 会扫描 node_modules
    ignorePatterns: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.data/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/blob-report/**',
    ],
    options: { typeAware: true, typeCheck: true },
  },
})
