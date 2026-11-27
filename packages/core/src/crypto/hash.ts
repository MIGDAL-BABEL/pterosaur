/**
 * 编解码与摘要：UTF-8、base64、十六进制、MD5 / SHA-1 / SHA-256、PBKDF2（ADR-067）。
 *
 * 只依赖 ECMAScript 内建。UTF-8 编解码既可由宿主经 {@link setUtf8Codec} 注入（如 Node / 浏览器
 * 的 `TextEncoder` 更高效），也内置了一份按 UTF-8 规则手写的实现——QuickJS 没有 `TextEncoder`，
 * 没注入时自动用它，内核在纯 ECMAScript 引擎上也能跑。正确性由 `test/crypto.test.ts` 对拍 Node 原生实现。
 */

/* ============================ 编解码 ============================ */

/**
 * UTF-8 编解码器。缺省使用按 UTF-8 规则手写的实现（见 {@link builtinUtf8Codec}）；
 * 宿主若提供 `TextEncoder` / `TextDecoder`，可经 {@link setUtf8Codec} 换成更快的原生实现。
 */
export interface Utf8Codec {
  encode(s: string): Uint8Array
  decode(b: Uint8Array): string
}

/**
 * 手写 UTF-8 编解码（严格按 RFC 3629）：
 * - 编码按码点分段，补充平面用代理对；
 * - 解码遇到孤立代理 / 截断序列 / 过长编码时替换为 U+FFFD，与 `TextDecoder` 的非 fatal 模式一致。
 */
function builtinUtf8Codec(): Utf8Codec {
  const encode = (s: string): Uint8Array => {
    const out: number[] = []
    for (const ch of s) {
      const cp = ch.codePointAt(0)!
      if (cp < 0x80) out.push(cp)
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
      else if (cp < 0x10000) {
        out.push(
          0xe0 | (cp >> 12),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        )
      } else {
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        )
      }
    }
    return Uint8Array.from(out)
  }
  const decode = (b: Uint8Array): string => {
    let out = ''
    const replacement = '�'
    const read = (i: number): number => b[i]!
    for (let i = 0; i < b.length;) {
      const c = read(i)
      if (c < 0x80) {
        out += String.fromCharCode(c)
        i++
        continue
      }
      let len = 0
      let cp = 0
      if (c >= 0xc2 && c <= 0xdf) {
        len = 2
        cp = c & 0x1f
      } else if (c >= 0xe0 && c <= 0xef) {
        len = 3
        cp = c & 0x0f
      } else if (c >= 0xf0 && c <= 0xf4) {
        len = 4
        cp = c & 0x07
      } else {
        out += replacement
        i++
        continue
      }
      // 按 WHATWG「最大子部分」规则定位错误：合法前缀字节被消费（报一个替换符），
      // 截断序列、过长编码、代理区、超过 U+10FFFF 都只消费首字节。与 TextDecoder 一致。
      const lo =
        len === 3
          ? c === 0xe0
            ? 0xa0
            : 0x80
          : len === 4
            ? c === 0xf0
              ? 0x90
              : 0x80
            : 0x80
      const hi =
        len === 3
          ? c === 0xed
            ? 0x9f
            : 0xbf
          : len === 4
            ? c === 0xf4
              ? 0x8f
              : 0xbf
            : 0xbf
      let aborted = false
      const units: number[] = [c]
      for (let k = 1; k < len; k++) {
        const at = i + k
        if (at >= b.length) {
          aborted = true
          break
        }
        const d = read(at)
        const inRange = d >= (k === 1 ? lo : 0x80) && d <= (k === 1 ? hi : 0xbf)
        if (!inRange) {
          aborted = true
          break
        }
        units.push(d)
      }
      if (aborted) {
        // 合法的续字节（首字节之后）属于这次的「最大子部分」，一并消费掉
        let used = 1
        while (used < units.length && used < len) {
          const d = units[used]!
          if (d < 0x80 || d > 0xbf) break
          used++
        }
        out += replacement
        i += used
        continue
      }
      cp = units.slice(1).reduce((acc, d) => (acc << 6) | (d & 0x3f), cp)
      out += String.fromCodePoint(cp)
      i += len
    }
    return out
  }
  return { encode, decode }
}

let utf8Codec: Utf8Codec = builtinUtf8Codec()

/** 替换 UTF-8 编解码实现（`null` 还原为内置实现）。 */
export function setUtf8Codec(codec: Utf8Codec | null): void {
  utf8Codec = codec ?? builtinUtf8Codec()
}

function codec(): Utf8Codec {
  return utf8Codec
}

/** 字符串 → UTF-8 字节。 */
export function utf8(input: string): Uint8Array {
  return codec().encode(input)
}

/** UTF-8 字节 → 字符串（非法序列替换为 U+FFFD，与 `TextDecoder` 缺省一致）。 */
export function fromUtf8(bytes: Uint8Array): string {
  return codec().decode(bytes)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 标准 base64 编码（补 `=`）。 */
export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += B64[(n >> 18) & 63]!
    out += B64[(n >> 12) & 63]!
    out += B64[(n >> 6) & 63]!
    out += B64[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out +=
      B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '='
  }
  return out
}

const B64_INDEX: Record<string, number> = {}
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]!] = i
B64_INDEX['-'] = 62
B64_INDEX['_'] = 63

/** base64 解码（容忍 URL-safe 字母表与缺失的 `=`）。 */
export function unbase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/_-]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (const ch of clean) {
    acc = (acc << 6) | B64_INDEX[ch]!
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 255
    }
  }
  return out.subarray(0, o)
}

/** 字节 → 小写十六进制。 */
export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** 十六进制 → 字节（大小写均可，忽略非十六进制字符）。 */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(clean.length >> 1)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** 拼接若干字节段。 */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const be32 = (n: number): Uint8Array => {
  n >>>= 0
  return new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
}

/* ============================ 摘要 ============================ */

type Compress = (block: Uint8Array, state: Uint32Array, w: Uint32Array) => void

/**
 * Merkle–Damgård 骨架：补 `0x80`、补零到「块对齐后留出长度字段」，写位长（64 位或 32 位），
 * 再逐块压缩。SHA 系列的长度字段大端，MD5 小端。
 */
function merkleDamgard(
  data: Uint8Array,
  state: Uint32Array,
  blockSize: number,
  lengthSize: number,
  littleEndianLength: boolean,
  compress: Compress,
): Uint8Array {
  const total =
    Math.ceil((data.length + 1 + lengthSize) / blockSize) * blockSize
  const msg = new Uint8Array(total)
  msg.set(data)
  msg[data.length] = 0x80
  const bits = data.length * 8
  const at = total - lengthSize
  // `reverse()` 原地修改，不能用在共享数组上：每个字段各取一份新序
  const values = littleEndianLength
    ? [bits >>> 0, Math.floor(bits / 0x100000000)]
    : [Math.floor(bits / 0x100000000), bits >>> 0]
  values.forEach((v, i) => {
    const p = at + i * 4
    const b = be32(v)
    msg.set(littleEndianLength ? b.slice().reverse() : b, p)
  })
  // 消息调度表：SHA-1 需要 80 个 word，SHA-256 需要 64 个，MD5 需要 16 个——
  // 按 80 分配，三种算法共用一块（按 `blockSize / 4` 分配会让 SHA-1 越界写入被静默丢弃）
  const w = new Uint32Array(80)
  for (let p = 0; p < total; p += blockSize) {
    compress(msg.subarray(p, p + blockSize), state, w)
  }
  const out = new Uint8Array(state.length * 4)
  state.forEach((v, i) => out.set(be32(v), i * 4))
  return out
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function readBeWords(
  block: Uint8Array,
  w: Uint32Array,
  from: number,
  to: number,
): void {
  for (let i = from; i < to; i++) {
    const p = i * 4
    w[i] =
      ((block[p]! << 24) |
        (block[p + 1]! << 16) |
        (block[p + 2]! << 8) |
        block[p + 3]!) >>>
      0
  }
}

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/** SHA-256 摘要。 */
export function sha256(data: Uint8Array): Uint8Array {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ])
  return merkleDamgard(data, state, 64, 8, false, (block, s, w) => {
    readBeWords(block, w, 0, 16)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let a = s[0]!,
      b = s[1]!,
      c = s[2]!,
      d = s[3]!
    let e = s[4]!,
      f = s[5]!,
      g = s[6]!,
      h = s[7]!
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    s[0] = (s[0]! + a) >>> 0
    s[1] = (s[1]! + b) >>> 0
    s[2] = (s[2]! + c) >>> 0
    s[3] = (s[3]! + d) >>> 0
    s[4] = (s[4]! + e) >>> 0
    s[5] = (s[5]! + f) >>> 0
    s[6] = (s[6]! + g) >>> 0
    s[7] = (s[7]! + h) >>> 0
  })
}

/** SHA-1 摘要（凭证指纹用，见 `services/http.ts`）。 */
export function sha1(data: Uint8Array): Uint8Array {
  const state = new Uint32Array([
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0,
  ])
  return merkleDamgard(data, state, 64, 8, false, (block, s, w) => {
    readBeWords(block, w, 0, 16)
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!
      w[i] = ((x << 1) | (x >>> 31)) >>> 0
    }
    let a = s[0]!,
      b = s[1]!,
      c = s[2]!,
      d = s[3]!,
      e = s[4]!
    for (let i = 0; i < 80; i++) {
      let f: number, k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = t
    }
    s[0] = (s[0]! + a) >>> 0
    s[1] = (s[1]! + b) >>> 0
    s[2] = (s[2]! + c) >>> 0
    s[3] = (s[3]! + d) >>> 0
    s[4] = (s[4]! + e) >>> 0
  })
}

const MD5_K = new Uint32Array(
  Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0,
  ),
)
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
]

/** MD5 摘要（B 站 wbi 签名、网易云 eapi 报文摘要用）。 */
export function md5(data: Uint8Array): Uint8Array {
  const state = new Uint32Array([
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476,
  ])
  const digest = merkleDamgard(data, state, 64, 8, true, (block, s, w) => {
    for (let i = 0; i < 16; i++) {
      const p = i * 4
      w[i] =
        (block[p]! |
          (block[p + 1]! << 8) |
          (block[p + 2]! << 16) |
          (block[p + 3]! << 24)) >>>
        0
    }
    let a = s[0]!,
      b = s[1]!,
      c = s[2]!,
      d = s[3]!
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const sum = (a + f + MD5_K[i]! + w[g]!) >>> 0
      const shift = MD5_S[i]!
      const rotated = ((sum << shift) | (sum >>> (32 - shift))) >>> 0
      a = d
      d = c
      c = b
      b = (b + rotated) >>> 0
    }
    s[0] = (s[0]! + a) >>> 0
    s[1] = (s[1]! + b) >>> 0
    s[2] = (s[2]! + c) >>> 0
    s[3] = (s[3]! + d) >>> 0
  })
  // MD5 的输出按小端逐个字段排列（骨架写的是大端）
  const out = new Uint8Array(16)
  for (let i = 0; i < 4; i++) {
    const at = i * 4
    out[at] = digest[at + 3]!
    out[at + 1] = digest[at + 2]!
    out[at + 2] = digest[at + 1]!
    out[at + 3] = digest[at]!
  }
  return out
}

/* ============================ PBKDF2 ============================ */

/**
 * PBKDF2-HMAC-SHA256（输出 32 字节 = 一个块）：网易云网页端 eapi 用
 * `PBKDF2('secret', salt, 1, 32, SHA-256)` 派生 AES 密钥。
 */
export function pbkdf2Sha256(
  password: string,
  salt: string,
  iterations: number,
): Uint8Array {
  const pw = utf8(password)
  if (pw.length > 64) throw new Error('pbkdf2Sha256: 口令超过 64 字节')
  const inner = new Uint8Array(64).fill(0x36)
  const outer = new Uint8Array(64).fill(0x5c)
  for (let i = 0; i < pw.length; i++) {
    inner[i] ^= pw[i]!
    outer[i] ^= pw[i]!
  }
  const hmac = (msg: Uint8Array): Uint8Array =>
    sha256(concatBytes(outer, sha256(concatBytes(inner, msg))))
  let u = hmac(concatBytes(utf8(salt), new Uint8Array([0, 0, 0, 1])))
  const t = u.slice()
  for (let i = 1; i < iterations; i++) {
    u = hmac(u)
    for (let j = 0; j < 32; j++) t[j] ^= u[j]!
  }
  return t
}

/* ============================ RSA PKCS#1 v1.5 ============================ */

/** 从 SPKI 的 DER 字节读出 RSA 公钥（n / e）。只认 RSA 的 `SEQUENCE { SEQUENCE, BIT STRING }`。 */
export function rsaKeyFromSpki(der: Uint8Array): { n: bigint; e: bigint } {
  const read = (at: number): { tag: number; start: number; end: number } => {
    const tag = der[at]!
    let p = at + 1
    let len = der[p++]!
    if (len & 0x80) {
      const count = len & 0x7f
      len = 0
      for (let i = 0; i < count; i++) len = (len << 8) | der[p++]!
    }
    return { tag, start: p, end: p + len }
  }
  const top = read(0)
  const alg = read(top.start)
  const bits = read(alg.end)
  const inner = read(bits.start + 1) // BIT STRING 首字节是「未用位数」
  const mod = read(inner.start)
  const exp = read(mod.end)
  const toBig = ({ start, end }: { start: number; end: number }): bigint => {
    let v = 0n
    for (let i = start; i < end; i++) v = (v << 8n) | BigInt(der[i]!)
    return v
  }
  return { n: toBig(mod), e: toBig(exp) }
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n
  base %= mod
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod
    base = (base * base) % mod
    exp >>= 1n
  }
  return r
}

/**
 * RSA PKCS#1 v1.5 加密（type 2 填充，即 WebCrypto 的 RSAES-PKCS1-v1_5）。
 * `random` 返回 [0,1) 的浮点数，填充串用它取非零字节；随机源由调用方注入以便测试复现。
 */
export function rsaEncryptPkcs1(
  key: { n: bigint; e: bigint },
  message: Uint8Array,
  random: () => number,
): Uint8Array {
  const k = Math.ceil(key.n.toString(16).length / 2)
  if (message.length > k - 11) throw new Error('RSA: 明文过长')
  const em = new Uint8Array(k)
  em[1] = 0x02
  for (let i = 2; i < k - message.length - 1; i++) {
    let b = 0
    while (b === 0) b = Math.floor(random() * 256) & 255
    em[i] = b
  }
  em.set(message, k - message.length)
  let m = 0n
  for (const b of em) m = (m << 8n) | BigInt(b)
  const hex = modPow(m, key.e, key.n)
    .toString(16)
    .padStart(k * 2, '0')
  return fromHex(hex)
}
