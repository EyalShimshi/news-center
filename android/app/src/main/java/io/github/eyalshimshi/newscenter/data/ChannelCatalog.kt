package io.github.eyalshimshi.newscenter.data

import io.github.eyalshimshi.newscenter.model.Channel
import java.net.URI
import java.util.Locale

/**
 * The rules for the channel list, ported from the desktop app (app/app.js) so both apps treat
 * built-in channels, user edits and Knesset streams the same way. No Android code: unit-tested.
 */
object ChannelCatalog {

    /** Knesset streams that knesset.tv stopped listing are forgotten after a month. */
    const val FORGET_AFTER_MS = 30L * 24 * 60 * 60 * 1000

    /** A channel cleaned up for use, or null when it has no name or no valid address. */
    fun normalize(channel: Channel): Channel? {
        val name = cleanText(channel.name, 80)
        val url = cleanText(channel.url, 2048)
        if (name.isEmpty() || !isHttpUrl(url) || isBlockedAddress(url)) return null
        return channel.copy(
            id = cleanText(channel.id, 240).ifEmpty { makeId("ch") },
            name = name,
            description = cleanText(channel.description, 160),
            kind = if (channel.kind == Channel.KIND_PAGE) Channel.KIND_PAGE else Channel.KIND_STREAM,
            url = url,
            poster = if (isHttpUrl(channel.poster)) channel.poster.trim() else "",
            auto = if (channel.auto == Channel.AUTO_KNESSET) Channel.AUTO_KNESSET else "",
            now = cleanText(channel.now, 300),
        )
    }

    /** The shipped channel list, marked as built-in. */
    fun builtins(catalog: List<Channel>): List<Channel> =
        catalog.mapNotNull(::normalize).map { it.copy(builtin = true, edited = false) }

    private fun sameDefinition(a: Channel, b: Channel): Boolean =
        a.name == b.name && a.description == b.description && a.kind == b.kind && a.url == b.url && a.poster == b.poster

    /**
     * Keeps the saved channels in sync with the built-in list: unedited built-ins pick up changes,
     * and new built-ins appear unless the user removed them. A new built-in goes right after the
     * built-in listed before it, so it joins its neighbours instead of trailing the Knesset streams.
     */
    fun mergeBuiltins(saved: List<Channel>, removed: Collection<String>, builtins: List<Channel>): List<Channel> {
        val builtinsById = builtins.associateBy { it.id }
        val seen = HashSet<String>()
        val merged = ArrayList<Channel>()
        for (original in saved) {
            if (original.id in seen) continue
            var channel = original
            val builtin = builtinsById[channel.id]
            if (builtin != null) {
                if (!channel.builtin) channel = channel.copy(builtin = true, edited = !sameDefinition(channel, builtin))
                if (!channel.edited) {
                    channel = channel.copy(
                        name = builtin.name,
                        description = builtin.description,
                        kind = builtin.kind,
                        url = builtin.url,
                        poster = builtin.poster,
                        auto = builtin.auto,
                    )
                }
            } else if (channel.builtin) {
                // A built-in that was dropped from the list goes too, unless the user changed it.
                if (!channel.edited) continue
                channel = channel.copy(builtin = false)
            }
            seen.add(channel.id)
            merged.add(channel)
        }
        var previous = -1
        for (builtin in builtins) {
            val index = merged.indexOfFirst { it.id == builtin.id }
            if (index >= 0) {
                previous = index
            } else if (builtin.id !in removed) {
                previous += 1
                merged.add(previous, builtin)
            }
        }
        return merged
    }

    /** A stream address taken from what the user pasted. */
    data class ParsedStream(val url: String, val poster: String, val extracted: Boolean)

    private val IFRAME_SRC = Regex("""<iframe[^>]*?\ssrc\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
    private val ENCODED_AMPERSAND = Regex("&amp;", RegexOption.IGNORE_CASE)

    /**
     * Accepts a stream address, an <iframe> embed code, or a player link that carries the stream in
     * its "src" parameter (like watch.knesset.tv).
     */
    fun parseStreamInput(input: String): ParsedStream? {
        var value = input.trim()
        if (value.isEmpty()) return null
        var fromEmbed = false
        IFRAME_SRC.find(value)?.let { match ->
            value = match.groupValues[1]
            fromEmbed = true
        }
        value = value.replace(ENCODED_AMPERSAND, "&").trim()
        if (!isHttpUrl(value)) return null
        val inner = queryParam(value, "src")?.trim()
        if (inner != null && isHttpUrl(inner)) {
            val poster = queryParam(value, "poster")?.trim()
            return ParsedStream(inner, if (poster != null && isHttpUrl(poster)) poster else "", extracted = true)
        }
        return ParsedStream(value, "", fromEmbed)
    }

    /** A Knesset stream found in a watch.knesset.tv player link. */
    data class PlayerStream(val id: String, val url: String, val poster: String)

    /**
     * knesset.tv embeds its player as watch.knesset.tv?src=<stream>&poster=<image>. The stream's id
     * is its server and folder, so a stream keeps its id when only the playlist name changes.
     */
    fun knessetPlayerStream(src: String, base: String): PlayerStream? {
        val player = resolveUrl(base, src.replace(ENCODED_AMPERSAND, "&")) ?: return null
        val stream = queryParam(player, "src")?.trim() ?: return null
        if (!isHttpUrl(stream)) return null
        val uri = runCatching { URI(stream) }.getOrNull() ?: return null
        val path = uri.rawPath.orEmpty()
        if (!path.lowercase(Locale.ROOT).endsWith(".m3u8")) return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        val hostAndPort = if (uri.port >= 0) "$host:${uri.port}" else host
        val poster = queryParam(player, "poster")?.trim()
        return PlayerStream(
            id = "knesset:$hostAndPort${path.substringBeforeLast('/')}",
            url = stream,
            poster = if (poster != null && isHttpUrl(poster)) poster else "",
        )
    }

    /** A live stream listed on knesset.tv. */
    data class DiscoveredStream(
        val id: String,
        val url: String,
        val poster: String,
        val name: String,
        val description: String,
        val now: String,
    )

    data class DiscoveryMerge(val channels: List<Channel>, val addedIds: List<String>)

    /**
     * Adds newly listed Knesset streams after the last Knesset channel, updates the ones the user
     * hasn't edited, and marks the rest as not listed. When the listing was [complete], streams that
     * haven't been listed for a month (and that the user didn't keep) are forgotten.
     */
    fun applyDiscovery(
        channels: List<Channel>,
        removed: Collection<String>,
        found: List<DiscoveredStream>,
        complete: Boolean,
        now: Long,
    ): DiscoveryMerge {
        val list = channels.toMutableList()
        val foundIds = HashSet<String>()
        val added = ArrayList<String>()
        for (item in found) {
            foundIds.add(item.id)
            val index = list.indexOfFirst { it.id == item.id }
            var channel: Channel
            if (index < 0) {
                if (item.id in removed) continue
                channel = normalize(
                    Channel(
                        id = item.id,
                        name = item.name,
                        description = item.description,
                        url = item.url,
                        poster = item.poster,
                        auto = Channel.AUTO_KNESSET,
                    ),
                ) ?: continue
                val lastKnesset = list.indexOfLast { it.isKnesset }
                list.add(if (lastKnesset >= 0) lastKnesset + 1 else list.size, channel)
                added.add(channel.id)
            } else {
                channel = list[index]
                if (!channel.edited) {
                    if (channel.url != item.url) channel = channel.copy(url = item.url)
                    if (!channel.builtin) {
                        channel = channel.copy(
                            name = item.name,
                            description = item.description,
                            poster = item.poster.ifEmpty { channel.poster },
                        )
                    }
                }
            }
            val at = list.indexOfFirst { it.id == channel.id }
            list[at] = channel.copy(auto = Channel.AUTO_KNESSET, listed = true, lastSeen = now, now = item.now)
        }
        if (complete) {
            val iterator = list.listIterator()
            while (iterator.hasNext()) {
                val channel = iterator.next()
                if (!channel.isKnesset || channel.id in foundIds) continue
                if (!channel.builtin && !channel.edited && now - channel.lastSeen > FORGET_AFTER_MS) {
                    iterator.remove()
                } else if (channel.listed) {
                    iterator.set(channel.copy(listed = false))
                }
            }
        }
        return DiscoveryMerge(list, added)
    }
}
