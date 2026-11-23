package io.github.eyalshimshi.newscenter.model

import kotlinx.serialization.Serializable

/** An RSS or Atom feed shown in the News tab. */
@Serializable
data class NewsSource(
    val id: String,
    val name: String,
    val url: String,
    /** "he" or "en" for built-in sources, which decides where the source is listed. */
    val lang: String = "",
    /** The source's color, as #RRGGBB. */
    val color: String = "",
    val enabled: Boolean = false,
    val builtin: Boolean = false,
    val edited: Boolean = false,
)

/** The built-in news sources shipped in assets/news.json. */
@Serializable
data class NewsCatalogFile(
    val catalogVersion: Long = 0,
    val sources: List<NewsSource> = emptyList(),
)

/** One headline from a feed. [time] is in epoch milliseconds, or null when the feed has no date. */
data class Headline(
    val key: String,
    val title: String,
    val link: String,
    val time: Long?,
    val summary: String,
)

/** A parsed feed. */
data class Feed(val title: String, val items: List<Headline>)

/** A headline as kept by the app: with its time settled and when it was first seen. */
data class StoredHeadline(
    val key: String,
    val title: String,
    val link: String,
    val time: Long,
    val summary: String,
    val seenAt: Long,
)
