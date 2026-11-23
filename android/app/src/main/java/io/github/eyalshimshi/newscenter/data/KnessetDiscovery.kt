package io.github.eyalshimshi.newscenter.data

import io.github.eyalshimshi.newscenter.data.ChannelCatalog.DiscoveredStream
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.jsoup.Jsoup
import org.jsoup.nodes.Element

/**
 * Finds the Knesset's live streams on knesset.tv/live: the Knesset Channel, plus every committee
 * and special broadcast it lists. Uses the same page structure as the desktop app.
 */
class KnessetDiscovery(private val http: Http) {

    data class Result(val found: List<DiscoveredStream>, val complete: Boolean)

    suspend fun discover(): Result = withContext(Dispatchers.IO) {
        val page = http.fetchText(LIVE_URL)
        if (!page.ok) throw IOException("knesset.tv answered HTTP ${page.status}")
        val live = parseLivePage(page.text, page.url)
        // A committee page that fails to load leaves the listing incomplete; then nothing is unlisted.
        val complete = AtomicBoolean(true)
        val broadcasts = coroutineScope {
            live.entries.map { entry ->
                async {
                    try {
                        val response = http.fetchText(entry.pageUrl)
                        if (!response.ok) {
                            complete.set(false)
                            null
                        } else {
                            parseBroadcastPage(response.text, response.url, entry.title)
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        complete.set(false)
                        null
                    }
                }
            }.awaitAll()
        }
        val found = ArrayList<DiscoveredStream>()
        live.main?.let(found::add)
        for (item in broadcasts) {
            if (item != null && found.none { it.url == item.url }) found.add(item)
        }
        Result(found, complete.get())
    }

    /** A broadcast listed on the live page, with the page that plays it. */
    data class Entry(val pageUrl: String, val title: String)

    data class LivePage(val main: DiscoveredStream?, val entries: List<Entry>)

    companion object {
        const val LIVE_URL = "https://www.knesset.tv/live/"
        const val MAIN_NAME = "ערוץ הכנסת"

        private val HIDDEN_STYLE = Regex("""display\s*:\s*none""", RegexOption.IGNORE_CASE)

        // Entries that knesset.tv hides on its live page are left out.
        private fun isHidden(element: Element): Boolean =
            element.hasAttr("hidden") || HIDDEN_STYLE.containsMatchIn(element.attr("style"))

        fun parseLivePage(html: String, baseUrl: String): LivePage {
            val doc = Jsoup.parse(html, baseUrl)
            val mainFrame = doc.selectFirst(".main-live-video-container iframe[src]")
            val main = mainFrame?.let { ChannelCatalog.knessetPlayerStream(it.attr("src"), baseUrl) }?.let { stream ->
                val program = cleanText(doc.selectFirst(".main-video-desc")?.text(), 300)
                    .ifEmpty { cleanText(doc.selectFirst(".main-video-title")?.text(), 300) }
                DiscoveredStream(stream.id, stream.url, stream.poster, MAIN_NAME, "Knesset Channel", program)
            }
            val entries = doc.select(".secondary-video-container")
                .filterNot(::isHidden)
                .mapNotNull { entry ->
                    val link = entry.selectFirst("a[href]") ?: return@mapNotNull null
                    val pageUrl = resolveUrl(baseUrl, link.attr("href"))?.takeIf(::isHttpUrl) ?: return@mapNotNull null
                    Entry(pageUrl, cleanText(entry.selectFirst(".secondary-video-title")?.text(), 80))
                }
            return LivePage(main, entries)
        }

        fun parseBroadcastPage(html: String, pageUrl: String, listedTitle: String): DiscoveredStream? {
            val doc = Jsoup.parse(html, pageUrl)
            val frame = doc.selectFirst(".video-page-player iframe[src], iframe.video-iframe[src]") ?: return null
            val stream = ChannelCatalog.knessetPlayerStream(frame.attr("src"), pageUrl) ?: return null
            val name = listedTitle.ifEmpty { cleanText(doc.selectFirst(".heading-block h1")?.text(), 80) }
            val now = cleanText(doc.selectFirst(".heading-block h6")?.text(), 300)
            return DiscoveredStream(
                id = stream.id,
                url = stream.url,
                poster = stream.poster,
                name = name.ifEmpty { "Knesset broadcast" },
                description = "Knesset · live broadcast",
                now = now,
            )
        }
    }
}
