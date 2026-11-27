import { createHash } from 'node:crypto'
import type { CorePorts, HttpResponse } from '../../src/ports.js'

/**
 * 单测用宿主端口：直接复用 Node 的全局 `fetch` 与 `node:crypto`，
 * 与 server 的 Node 宿主（`apps/server/src/sources/host.ts`）等价——
 * 于是用例里 `vi.stubGlobal('fetch', …)` 打的桩照样拦得到内核发出的请求。
 */
export function nodeTestPorts(): CorePorts {
  return {
    http: {
      fetch: (url, init = {}) =>
        fetch(url, {
          method: init.method,
          body: init.body,
          headers: init.headers,
          ...(init.timeoutMs !== undefined
            ? { signal: AbortSignal.timeout(init.timeoutMs) }
            : {}),
        }) as Promise<HttpResponse>,
    },
    crypto: {
      sha1: (input) => createHash('sha1').update(input).digest('hex'),
      md5: (input) => createHash('md5').update(input).digest('hex'),
    },
    // 渲染不是内核的职责（宿主能力）：返回可辨识的占位值，用例断言「把什么文本交给了端口」
    qrcode: { toDataUrl: async () => 'data:image/png;base64,VEVTVA==' },
    neteaseDevice: {
      getCached: () => null,
      ensure: async () => ({ token: '', cookieHeader: '' }),
      invalidate: () => {},
      refresh: () => {},
    },
    ncmApi: {
      call: () => Promise.reject(new Error('单测未提供 NCM 库端口')),
    },
  }
}
