/**
 * 宿主端口——内核与运行环境之间的唯一接缝（见 ADR-065 / ADR-067）。
 *
 * 内核（本包）必须**引擎可移植**：只假定标准 ES 与 `setTimeout` / `clearTimeout`，不直接使用
 * Node 或 WHATWG 的运行时 API（`fetch`、`AbortSignal`、`node:crypto`、`require`、`URLSearchParams` 等）。
 * 凡要用到这些能力的地方一律经由这里声明的端口，由宿主注入实现：
 *
 * - Node 宿主（`apps/server`）：全局 `fetch`、`node:crypto`、`qrcode`、playwright 设备身份，
 *   以及过渡期的 `NeteaseCloudMusicApi`；
 * - QuickJS 宿主（C++ 终端版，ADR-067）：以 C / C++ 实现等价函数。
 *
 * 端口是运行时级单例（{@link configureCore}）：适配器本身是模块级单例、带模块级缓存，
 * 一个运行时只承载一份内核，不存在按实例隔离的需求。
 */

/* ============================ HTTP ============================ */

/** 内核能看到的 HTTP 响应：WHATWG `Response` 的最小子集，Node 的 `fetch` 结果可直接充当。 */
export interface HttpResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: {
    get(name: string): string | null
    /** 全部 `Set-Cookie` 原始串（登录接口下发会话用）；运行环境不支持时缺省。 */
    getSetCookie?(): string[]
  }
  text(): Promise<string>
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface HttpRequest {
  method?: string
  body?: string
  headers?: Record<string, string>
  /** 单次请求的墙钟超时（毫秒）；缺省即不设超时。 */
  timeoutMs?: number
}

export interface HttpPort {
  /**
   * 发一次请求。失败（断网 / 超时 / 被取消）以 reject 表达，与 `fetch` 一致；
   * **不在这里重试**——按错误类别重试的策略在内核（`sources/http.ts`）。
   */
  fetch(url: string, init?: HttpRequest): Promise<HttpResponse>
}

/* ============================ 密码原语 ============================ */

export interface CryptoPort {
  /** SHA-1 摘要，小写十六进制（凭证指纹用，见 ADR-042）。 */
  sha1(input: string): string
  /** MD5 摘要，小写十六进制（B 站 wbi 签名用）。 */
  md5(input: string): string
}

/* ============================ 二维码渲染 ============================ */

export interface QrPort {
  /** 把文本渲染成二维码图片的 data URL（PNG）。 */
  toDataUrl(
    text: string,
    options?: { margin?: number; width?: number },
  ): Promise<string>
}

/* ============================ 网易云设备身份（ADR-052） ============================ */

/** 一套设备身份。`token` 为空串表示降级（未就绪或不可用）。 */
export interface NeteaseDeviceIdentity {
  /** `ydDeviceToken`——NEFingerprint 的 32 字符 token；降级时空串。 */
  token: string
  /** 白名单 cookie 拼好的请求头值（`k=v; k=v`）；降级时空串。 */
  cookieHeader: string
  /** 真实设备 id（chainId 用）；可能缺省。 */
  sDeviceId?: string
}

/**
 * 设备身份的取用面。怎么取身份是宿主的事（Node：headless 浏览器；原生端：ADR-053 的纯算法），
 * 内核只在扫码登录时消费：取 key 前等一份身份、轮询时带上、命中 8821 时作废并后台重取。
 */
export interface NeteaseDeviceIdentityPort {
  /** 读缓存（不触发刷新）；未就绪返回 `null`。 */
  getCached(): NeteaseDeviceIdentity | null
  /** 主动等一份身份；超时 / 失败降级为空身份，**绝不 reject**。 */
  ensure(timeoutMs?: number): Promise<NeteaseDeviceIdentity>
  /** 作废缓存（轮询命中 8821 时），下次刷新重新取。 */
  invalidate(): void
  /** 后台刷新（fire-and-forget）。 */
  refresh(): void
}

/* ============================ 网易云第三方库（过渡） ============================ */

/**
 * 网易云第三方库的调用端口——**过渡用**（ADR-065）。
 *
 * 适配器层抽离为内核时，先让 server 经此端口继续调用 `NeteaseCloudMusicApi`，保证行为不变；
 * 随后它承担的接口在内核内改为自实现签名请求，本端口随之删除。
 */
export interface NcmApiPort {
  /** 调用库的某函数（键名即库导出名，如 `cloudsearch`）。 */
  call(name: string, params: Record<string, unknown>): Promise<NcmResponse>
}

/** 库的返回：`body` 为上游 JSON，`cookie` 是「原始 Set-Cookie 字符串数组」。 */
export interface NcmResponse {
  // 库的返回形状随版本漂移，适配器只能在使用处收敛；此处用 any 承接。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  cookie?: string[]
  status?: number
}

/* ============================ 端口注册 ============================ */

export interface CorePorts {
  http: HttpPort
  crypto: CryptoPort
  qrcode: QrPort
  neteaseDevice: NeteaseDeviceIdentityPort
  ncmApi: NcmApiPort
}

let current: CorePorts | null = null

/** 注入宿主端口。可重复调用，后一次整体替换前一次。 */
export function configureCore(ports: CorePorts): void {
  current = ports
}

/** 取当前端口；宿主尚未注入时抛错并指明责任方，而不是在深处冒出 `undefined` 错误。 */
export function corePorts(): CorePorts {
  if (!current) {
    throw new Error(
      '@pterosaur/core 尚未注入宿主端口：宿主须先调用 configureCore()（见 ADR-067）',
    )
  }
  return current
}
