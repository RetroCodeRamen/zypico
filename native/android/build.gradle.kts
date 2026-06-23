// AGP 9.2.1 bundles Kotlin Gradle plugin 2.2.x, but the meshtastic-sdk is built
// with Kotlin 2.4.0 — override the built-in KGP to 2.4.0 so its metadata reads.
buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.0")
  }
}

plugins {
  // AGP 9 has built-in Kotlin support — no separate Kotlin plugin needed.
  id("com.android.application") version "9.2.1" apply false
}
