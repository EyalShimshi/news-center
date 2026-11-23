package io.github.eyalshimshi.newscenter.ui.knesset

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.github.eyalshimshi.newscenter.data.Http
import io.github.eyalshimshi.newscenter.data.KnessetFetch
import io.github.eyalshimshi.newscenter.data.hostName
import io.github.eyalshimshi.newscenter.data.isBlockedAddress
import io.github.eyalshimshi.newscenter.playback.PlayerPool
import io.github.eyalshimshi.newscenter.ui.openUrl
import java.io.ByteArrayInputStream
import java.io.IOException
import kotlin.math.roundToInt
import org.json.JSONObject

/** What the Knesset page asks the app to do. */
sealed interface KnessetRequest {
    /** Show this Knesset channel big on the Watch screen, heard alone. */
    data class Watch(val id: String) : KnessetRequest

    /** Play a recording (or a live room that isn't among the channels). */
    data class Play(val url: String, val title: String) : KnessetRequest

    data object RefreshChannels : KnessetRequest

    data class Message(val text: String) : KnessetRequest
}

/**
 * The Knesset screen's page: the Windows app's Knesset view (assets/knesset/) in one WebView that
 * lives as long as the app's screen, so switching tabs keeps its place and its data. A page can't
 * read other sites, so it asks for the Knesset's replies at /__fetch, which the app answers through
 * [Http] (blocked sites refused at every redirect) for the addresses [KnessetFetch] allows.
 */
class KnessetWeb(private val context: Context, private val http: Http) {

    /** Changes when the page had to start over (its renderer was stopped), so it's shown anew. */
    var generation by mutableIntStateOf(0)
        private set

    /** The page has a detail or a player open, which the back gesture closes first. */
    var canGoBack by mutableStateOf(false)
        private set

    var onRequest: ((KnessetRequest) -> Unit)? = null

    private var webView: WebView? = null
    private val main = Handler(Looper.getMainLooper())
    private var ready = false
    private var theme = ""
    private var channels = ""

    /** The page, created on first use with the app's colors ([theme], see KnessetScreen). */
    fun obtain(theme: String): WebView {
        this.theme = theme
        return webView ?: create().also { webView = it }
    }

    fun setTheme(json: String) {
        if (json == theme) return
        theme = json
        if (ready) evaluate("window.__nc&&window.__nc.theme($json)")
    }

    fun setChannels(json: String) {
        if (json == channels) return
        channels = json
        if (ready) evaluate("window.__nc&&window.__nc.channels($json)")
    }

    fun back() = evaluate("window.__nc&&window.__nc.back()")

    /** While the screen is out of sight the page counts as hidden and stops refreshing. */
    fun onShown() {
        webView?.onResume()
    }

    fun onHidden() {
        webView?.onPause()
    }

    fun destroy() {
        webView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        webView = null
        ready = false
        canGoBack = false
    }

    private fun evaluate(script: String) {
        webView?.evaluateJavascript(script, null)
    }

    private fun handle(data: String?) {
        val message = runCatching { JSONObject(data.orEmpty()) }.getOrNull() ?: return
        when (message.optString("type")) {
            "ready" -> {
                ready = true
                if (theme.isNotEmpty()) evaluate("window.__nc&&window.__nc.theme($theme)")
                if (channels.isNotEmpty()) evaluate("window.__nc&&window.__nc.channels($channels)")
            }
            "back" -> canGoBack = message.optBoolean("open")
            "log" -> Log.i(PlayerPool.TAG, "knesset: " + message.optString("text").take(MAX_LOG_CHARS))
            "watch" -> onRequest?.invoke(KnessetRequest.Watch(message.optString("id")))
            "play" -> onRequest?.invoke(KnessetRequest.Play(message.optString("url"), message.optString("title")))
            "refresh" -> onRequest?.invoke(KnessetRequest.RefreshChannels)
            "toast" -> onRequest?.invoke(KnessetRequest.Message(message.optString("text").take(MAX_MESSAGE_CHARS)))
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun create(): WebView {
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
        return WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportZoom(false)
            // Desktop-sized text, a little larger for a phone, following the system's font size.
            settings.textZoom = (context.resources.configuration.fontScale * TEXT_ZOOM).roundToInt()
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.addWebMessageListener(this, BRIDGE, setOf(ORIGIN)) { _, message, _, isMainFrame, _ ->
                    if (isMainFrame) handle(message.data)
                }
            } else {
                addJavascriptInterface(Bridge(), BRIDGE)
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val url = request.url
                    if (url.host == HOST) return if (url.path == FETCH_PATH) fetch(request) else assets.shouldInterceptRequest(url)
                    return if (isBlockedAddress(url.toString())) reply(403, "") else null
                }

                // The page stays put; its links (Knesset pages, documents) open in the browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.host == HOST) return false
                    val address = url.toString()
                    if ((url.scheme == "https" || url.scheme == "http") && !isBlockedAddress(address)) openUrl(context, address)
                    return true
                }

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    Log.w(PlayerPool.TAG, "knesset: the page's renderer stopped (crash: ${detail.didCrash()})")
                    if (view === webView) {
                        destroy()
                        generation++
                    }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                        Log.w(PlayerPool.TAG, "knesset page: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                    }
                    return true
                }
            }
            loadUrl("$ORIGIN/assets/knesset/index.html?theme=${Uri.encode(theme)}")
        }
    }

    /** Runs on one of the WebView's network threads, so it may wait for the answer. */
    private fun fetch(request: WebResourceRequest): WebResourceResponse {
        val target = request.url.getQueryParameter("u").orEmpty()
        if (request.method != "GET" || !KnessetFetch.isAllowed(target)) return reply(403, "")
        return try {
            val response = http.fetchText(target)
            reply(KnessetFetch.pageStatus(response.status), response.text)
        } catch (e: IOException) {
            Log.w(PlayerPool.TAG, "knesset: ${hostName(target)} didn't answer: ${e.message}")
            reply(502, "", mapOf(ERROR_HEADER to "network"))
        }
    }

    private fun reply(status: Int, text: String, headers: Map<String, String> = emptyMap()): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "utf-8",
            status,
            if (status in 200..299) "OK" else "Error",
            headers + ("Cache-Control" to "no-store"),
            ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)),
        )

    /** For WebViews without message listeners; the page only ever posts JSON text. */
    private inner class Bridge {
        @JavascriptInterface
        fun postMessage(data: String?) {
            main.post { handle(data) }
        }
    }

    private companion object {
        const val HOST = WebViewAssetLoader.DEFAULT_DOMAIN
        const val ORIGIN = "https://$HOST"
        const val FETCH_PATH = "/__fetch"
        const val BRIDGE = "NewsCenterHost"
        const val ERROR_HEADER = "X-NC-Error"
        const val TEXT_ZOOM = 110f
        const val MAX_LOG_CHARS = 300
        const val MAX_MESSAGE_CHARS = 200
    }
}
