package io.github.eyalshimshi.newscenter

import io.github.eyalshimshi.newscenter.data.KnessetDiscovery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** Reading knesset.tv's live page and broadcast pages (the same structure the desktop app reads). */
class KnessetDiscoveryTest {

    private val livePage = """
        <!DOCTYPE html>
        <html lang="he"><body>
          <div class="main-live-video-container">
            <iframe src="https://watch.knesset.tv/?src=https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8&amp;poster=https://www.knesset.tv/media/28897/photo.jpg&amp;mute=true"></iframe>
            <div class="main-video-title">שידור חי</div>
            <div class="main-video-desc">  ישיבת מליאה
               מיוחדת </div>
          </div>
          <div class="secondary-video-container">
            <a href="/live/committee-finance/"><span class="secondary-video-title">ועדת הכספים</span></a>
          </div>
          <div class="secondary-video-container" style="display: none">
            <a href="/live/hidden/"><span class="secondary-video-title">Hidden</span></a>
          </div>
          <div class="secondary-video-container" hidden>
            <a href="/live/also-hidden/">Also hidden</a>
          </div>
          <div class="secondary-video-container"><span>No link</span></div>
        </body></html>
    """.trimIndent()

    @Test
    fun livePageGivesTheMainChannelAndTheListedBroadcasts() {
        val page = KnessetDiscovery.parseLivePage(livePage, KnessetDiscovery.LIVE_URL)
        val main = page.main
        assertNotNull(main)
        assertEquals("knesset:kneset.gostreaming.tv/p2-kneset/_definst_/myStream", main!!.id)
        assertEquals("https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8", main.url)
        assertEquals("https://www.knesset.tv/media/28897/photo.jpg", main.poster)
        assertEquals(KnessetDiscovery.MAIN_NAME, main.name)
        assertEquals("ישיבת מליאה מיוחדת", main.now)
        assertEquals(listOf("https://www.knesset.tv/live/committee-finance/"), page.entries.map { it.pageUrl })
        assertEquals("ועדת הכספים", page.entries.single().title)
    }

    @Test
    fun broadcastPageGivesItsStream() {
        val html = """
            <html><body>
              <div class="heading-block"><h1>ועדת הכספים</h1><h6>דיון בהצעת התקציב</h6></div>
              <div class="video-page-player">
                <iframe src="//watch.knesset.tv/?src=https://kneset.gostreaming.tv/p3-committee/_definst_/finance/playlist.m3u8"></iframe>
              </div>
            </body></html>
        """.trimIndent()
        val stream = KnessetDiscovery.parseBroadcastPage(html, "https://www.knesset.tv/live/committee-finance/", listedTitle = "")
        assertNotNull(stream)
        assertEquals("knesset:kneset.gostreaming.tv/p3-committee/_definst_/finance", stream!!.id)
        assertEquals("ועדת הכספים", stream.name)
        assertEquals("דיון בהצעת התקציב", stream.now)
        // The title on the live page wins over the page's own heading.
        assertEquals("Finance", KnessetDiscovery.parseBroadcastPage(html, "https://www.knesset.tv/x/", "Finance")!!.name)
    }

    @Test
    fun pagesWithoutAPlayerGiveNothing() {
        assertNull(KnessetDiscovery.parseBroadcastPage("<html><body><h1>Nothing</h1></body></html>", "https://www.knesset.tv/", ""))
        assertNull(KnessetDiscovery.parseLivePage("<html><body></body></html>", KnessetDiscovery.LIVE_URL).main)
    }
}
