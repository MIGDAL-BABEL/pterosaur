import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 内核必须引擎可移植（ADR-067）：不直接使用 Node / WHATWG 的运行时 API。
 *
 * 类型层面由 `tsconfig.json` 兜底——不带 DOM / Node 类型，`fetch`、`Response`、`process`、
 * `require`、`import.meta` 一旦出现即编译失败。这里再从文本与依赖层面兜一道，堵住类型检查管不到的口子：
 * 用 `@ts-ignore` 类注释压错误、经 `globalThis` 绕路取宿主 API、以及把 Node 专有的包拉进运行时依赖。
 */
const ROOT = join(import.meta.dirname, '..')
const srcFiles = readdirSync(join(ROOT, 'src'), { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.ts'))

describe('内核的引擎可移植性（ADR-067）', () => {
  it('扫描到了源码文件', () => {
    expect(srcFiles.length).toBeGreaterThan(3)
  })

  it('源码不压制类型检查、不经 globalThis 取宿主 API', () => {
    const offenders: string[] = []
    for (const file of srcFiles) {
      const text = readFileSync(join(ROOT, 'src', file), 'utf8')
      for (const [label, re] of [
        ['类型检查压制注释', /@(ts-ignore|ts-expect-error|ts-nocheck)/],
        ['globalThis', /\bglobalThis\b/],
        ['Node 内建模块', /['"]node:[a-z_/]+['"]/],
        [
          'Node 专有依赖',
          /['"](NeteaseCloudMusicApi|playwright-core|lru-cache|qrcode)['"]/,
        ],
      ] as const) {
        if (re.test(text)) offenders.push(`${file}：${label}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('运行时依赖只有 @pterosaur/shared', () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@pterosaur/shared'])
  })
})
