// 骨架测试：只证明「:core 能构建、测试能读契约」。契约用例由 feat/android 分支补齐。
package im.xrl.pterosaur.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

class SkeletonTest {
    @Test
    fun contractDirectoryIsReachable() {
        val caps = File(CONTRACT_ROOT, "capabilities.json")
        assertTrue(caps.exists(), "读不到契约：${caps.absolutePath}")
    }
}
