import { createHash } from 'node:crypto'
import QRCode from 'qrcode'
import type { CorePorts } from '@pterosaur/core'
import {
  ensureNeteaseDeviceIdentity,
  getCachedNeteaseDeviceIdentity,
  invalidateNeteaseDeviceIdentity,
  refreshNeteaseDeviceIdentity,
} from './neteaseDevice.js'

export { configureCore } from '@pterosaur/core'

/**
 * Node 宿主的内核端口（ADR-067）。
 *
 * 协议内核（`@pterosaur/core`）不碰运行环境；网络、密码原语、二维码渲染与设备身份
 * 都在这里接到 Node 的实现上。由 `createApp()` 与 `cli/login.ts` 经
 * `configureCore(nodeCoreHost())` 注入。
 *
 * 网易云接口的签名与请求已在核心里自实现（ADR-065），不再经任何第三方库。
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
  }
}
