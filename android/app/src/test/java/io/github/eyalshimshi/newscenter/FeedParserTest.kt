package io.github.eyalshimshi.newscenter

import io.github.eyalshimshi.newscenter.data.FeedParser
import io.github.eyalshimshi.newscenter.data.Http
import java.nio.charset.Charset
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reading news feeds the way the desktop app's News panel does. */
class FeedParserTest {

    private val israel = ZoneId.of("Asia/Jerusalem")

    @Test
    fun rssWithHtmlInItsFields() {
        val rss = """
            <?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
              <channel>
                <title>ynet - מבזקים</title>
                <item>
                  <title><![CDATA[<b>Breaking:</b> rockets &amp; sirens]]></title>
                  <link>https://www.ynet.co.il/news/article/abc</link>
                  <pubDate>Tue, 18 Nov 2026 14:05:00 +0200</pubDate>
                  <guid>abc</guid>
                  <description><![CDATA[<p>Details</p>]]></description>
                </item>
                <item>
                  <title>Relative link</title>
                  <link>/news/2</link>
                  <dc:date>2026-11-18T12:00:00Z</dc:date>
                </item>
                <item><title>   </title></item>
              </channel>
            </rss>
        """.trimIndent()
        val feed = FeedParser.parse(rss, "https://www.ynet.co.il/Integration/StoryRss1854.xml")
        assertNotNull(feed)
        assertEquals("ynet - מבזקים", feed!!.title)
        assertEquals(2, feed.items.size)
        val first = feed.items[0]
        assertEquals("Breaking: rockets & sirens", first.title)
        assertEquals("abc", first.key)
        assertEquals("Details", first.summary)
        assertEquals(ZonedDateTime.of(2026, 11, 18, 14, 5, 0, 0, israel).toInstant().toEpochMilli(), first.time)
        assertEquals("https://www.ynet.co.il/news/2", feed.items[1].link)
        assertEquals("https://www.ynet.co.il/news/2", feed.items[1].key)
    }

    @Test
    fun atomAndRdfFeeds() {
        val atom = """
            <feed xmlns="http://www.w3.org/2005/Atom">
              <title>Example</title>
              <entry>
                <title>Atom story</title>
                <link rel="enclosure" href="https://example.com/image.jpg"/>
                <link href="https://example.com/story"/>
                <id>tag:example.com,2026:1</id>
                <updated>2026-11-18T10:00:00+02:00</updated>
              </entry>
            </feed>
        """.trimIndent()
        val atomFeed = FeedParser.parse(atom, "https://example.com/feed")!!
        assertEquals("https://example.com/story", atomFeed.items.single().link)
        assertEquals(ZonedDateTime.of(2026, 11, 18, 10, 0, 0, 0, israel).toInstant().toEpochMilli(), atomFeed.items.single().time)

        val rdf = """
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
              <channel><title>DW</title></channel>
              <item><title>RDF story</title><link>https://dw.com/a</link></item>
            </rdf:RDF>
        """.trimIndent()
        assertEquals("RDF story", FeedParser.parse(rdf, "https://rss.dw.com/rdf/rss-en-all")!!.items.single().title)
    }

    @Test
    fun brokenXmlStillGivesHeadlines() {
        val broken = "<rss><channel><title>Broken & co</title><item><title>One & two</title><link>https://example.com/1?a=1&b=2</link></item>" +
            "<item><title>Second</title><link>https://example.com/2</link></item></channel>"
        val feed = FeedParser.parse(broken, "https://example.com/rss")
        assertNotNull(feed)
        assertEquals(listOf("One & two", "Second"), feed!!.items.map { it.title })
    }

    @Test
    fun webPagesAreNotFeeds() {
        assertNull(FeedParser.parse("<!DOCTYPE html><html><head><title>Home</title></head><body><p>Hi</p></body></html>", "https://example.com/"))
        assertTrue(FeedParser.isHtmlPage("<!DOCTYPE html><html lang=\"he\">"))
    }

    @Test
    fun israeliTimeZoneNamesAndOtherDateFormats() {
        val expected = ZonedDateTime.of(2026, 11, 18, 9, 30, 0, 0, israel).toInstant().toEpochMilli()
        assertEquals(expected, FeedParser.parseDate("Wed, 18 Nov 2026 09:30:00 IST", israel))
        assertEquals(expected - 3_600_000L, FeedParser.parseDate("Wed, 18 Nov 2026 09:30:00 IDT", israel))
        assertEquals(expected, FeedParser.parseDate("Wed, 18 Nov 2026 07:30:00 GMT", israel))
        // A wrong weekday doesn't lose the date.
        assertEquals(expected, FeedParser.parseDate("Mon, 18 Nov 2026 09:30:00 +0200", israel))
        assertEquals(expected, FeedParser.parseDate("2026-11-18 09:30:00", israel))
        assertEquals(expected, FeedParser.parseDate("18/11/2026 09:30", israel))
        assertNull(FeedParser.parseDate("", israel))
        assertNull(FeedParser.parseDate("someday", israel))
    }

    @Test
    fun charsetFromTheServerOrTheDocument() {
        val hebrew = "<?xml version=\"1.0\" encoding=\"windows-1255\"?><rss><channel><title>ערוץ 7</title></channel></rss>"
        val bytes = hebrew.toByteArray(Charset.forName("windows-1255"))
        assertTrue(Http.decodeBody(bytes, "text/xml").contains("ערוץ 7"))
        assertTrue(Http.decodeBody(bytes, "application/rss+xml; charset=windows-1255").contains("ערוץ 7"))
        assertEquals("שלום", Http.decodeBody("\uFEFFשלום".toByteArray(Charsets.UTF_8), null))
    }

    @Test
    fun webFilterIsolationPagesAreRecognized() {
        assertTrue(FeedParser.isIsolationPage("<html><script src=\"https://abc.prod.fire.glass/loader.js\"></script></html>"))
        assertFalse(FeedParser.isIsolationPage("<html><p>We use fire.glass for security</p></html>"))
    }

    @Test
    fun homePagesNameTheirFeed() {
        val html = """
            <html><head>
              <link rel="stylesheet" href="/style.css">
              <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed/">
            </head><body></body></html>
        """.trimIndent()
        assertEquals("https://news.example.com/feed/", FeedParser.findFeedLink(html, "https://news.example.com/"))
        assertNull(FeedParser.findFeedLink("<html><head></head></html>", "https://example.com/"))
    }
}
