// swift-tools-version: 6.0
import PackageDescription

// macOS 端（ADR-066）：Core 是引擎无关的纯 Swift 协议层，App 是 SwiftUI 外壳。
// 本文件只固定模块边界，不含任何源代码——具体实现在 feat/macos 分支上提交。
let package = Package(
    name: "Pterosaur",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PterosaurCore", targets: ["PterosaurCore"]),
        .executable(name: "Pterosaur", targets: ["PterosaurApp"]),
    ],
    targets: [
        // 协议层：不得依赖 SwiftUI / AVFoundation / WebKit
        .target(name: "PterosaurCore", path: "Core/Sources"),
        // 外壳：只依赖 Core 的公开接口
        .executableTarget(
            name: "PterosaurApp",
            dependencies: ["PterosaurCore"],
            path: "App"
        ),
        // 契约测试：读 ../../packages/contract/**（ADR-069），不得复制样例
        .testTarget(
            name: "PterosaurCoreTests",
            dependencies: ["PterosaurCore"],
            path: "Core/Tests"
        ),
    ]
)