/**
 * 录制：对真实上游发一组匿名请求，把「请求形态 + 明文载荷 + 原始响应」固化成语言无关的样例。
 *
 * 产出 `recordings/netease.ndjson`（一行一条 `Recording`）。**需要联网**，不进 CI。
 * 请求一律匿名，凭证全部剥离，响应体只保留前若干 KB（样例不需要全量数据）。
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { configureCore } from '@pterosaur/core'
import type { HttpRequest, HttpResponse } from '@pterosaur/core'
import * as ncm from '../../core/src/sources/neteaseApi.js'
import { eapiDecrypt } from '../../core/src/sources/neteaseSign.js'
import { contractPath, type Recording } from '../src/index.js'

/** 记录每一次出站请求的宿主端口。 */
const captured: { url: string; init: HttpRequest }[] = []
configureCore({
  http: {
    fetch: async (url, init = {}) => {
      captured.push({ url, init })
      const res = await fetch(url, {
        method: init.method,
        body: init.body,
        headers: init.headers,
        ...(init.timeoutMs !== undefined
          ? { signal: AbortSignal.timeout(init.timeoutMs) }
          : {}),
      })
      return res as HttpResponse
    },
  },
  crypto: {
    sha1: (s) => createHash('sha1').update(s).digest('hex'),
    md5: (s) => createHash('md5').update(s).digest('hex'),
  },
  qrcode: { toDataUrl: async () => '' },
  neteaseDevice: {
    getCached: () => null,
    ensure: async () => ({ token: '', cookieHeader: '' }),
    invalidate: () => {},
    refresh: () => {},
  },
})

/** 只保留协议相关的头；Cookie 是匿名设备字段、值每次不同，不录。 */
const PROTOCOL_HEADERS = ['user-agent', 'referer', 'content-type']
/** 响应体截断：样例只用于核对**形状**，不承载整份歌单。 */
const BODY_CLIP = 400_000

async function run(
  id: string,
  fn: () => Promise<{ body: unknown }>,
): Promise<Recording> {
  const before = captured.length
  const result = await fn()
  if (captured.length - before !== 1) {
    throw new Error(
      `${id}：期望一次出站请求，实际 ${captured.length - before} 次`,
    )
  }
  const sent = captured[captured.length - 1]!
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(sent.init.headers ?? {})) {
    if (PROTOCOL_HEADERS.includes(k.toLowerCase())) headers[k] = String(v)
  }
  const form = new URLSearchParams(sent.init.body ?? '')
  const params = form.get('params') ?? ''
  const isEapi = sent.url.includes('/eapi/')
  const u = new URL(sent.url)
  const endpoint = `${u.origin}${u.pathname}`
  return {
    id,
    endpoint,
    request: {
      method: String(sent.init.method ?? 'POST'),
      url: endpoint,
      headers,
      // 加密体每次不同：只记字段名、密文格式与长度
      body: [...form.keys()]
        .map(
          (k) =>
            `${k}=<${k === 'params' ? (isEapi ? 'hex' : 'base64') : 'rsa'}:${form.get(k)?.length ?? 0}>`,
        )
        .join('&'),
      // eapi 的明文里带 `header`（设备字段，与 Cookie 头同源）：样例只留「载荷里除了 header 还有什么」，
      // 保证录制中不出现 cookie 字符串
      plaintext: isEapi ? stripHeader(eapiDecrypt(params)) : null,
    },
    response: {
      status: 200,
      body: clip(result.body ?? {}),
      note: '匿名请求',
    },
  }
}

function stripHeader(v: unknown): unknown {
  if (v && typeof v === 'object' && 'header' in v) {
    const { header: _header, ...rest } = v as Record<string, unknown>
    return rest
  }
  return v
}

function clip(v: unknown): unknown {
  const s = JSON.stringify(v)
  return s.length <= BODY_CLIP
    ? v
    : { __clipped__: true, json: s.slice(0, BODY_CLIP) }
}

const recordings: Recording[] = [
  await run('cloudsearch-songs', () =>
    ncm.cloudsearch({ keywords: '稻香', limit: 3 }),
  ),
  await run('personalized', () => ncm.personalized({ limit: 3 })),
  await run('album-newest', () => ncm.albumNewest({})),
  await run('artists', () => ncm.artists({ id: '6452' })),
  await run('album', () => ncm.album({ id: '32311' })),
  await run('song-url-v1', () =>
    ncm.songUrlV1({ id: '185809', level: 'exhigh' }),
  ),
]

writeFileSync(
  contractPath('recordings', 'netease.ndjson'),
  recordings.map((r) => JSON.stringify(r)).join('\n') + '\n',
)
console.log(`已写入 ${recordings.length} 条录制 → recordings/netease.ndjson`)
