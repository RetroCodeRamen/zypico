plugins {
  // AGP 9 brings Kotlin support built-in.
  id("com.android.application")
}

android {
  namespace = "com.zypico.app"
  compileSdk = 37

  defaultConfig {
    applicationId = "com.zypico.app"
    minSdk = 26
    targetSdk = 37
    versionCode = 1
    versionName = "0.1.0"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildTypes {
    debug { isMinifyEnabled = false }
  }
}

dependencies {
  // The official Meshtastic Kotlin SDK — BLE transport + on-device storage.
  implementation("org.meshtastic:sdk-core:0.1.1-SNAPSHOT")
  implementation("org.meshtastic:sdk-transport-ble:0.1.1-SNAPSHOT")
  implementation("org.meshtastic:sdk-storage-sqldelight:0.1.1-SNAPSHOT")
  implementation("com.juul.kable:kable-core:0.43.1")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}
