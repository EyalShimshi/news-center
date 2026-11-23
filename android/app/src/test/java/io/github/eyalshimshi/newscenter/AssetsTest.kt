package io.github.eyalshimshi.newscenter

import io.github.eyalshimshi.newscenter.data.ChannelCatalog
import io.github.eyalshimshi.newscenter.data.NewsCatalog
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.model.ChannelCatalogFile
import io.github.eyalshimshi.newscenter.model.NewsCatalogFile
import java.io.File
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Validates the channel and news lists bundled in the APK, so a typo fails CI. */
class AssetsTest {

    // Unit tests run with the module directory (app/) as the working directory.
    private val json = Json { ignoreUnknownKeys = true }
    private val channels = json.decodeFromString(ChannelCatalogFile.serializer(), File("src/main/assets/channels.json").readText())
    private val news = json.decodeFromString(NewsCatalogFile.serializer(), File("src/main/assets/news.json").readText())

    @Test
    fun everyBuiltInChannelIsValidAndUnique() {
        val builtins = ChannelCatalog.builtins(channels.channels)
        assertEquals("a channel was dropped as invalid", channels.channels.size, builtins.size)
        assertEquals("duplicate channel ids", builtins.size, builtins.map { it.id }.toSet().size)
        builtins.forEach { assertTrue("${it.id} must use HTTPS", it.url.startsWith("https://")) }
        assertTrue("expected the main channels", builtins.count { it.enabled } >= 8)
    }

    @Test
    fun theKnessetChannelHasTheIdDiscoveryGivesIt() {
        val knesset = channels.channels.single { it.auto == Channel.AUTO_KNESSET }
        val discovered = ChannelCatalog.knessetPlayerStream("https://watch.knesset.tv/?src=${knesset.url}", "https://www.knesset.tv/live/")
        assertEquals(knesset.id, discovered?.id)
    }

    @Test
    fun everyBuiltInNewsSourceIsValid() {
        val sources = NewsCatalog.builtins(news.sources)
        assertEquals("a source was dropped as invalid", news.sources.size, sources.size)
        assertEquals("duplicate source ids", sources.size, sources.map { it.id }.toSet().size)
        sources.forEach { source ->
            assertTrue("${source.id} must use HTTPS", source.url.startsWith("https://"))
            assertTrue("${source.id} needs a language", source.lang == "he" || source.lang == "en")
            assertTrue("${source.id} needs a color", source.color.isNotEmpty())
        }
        assertTrue("some sources start switched on", sources.any { it.enabled })
    }
}
