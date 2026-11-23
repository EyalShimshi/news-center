package io.github.eyalshimshi.newscenter.ui.watch

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.github.eyalshimshi.newscenter.data.isBlockedAddress
import io.github.eyalshimshi.newscenter.model.Channel
import java.io.ByteArrayInputStream
import java.util.Locale

/**
 * A web-page channel (Channel 12): the broadcaster's own page and player, showing just the player.
 * The page follows the tile's mute and volume through page-helper.js (in every frame of the page,
 * like in the desktop app), and starts muted.
 */
@Composable
fun PageView(channel: Channel, muted: Boolean, volume: Float, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val audio = remember(channel.id, channel.url) { PageAudio() }
    val webView = remember(channel.id, channel.url) { createPageWebView(context, channel.url, audio) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(webView, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    webView.evaluateJavascript("window.newscenterPause && window.newscenterPause();", null)
                    webView.onPause()
                }
                Lifecycle.Event.ON_START -> {
                    webView.onResume()
                    webView.evaluateJavascript("window.newscenterResume && window.newscenterResume();", null)
                }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(webView, muted, volume) {
        audio.muted = muted
        audio.volume = volume.coerceIn(0f, 1f)
        webView.evaluateJavascript(audio.script(), null)
    }
    key(webView) {
        AndroidView(
            factory = { webView },
            // Only once the page is off the screen: a WebView mustn't be destroyed while it's shown.
            onRelease = { view ->
                view.stopLoading()
                view.destroy()
            },
            modifier = modifier,
        )
    }
}

/** What the page's sound should be; re-applied whenever a page finishes loading. */
private class PageAudio {
    var muted = true
    var volume = 1f

    fun script(): String =
        "window.newscenterAudio && window.newscenterAudio($muted, ${String.format(Locale.US, "%.3f", volume)});"
}

@SuppressLint("SetJavaScriptEnabled")
private fun createPageWebView(context: Context, url: String, audio: PageAudio): WebView {
    val helper = context.assets.open("page-helper.js").bufferedReader().use { it.readText() }
    val documentStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    return WebView(context).apply {
        setBackgroundColor(Color.BLACK)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        // The broadcaster's desktop page has the full live player; its mobile page promotes an app.
        settings.userAgentString = DESKTOP_USER_AGENT
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        if (documentStart) WebViewCompat.addDocumentStartJavaScript(this, helper, setOf("*"))
        webViewClient = object : WebViewClient() {
            // Blocked sites get no request at all, even when the page embeds them.
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (isBlockedAddress(request.url.toString())) {
                    WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                } else {
                    null
                }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                isBlockedAddress(request.url.toString())

            override fun onPageFinished(view: WebView, url: String?) {
                if (!documentStart) view.evaluateJavascript(helper, null)
                view.evaluateJavascript(audio.script(), null)
            }
        }
        webChromeClient = object : WebChromeClient() {
            // Lets the player use protected (DRM) video if the broadcaster needs it.
            override fun onPermissionRequest(request: PermissionRequest) {
                val allowed = request.resources.filter { it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }
                if (allowed.isEmpty()) request.deny() else request.grant(allowed.toTypedArray())
            }
        }
        loadUrl(url)
    }
}

private const val DESKTOP_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
