/**
 * 网易云网页端 / 客户端接口的签名与加密（ADR-065：协议在内核自实现，不再依赖第三方库）。
 *
 * 网易云的接口按调用方分成几种「加密方式」，本模块实现其中两种：
 *
 * - **weapi**（网页端）：明文 JSON → AES-128-CBC（固定预设密钥 + 固定 IV）→ 再用随机会话密钥
 *   AES-128-CBC 一次 → `params`；会话密钥反转后 RSA PKCS#1 v1.5 加密 → `encSecKey`。
 *   打到 `https://music.163.com/weapi/<path>`。
 * - **eapi**（客户端）：字符串 `<path>-36cd479b6b5-<JSON>-36cd479b6b5-<MD5 原文>` → AES-128-ECB
 *   （固定 eapi 密钥）→ 大写十六进制 `params`。打到 `https://interface.music.163.com/eapi/<path>`；
 *   官方 App 的 eapi 密钥由随机数与固定文本经 PBKDF2 派生，这里沿用库实测可用的固定密钥。
 *
 * 常量与构造方式来自对 `NeteaseCloudMusicApi` 4.32.0 源码的逐行核对（`util/crypto.js` /
 * `util/request.js`），迁移时刻意保持不变——它们是与上游协商的一部分，不是实现细节。
 */
import {
  aesCbcEncrypt,
  aesEcbDecrypt,
  aesEcbEncrypt,
  base64,
  fromHex,
  fromUtf8,
  md5,
  rsaEncryptPkcs1,
  rsaKeyFromSpki,
  toHex,
  unbase64,
  utf8,
} from '../services/crypto.js'

/** weapi 的固定预设密钥与 IV（网页端写死）。 */
const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const IV = '0102030405060708'
/** eapi 的固定密钥（客户端包内常量）。 */
const EAPI_KEY = 'e82ckenh8dichen8'
/** eapi 报文拼接用的分隔串。 */
const EAPI_SEPARATOR = '-36cd479b6b5-'
/** 会话密钥字母表：大小写字母在前、数字在后（库的 `base62`）。 */
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** weapi 用的 RSA 公钥（SPKI，base64）。 */
const WEAPI_PUBLIC_KEY_B64 =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB'
const WEAPI_PUBLIC_KEY = rsaKeyFromSpki(unbase64(WEAPI_PUBLIC_KEY_B64))

/** 一次加密的产物：直接作为表单体发送的键值对。 */
export interface EncryptedForm {
  [field: string]: string
}

/**
 * 生成会话密钥（库的 `weapi()` 原样做法）。
 *
 * 库用 `Math.round(Math.random() * 61)` 选字符：落在 [0.5, 61.5] 之外时会取到 62 号，
 * `charAt(62)` 返回空串——实际密钥**可能是 15 个字符**。上游接受这种密钥，且密钥经 RSA
 * 加密送达，故按库的行为逐字保留；不复刻它会引入与签名无关的请求特征差异。
 */
export function randomSecretKey(random: () => number): string {
  let key = ''
  for (let i = 0; i < 16; i++) {
    key += BASE62.charAt(Math.round(random() * 61))
  }
  return key
}

/**
 * weapi 加密：返回 `{ params, encSecKey }`（表单值）。
 * `random` 供会话密钥与 RSA 填充取随机数，测试注入固定源即可复现。
 */
export function weapiEncrypt(
  payload: Record<string, unknown>,
  random: () => number,
): EncryptedForm {
  const text = JSON.stringify(payload)
  const secret = randomSecretKey(random)
  const inner = base64(aesCbcEncrypt(utf8(PRESET_KEY), utf8(IV), utf8(text)))
  const params = base64(aesCbcEncrypt(utf8(secret), utf8(IV), utf8(inner)))
  const encSecKey = toHex(
    rsaEncryptPkcs1(
      WEAPI_PUBLIC_KEY,
      utf8(secret.split('').reverse().join('')),
      random,
    ),
  )
  return { params, encSecKey }
}

/**
 * eapi 加密：返回 `{ params }`（大写十六进制）。
 * `path` 必须是接口的完整路径（含前导 `/`），因为它参与报文摘要。
 */
export function eapiEncrypt(
  path: string,
  payload: Record<string, unknown> | string,
): EncryptedForm {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const digest = toHex(md5(utf8(`nobody${path}use${text}md5forencrypt`)))
  const data = `${path}${EAPI_SEPARATOR}${text}${EAPI_SEPARATOR}${digest}`
  const cipher = aesEcbEncrypt(utf8(EAPI_KEY), utf8(data))
  return { params: toHex(cipher).toUpperCase() }
}

/**
 * eapi 响应解密（客户端接口可能回加密体）：密文是十六进制，AES-128-ECB 解密后是 JSON。
 * 解析失败返回 `null`，由调用方决定降级。
 */
export function eapiDecrypt(hex: string): unknown {
  try {
    const plain = fromUtf8(aesEcbDecrypt(utf8(EAPI_KEY), fromHex(hex)))
    // 取出报文里的 JSON 段：`path -36cd...- <JSON> -36cd...- <md5>`
    const at = plain.indexOf(EAPI_SEPARATOR)
    const end = plain.lastIndexOf(EAPI_SEPARATOR)
    return JSON.parse(plain.slice(at + EAPI_SEPARATOR.length, end))
  } catch {
    return null
  }
}
