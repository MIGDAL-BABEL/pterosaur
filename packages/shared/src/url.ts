/**
 * URL 与表单编解码的纯 ES 实现（ADR-067）。
 *
 * `URL` / `URLSearchParams` 是 WHATWG 的宿主 API，不属于 ECMAScript：浏览器与 Node 有，
 * 内核（`@pterosaur/core`）将来要跑的 QuickJS 没有。`shared` 被内核依赖，故这里不直接用它们，
 * 而是按 WHATWG 的口径实现一个最小子集；对合法输入，输出与原生实现逐字节一致
 * （见 `test/url.test.ts`，用例直接拿 Node 的原生实现对拍）。
 *
 * 刻意**不做**的事：路径点段归一化、非 ASCII 的百分号编码、IDN 与默认端口折叠——
 * CDN 图片地址用不到，调用方拿到的是上游给出的合法 ASCII 地址。
 */

/* ============================ 表单编码 ============================ */

/**
 * `application/x-www-form-urlencoded` 的值编码（口径同 `URLSearchParams.toString()`）：
 * 空格写作 `+`；除 `* - . _` 与字母数字外一律百分号编码（大写十六进制）。
 */
export function formUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(
      /[!'()~]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    )
}

/**
 * 表单值解码：`+` 还原为空格，百分号序列按 UTF-8 解码。
 * 遇到非法的 UTF-8 序列时整段原样保留（WHATWG 会替换成 U+FFFD，这里保守不猜）。
 */
function formUrlDecode(value: string): string {
  return value.replace(/\+/g, ' ').replace(/(?:%[0-9a-fA-F]{2})+/g, (seq) => {
    try {
      return decodeURIComponent(seq)
    } catch {
      return seq
    }
  })
}

/** 把键值对序列化为表单串，等价于 `new URLSearchParams(fields).toString()`。 */
export function encodeForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${formUrlEncode(k)}=${formUrlEncode(v)}`)
    .join('&')
}

/* ============================ URL 拆解 ============================ */

export interface UrlParts {
  /** 小写 scheme，含冒号，如 `https:`。 */
  protocol: string
  /** userinfo 段（含末尾的 `@`）；没有时为空串。 */
  userinfo: string
  /** 主机名（小写；IPv6 字面量保留方括号），不含端口。 */
  hostname: string
  /** 端口段（含前导冒号）；没有时为空串。 */
  port: string
  /** 路径、查询串与片段；原串没有路径时为 `/`。 */
  rest: string
}

/**
 * 把绝对 URL 拆成 `scheme://[userinfo@]hostname[:port]rest`。
 * 只认带 `//` 的绝对地址（http / https 等「特殊 scheme」的形态）；解析不了返回 `null`，
 * 对应 `new URL()` 抛错。首尾空白按 WHATWG 口径先剥掉。
 */
export function splitUrl(url: string): UrlParts | null {
  const text = url.trim()
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^\s]*)$/i.exec(text)
  if (!m || !m[1]) return null
  const authority = m[1]
  const at = authority.lastIndexOf('@')
  const userinfo = at < 0 ? '' : authority.slice(0, at + 1)
  const host = at < 0 ? authority : authority.slice(at + 1)
  // 端口是最后一个冒号之后的段；IPv6 字面量里的冒号在 `]` 之前，不算
  const hasPort = host.lastIndexOf(':') > host.lastIndexOf(']')
  const hostname = (
    hasPort ? host.slice(0, host.lastIndexOf(':')) : host
  ).toLowerCase()
  const port = hasPort ? host.slice(host.lastIndexOf(':')) : ''
  const rest = m[2] === '' || m[2][0] === '/' ? m[2] : `/${m[2]}`
  return {
    protocol: `${text.slice(0, text.indexOf(':')).toLowerCase()}:`,
    userinfo,
    hostname,
    port,
    rest: rest === '' ? '/' : rest,
  }
}

/** 按原样拼回 URL（scheme / 主机 / 路径段可替换，用于改写后的重建）。 */
export function joinUrl(
  parts: UrlParts,
  override: Partial<Pick<UrlParts, 'protocol' | 'hostname' | 'rest'>> = {},
): string {
  return `${override.protocol ?? parts.protocol}//${parts.userinfo}${override.hostname ?? parts.hostname}${parts.port}${override.rest ?? parts.rest}`
}

/* ============================ 查询串 ============================ */

/** 取查询串（`?` 之后、`#` 之前）；没有查询串返回空串。 */
function queryString(rest: string): string {
  const i = rest.indexOf('?')
  if (i < 0) return ''
  const h = rest.indexOf('#', i)
  return h < 0 ? rest.slice(i + 1) : rest.slice(i + 1, h)
}

/** 去掉查询串，保留路径与片段。 */
function withoutQuery(rest: string): string {
  const i = rest.indexOf('?')
  if (i < 0) return rest
  const h = rest.indexOf('#', i)
  return h < 0 ? rest.slice(0, i) : rest.slice(0, i) + rest.slice(h)
}

/** 把 `path?query#fragment` 的查询串整体换成 `query`（空串即去掉查询串），路径与片段不动。 */
export function replaceQuery(rest: string, query: string): string {
  const base = withoutQuery(rest)
  if (!query) return base
  const h = base.indexOf('#')
  return h < 0
    ? `${base}?${query}`
    : `${base.slice(0, h)}?${query}${base.slice(h)}`
}

/** 查询串里某个键的全部值（表单口径解码），按出现顺序；键名按解码后的值比对。 */
export function queryValues(rest: string, key: string): string[] {
  const values: string[] = []
  for (const pair of queryString(rest).split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (formUrlDecode(eq < 0 ? pair : pair.slice(0, eq)) !== key) continue
    values.push(formUrlDecode(eq < 0 ? '' : pair.slice(eq + 1)))
  }
  return values
}
