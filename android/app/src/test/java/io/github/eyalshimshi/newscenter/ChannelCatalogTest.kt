package io.github.eyalshimshi.newscenter

import io.github.eyalshimshi.newscenter.data.ChannelCatalog
import io.github.eyalshimshi.newscenter.data.ChannelCatalog.DiscoveredStream
import io.github.eyalshimshi.newscenter.model.Channel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The channel-list rules shared with the desktop app. */
class ChannelCatalogTest {

    private fun stream(id: String, name: String = id, url: String = "https://example.com/$id/live.m3u8") =
        Channel(id = id, name = name, url = url)

    private val builtins = ChannelCatalog.builtins(listOf(stream("a"), stream("b"), stream("c")))

    @Test
    fun firstStartUsesTheBuiltInList() {
        val merged = ChannelCatalog.mergeBuiltins(emptyList(), emptySet(), builtins)
        assertEquals(listOf("a", "b", "c"), merged.map { it.id })
    }

    @Test
    fun newBuiltInJoinsItsNeighbourAndUserOrderStays() {
        val saved = listOf(builtins[2], builtins[0], stream("mine").copy(name = "Mine"))
        val merged = ChannelCatalog.mergeBuiltins(saved, emptySet(), builtins)
        // "b" comes right after "a", the built-in listed before it, even though the user moved "c" first.
        assertEquals(listOf("c", "a", "b", "mine"), merged.map { it.id })
    }

    @Test
    fun removedBuiltInsStayRemoved() {
        val merged = ChannelCatalog.mergeBuiltins(listOf(builtins[0], builtins[2]), setOf("b"), builtins)
        assertEquals(listOf("a", "c"), merged.map { it.id })
    }

    @Test
    fun uneditedBuiltInsFollowTheListAndEditedOnesKeepTheirChanges() {
        val newList = ChannelCatalog.builtins(
            listOf(stream("a", url = "https://example.com/a/new.m3u8"), stream("b", url = "https://example.com/b/new.m3u8"), stream("c")),
        )
        val saved = listOf(
            builtins[0].copy(enabled = false),
            builtins[1].copy(url = "https://mine.example/b.m3u8", edited = true),
            builtins[2],
        )
        val merged = ChannelCatalog.mergeBuiltins(saved, emptySet(), newList).associateBy { it.id }
        assertEquals("https://example.com/a/new.m3u8", merged.getValue("a").url)
        assertFalse("switched off stays off", merged.getValue("a").enabled)
        assertEquals("https://mine.example/b.m3u8", merged.getValue("b").url)
    }

    @Test
    fun builtInDroppedFromTheListGoesUnlessEdited() {
        val newList = ChannelCatalog.builtins(listOf(stream("a")))
        val saved = listOf(builtins[0], builtins[1], builtins[2].copy(edited = true))
        val merged = ChannelCatalog.mergeBuiltins(saved, emptySet(), newList)
        assertEquals(listOf("a", "c"), merged.map { it.id })
        assertFalse(merged.last().builtin)
    }

    @Test
    fun theKnessetEmbedCodeGivesTheStreamAndPoster() {
        // The embed code from knesset.tv that started this project.
        val embed = """<iframe width="560" height="315" src="https://watch.knesset.tv/?src=https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8&poster=https://www.knesset.tv/media/28897/photo_2024-12-24_18-43-17.jpg&mute=true" frameborder="0"></iframe>"""
        val parsed = ChannelCatalog.parseStreamInput(embed)
        assertNotNull(parsed)
        assertEquals("https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8", parsed!!.url)
        assertEquals("https://www.knesset.tv/media/28897/photo_2024-12-24_18-43-17.jpg", parsed.poster)
        assertTrue(parsed.extracted)
    }

    @Test
    fun plainAddressesAndBadInput() {
        assertEquals("https://example.com/live.m3u8", ChannelCatalog.parseStreamInput("  https://example.com/live.m3u8 ")?.url)
        assertFalse(ChannelCatalog.parseStreamInput("https://example.com/live.m3u8")!!.extracted)
        assertNull(ChannelCatalog.parseStreamInput("not a link"))
        assertNull(ChannelCatalog.parseStreamInput("ftp://example.com/a.m3u8"))
        assertNull(ChannelCatalog.parseStreamInput(""))
    }

    @Test
    fun knessetStreamIdsMatchTheDesktopApp() {
        val stream = ChannelCatalog.knessetPlayerStream(
            "//watch.knesset.tv/?src=https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8&amp;poster=https://www.knesset.tv/a.jpg",
            "https://www.knesset.tv/live/",
        )
        assertNotNull(stream)
        assertEquals("knesset:kneset.gostreaming.tv/p2-kneset/_definst_/myStream", stream!!.id)
        assertEquals("https://www.knesset.tv/a.jpg", stream.poster)
        assertNull("only HLS streams", ChannelCatalog.knessetPlayerStream("https://watch.knesset.tv/?src=https://x.example/a.mp4", "https://www.knesset.tv/"))
    }

    private val knessetMain = Channel(
        id = "knesset:kneset.gostreaming.tv/p2-kneset/_definst_/myStream",
        name = "ערוץ הכנסת",
        url = "https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8",
        auto = Channel.AUTO_KNESSET,
        builtin = true,
    )

    private fun found(id: String, url: String = "https://kneset.gostreaming.tv/$id/playlist.m3u8", name: String = id) =
        DiscoveredStream("knesset:kneset.gostreaming.tv/$id", url, "", name, "Knesset · live broadcast", "")

    @Test
    fun newKnessetStreamsGoAfterTheLastKnessetChannel() {
        val channels = listOf(stream("kan11"), knessetMain, stream("ch14"))
        val result = ChannelCatalog.applyDiscovery(channels, emptySet(), listOf(found("committee1")), complete = true, now = 1_000L)
        assertEquals(listOf("kan11", knessetMain.id, "knesset:kneset.gostreaming.tv/committee1", "ch14"), result.channels.map { it.id })
        assertEquals(listOf("knesset:kneset.gostreaming.tv/committee1"), result.addedIds)
        val added = result.channels[2]
        assertTrue(added.isKnesset && added.listed)
        assertEquals(1_000L, added.lastSeen)
        // The main channel wasn't listed this time, but it's built in: it stays, marked as not listed.
        assertFalse(result.channels[1].listed)
    }

    @Test
    fun streamsThatStopBeingListedAreForgottenAfterAMonth() {
        val old = found("old").let { Channel(id = it.id, name = "Old", url = it.url, auto = Channel.AUTO_KNESSET, lastSeen = 0L) }
        val recent = old.copy(id = "knesset:kneset.gostreaming.tv/recent", lastSeen = ChannelCatalog.FORGET_AFTER_MS)
        val now = ChannelCatalog.FORGET_AFTER_MS + 1
        val result = ChannelCatalog.applyDiscovery(listOf(knessetMain, old, recent), emptySet(), emptyList(), complete = true, now = now)
        assertEquals(listOf(knessetMain.id, recent.id), result.channels.map { it.id })
        assertFalse(result.channels[1].listed)
        // An incomplete listing (a committee page failed to load) unlists and forgets nothing.
        val partial = ChannelCatalog.applyDiscovery(listOf(knessetMain, old), emptySet(), emptyList(), complete = false, now = now)
        assertEquals(2, partial.channels.size)
        assertTrue(partial.channels.all { it.listed })
    }

    @Test
    fun discoveryRespectsRemovalsAndEdits() {
        val removed = ChannelCatalog.applyDiscovery(listOf(knessetMain), setOf(found("gone").id), listOf(found("gone")), true, 5L)
        assertEquals(listOf(knessetMain.id), removed.channels.map { it.id })

        val moved = found("main", url = "https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/other.m3u8")
            .copy(id = knessetMain.id, name = "Renamed")
        val updated = ChannelCatalog.applyDiscovery(listOf(knessetMain), emptySet(), listOf(moved), true, 5L).channels.single()
        assertEquals(moved.url, updated.url)
        assertEquals("built-in names stay", "ערוץ הכנסת", updated.name)

        val edited = knessetMain.copy(url = "https://mine.example/k.m3u8", edited = true)
        val kept = ChannelCatalog.applyDiscovery(listOf(edited), emptySet(), listOf(moved), true, 5L).channels.single()
        assertEquals("https://mine.example/k.m3u8", kept.url)
    }

    @Test
    fun normalizeRejectsIncompleteChannels() {
        assertNull(ChannelCatalog.normalize(Channel(id = "x", name = " ", url = "https://example.com/a.m3u8")))
        assertNull(ChannelCatalog.normalize(Channel(id = "x", name = "X", url = "example.com/a.m3u8")))
        val clean = ChannelCatalog.normalize(Channel(id = "x", name = "  Spaced   name ", url = "https://example.com/a.m3u8", kind = "other"))
        assertEquals("Spaced name", clean!!.name)
        assertEquals(Channel.KIND_STREAM, clean.kind)
    }
}
