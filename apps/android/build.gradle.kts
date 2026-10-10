// Root build file. Per-module config lives in app/build.gradle.kts; this file
// only declares which Gradle plugins are available to the project, at which
// versions, without applying them anywhere — the standard AGP/Kotlin DSL
// layout since Android Gradle Plugin 7+.
plugins {
    // AGP 8.9+ (Gradle 8.11.1+ required) because androidx.browser, pulled in
    // transitively by androidbrowserhelper, needs it. Bump AGP/Kotlin/Gradle
    // together — see gradle/wrapper/gradle-wrapper.properties.
    id("com.android.application") version "8.9.2" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
}

tasks.register("clean", Delete::class) {
    delete(rootProject.layout.buildDirectory)
}
