// :core —— 协议层（ADR-066）。纯 JVM 模块，不依赖 Android SDK：契约测试在 Windows 本机即可跑。
// 本模块不得引入 Android 依赖；只有它能请求上游（ADR-064）。
plugins {
    alias(libs.plugins.kotlin.jvm)
    `java-library`
}

kotlin { jvmToolchain(21) }

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    // Gradle 测试的缺省工作目录即本模块根（apps/android/core/），契约在 ../../../packages/contract
}
