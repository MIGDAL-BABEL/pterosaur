// 骨架测试：只证明「Core 能构建、测试能读契约」。契约用例由 feat/macos 分支补齐。
//
// 契约路径按**源码目录**推算，而不是依赖当前工作目录：
// SwiftPM 把测试编译到 .build/ 下，`#filePath` 指向源码位置，构造时深四层（Tests → Core → macos → apps → 仓库根）。
import XCTest
@testable import PterosaurCore

final class SkeletonTests: XCTestCase {
    private func contractDir() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // Core/Tests
            .deletingLastPathComponent() // Core
            .deletingLastPathComponent() // macos
            .deletingLastPathComponent() // apps
            .appendingPathComponent("packages/contract")
    }

    func testContractDirectoryIsReachable() {
        let caps = contractDir().appendingPathComponent("capabilities.json")
        XCTAssertTrue(FileManager.default.fileExists(atPath: caps.path), "读不到契约：\(caps.path)")
    }
}
