/**
 * AES：按定义直写的参考实现，支持 128 / 192 / 256 位密钥，ECB / CBC + PKCS#7（ADR-067）。
 *
 * 刻意避开定点数、BigInt 与宿主 crypto：纯整数位运算，移植到 Swift / Kotlin / C++ 时逐行可照抄。
 * 正确性由 `test/crypto.test.ts` 对拍 Node `node:crypto` 的分组 / 链路加密（含分块与填充边界）。
 */

/* ============================ S 盒 ============================ */

/** GF(2^8) 乘 2（域多项式 x^8 + x^4 + x^3 + x + 1）。 */
const xtime = (b: number): number => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 255

const SBOX = new Uint8Array(256)
const INV_SBOX = new Uint8Array(256)
;(() => {
  // S 盒按定义生成：GF(2^8) 乘法逆元 → 仿射变换（⊕ 循环左移 1..4 位 → ⊕ 0x63）
  const inverse = new Uint8Array(256)
  for (let a = 1; a < 256; a++) {
    for (let b = 1; b < 256; b++) {
      // 判断 a * b == 1：逐步「乘 2 + 条件异或」的俄罗斯农民乘法
      let x = a
      let y = b
      let p = 0
      while (y) {
        if (y & 1) p ^= x
        x = xtime(x)
        y >>= 1
      }
      if (p === 1) {
        inverse[a] = b
        break
      }
    }
  }
  for (let i = 0; i < 256; i++) {
    const x = inverse[i]!
    const rot = (k: number): number => ((x << k) | (x >>> (8 - k))) & 255
    const s = x ^ rot(1) ^ rot(2) ^ rot(3) ^ rot(4) ^ 0x63
    SBOX[i] = s
    INV_SBOX[s] = i
  }
})()

/** GF(2^8) 乘 n（n ∈ {2, 3, 9, 11, 13, 14}，InvMixColumns 需要）。 */
const mul = (a: number, n: number): number => {
  let p = 0
  let x = a
  let y = n
  while (y) {
    if (y & 1) p ^= x
    x = xtime(x)
    y >>= 1
  }
  return p
}

/* ============================ 分组 ============================ */

/** 展开轮密钥：`rounds + 1` 个 16 字节分组依次排列。 */
function expandKey(key: Uint8Array): { roundKeys: Uint8Array; rounds: number } {
  const nk = key.length >> 2
  if (nk !== 4 && nk !== 6 && nk !== 8) {
    throw new Error('AES 密钥长度必须是 16 / 24 / 32 字节')
  }
  const rounds = nk + 6
  const words = new Uint8Array((rounds + 1) * 16)
  words.set(key)
  let rcon = 1
  for (let w = nk; w < (rounds + 1) * 4; w++) {
    const prev = words.subarray((w - 1) * 4, w * 4)
    let t = [prev[0]!, prev[1]!, prev[2]!, prev[3]!]
    if (w % nk === 0) {
      t = [t[1]!, t[2]!, t[3]!, t[0]!].map((b) => SBOX[b]!)
      t[0] ^= rcon
      rcon = xtime(rcon)
    } else if (nk > 6 && w % nk === 4) {
      t = t.map((b) => SBOX[b]!)
    }
    for (let j = 0; j < 4; j++) {
      words[w * 4 + j] = words[(w - nk) * 4 + j]! ^ t[j]!
    }
  }
  return { roundKeys: words, rounds }
}

/** 状态按「列优先」存放：`s[r + 4c]` 即第 c 列第 r 行。 */
function shiftRows(s: Uint8Array, inverse: boolean): void {
  const t = s.slice()
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      // 正向：第 r 行左移 r；逆向：右移 r
      const from = inverse ? (c - r + 4) % 4 : (c + r) % 4
      s[c * 4 + r] = t[from * 4 + r]!
    }
  }
}

function mixColumns(s: Uint8Array, inverse: boolean): void {
  const m = inverse ? [14, 11, 13, 9] : [2, 3, 1, 1]
  for (let c = 0; c < 4; c++) {
    const a = [s[c * 4]!, s[c * 4 + 1]!, s[c * 4 + 2]!, s[c * 4 + 3]!]
    s[c * 4] =
      mul(a[0]!, m[0]!) ^
      mul(a[1]!, m[1]!) ^
      mul(a[2]!, m[2]!) ^
      mul(a[3]!, m[3]!)
    s[c * 4 + 1] =
      mul(a[0]!, m[3]!) ^
      mul(a[1]!, m[0]!) ^
      mul(a[2]!, m[1]!) ^
      mul(a[3]!, m[2]!)
    s[c * 4 + 2] =
      mul(a[0]!, m[2]!) ^
      mul(a[1]!, m[3]!) ^
      mul(a[2]!, m[0]!) ^
      mul(a[3]!, m[1]!)
    s[c * 4 + 3] =
      mul(a[0]!, m[1]!) ^
      mul(a[1]!, m[2]!) ^
      mul(a[2]!, m[3]!) ^
      mul(a[3]!, m[0]!)
  }
}

function addRoundKey(
  s: Uint8Array,
  roundKeys: Uint8Array,
  round: number,
): void {
  for (let i = 0; i < 16; i++) s[i] ^= roundKeys[round * 16 + i]!
}

class Aes {
  private readonly roundKeys: Uint8Array
  private readonly rounds: number

  constructor(key: Uint8Array) {
    const { roundKeys, rounds } = expandKey(key)
    this.roundKeys = roundKeys
    this.rounds = rounds
  }

  encryptBlock(block: Uint8Array): Uint8Array {
    const s = block.slice()
    addRoundKey(s, this.roundKeys, 0)
    for (let round = 1; round <= this.rounds; round++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]!]!
      shiftRows(s, false)
      if (round !== this.rounds) mixColumns(s, false)
      addRoundKey(s, this.roundKeys, round)
    }
    return s
  }

  decryptBlock(block: Uint8Array): Uint8Array {
    const s = block.slice()
    addRoundKey(s, this.roundKeys, this.rounds)
    for (let round = this.rounds - 1; round >= 0; round--) {
      shiftRows(s, true)
      for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]!]!
      addRoundKey(s, this.roundKeys, round)
      if (round !== 0) mixColumns(s, true)
    }
    return s
  }
}

/* ============================ 链路模式 ============================ */

function pkcs7Pad(data: Uint8Array): Uint8Array {
  const size = 16 - (data.length % 16)
  const out = new Uint8Array(data.length + size)
  out.set(data)
  out.fill(size, data.length)
  return out
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  const size = data[data.length - 1] ?? 0
  if (size < 1 || size > 16 || size > data.length) return data
  for (let i = data.length - size; i < data.length; i++) {
    if (data[i] !== size) return data
  }
  return data.subarray(0, data.length - size)
}

const assertBlocks = (data: Uint8Array, label: string): void => {
  if (data.length === 0 || data.length % 16 !== 0) {
    throw new Error(`${label}: 密文长度必须是 16 的正整数倍`)
  }
}

function ecbEncrypt(aes: Aes, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let p = 0; p < data.length; p += 16) {
    out.set(aes.encryptBlock(data.subarray(p, p + 16)), p)
  }
  return out
}

function ecbDecrypt(aes: Aes, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let p = 0; p < data.length; p += 16) {
    out.set(aes.decryptBlock(data.subarray(p, p + 16)), p)
  }
  return out
}

/** AES-ECB 加密（PKCS#7 填充）。 */
export function aesEcbEncrypt(key: Uint8Array, plain: Uint8Array): Uint8Array {
  return ecbEncrypt(new Aes(key), pkcs7Pad(plain))
}

/** AES-ECB 解密（去 PKCS#7 填充）。 */
export function aesEcbDecrypt(key: Uint8Array, cipher: Uint8Array): Uint8Array {
  assertBlocks(cipher, 'aesEcbDecrypt')
  return pkcs7Unpad(ecbDecrypt(new Aes(key), cipher))
}

/** AES-CBC 加密（PKCS#7 填充），逐块先异或前文再加密。 */
export function aesCbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plain: Uint8Array,
): Uint8Array {
  if (iv.length !== 16) throw new Error('AES-CBC: IV 必须是 16 字节')
  const aes = new Aes(key)
  const data = pkcs7Pad(plain)
  const out = new Uint8Array(data.length)
  let prev = iv
  for (let p = 0; p < data.length; p += 16) {
    const x = new Uint8Array(16)
    for (let i = 0; i < 16; i++) x[i] = data[p + i]! ^ prev[i]!
    prev = aes.encryptBlock(x)
    out.set(prev, p)
  }
  return out
}

/** AES-CBC 解密（去 PKCS#7 填充），逐块解密后再异或前文密文。 */
export function aesCbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  cipher: Uint8Array,
): Uint8Array {
  if (iv.length !== 16) throw new Error('AES-CBC: IV 必须是 16 字节')
  assertBlocks(cipher, 'aesCbcDecrypt')
  const aes = new Aes(key)
  const out = new Uint8Array(cipher.length)
  let prev = iv
  for (let p = 0; p < cipher.length; p += 16) {
    const block = cipher.subarray(p, p + 16)
    const d = aes.decryptBlock(block)
    for (let i = 0; i < 16; i++) out[p + i] = d[i]! ^ prev[i]!
    prev = block
  }
  return pkcs7Unpad(out)
}
