# AGENTS.md — macOS 端

Swift + SwiftUI（Liquid Glass）的 Pterosaur 原生客户端，**自带内核**（ADR-064）：本应用不依赖自托管
server 即可完整使用；server 只在用户选择「云同步」时作为同步中枢。

协议层的规格与样例全部来自仓库根 `packages/contract/` 与 `docs/`——本目录只放实现。

## 目录

```
apps/macos/
├─ Package.swift         SwiftPM 清单：Core（纯逻辑）+ App（可执行）两个 target
├─ Core/                 协议层与模型（引擎无关的纯 Swift，可单测）
│  ├─ Crypto/            MD5 / SHA-1 / SHA-256 / PBKDF2 / AES / RSA / UTF-8（对拍 contract/vectors）
│  ├─ Netease/           签名（weapi / eapi）、接口、扫码登录、设备身份（ADR-053 纯算法）
│  ├─ Bilibili/          搜索、dash.audio、字幕歌词、WBI 签名
│  ├─ Model/             Track / Artist / Album / Playlist / LibraryData（对应 shared/types.ts）
│  └─ ContractTests/     读 ../../packages/contract/** 的测试
└─ App/                  SwiftUI 视图、AVPlayer、Keychain、持久化
```

`Core` 与 `App` 之间只通过协议交互——`Core` 不 import SwiftUI / AVFoundation / WebKit。

## 铁律

- **只有 Core 可以请求上游**。UI 层不得出现 `URLSession` 或上游域名（对应 Web 端的「同源代理铁律」，ADR-064）。
- **Core 的契约测试必须读 `packages/contract`**，不得把样例复制进来。
- **改协议 = 同一提交里改 `packages/contract`**（ADR-065 / ADR-069）。
- **`LibraryData` 的未知字段必须原样回写**：云同步是整份覆盖（ADR-038），解码时丢弃未知字段再回写
  会抹掉其它端写入的内容。Swift 的 `Codable` 默认丢字段——persisted 模型须自定义解码与编码保留未知键。
- 播放地址一律 https；封面按 CDN 规范化（网易云 `canonicalNeteaseImage` 的 Swift 版、B 站 `i0`–`iN` 归一）。
- 扫码登录：二维码由 SwiftUI 画（内核只给 URL）；会话 cookie 存 Keychain，退出登录一并清理。
  设备身份优先用 ADR-053 的纯算法；兜底可用隐藏 `WKWebView` 跑官方 SDK。

## 构建

```bash
swift build                 # 需要 macOS + Xcode 26 命令行工具
swift test                  # Core 的契约测试（读 packages/contract）
```

Windows 上无法构建本端；CI 的 macOS runner 负责构建与测试（`.github/workflows/all.yml` 的 `macos` job）。

## 功能范围

- 支持：发现 / 搜索 / 歌单 / 艺人 / 专辑 / 磁带（B 站）/ 播放队列 / 全屏歌词 / 资料库 / 登录（扫码 + 自提供 Cookie）。
- **不支持**：CD 刻录（ADR-064 已定）；PWA 外壳缓存（Web 专属）。
- 待定：翻录的数字打包（ZIP）是否进入本端。

## 发版

按路径打 tag：`macos/v<版本>`。