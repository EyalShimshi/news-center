package io.github.eyalshimshi.newscenter.data

import io.github.eyalshimshi.newscenter.model.Headline
import io.github.eyalshimshi.newscenter.model.NewsSource
import io.github.eyalshimshi.newscenter.model.StoredHeadline

/** The rules for news sources and headlines, ported from the desktop app. Unit-tested. */
object NewsCatalog {

    /** Headlines older than this are dropped. */
    const val MAX_AGE_MS = 48L * 60 * 60 * 1000

    /** Headlines this new are marked as new. */
    const val FRESH_MS = 10L * 60 * 1000

    const val PER_SOURCE = 60
    const val SHOWN = 250

    private val COLOR = Regex("^#[0-9a-fA-F]{6}$")

    fun normalize(source: NewsSource): NewsSource? {
        val name = cleanText(source.name, 60)
        val url = cleanText(source.url, 2048)
        if (name.isEmpty() || !isHttpUrl(url) || isBlockedAddress(url)) return null
        return source.copy(
            id = cleanText(source.id, 120).ifEmpty { makeId("news") },
            name = name,
            url = url,
            lang = if (source.lang == "he" || source.lang == "en") source.lang else "",
            color = if (COLOR.matches(source.color)) source.color else "",
        )
    }

    fun builtins(catalog: List<NewsSource>): List<NewsSource> =
        catalog.mapNotNull(::normalize).map { it.copy(builtin = true, edited = false) }

    /**
     * Unedited built-in sources follow the shipped list, new ones appear unless the user removed
     * them, and each source stays switched on or off as the user left it.
     */
    fun mergeSources(saved: List<NewsSource>, removed: Collection<String>, builtins: List<NewsSource>): List<NewsSource> {
        val builtinIds = builtins.map { it.id }.toSet()
        val byId = LinkedHashMap<String, NewsSource>()
        for (source in saved) byId.putIfAbsent(source.id, source)
        val merged = ArrayList<NewsSource>()
        for (builtin in builtins) {
            val source = byId[builtin.id]
            if (source == null) {
                if (builtin.id !in removed) merged.add(builtin)
                continue
            }
            merged.add(
                if (source.edited) {
                    source.copy(builtin = true, lang = builtin.lang, color = builtin.color)
                } else {
                    source.copy(builtin = true, lang = builtin.lang, color = builtin.color, name = builtin.name, url = builtin.url)
                },
            )
        }
        for (source in byId.values) {
            if (source.id in builtinIds || (source.builtin && !source.edited)) continue
            merged.add(source.copy(builtin = false))
        }
        return merged
    }

    /**
     * Headlines that roll off a busy feed stay for a while, so they aren't lost between refreshes.
     * Feeds that date stories ahead of the clock count them as just published.
     */
    fun mergeHeadlines(previous: List<StoredHeadline>, items: List<Headline>, now: Long): List<StoredHeadline> {
        val known = previous.associateBy { it.key }
        val merged = LinkedHashMap<String, StoredHeadline>()
        for (item in items) {
            if (merged.containsKey(item.key)) continue
            val before = known[item.key]
            val time = item.time?.coerceAtMost(now) ?: before?.time ?: now
            merged[item.key] = StoredHeadline(item.key, item.title, item.link, time, item.summary, before?.seenAt ?: now)
        }
        for (item in previous) {
            if (!merged.containsKey(item.key) && now - item.time < MAX_AGE_MS) merged[item.key] = item
        }
        return merged.values.sortedByDescending { it.time }.take(PER_SOURCE)
    }

    /** A headline with the source it came from. */
    data class Entry(val headline: StoredHeadline, val source: NewsSource)

    /**
     * The newest headlines of the switched-on sources (or of [filter] alone), newest first. A story
     * in two feeds of the same outlet shows once.
     */
    fun headlines(
        sources: List<NewsSource>,
        itemsBySource: Map<String, List<StoredHeadline>>,
        filter: String?,
        now: Long,
    ): List<Entry> {
        val enabled = sources.filter { it.enabled }
        val only = filter?.takeIf { id -> enabled.any { it.id == id } }
        val cutoff = now - MAX_AGE_MS
        val list = ArrayList<Entry>()
        for (source in enabled) {
            if (only != null && source.id != only) continue
            for (item in itemsBySource[source.id].orEmpty()) {
                if (item.time >= cutoff) list.add(Entry(item, source))
            }
        }
        list.sortByDescending { it.headline.time }
        val seen = HashSet<String>()
        return list.filter { seen.add(it.headline.link.ifEmpty { it.headline.title }) }.take(SHOWN)
    }
}
