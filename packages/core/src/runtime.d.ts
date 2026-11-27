/**
 * 内核假定的运行环境（ADR-067）：标准 ES 之外只有定时器。
 *
 * 本包的 tsconfig 不带 DOM / Node 类型——`fetch`、`Response`、`URLSearchParams`、`process`、
 * `Buffer` 等在类型上即不可见，误用会直接编译失败；定时器是唯一例外，在此声明。
 * 返回类型取 `unknown`：Node 的 `setTimeout` 返回 `NodeJS.Timeout`，浏览器返回 number，
 * 内核只把句柄原样交回 `clearTimeout`，从不检视它。
 */
declare function setTimeout(handler: () => void, timeout?: number): unknown
declare function clearTimeout(id: unknown): void
