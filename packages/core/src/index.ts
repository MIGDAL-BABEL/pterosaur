/**
 * `@pterosaur/core`——Pterosaur 的音源协议内核（TS 参考实现，见 ADR-065）。
 *
 * 把网易云 / B 站的私有接口收敛为共享模型：搜索、发现、解析播放地址、歌词、登录与各自的归一化。
 * 它不依赖 Node：网络、密码原语、二维码渲染、设备身份等运行环境能力全部经宿主端口注入
 * （{@link configureCore}），因此既能被 Node 的 server 直接消费，也能打进 QuickJS（ADR-067）。
 *
 * 上游协议的改动只允许发生在本包；且必须与 `packages/contract` 的更新在同一提交（ADR-065）。
 */

export { sources, adapterOf } from './sources/index.js'
export type { SourceAdapter, QrCheckResult } from './sources/types.js'
export { configureCore } from './ports.js'
export type {
  CorePorts,
  CryptoPort,
  HttpPort,
  HttpRequest,
  HttpResponse,
  NcmApiPort,
  NcmResponse,
  NeteaseDeviceIdentity,
  NeteaseDeviceIdentityPort,
  QrPort,
} from './ports.js'
