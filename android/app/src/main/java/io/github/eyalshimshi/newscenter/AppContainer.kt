package io.github.eyalshimshi.newscenter

import android.content.Context
import android.webkit.WebSettings
import io.github.eyalshimshi.newscenter.data.ChannelCatalog
import io.github.eyalshimshi.newscenter.data.ChannelStore
import io.github.eyalshimshi.newscenter.data.FALLBACK_USER_AGENT
import io.github.eyalshimshi.newscenter.data.Http
import io.github.eyalshimshi.newscenter.data.NewsCatalog
import io.github.eyalshimshi.newscenter.data.NewsStore
import io.github.eyalshimshi.newscenter.data.SettingsRepository
import io.github.eyalshimshi.newscenter.data.newsCenterPreferences
import io.github.eyalshimshi.newscenter.model.ChannelCatalogFile
import io.github.eyalshimshi.newscenter.model.NewsCatalogFile
import java.util.concurrent.TimeUnit
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient

/** Manual dependency container for the app. */
class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val preferences = appContext.newsCenterPreferences()

    val settingsRepository = SettingsRepository(preferences)

    val channelStore = ChannelStore(
        preferences,
        json,
        ChannelCatalog.builtins(readAsset<ChannelCatalogFile>("channels.json").channels),
    )

    val newsStore = NewsStore(
        preferences,
        json,
        NewsCatalog.builtins(readAsset<NewsCatalogFile>("news.json").sources),
    )

    /**
     * The system browser's User-Agent: streams and sites treat News Center like the browser on the
     * same phone. Read on first use (it loads the WebView once).
     */
    val userAgent: String by lazy {
        runCatching { WebSettings.getDefaultUserAgent(appContext) }.getOrNull()?.takeIf { it.isNotBlank() }
            ?: FALLBACK_USER_AGENT
    }

    val http = Http { userAgent }

    /** One HTTP stack for every stream, so connections to the same servers are reused. */
    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectionPool(ConnectionPool(16, 5, TimeUnit.MINUTES))
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private inline fun <reified T> readAsset(name: String): T =
        appContext.assets.open(name).bufferedReader().use { json.decodeFromString<T>(it.readText()) }
}
