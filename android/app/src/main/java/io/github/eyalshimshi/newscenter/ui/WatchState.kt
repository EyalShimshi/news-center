package io.github.eyalshimshi.newscenter.ui

import io.github.eyalshimshi.newscenter.model.Availability
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.playback.MixState

/** Whether a stream is on air, for the address it had when it was checked. */
data class AvailabilityInfo(
    val url: String,
    val availability: Availability,
    val detail: String,
    val checkedAt: Long,
)

fun availabilityOf(channel: Channel, map: Map<String, AvailabilityInfo>): Availability {
    if (channel.isPage) return Availability.LIVE
    return map[channel.id]?.takeIf { it.url == channel.url }?.availability ?: Availability.CHECKING
}

/** Off-air streams stay off the Watch screen and come back by themselves when they go live. */
fun isShown(channel: Channel, map: Map<String, AvailabilityInfo>): Boolean {
    if (!channel.wantsScreen) return false
    val availability = availabilityOf(channel, map)
    return availability == Availability.LIVE || availability == Availability.ERROR
}

/** What the channel list says about a channel. */
enum class ChannelStatus { HIDDEN, UNLISTED, CHECKING, LIVE, OFF_AIR, UNREACHABLE, WEB }

fun channelStatus(channel: Channel, map: Map<String, AvailabilityInfo>): ChannelStatus = when {
    !channel.enabled -> ChannelStatus.HIDDEN
    channel.isKnesset && !channel.listed -> ChannelStatus.UNLISTED
    channel.isPage -> ChannelStatus.WEB
    else -> when (availabilityOf(channel, map)) {
        Availability.CHECKING -> ChannelStatus.CHECKING
        Availability.LIVE -> ChannelStatus.LIVE
        Availability.OFFLINE -> ChannelStatus.OFF_AIR
        Availability.ERROR -> ChannelStatus.UNREACHABLE
    }
}

/** Everything the Watch screen shows. */
data class WatchState(
    /** On screen, in the user's order (a previewed link first). */
    val shown: List<Channel> = emptyList(),
    val spotlight: Channel? = null,
    val fullscreen: Channel? = null,
    val mix: MixState = MixState(),
    val audible: Set<String> = emptySet(),
    /** Channels still being checked while nothing is on screen yet. */
    val checking: Boolean = true,
    /** Switched-on channels, on air or not. */
    val wanted: Int = 0,
    val offAir: Int = 0,
) {
    val shownIds: List<String> get() = shown.map { it.id }

    fun isFocused(id: String): Boolean = spotlight?.id == id && mix.isFocused(id, shownIds)
}

/** One-off messages for the snackbar. */
sealed interface UiEvent {
    data class NewKnesset(val names: List<String>) : UiEvent

    data class WentLive(val name: String) : UiEvent

    data class Refreshed(val onScreen: Int, val offAir: Int, val added: Int) : UiEvent

    data class DiscoveryFailed(val detail: String) : UiEvent

    data class ChannelRemoved(val removed: RemovedChannel) : UiEvent

    data class SourceRemoved(val removed: NewsController.RemovedSource) : UiEvent

    /** A short message, such as the Knesset screen's. */
    data class Message(val text: String) : UiEvent

    data object ChannelsReset : UiEvent

    data object SourcesReset : UiEvent

    /** Sound was turned off: headphones unplugged, a call, or another app started playing. */
    data object SoundStopped : UiEvent
}

data class RemovedChannel(val channel: Channel, val index: Int, val remembered: Boolean)

/** A Knesset stream as the Knesset screen sees it; live means it's on the Watch screen. */
data class KnessetStream(
    val id: String,
    val name: String,
    val url: String,
    val now: String,
    /** The Knesset Channel itself, which shows the plenum. */
    val main: Boolean,
    val live: Boolean,
)

/** A Knesset recording playing over everything. */
data class Recording(val url: String, val title: String)

/** What the channel editor saves. */
data class ChannelDraft(
    val name: String,
    val description: String,
    val kind: String,
    val url: String,
    val poster: String,
)
