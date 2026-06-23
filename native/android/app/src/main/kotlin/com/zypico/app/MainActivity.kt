package com.zypico.app

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView

// Minimal shell for the first build (dependency/toolchain derisk). The Meshtastic
// SDK bridge + bundled UI loading get wired once this compiles and the snapshot
// SDK resolves.
class MainActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val web = WebView(this)
    web.settings.javaScriptEnabled = true
    web.settings.domStorageEnabled = true
    setContentView(web)
    web.loadUrl("file:///android_asset/web/index.html")
  }
}
