package io.github.eyalshimshi.newscenter.playback

/**
 * Mute and solo, like a mixing desk, with the desktop app's rules: every channel starts muted;
 * mute wins over solo; while any shown channel is soloed, only soloed channels are heard; and
 * soloing a channel also unmutes it. No Android code: unit-tested.
 */
data class MixState(
    val unmuted: Set<String> = emptySet(),
    val soloed: Set<String> = emptySet(),
) {
    fun isMuted(id: String): Boolean = id !in unmuted

    fun isSoloed(id: String): Boolean = id in soloed

    fun isAudible(id: String, shown: Collection<String>): Boolean {
        if (id !in unmuted) return false
        val soloActive = shown.any { it in soloed }
        return !soloActive || id in soloed
    }

    fun audible(shown: Collection<String>): Set<String> = shown.filter { isAudible(it, shown) }.toSet()

    fun toggleMute(id: String): MixState =
        if (id in unmuted) copy(unmuted = unmuted - id) else copy(unmuted = unmuted + id)

    /** Adds the channel to the soloed set (or takes it out). [exclusive] keeps only this one soloed. */
    fun toggleSolo(id: String, exclusive: Boolean = false): MixState {
        if (exclusive) {
            val onlyThis = id in soloed && soloed.size == 1
            return if (onlyThis) copy(soloed = emptySet()) else copy(soloed = setOf(id), unmuted = unmuted + id)
        }
        return if (id in soloed) copy(soloed = soloed - id) else copy(soloed = soloed + id, unmuted = unmuted + id)
    }

    /** Spotlight + solo: this channel is the only one heard, and every other channel is muted. */
    fun focus(id: String): MixState = MixState(unmuted = setOf(id), soloed = setOf(id))

    /** Whether [id] is the only channel heard because of [focus] (or the same choice made by hand). */
    fun isFocused(id: String, shown: Collection<String>): Boolean =
        id in unmuted && id in soloed && shown.none { it != id && it in soloed }

    fun clearSolo(): MixState = copy(soloed = emptySet())

    /** Unmutes every channel when any shown channel is muted; otherwise mutes them all. */
    fun toggleMuteAll(shown: Collection<String>, all: Collection<String>): MixState {
        val anyMuted = shown.any { it !in unmuted }
        return if (anyMuted) copy(unmuted = unmuted + all) else copy(unmuted = emptySet())
    }

    companion object {
        /** Perceived loudness follows the square of the slider, as in the desktop app. */
        fun loudness(volume: Float): Float = volume * volume
    }
}
