package io.github.eyalshimshi.newscenter.playback

import android.content.Context
import android.util.Log
import android.view.TextureView
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.model.TileStatus
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

/** One channel's player, shared by every view that shows the channel. Main thread only. */
@OptIn(UnstableApi::class)
class TilePlayer internal constructor(
    val channelId: String,
    val url: String,
    val player: ExoPlayer,
    val meter: LevelMeterProcessor,
) {
    internal val mutableStatus = MutableStateFlow(TileStatus.CONNECTING)
    val status: StateFlow<TileStatus> = mutableStatus.asStateFlow()

    internal val mutableAspect = MutableStateFlow(DEFAULT_ASPECT)

    /** The picture's width / height, for letterboxing. */
    val aspect: StateFlow<Float> = mutableAspect.asStateFlow()

    internal var users = 0
    internal var failures = 0
    internal var everPlayed = false
    internal var limited: Boolean? = null
    internal var videoOff = false
    internal var releaseJob: Job? = null
    internal var retryJob: Job? = null
    internal var watchdogJob: Job? = null

    private val surfaces = ArrayList<TextureView>()

    /** Shows the picture in [view]; the newest view wins while two show the same channel. */
    fun attachSurface(view: TextureView) {
        surfaces.remove(view)
        surfaces.add(view)
        player.setVideoTextureView(view)
    }

    fun detachSurface(view: TextureView) {
        val wasCurrent = surfaces.lastOrNull() === view
        surfaces.remove(view)
        if (!wasCurrent) return
        val next = surfaces.lastOrNull()
        if (next != null) player.setVideoTextureView(next) else player.clearVideoTextureView(view)
    }

    companion object {
        const val DEFAULT_ASPECT = 16f / 9f
    }
}

/**
 * Plays every channel that's on screen (and every channel you can hear) with its own ExoPlayer.
 * Players start muted; [applyMix] sets each one's volume. Main thread only.
 */
@OptIn(UnstableApi::class)
class PlayerPool(
    private val context: Context,
    httpClient: OkHttpClient,
    userAgent: String,
    private val scope: CoroutineScope,
    /** Called when a channel keeps failing, so the app can check whether it went off air. */
    private val onTrouble: (channelId: String) -> Unit,
) {
    private val players = LinkedHashMap<String, TilePlayer>()
    private val dataSourceFactory = DefaultDataSource.Factory(
        context,
        OkHttpDataSource.Factory(httpClient).setUserAgent(userAgent),
    )
    private var volumes: Map<String, Float> = emptyMap()
    private var fullQuality: Set<String> = emptySet()
    private var dataSaver = true
    private var active = true

    fun acquire(channel: Channel): TilePlayer {
        val existing = players[channel.id]
        if (existing != null && existing.url == channel.url) {
            existing.users++
            existing.releaseJob?.cancel()
            existing.releaseJob = null
            setVideoOff(existing, false)
            return existing
        }
        if (existing != null) releaseNow(existing)
        val tile = create(channel)
        tile.users = 1
        players[channel.id] = tile
        return tile
    }

    fun release(tile: TilePlayer) {
        if (players[tile.channelId] !== tile) return
        tile.users = (tile.users - 1).coerceAtLeast(0)
        if (tile.users == 0) scheduleRelease(tile)
    }

    /** Linear gain per channel: 0 is silent, 1 is 100%, up to 4 for 200%. Missing channels are silent. */
    fun applyMix(gains: Map<String, Float>) {
        volumes = gains
        for (tile in players.values.toList()) {
            applyGain(tile)
            if (tile.users == 0 && tile.releaseJob == null) scheduleRelease(tile)
        }
    }

    /** Grid tiles play at most 480p while [dataSaver] is on; [ids] always play at full quality. */
    fun setQuality(ids: Set<String>, dataSaver: Boolean) {
        fullQuality = ids
        this.dataSaver = dataSaver
        players.values.forEach(::applyQuality)
    }

    /** Stops everything while the app is out of sight, and picks up at the live edge on return. */
    fun setActive(value: Boolean) {
        if (active == value) return
        active = value
        for (tile in players.values) {
            cancelJobs(tile)
            if (value) {
                tile.player.seekToDefaultPosition()
                tile.player.prepare()
                tile.player.playWhenReady = true
            } else {
                tile.player.stop()
            }
        }
    }

    /** Reloads every channel, as the global refresh does. */
    fun restartAll() {
        players.values.forEach(::restartTile)
    }

    fun restart(channelId: String) {
        players[channelId]?.let(::restartTile)
    }

    fun releaseAll() {
        players.values.toList().forEach(::releaseNow)
    }

    private fun restartTile(tile: TilePlayer) {
        cancelJobs(tile)
        tile.failures = 0
        tile.player.stop()
        tile.player.seekToDefaultPosition()
        if (active) tile.player.prepare()
        refreshStatus(tile)
    }

    private fun create(channel: Channel): TilePlayer {
        val meter = LevelMeterProcessor()
        val renderers = MeteringRenderersFactory(context, meter).setEnableDecoderFallback(true)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(MIN_BUFFER_MS, MAX_BUFFER_MS, START_BUFFER_MS, REBUFFER_MS)
            .build()
        val player = ExoPlayer.Builder(context, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .setLoadControl(loadControl)
            // Every channel plays at once, so the app requests audio focus itself (see AudioFocus).
            .setAudioAttributes(MOVIE_AUDIO, false)
            .build()
        val tile = TilePlayer(channel.id, channel.url, player, meter)
        player.addListener(TileListener(tile))
        val item = MediaItem.Builder()
            .setMediaId(channel.id)
            .setUri(channel.url)
            .setMimeType(if (channel.url.lowercase(Locale.ROOT).contains("m3u8")) MimeTypes.APPLICATION_M3U8 else null)
            .build()
        player.setMediaItem(item)
        applyGain(tile)
        applyQuality(tile)
        player.playWhenReady = true
        if (active) player.prepare()
        return tile
    }

    private fun applyGain(tile: TilePlayer) {
        val gain = volumes[tile.channelId] ?: 0f
        tile.player.volume = gain.coerceIn(0f, 1f)
        tile.meter.gain = gain.coerceAtLeast(1f)
    }

    private fun applyQuality(tile: TilePlayer) {
        val limited = dataSaver && tile.channelId !in fullQuality
        if (tile.limited == limited) return
        tile.limited = limited
        val builder = tile.player.trackSelectionParameters.buildUpon()
        if (limited) builder.setMaxVideoSize(GRID_MAX_WIDTH, GRID_MAX_HEIGHT) else builder.clearVideoSizeConstraints()
        tile.player.trackSelectionParameters = builder.build()
    }

    /** A channel you can hear but don't see plays its sound only. */
    private fun setVideoOff(tile: TilePlayer, off: Boolean) {
        if (tile.videoOff == off) return
        tile.videoOff = off
        tile.player.trackSelectionParameters = tile.player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, off)
            .build()
    }

    private fun scheduleRelease(tile: TilePlayer) {
        tile.releaseJob?.cancel()
        tile.releaseJob = scope.launch {
            delay(RELEASE_GRACE_MS)
            tile.releaseJob = null
            if (tile.users > 0) return@launch
            // Channels you can hear keep playing while you look at another tab.
            if ((volumes[tile.channelId] ?: 0f) > 0f) setVideoOff(tile, true) else releaseNow(tile)
        }
    }

    private fun releaseNow(tile: TilePlayer) {
        cancelJobs(tile)
        tile.releaseJob?.cancel()
        tile.releaseJob = null
        if (players[tile.channelId] === tile) players.remove(tile.channelId)
        tile.player.release()
    }

    private fun cancelJobs(tile: TilePlayer) {
        tile.retryJob?.cancel()
        tile.retryJob = null
        tile.watchdogJob?.cancel()
        tile.watchdogJob = null
    }

    private fun refreshStatus(tile: TilePlayer) {
        val player = tile.player
        tile.mutableStatus.value = when {
            player.playerError != null || tile.retryJob != null -> TileStatus.RECONNECTING
            player.playbackState == Player.STATE_READY -> TileStatus.LIVE
            player.playbackState == Player.STATE_BUFFERING && tile.everPlayed -> TileStatus.BUFFERING
            else -> TileStatus.CONNECTING
        }
    }

    private fun scheduleRetry(tile: TilePlayer) {
        tile.watchdogJob?.cancel()
        tile.watchdogJob = null
        tile.retryJob?.cancel()
        val wait = RETRY_DELAYS_MS[(tile.failures - 1).coerceIn(0, RETRY_DELAYS_MS.lastIndex)]
        tile.retryJob = scope.launch {
            delay(wait)
            tile.retryJob = null
            if (!active || players[tile.channelId] !== tile) return@launch
            tile.player.seekToDefaultPosition()
            tile.player.prepare()
            refreshStatus(tile)
        }
        refreshStatus(tile)
        if (tile.failures >= TROUBLE_AFTER_FAILURES) onTrouble(tile.channelId)
    }

    /** Restarts a channel that stays stuck connecting or buffering. */
    private fun watch(tile: TilePlayer) {
        if (tile.watchdogJob != null) return
        val limit = if (tile.everPlayed) STALL_LIMIT_MS else CONNECT_LIMIT_MS
        tile.watchdogJob = scope.launch {
            delay(limit)
            tile.watchdogJob = null
            if (!active || players[tile.channelId] !== tile || tile.player.playbackState == Player.STATE_READY) return@launch
            Log.i(TAG, "stalled ${tile.channelId}")
            tile.failures++
            tile.player.stop()
            scheduleRetry(tile)
        }
    }

    private inner class TileListener(private val tile: TilePlayer) : Player.Listener {

        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_BUFFERING -> watch(tile)
                Player.STATE_READY -> {
                    tile.watchdogJob?.cancel()
                    tile.watchdogJob = null
                }
                Player.STATE_ENDED -> {
                    // A live stream that ends has gone off air or dropped; try again shortly.
                    tile.failures++
                    scheduleRetry(tile)
                }
                else -> Unit
            }
            refreshStatus(tile)
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) {
                if (!tile.everPlayed) Log.i(TAG, "playing ${tile.channelId}")
                tile.everPlayed = true
                tile.failures = 0
            }
            refreshStatus(tile)
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.w(TAG, "error ${tile.channelId}: ${error.errorCodeName}")
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                tile.player.seekToDefaultPosition()
                tile.player.prepare()
                return
            }
            tile.failures++
            scheduleRetry(tile)
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width > 0 && videoSize.height > 0) {
                tile.mutableAspect.value = videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height
            }
        }

        override fun onRenderedFirstFrame() {
            Log.i(TAG, "first frame ${tile.channelId}")
        }
    }

    /** Puts the channel's [LevelMeterProcessor] into its audio path. */
    private class MeteringRenderersFactory(
        context: Context,
        private val meter: LevelMeterProcessor,
    ) : DefaultRenderersFactory(context) {
        override fun buildAudioSink(
            context: Context,
            enableFloatOutput: Boolean,
            enableAudioOutputPlaybackParams: Boolean,
        ): AudioSink? = DefaultAudioSink.Builder(context)
            .setAudioProcessors(arrayOf<AudioProcessor>(meter))
            .setEnableFloatOutput(enableFloatOutput)
            .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
            .build()
    }

    companion object {
        const val TAG = "NewsCenter"

        private val MOVIE_AUDIO: AudioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
            .build()

        private const val MIN_BUFFER_MS = 6_000
        private const val MAX_BUFFER_MS = 15_000
        private const val START_BUFFER_MS = 1_500
        private const val REBUFFER_MS = 3_000
        private const val GRID_MAX_WIDTH = 854
        private const val GRID_MAX_HEIGHT = 480

        /** A channel that leaves the screen keeps its player this long, in case it comes right back. */
        private const val RELEASE_GRACE_MS = 5_000L
        private const val CONNECT_LIMIT_MS = 45_000L
        private const val STALL_LIMIT_MS = 20_000L
        private const val TROUBLE_AFTER_FAILURES = 2
        private val RETRY_DELAYS_MS = longArrayOf(3_000, 6_000, 12_000, 20_000, 30_000)
    }
}
