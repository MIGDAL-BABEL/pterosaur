// :app —— Compose 外壳（ADR-066）。骨架阶段只有空壳；具体界面由 feat/android 分支提交。
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "im.xrl.pterosaur"
    compileSdk = 35

    defaultConfig {
        applicationId = "im.xrl.pterosaur"
        minSdk = 29
        targetSdk = 35
    }
}

dependencies {
    implementation(project(":core"))
}
