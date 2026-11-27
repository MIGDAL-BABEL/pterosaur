rootProject.name = "PterosaurAndroid"

// Android 端（ADR-066）：:core 是 JVM 模块（不依赖 Android SDK），:app 是 Compose 外壳。
// 本文件只固定模块边界，不含任何源代码——具体实现在 feat/android 分支上提交。

pluginManagement {
    repositories {
        google()
        mavenCentral()
        // 中国境内镜像优先（AGENTS.md「下载依赖优先使用中国境内镜像」）
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        maven("https://maven.aliyun.com/repository/public")
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
    }
}

include(":core")
include(":app")
