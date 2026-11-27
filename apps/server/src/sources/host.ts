import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import QRCode from 'qrcode'
import { configureCore } from '@pterosaur/core'
import type { CorePorts, NcmResponse } from '@pterosaur/core'
import {
  ensureNeteaseDeviceIdentity,
  getCachedNeteaseDeviceIdentity,
  invalidateNeteaseDeviceIdentity,
  refreshNeteaseDeviceIdentity,
} from './neteaseDevice.js'

export { configureCore }

const require = createRequire(import.meta.url)

/**
 * 网易云第三方库：CommonJS 大包，模块求值时加载一次（与抽离前的时机一致——
 * 缺库在启动时就暴露，而不是拖到第一次请求）。函数签名约为
 * `(query) => Promise<{ status, body, cookie? }>`，返回形状随版本漂移，由内核在使用处收敛。
 */
const ncm = require('NeteaseCloudMusicApi') as Record<
  string,
  (query: Record<string, unknown>) => Promise<NcmResponse>
>

/**
 * Node 宿主的内核端口（ADR-067）。
 *
 * 协议内核（`@pterosaur/core`）不碰运行环境；网络、密码原语、二维码渲染、设备身份
 * 与过渡期的 NCM 库，都在这里接到 Node 的实现上。由 `createApp()` 与 `cli/login.ts`
 * 经 `configureCore(nodeCoreHost())` 注入。
 */
export function nodeCoreHost(): CorePorts {
  return {
    http: {
      // 与抽离前逐项对齐：method / body / headers 原样透传，只有设了超时才挂 AbortSignal。
      // 返回的 Response 在结构上即内核的 HttpResponse（ok / status / headers / text / json / arrayBuffer）。
      fetch(url, init = {}) {
        return fetch(url, {
          method: init.method,
          body: init.body,
          headers: init.headers,
          ...(init.timeoutMs !== undefined
            ? { signal: AbortSignal.timeout(init.timeoutMs) }
            : {}),
        })
      },
    },
    crypto: {
      sha1: (input) => createHash('sha1').update(input).digest('hex'),
      md5: (input) => createHash('md5').update(input).digest('hex'),
    },
    qrcode: { toDataUrl: (text, options) => QRCode.toDataURL(text, options) },
    neteaseDevice: {
      getCached: getCachedNeteaseDeviceIdentity,
      ensure: ensureNeteaseDeviceIdentity,
      invalidate: invalidateNeteaseDeviceIdentity,
      refresh: refreshNeteaseDeviceIdentity,
    },
    ncmApi: { call: (name, params) => ncm[name](params) },
  }
}
