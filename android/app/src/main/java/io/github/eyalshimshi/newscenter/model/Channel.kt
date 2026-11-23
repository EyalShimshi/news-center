package io.github.eyalshimshi.newscenter.model

import kotlinx.serialization.Serializable

/**
 * A TV channel: a live HLS stream, or a web page that plays the channel in its own player
 * (Channel 12). The same fields as the desktop app's channels, so the two stay easy to compare.
 */
@Serializable
data class Channel(
    val id: String,
    val name: String,
    val description: String = "",
    /** [KIND_STREAM] or [KIND_PAGE]. */
    val kind: String = KIND_STREAM,
    val url: String,
    val poster: String = "",
    /** Shown on the Watch screen; switched off channels stay in the channel list. */
    val enabled: Boolean = true,
    /** [AUTO_KNESSET] for the Knesset streams that News Center keeps in sync with knesset.tv. */
    val auto: String = "",
    val builtin: Boolean = false,
    /** Changed by the user, so updates of the built-in list no longer overwrite it. */
    val edited: Boolean = false,
    /** For Knesset streams: whether knesset.tv lists it right now. */
    val listed: Boolean = true,
    /** When knesset.tv last listed it (epoch milliseconds). */
    val lastSeen: Long = 0L,
    /** What's on now, when knesset.tv says. */
    val now: String = "",
    /** Shows the tile's level meter. */
    val meter: Boolean = true,
) {
    val isPage: Boolean get() = kind == KIND_PAGE
    val isStream: Boolean get() = kind != KIND_PAGE
    val isKnesset: Boolean get() = auto == AUTO_KNESSET

    /** Off air, hidden on knesset.tv, or switched off: such channels stay off the Watch screen. */
    val wantsScreen: Boolean get() = enabled && (!isKnesset || listed)

    companion object {
        const val KIND_STREAM = "stream"
        const val KIND_PAGE = "page"
        const val AUTO_KNESSET = "knesset"
    }
}

/** Whether a stream is on air, as found by checking its playlist. */
enum class Availability { CHECKING, LIVE, OFFLINE, ERROR }

/** What a playing tile shows. */
enum class TileStatus { CONNECTING, LIVE, BUFFERING, RECONNECTING }

/** The built-in channel list shipped in assets/channels.json. */
@Serializable
data class ChannelCatalogFile(
    val catalogVersion: Long = 0,
    val channels: List<Channel> = emptyList(),
)
