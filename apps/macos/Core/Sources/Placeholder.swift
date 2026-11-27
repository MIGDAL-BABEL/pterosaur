// Core：协议层（ADR-066）。骨架阶段只有模块出口，具体实现由 feat/macos 分支提交。
// 本模块不得 import SwiftUI / AVFoundation / WebKit——只有它能请求上游（ADR-064）。

/// 契约目录的相对位置（从 `apps/macos/Core/Sources/` 出发：Sources → Core → macos → apps → 仓库根）。
public let contractRoot = "../../../../packages/contract"
