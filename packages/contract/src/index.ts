/**
 * 跨端契约的 TypeScript 出口与读写工具（ADR-065 / ADR-069）。
 *
 * 契约的**内容**是语言无关的 JSON / NDJSON（`vectors/`、`golden/`、`recordings/`、`capabilities.json`），
 * 任何端的测试都能直接读文件；本模块只做三件事：定义每类文件的形状、提供路径常量、
 * 以及一份「按文件名读出并做结构校验」的小工具，供 TS 参考实现自检。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

/** 契约目录下的绝对路径。 */
export function contractPath(...segments: string[]): string {
  return join(ROOT, ...segments)
}

/** 读一份 JSON 文件并断言其顶层形状（`ok` 为各端通用的最小校验）。 */
export function readJson<T>(
  relative: string,
  isValid: (v: unknown) => v is T,
): T {
  const value: unknown = JSON.parse(
    readFileSync(contractPath(relative), 'utf8'),
  )
  if (!isValid(value)) throw new Error(`契约文件形状不符：${relative}`)
  return value
}

/* ============================ 能力清单 ============================ */

/** 一个音源实现了哪些可选能力（缺省即不支持，路由回 501、前端隐藏入口）。 */
export interface SourceCapabilities {
  /** 必选面：搜索单曲、专辑详情、解析播放地址、歌词、登录态查询。 */
  readonly core: true
  /** 可选面：值为 true 表示实现了。 */
  readonly optional: Readonly<Record<string, boolean>>
}

/** `capabilities.json`：各源的能力矩阵与源清单。 */
export interface CapabilitiesFile {
  readonly musicSources: readonly string[]
  readonly cassetteSources: readonly string[]
  readonly defaultSource: string
  readonly sources: Readonly<Record<string, SourceCapabilities>>
  /** 编译内核时必须保持可用的引擎（可移植性扫描的依据）。 */
  readonly enginePortable: true
}

export function isCapabilitiesFile(v: unknown): v is CapabilitiesFile {
  const f = v as CapabilitiesFile
  return (
    typeof f === 'object' &&
    f !== null &&
    Array.isArray(f.musicSources) &&
    Array.isArray(f.cassetteSources) &&
    typeof f.defaultSource === 'string' &&
    typeof f.sources === 'object'
  )
}

/* ============================ 算法向量 ============================ */

/** 一条「同样的输入 → 同样的输出」的向量；`kind` 指出属于哪项算法。 */
export interface Vector {
  readonly kind: string
  readonly input: unknown
  readonly expected: unknown
  /** 出处：给修正它的人看（上游实测 / 规范 / 库源码）。 */
  readonly source: string
}

export interface VectorFile {
  readonly schema: string
  readonly vectors: readonly Vector[]
}

export function isVectorFile(v: unknown): v is VectorFile {
  const f = v as VectorFile
  return (
    typeof f === 'object' &&
    f !== null &&
    typeof f.schema === 'string' &&
    Array.isArray(f.vectors) &&
    f.vectors.every(
      (x) => x && typeof x.kind === 'string' && 'input' in x && 'expected' in x,
    )
  )
}

/* ============================ 黄金样例 ============================ */

/** 一条归一化样例：上游原始 JSON → 共享模型。 */
export interface GoldenCase {
  readonly id: string
  /** 被测函数名（与各端 core 的导出对应）。 */
  readonly fn: string
  readonly input: unknown
  readonly expected: unknown
  readonly source: string
}

export interface GoldenFile {
  readonly schema: string
  readonly cases: readonly GoldenCase[]
}

export function isGoldenFile(v: unknown): v is GoldenFile {
  const f = v as GoldenFile
  return (
    typeof f === 'object' &&
    f !== null &&
    typeof f.schema === 'string' &&
    Array.isArray(f.cases) &&
    f.cases.every(
      (c) => c && typeof c.id === 'string' && typeof c.fn === 'string',
    )
  )
}

/* ============================ 录制 ============================ */

/**
 * 一条录制：一次真实（或据库源码构造）的上游请求与响应。
 * 各端用回放服务器离线跑同一组用例，并断言自己发出的请求与 `request` 一致。
 */
export interface Recording {
  readonly id: string
  readonly endpoint: string
  readonly request: {
    readonly method: string
    readonly url: string
    /** 只记影响协议的头（User-Agent / Referer / Content-Type），不记 Cookie 值。 */
    readonly headers: Record<string, string>
    /** 表单体；`params` 等加密字段以 `{{…}}` 占位，因为每次请求的密文不同。 */
    readonly body: string
    /** 解密后的明文载荷——回放服务器据此核对各端的加密是否正确。 */
    readonly plaintext: unknown
  }
  readonly response: {
    readonly status: number
    readonly body: unknown
    /** 出处于哪条上游请求（脱敏后的描述）。 */
    readonly note?: string
  }
}

export interface RecordingFile {
  readonly schema: string
  readonly recordings: readonly Recording[]
}

export function isRecordingFile(v: unknown): v is RecordingFile {
  const f = v as RecordingFile
  return (
    typeof f === 'object' &&
    f !== null &&
    typeof f.schema === 'string' &&
    Array.isArray(f.recordings) &&
    f.recordings.every(
      (r) => r && typeof r.id === 'string' && typeof r.endpoint === 'string',
    )
  )
}

export * from './capabilities.js'
