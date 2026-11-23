package io.github.eyalshimshi.newscenter.data

import io.github.eyalshimshi.newscenter.model.Availability
import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Whether a stream is on air: its playlist (or its first variant) lists video segments. The same
 * test as the desktop app, so a channel is "off air" in both apps at the same time.
 */
object StreamCheck {

    data class Result(val availability: Availability, val detail: String, val maxHeight: Int? = null)

    private val SEGMENT = Regex("#EXTINF", RegexOption.IGNORE_CASE)
    private val RESOLUTION = Regex("""RESOLUTION=\d+x(\d+)""")

    suspend fun check(http: Http, url: String): Result = withContext(Dispatchers.IO) {
        try {
            val response = http.fetchText(url, maxBytes = PLAYLIST_BYTES, timeoutMs = TIMEOUT_MS)
            if (!response.ok) return@withContext httpOutcome(response.status)
            val text = response.text
            when (val first = evaluatePlaylist(text)) {
                is Playlist.Media -> Result(Availability.LIVE, "", maxHeight(text))
                is Playlist.Invalid -> Result(Availability.OFFLINE, first.reason)
                is Playlist.Master -> {
                    val variantUrl = resolveUrl(response.url, first.variant)
                        ?: return@withContext Result(Availability.OFFLINE, "Empty playlist")
                    val variant = http.fetchText(variantUrl, maxBytes = PLAYLIST_BYTES, timeoutMs = TIMEOUT_MS)
                    if (!variant.ok) return@withContext httpOutcome(variant.status)
                    if (SEGMENT.containsMatchIn(variant.text)) {
                        Result(Availability.LIVE, "", maxHeight(text))
                    } else {
                        Result(Availability.OFFLINE, "Not broadcasting")
                    }
                }
            }
        } catch (e: SocketTimeoutException) {
            Result(Availability.ERROR, "No answer")
        } catch (e: IOException) {
            Result(Availability.ERROR, "Unreachable")
        }
    }

    /** What a playlist's text says, before any variant is fetched. */
    sealed interface Playlist {
        data object Media : Playlist
        data class Master(val variant: String) : Playlist
        data class Invalid(val reason: String) : Playlist
    }

    fun evaluatePlaylist(text: String): Playlist {
        if (!text.trimStart().startsWith("#EXTM3U")) return Playlist.Invalid("Not an HLS playlist")
        if (SEGMENT.containsMatchIn(text)) return Playlist.Media
        val variant = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() && !it.startsWith("#") }
            ?: return Playlist.Invalid("Empty playlist")
        return Playlist.Master(variant)
    }

    /** The tallest picture a master playlist offers (1080 for 1920x1080), or null if it doesn't say. */
    fun maxHeight(text: String): Int? = RESOLUTION.findAll(text).mapNotNull { it.groupValues[1].toIntOrNull() }.maxOrNull()

    private fun httpOutcome(status: Int) = Result(
        availability = if (status in 400..499) Availability.OFFLINE else Availability.ERROR,
        detail = "HTTP $status",
    )

    private const val PLAYLIST_BYTES = 1024 * 1024
    private const val TIMEOUT_MS = 12_000
}
