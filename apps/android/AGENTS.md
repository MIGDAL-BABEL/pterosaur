# AGENTS.md — Android 端

Kotlin + Jetpack Compose 的 Pterosaur 原生客户端，**自带内核**（ADR-064）：本应用不依赖自托管
server 即可完整使用；server 只在用户选择「云同步」时作为同步中枢。

协议层的规格与样例全部来自仓库根 `packages/contract/` 与 `docs/`——本目录只放实现。

## 目录

```
apps/android/
├─ settings.gradle.kts        Gradle 多模块：:core（JVM）+ :app（Android）
├─ gradle/libs.versions.toml  版本目录
├─ core/                      协议层与模型（纯 Kotlin/JVM，可单测）
│  ├─ crypto/                 MD5 / SHA-1 / SHA-256 / PBKDF2 / AES / RSA / UTF-8（对拍 contract/vectors）
│  ├─ netease/                签名（weapi / eapi）、接口、扫码登录、设备身份（ADR-053 纯算法）
│  ├─ bilibili/               搜索、dash.audio、字幕歌词、WBI 签名
│  ├─ model/                  Track / Artist / Album / Playlist / LibraryData（对应 shared/types.ts）
│  └─ src/test/               读 ../../packages/contract/** 的测试
└─ app/                       Compose UI、Media3（ExoPlayer）、DataStore、播放服务
```

`:core` 是 **JVM 模块**（`kotlin("jvm")`），不依赖 Android SDK——契约测试在 Windows 本机即可跑。

## 铁律

- **只有 :core 可以请求上游**。`:app` 不得出现 OkHttp / 上游域名（对应 Web 端的「同源代理铁律」，ADR-064）。
- **:core 的契约测试必须读 `packages/contract`**，不得把样例复制进来。
- **改协议 = 同一提交里改 `packages/contract`**（ADR-065 / ADR-069）。
- **`LibraryData` 的未知字段必须原样回写**：云同步是整份覆盖（ADR-038），`ignoreUnknownKeys` 解码
  后回写会抹掉其它端写入的内容——persisted 模型须保留未知键（如 `JsonObject` 兜底）。
- 播放地址一律 https；封面按 CDN 规范化（网易云 `canonicalNeteaseImage` 的 Kotlin 版、B 站 `i0`–`iN` 归一）。
- 扫码登录：二维码由 Compose 画（内核只给 URL）；会话 cookie 存加密存储（`EncryptedSharedPreferences`
  或 Keystore），退出登录一并清理。设备身份优先用 ADR-053 的纯算法；兜底可用隐藏 `WebView` 跑官方 SDK。
- 明文 HTTP 的自填 server 地址需要 network security config 例外。

## 构建

```bash
# 骨架阶段没有 gradle wrapper：用系统 gradle（8.11+）执行；feat/android 分支提交时补 ./gradlew
gradle :core:test        # 契约测试（Windows 本机可跑）
gradle :app:assembleDebug
```

CI 在 Ubuntu runner 上跑 `:core:test` 与 `:app:assembleDebug`（`.github/workflows/all.yml` 的 `android` job）。

## 功能范围

- 支持：发现 / 搜索 / 歌单 / 艺人 / 专辑 / 磁带（B 站）/ 播放队列 / 全屏歌词 / 资料库 / 登录（扫码 + 自提供 Cookie）。
- **不支持**：CD 刻录（ADR-064 已定）；PWA 外壳缓存（Web 专属）。
- 待定：翻录的数字打包（ZIP）是否进入本端。

## 发版

按路径打 tag：`android/v<版本>`。