package com.nothing.voiceagent.assist

import android.content.Context
import android.service.voice.VoiceInteractionSession
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * The actual on-screen overlay shown when the assist gesture fires — this is the
 * Siri-like popup. It hosts a WebView pointed at the same Cordova/Angular `www`
 * bundle the main app uses, so the listening-orb UI (angular-app/src/app/assistant)
 * is shared between "launch from app icon" and "launch via assist gesture".
 *
 * android:supportsAssist handles bringing this up; this class only needs to supply
 * the content view and manage its lifecycle.
 */
class VoiceAssistSession(context: Context) : VoiceInteractionSession(context) {

    private var webView: WebView? = null

    override fun onCreateContentView(): View {
        val webView = WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    // main.ts installs window.startAssistantTurn once Angular bootstraps,
                    // which happens shortly after the page load event this fires on — skip
                    // the "tap to speak" step so the assist gesture behaves like Siri's,
                    // listening starting the instant the overlay appears. If bootstrap is
                    // still in flight this no-ops harmlessly; worth revisiting with a retry
                    // or an explicit "app ready" postMessage once this runs on a real device.
                    view.evaluateJavascript("window.startAssistantTurn && window.startAssistantTurn();", null)
                }
            }
            loadUrl("file:///android_asset/www/index.html")
        }
        this.webView = webView
        return webView
    }

    override fun onHide() {
        super.onHide()
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
