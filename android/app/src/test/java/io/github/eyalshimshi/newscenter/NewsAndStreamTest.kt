package io.github.eyalshimshi.newscenter

import io.github.eyalshimshi.newscenter.data.BLOCKED_DOMAINS
import io.github.eyalshimshi.newscenter.data.Http
import io.github.eyalshimshi.newscenter.data.NewsCatalog
import io.github.eyalshimshi.newscenter.data.StreamCheck
import io.github.eyalshimshi.newscenter.data.isBlockedAddress
import io.github.eyalshimshi.newscenter.model.Headline
import io.github.eyalshimshi.newscenter.model.NewsSource
import io.github.eyalshimshi.newscenter.model.StoredHeadline
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** News source merging, headline bookkeeping and the on-air test for playlists. */
class NewsAndStreamTest {

    private fun source(id: String, enabled: Boolean = false, url: String = "https://example.com/$id.xml") =
        NewsSource(id = id, name = id.uppercase(), url = url, lang = "he", color = "#112233", enabled = enabled)

    @Test
    fun sourcesKeepTheUsersChoicesAndFollowTheList() {
        val builtins = NewsCatalog.builtins(listOf(source("a", enabled = true), source("b"), source("c")))
        val saved = listOf(
            builtins[0].copy(enabled = false, url = "https://old.example/a.xml"),
            NewsSource(id = "mine", name = "Mine", url = "https://mine.example/rss", enabled = true),
        )
        val merged = NewsCatalog.mergeSources(saved, removed = setOf("c"), builtins = builtins)
        assertEquals(listOf("a", "b", "mine"), merged.map { it.id })
        assertEquals("unedited sources follow the list", "https://example.com/a.xml", merged[0].url)
        assertEquals("switched off stays off", false, merged[0].enabled)
        assertTrue(merged[2].enabled && !merged[2].builtin)
    }

    private fun headline(key: String, time: Long?) = Headline(key, "Title $key", "https://example.com/$key", time, "")

    @Test
    fun blockedSitesAreNeverUsed() {
        val domain = BLOCKED_DOMAINS.first()
        assertTrue(isBlockedAddress("https://www.$domain/feed"))
        assertTrue(isBlockedAddress("http://${domain.uppercase()}./x"))
        assertEquals(false, isBlockedAddress("https://not$domain/feed"))
        assertNull("a saved blocked source is dropped", NewsCatalog.normalize(source("x", url = "https://www.$domain/feed")))
        val error = runCatching { Http { "test" }.fetchText("https://www.$domain/feed") }.exceptionOrNull()
        assertTrue("blocked before any connection", error is IOException && error.message!!.contains("blocked"))
    }

    @Test
    fun headlinesStayForAWhileAfterLeavingTheFeed() {
        val now = 10L * 60 * 60 * 1000
        val first = NewsCatalog.mergeHeadlines(emptyList(), listOf(headline("1", now - 1000), headline("2", now + 60_000)), now)
        assertEquals("future dates count as now", now, first.first { it.key == "2" }.time)
        val later = now + 60_000
        val second = NewsCatalog.mergeHeadlines(first, listOf(headline("3", later)), later)
        assertEquals(listOf("3", "2", "1"), second.map { it.key })
        assertEquals("first seen time is kept", now, second.first { it.key == "1" }.seenAt)
        val muchLater = later + NewsCatalog.MAX_AGE_MS + 1
        assertEquals(listOf("4"), NewsCatalog.mergeHeadlines(second, listOf(headline("4", muchLater)), muchLater).map { it.key })
    }

    @Test
    fun headlinesComeFromSwitchedOnSourcesNewestFirstWithoutDuplicates() {
        val now = 100_000_000L
        fun stored(key: String, time: Long, link: String = "https://example.com/$key") = StoredHeadline(key, key, link, time, "", time)
        val sources = listOf(source("a", enabled = true), source("b", enabled = true), source("off"))
        val items = mapOf(
            "a" to listOf(stored("a1", now - 10), stored("dup", now - 30, "https://example.com/same")),
            "b" to listOf(stored("b1", now - 20), stored("dup2", now - 40, "https://example.com/same")),
            "off" to listOf(stored("off1", now)),
        )
        val all = NewsCatalog.headlines(sources, items, filter = null, now = now)
        assertEquals(listOf("a1", "b1", "dup"), all.map { it.headline.key })
        assertEquals(listOf("b1", "dup2"), NewsCatalog.headlines(sources, items, filter = "b", now = now).map { it.headline.key })
        // A filter on a source that's switched off shows everything.
        assertEquals(3, NewsCatalog.headlines(sources, items, filter = "off", now = now).size)
    }

    @Test
    fun playlistsTellWhetherAStreamIsOnAir() {
        val media = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n"
        assertEquals(StreamCheck.Playlist.Media, StreamCheck.evaluatePlaylist(media))
        val master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/index.m3u8\n" +
            "#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080\nhigh/index.m3u8\n"
        assertEquals(StreamCheck.Playlist.Master("low/index.m3u8"), StreamCheck.evaluatePlaylist(master))
        assertEquals(1080, StreamCheck.maxHeight(master))
        assertTrue(StreamCheck.evaluatePlaylist("<html>Not found</html>") is StreamCheck.Playlist.Invalid)
        assertTrue(StreamCheck.evaluatePlaylist("#EXTM3U\n#EXT-X-VERSION:3\n") is StreamCheck.Playlist.Invalid)
        assertNull(StreamCheck.maxHeight(media))
    }
}
