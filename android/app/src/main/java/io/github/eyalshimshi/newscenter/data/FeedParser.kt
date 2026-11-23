package io.github.eyalshimshi.newscenter.data

import io.github.eyalshimshi.newscenter.model.Feed
import io.github.eyalshimshi.newscenter.model.Headline
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import org.jsoup.Jsoup
import org.jsoup.nodes.Element
import org.jsoup.parser.Parser

/**
 * Reads RSS 2.0, RSS 1.0 (RDF) and Atom feeds. Broken XML gets a more forgiving reading, like in
 * the desktop app. No Android code: unit-tested.
 */
object FeedParser {

    private val FEED_ROOTS = setOf("rss", "rdf", "feed")
    private val LOOSE_BLOCK = Regex("""<(item|entry)\b[^>]*>([\s\S]*?)</\1>""", RegexOption.IGNORE_CASE)
    private val CDATA = Regex("""<!\[CDATA\[([\s\S]*?)]]>""")
    private val LOOSE_HREF = Regex("""<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
    private val LOOSE_TITLE = Regex("""<title\b[^>]*>([\s\S]*?)</title>""", RegexOption.IGNORE_CASE)
    private val ISOLATION_SCRIPT =
        Regex("""<script\b[^>]*\bsrc\s*=\s*["']https?://[^"'/]*\.fire\.glass/""", RegexOption.IGNORE_CASE)
    private val HTML_DOCUMENT = Regex("""<html[\s>]""", RegexOption.IGNORE_CASE)
    private val FEED_TYPE = Regex("rss|atom", RegexOption.IGNORE_CASE)

    fun parse(text: String, baseUrl: String): Feed? = parseXml(text, baseUrl) ?: parseLoosely(text, baseUrl)

    private fun localName(element: Element): String = element.tagName().substringAfter(':').lowercase(Locale.ROOT)

    private fun parseXml(text: String, baseUrl: String): Feed? {
        val doc = runCatching { Jsoup.parse(text, baseUrl, Parser.xmlParser()) }.getOrNull() ?: return null
        val root = doc.children().firstOrNull() ?: return null
        if (localName(root) !in FEED_ROOTS) return null
        val channel = root.children().firstOrNull { localName(it) == "channel" } ?: root
        val entries = doc.allElements.filter { localName(it) == "item" } + doc.allElements.filter { localName(it) == "entry" }
        val items = entries.mapNotNull { entry ->
            makeHeadline(
                title = childText(entry, "title"),
                link = entryLink(entry),
                date = childText(entry, "pubdate", "date", "published", "updated", "issued", "modified"),
                summary = childText(entry, "description", "summary", "encoded", "content"),
                guid = childText(entry, "guid", "id"),
                baseUrl = baseUrl,
            )
        }
        // Something jsoup could read as a feed root but that has no entries may still be broken XML.
        if (items.isEmpty() && LOOSE_BLOCK.containsMatchIn(text)) return null
        return Feed(plainText(childText(channel, "title"), 80), items)
    }

    private fun childText(element: Element, vararg names: String): String {
        for (name in names) {
            for (child in element.children()) {
                if (localName(child) != name) continue
                val text = child.text().trim()
                if (text.isNotEmpty()) return text
            }
        }
        return ""
    }

    private fun entryLink(entry: Element): String {
        var other = ""
        for (child in entry.children()) {
            if (localName(child) != "link") continue
            val href = child.attr("href")
            if (href.isEmpty()) {
                val text = child.text().trim()
                if (text.isNotEmpty()) return text
            } else if (child.attr("rel").ifEmpty { "alternate" } == "alternate") {
                return href
            } else if (other.isEmpty()) {
                other = href
            }
        }
        val guid = childText(entry, "origlink", "guid", "id")
        return other.ifEmpty { if (isHttpUrl(guid)) guid else "" }
    }

    private fun parseLoosely(text: String, baseUrl: String): Feed? {
        val blocks = LOOSE_BLOCK.findAll(text).map { it.groupValues[2] }.toList()
        if (blocks.isEmpty()) return null
        val items = blocks.mapNotNull { block ->
            makeHeadline(
                title = looseField(block, "title"),
                link = (looseField(block, "link").ifEmpty { LOOSE_HREF.find(block)?.groupValues?.get(1).orEmpty() }
                    .ifEmpty { looseField(block, "guid") }).replace("&amp;", "&"),
                date = looseField(block, "pubDate", "dc:date", "published", "updated"),
                summary = looseField(block, "description", "summary", "content:encoded", "content"),
                guid = looseField(block, "guid", "id"),
                baseUrl = baseUrl,
            )
        }
        if (items.isEmpty()) return null
        val title = LOOSE_TITLE.find(text)?.groupValues?.get(1)?.let(::unwrapCdata).orEmpty()
        return Feed(plainText(title, 80), items)
    }

    private fun unwrapCdata(value: String): String = CDATA.replace(value) { it.groupValues[1] }.trim()

    private fun looseField(block: String, vararg names: String): String {
        for (name in names) {
            val pattern = Regex("<${Regex.escape(name)}\\b[^>]*>([\\s\\S]*?)</${Regex.escape(name)}>", RegexOption.IGNORE_CASE)
            val value = pattern.find(block)?.groupValues?.get(1)?.let(::unwrapCdata).orEmpty()
            if (value.isNotEmpty()) return value
        }
        return ""
    }

    private fun makeHeadline(title: String, link: String, date: String, summary: String, guid: String, baseUrl: String): Headline? {
        val cleanTitle = plainText(title, 300)
        if (cleanTitle.isEmpty()) return null
        val absolute = if (link.isBlank()) null else resolveUrl(baseUrl, link)
        val cleanLink = if (absolute != null && isHttpUrl(absolute) && !isBlockedAddress(absolute)) absolute else ""
        return Headline(
            key = cleanText(guid, 500).ifEmpty { cleanLink }.ifEmpty { cleanTitle },
            title = cleanTitle,
            link = cleanLink,
            time = parseDate(date),
            summary = plainText(summary, 400),
        )
    }

    /** Feed text often carries HTML, sometimes escaped twice; only its text is shown. */
    fun plainText(value: String, maxLength: Int): String {
        var text = value
        var pass = 0
        while (pass < 2 && (text.contains('<') || text.contains('&'))) {
            text = Jsoup.parseBodyFragment(text).text()
            pass++
        }
        return cleanText(text, maxLength)
    }

    private val NAMED_ZONES = mapOf(
        // Israeli sites name their time zone IST or IDT, which date parsers don't know.
        "IST" to "+0200", "IDT" to "+0300",
        "UT" to "+0000", "UTC" to "+0000", "GMT" to "+0000", "Z" to "+0000",
        "EST" to "-0500", "EDT" to "-0400", "CST" to "-0600", "CDT" to "-0500",
        "MST" to "-0700", "MDT" to "-0600", "PST" to "-0800", "PDT" to "-0700",
    )
    private val TRAILING_ZONE = Regex("""\s([A-Z]{1,4})$""")
    private val WEEKDAY = Regex("""^[A-Za-z]{3,9},\s*""")
    private val RFC_822 = DateTimeFormatter.ofPattern("d MMM yyyy H:mm[:ss] Z", Locale.ENGLISH)
    private val DAY_FIRST = Regex("""^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?""")
    private val ISO_WITH_SPACE = Regex("""^\d{4}-\d{2}-\d{2} \d""")

    /** Epoch milliseconds, or null for an empty or unreadable date. */
    fun parseDate(value: String, zone: ZoneId = ZoneId.systemDefault()): Long? {
        var text = value.trim().replace(Regex("\\s+"), " ")
        if (text.isEmpty()) return null
        TRAILING_ZONE.find(text)?.let { match ->
            NAMED_ZONES[match.groupValues[1]]?.let { offset -> text = text.substring(0, match.range.first) + " " + offset }
        }
        val withoutWeekday = text.replace(WEEKDAY, "")
        tryParse { ZonedDateTime.parse(withoutWeekday, RFC_822).toInstant().toEpochMilli() }?.let { return it }
        val iso = if (ISO_WITH_SPACE.containsMatchIn(text)) text.replaceFirst(' ', 'T') else text
        tryParse { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }?.let { return it }
        tryParse { LocalDateTime.parse(iso).atZone(zone).toInstant().toEpochMilli() }?.let { return it }
        tryParse { LocalDate.parse(iso).atStartOfDay(zone).toInstant().toEpochMilli() }?.let { return it }
        val match = DAY_FIRST.find(text) ?: return null
        val (day, month, year) = match.destructured
        return tryParse {
            LocalDateTime.of(
                year.toInt(),
                month.toInt(),
                day.toInt(),
                match.groupValues[4].toIntOrNull() ?: 0,
                match.groupValues[5].toIntOrNull() ?: 0,
                match.groupValues[6].toIntOrNull() ?: 0,
            ).atZone(zone).toInstant().toEpochMilli()
        }
    }

    private inline fun tryParse(block: () -> Long): Long? = try {
        block()
    } catch (e: DateTimeParseException) {
        null
    } catch (e: java.time.DateTimeException) {
        null
    }

    /**
     * Some corporate web filters (Symantec's Fire Glass) answer a site they isolate with a page that
     * loads the filter's own script instead of the site. Merely mentioning the filter doesn't count.
     */
    fun isIsolationPage(text: String): Boolean = ISOLATION_SCRIPT.containsMatchIn(text)

    fun isHtmlPage(text: String): Boolean = HTML_DOCUMENT.containsMatchIn(text)

    /** The feed a news site's home page names in a <link rel="alternate"> tag, as an absolute address. */
    fun findFeedLink(html: String, pageUrl: String): String? {
        val doc = Jsoup.parse(html, pageUrl)
        val link = doc.select("link[href]").firstOrNull { element ->
            element.attr("rel").split(' ').any { it.equals("alternate", ignoreCase = true) } &&
                FEED_TYPE.containsMatchIn(element.attr("type"))
        } ?: return null
        val url = resolveUrl(pageUrl, link.attr("href")) ?: return null
        return if (isHttpUrl(url)) url else null
    }
}
