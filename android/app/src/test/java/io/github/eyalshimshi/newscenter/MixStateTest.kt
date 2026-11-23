package io.github.eyalshimshi.newscenter

import io.github.eyalshimshi.newscenter.playback.MixState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mute and solo, with the desktop app's rules. */
class MixStateTest {

    private val shown = listOf("kan11", "ch12", "ch13", "knesset")

    @Test
    fun everythingStartsMuted() {
        val mix = MixState()
        assertTrue(shown.all { mix.isMuted(it) })
        assertTrue(mix.audible(shown).isEmpty())
    }

    @Test
    fun soloingSeveralChannelsPlaysExactlyThose() {
        val mix = MixState().toggleSolo("kan11").toggleSolo("knesset")
        assertEquals(setOf("kan11", "knesset"), mix.audible(shown))
        // Unmuting another channel doesn't make it heard while others are soloed.
        assertEquals(setOf("kan11", "knesset"), mix.toggleMute("ch13").audible(shown))
        // Clearing the solos lets every unmuted channel be heard.
        assertEquals(setOf("kan11", "knesset", "ch13"), mix.toggleMute("ch13").clearSolo().audible(shown))
    }

    @Test
    fun muteWinsOverSolo() {
        val mix = MixState().toggleSolo("kan11").toggleMute("kan11")
        assertTrue(mix.isSoloed("kan11"))
        assertFalse(mix.isAudible("kan11", shown))
    }

    @Test
    fun soloOnlyCountsChannelsOnScreen() {
        val mix = MixState().toggleMute("kan11").toggleSolo("offair")
        // The soloed channel went off air: the rest are heard again.
        assertEquals(setOf("kan11"), mix.audible(shown))
    }

    @Test
    fun focusHearsOnlyThatChannel() {
        val mix = MixState().toggleMute("kan11").toggleMute("ch13").toggleSolo("ch13").focus("knesset")
        assertEquals(setOf("knesset"), mix.audible(shown))
        assertTrue(mix.isFocused("knesset", shown))
        assertTrue(listOf("kan11", "ch12", "ch13").all { mix.isMuted(it) })
        assertFalse(mix.toggleSolo("kan11").isFocused("knesset", shown))
    }

    @Test
    fun exclusiveSoloAndMuteAll() {
        val mix = MixState().toggleSolo("kan11").toggleSolo("ch12").toggleSolo("ch13", exclusive = true)
        assertEquals(setOf("ch13"), mix.soloed)
        assertTrue(mix.toggleSolo("ch13", exclusive = true).soloed.isEmpty())

        val allOn = MixState().toggleMuteAll(shown, shown)
        assertTrue(shown.none { allOn.isMuted(it) })
        val allOff = allOn.toggleMuteAll(shown, shown)
        assertTrue(shown.all { allOff.isMuted(it) })
    }

    @Test
    fun loudnessFollowsTheSquareOfTheSlider() {
        assertEquals(1f, MixState.loudness(1f), 0f)
        assertEquals(4f, MixState.loudness(2f), 0f)
        assertEquals(0.25f, MixState.loudness(0.5f), 0f)
    }
}
