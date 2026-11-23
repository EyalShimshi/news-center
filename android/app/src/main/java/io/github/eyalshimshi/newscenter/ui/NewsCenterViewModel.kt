package io.github.eyalshimshi.newscenter.ui

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.eyalshimshi.newscenter.CrashReporter
import io.github.eyalshimshi.newscenter.NewsCenterApplication
import io.github.eyalshimshi.newscenter.data.AppSettings
import io.github.eyalshimshi.newscenter.data.ChannelCatalog
import io.github.eyalshimshi.newscenter.data.ChannelStore
import io.github.eyalshimshi.newscenter.data.KnessetDiscovery
import io.github.eyalshimshi.newscenter.data.StreamCheck
import io.github.eyalshimshi.newscenter.data.ThemeMode
import io.github.eyalshimshi.newscenter.data.TileSize
import io.github.eyalshimshi.newscenter.data.hostName
import io.github.eyalshimshi.newscenter.data.isBlockedAddress
import io.github.eyalshimshi.newscenter.data.isHttpUrl
import io.github.eyalshimshi.newscenter.data.makeId
import io.github.eyalshimshi.newscenter.model.Availability
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.playback.AudioFocus
import io.github.eyalshimshi.newscenter.playback.MixState
import io.github.eyalshimshi.newscenter.playback.PlayerPool
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch

class NewsCenterViewModel(application: Application) : AndroidViewModel(application) {

    private val container = (application as NewsCenterApplication).container
    private val channelStore = container.channelStore
    private val settingsRepository = container.settingsRepository
    private val http = container.http
    private val discovery = KnessetDiscovery(http)

    val settings: StateFlow<AppSettings?> = settingsRepository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val channels: StateFlow<ChannelStore.State> = channelStore.state

    private val _availability = MutableStateFlow<Map<String, AvailabilityInfo>>(emptyMap())
    val availability: StateFlow<Map<String, AvailabilityInfo>> = _availability.asStateFlow()

    /** A stream opened from a newscenter://play link: on screen until closed, never saved. */
    private val preview = MutableStateFlow<Channel?>(null)

    private val mix = MutableStateFlow(MixState())

    private data class Layout(val spotlightId: String? = null, val fullscreenId: String? = null)

    private val layout = MutableStateFlow(Layout())

    private val _recording = MutableStateFlow<Recording?>(null)

    /** A Knesset recording playing over everything; the channels are silent meanwhile. */
    val recording: StateFlow<Recording?> = _recording.asStateFlow()

    private val _masterVolume = MutableStateFlow(settingsRepository.masterVolume())
    val masterVolume: StateFlow<Float> = _masterVolume.asStateFlow()

    private val _discovering = MutableStateFlow(false)
    val discovering: StateFlow<Boolean> = _discovering.asStateFlow()

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<UiEvent> = _events.asSharedFlow()

    private val _crashReport = MutableStateFlow(CrashReporter.lastReport(application))
    val crashReport: StateFlow<String?> = _crashReport.asStateFlow()

    val news = NewsController(container.newsStore, http, viewModelScope)

    val pool = PlayerPool(application, container.httpClient, container.userAgent, viewModelScope, ::onTrouble)

    private val audioFocus = AudioFocus(application) {
        if (mix.value.unmuted.isNotEmpty()) {
            mix.value = MixState()
            _events.tryEmit(UiEvent.SoundStopped)
        }
    }

    val watch: StateFlow<WatchState> =
        combine(channelStore.state, _availability, preview, mix, layout) { state, availability, preview, mix, layout ->
            buildWatchState(state.channels, availability, preview, mix, layout)
        }.stateIn(viewModelScope, SharingStarted.Eagerly, WatchState())

    /** The Knesset's streams for the Knesset screen, the same list as the desktop app gives its view. */
    val knessetStreams: StateFlow<List<KnessetStream>> =
        combine(channelStore.state, _availability) { state, availability ->
            state.channels.filter { it.isKnesset && it.isStream }.map {
                KnessetStream(it.id, it.name, it.url, it.now, main = it.builtin, live = isShown(it, availability))
            }
        }.distinctUntilChanged().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    private var foreground = true
    private var started = false
    private var loops: Job? = null
    private var discoveryJob: Job? = null
    private var lastDiscovery = 0L
    private var lastAdded = 0
    private val checks = HashMap<String, Job>()

    // Unplugging headphones turns the sound off rather than moving it to the loudspeaker.
    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && watch.value.audible.isNotEmpty()) {
                mix.value = MixState()
                _events.tryEmit(UiEvent.SoundStopped)
            }
        }
    }

    init {
        ContextCompat.registerReceiver(
            application,
            noisyReceiver,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        viewModelScope.launch {
            combine(watch, _masterVolume, _recording) { state, volume, recording -> Triple(state.audible, volume, recording != null) }
                .distinctUntilChanged()
                .collect { (audible, volume, silenced) ->
                    val gain = if (silenced) 0f else MixState.loudness(volume)
                    pool.applyMix(audible.associateWith { gain })
                    audioFocus.update(foreground && gain > 0f && audible.isNotEmpty())
                }
        }
        viewModelScope.launch {
            combine(watch, settings) { state, settings ->
                Triple(state.spotlight?.id, state.fullscreen?.id, settings?.gridDataSaver ?: true)
            }.distinctUntilChanged().collect { (spotlight, fullscreen, dataSaver) ->
                pool.setQuality(setOfNotNull(spotlight, fullscreen), dataSaver)
            }
        }
        // Every start checks which channels are on air and looks for new Knesset streams.
        channelStore.channels.filter { it.wantsScreen }.forEach { checkChannel(it) }
        val firstDiscovery = runDiscovery(announce = false)
        viewModelScope.launch {
            firstDiscovery.join()
            started = true
        }
    }

    private fun buildWatchState(
        channels: List<Channel>,
        availability: Map<String, AvailabilityInfo>,
        preview: Channel?,
        mix: MixState,
        layout: Layout,
    ): WatchState {
        val shown = buildList {
            if (preview != null) add(preview)
            channels.filterTo(this) { isShown(it, availability) }
        }
        val ids = shown.map { it.id }
        val wanted = channels.filter { it.wantsScreen }
        return WatchState(
            shown = shown,
            spotlight = layout.spotlightId?.let { id -> shown.firstOrNull { it.id == id } },
            fullscreen = layout.fullscreenId?.let { id -> shown.firstOrNull { it.id == id } },
            mix = mix,
            audible = mix.audible(ids),
            checking = wanted.any { it.isStream && availabilityOf(it, availability) == Availability.CHECKING },
            wanted = wanted.size,
            offAir = wanted.count { it.isStream && availabilityOf(it, availability) == Availability.OFFLINE },
        )
    }

    /* ---------- Lifecycle ---------- */

    fun onScreenStarted() {
        foreground = true
        pool.setActive(true)
        val state = watch.value
        audioFocus.update(state.audible.isNotEmpty() && _masterVolume.value > 0f && _recording.value == null)
        if (loops == null) {
            loops = viewModelScope.launch {
                launch {
                    while (true) {
                        delay(DISCOVERY_INTERVAL_MS)
                        runDiscovery(announce = false)
                    }
                }
                launch {
                    while (true) {
                        delay(RECHECK_TICK_MS)
                        recheckStale()
                    }
                }
            }
        }
        if (started && System.currentTimeMillis() - lastDiscovery > DISCOVERY_INTERVAL_MS) runDiscovery(announce = false)
    }

    /** Out of sight (not in picture-in-picture): everything stops until the app comes back. */
    fun onScreenStopped() {
        foreground = false
        loops?.cancel()
        loops = null
        pool.setActive(false)
        audioFocus.update(false)
    }

    override fun onCleared() {
        runCatching { getApplication<Application>().unregisterReceiver(noisyReceiver) }
        audioFocus.update(false)
        pool.releaseAll()
    }

    /* ---------- On air or not ---------- */

    private fun checkChannel(channel: Channel): Job? {
        if (!channel.isStream || channel.id == PREVIEW_ID) return null
        val key = channel.id + "\n" + channel.url
        checks[key]?.let { if (it.isActive) return it }
        val job = viewModelScope.launch {
            val result = StreamCheck.check(http, channel.url)
            val current = channelStore.channels.firstOrNull { it.id == channel.id } ?: return@launch
            if (current.url == channel.url) setAvailability(current, result)
        }
        checks[key] = job
        return job
    }

    private fun setAvailability(channel: Channel, result: StreamCheck.Result) {
        val previous = _availability.value[channel.id]?.takeIf { it.url == channel.url }?.availability
        _availability.update {
            it + (channel.id to AvailabilityInfo(channel.url, result.availability, result.detail, System.currentTimeMillis()))
        }
        if (started && previous == Availability.OFFLINE && result.availability == Availability.LIVE && channel.wantsScreen) {
            _events.tryEmit(UiEvent.WentLive(channel.name))
        }
    }

    /** Off-air and unreachable streams are checked again every minute; new ones right away. */
    private fun recheckStale() {
        val now = System.currentTimeMillis()
        val map = _availability.value
        for (channel in channelStore.channels) {
            if (!channel.isStream || !channel.wantsScreen) continue
            val info = map[channel.id]?.takeIf { it.url == channel.url }
            if (info == null || (info.availability != Availability.LIVE && now - info.checkedAt > RECHECK_OFF_AIR_MS)) {
                checkChannel(channel)
            }
        }
    }

    /** A channel that keeps failing may have gone off air. */
    private fun onTrouble(channelId: String) {
        channelStore.channels.firstOrNull { it.id == channelId }?.let { checkChannel(it) }
    }

    /* ---------- Knesset streams ---------- */

    /** Looks for new Knesset streams: on start, every few minutes, and on refresh. */
    fun runDiscovery(announce: Boolean): Job {
        discoveryJob?.let { if (it.isActive) return it }
        val job = viewModelScope.launch {
            _discovering.value = true
            try {
                val result = discovery.discover()
                val state = channelStore.state.value
                val merge = ChannelCatalog.applyDiscovery(
                    state.channels,
                    state.removed,
                    result.found,
                    result.complete,
                    System.currentTimeMillis(),
                )
                channelStore.update { it.copy(channels = merge.channels) }
                lastDiscovery = System.currentTimeMillis()
                lastAdded = merge.addedIds.size
                channelStore.channels.filter { it.isKnesset && it.wantsScreen }.mapNotNull { checkChannel(it) }.joinAll()
                val map = _availability.value
                val liveAdded = merge.addedIds.mapNotNull { id -> channelStore.channels.firstOrNull { it.id == id } }
                    .filter { it.wantsScreen && availabilityOf(it, map) == Availability.LIVE }
                if (started && liveAdded.isNotEmpty()) _events.tryEmit(UiEvent.NewKnesset(liveAdded.map { it.name }))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(PlayerPool.TAG, "knesset.tv: ${e.message}")
                lastAdded = 0
                if (announce) _events.tryEmit(UiEvent.DiscoveryFailed(e.message.orEmpty()))
            } finally {
                _discovering.value = false
            }
        }
        discoveryJob = job
        return job
    }

    /** The global refresh: look for new streams, check every channel again and reload what plays. */
    fun refreshAll() {
        if (_refreshing.value) return
        _refreshing.value = true
        news.loadDue(force = true)
        viewModelScope.launch {
            try {
                runDiscovery(announce = true).join()
                channelStore.channels.filter { it.isStream && it.wantsScreen }.mapNotNull { checkChannel(it) }.joinAll()
                pool.restartAll()
                val map = _availability.value
                val wanted = channelStore.channels.filter { it.wantsScreen }
                _events.tryEmit(
                    UiEvent.Refreshed(
                        onScreen = wanted.count { isShown(it, map) } + (if (preview.value != null) 1 else 0),
                        offAir = wanted.count { it.isStream && availabilityOf(it, map) == Availability.OFFLINE },
                        added = lastAdded,
                    ),
                )
            } finally {
                _refreshing.value = false
            }
        }
    }

    /* ---------- Sound ---------- */

    fun toggleMute(id: String) = mix.update { it.toggleMute(id) }

    fun toggleSolo(id: String, exclusive: Boolean = false) = mix.update { it.toggleSolo(id, exclusive) }

    fun clearSolo() = mix.update { it.clearSolo() }

    fun toggleMuteAll() {
        val all = channelStore.channels.map { it.id } + listOfNotNull(preview.value?.id)
        mix.update { it.toggleMuteAll(watch.value.shownIds, all) }
    }

    /** 0–2 (200%); snaps to 100% when it passes close by. */
    fun setMasterVolume(value: Float) {
        val volume = value.coerceIn(0f, MAX_VOLUME)
        _masterVolume.value = if (kotlin.math.abs(volume - 1f) <= UNITY_SNAP) 1f else volume
    }

    fun saveMasterVolume() = settingsRepository.setMasterVolume(_masterVolume.value)

    /* ---------- Spotlight and fullscreen ---------- */

    /**
     * Makes a channel the big one and the only one heard, muting every other channel. Doing it
     * again on the same channel goes back to the grid and leaves its sound on.
     */
    fun focus(id: String) {
        if (watch.value.isFocused(id)) {
            layout.update { it.copy(spotlightId = null) }
            return
        }
        mix.value = mix.value.focus(id)
        layout.update { it.copy(spotlightId = id) }
    }

    fun closeSpotlight() = layout.update { it.copy(spotlightId = null) }

    fun openFullscreen(id: String) = layout.update { Layout(spotlightId = id, fullscreenId = id) }

    fun closeFullscreen() = layout.update { it.copy(fullscreenId = null) }

    /** Switches the fullscreen channel, with its sound, to the next or previous stream on screen. */
    fun fullscreenStep(step: Int) {
        val streams = watch.value.shown.filter { it.isStream }
        if (streams.isEmpty()) return
        val index = streams.indexOfFirst { it.id == layout.value.fullscreenId }.coerceAtLeast(0)
        val next = streams[Math.floorMod(index + step, streams.size)].id
        mix.value = mix.value.focus(next)
        layout.value = Layout(spotlightId = next, fullscreenId = next)
    }

    /* ---------- Channel list ---------- */

    /** Puts the channels [ids] in this order, in the places they already occupy in the full list. */
    fun applyOrder(ids: List<String>) {
        channelStore.updateChannels { list ->
            val wanted = ids.toSet()
            val slots = list.indices.filter { list[it].id in wanted }
            val byId = list.associateBy { it.id }
            val ordered = ids.mapNotNull { byId[it] }
            if (ordered.size != slots.size) return@updateChannels list
            val result = list.toMutableList()
            slots.forEachIndexed { i, slot -> result[slot] = ordered[i] }
            result
        }
    }

    fun setEnabled(id: String, enabled: Boolean) {
        channelStore.updateChannel(id) { it.copy(enabled = enabled) }
        if (enabled) channelStore.channels.firstOrNull { it.id == id }?.let { checkChannel(it) }
    }

    fun toggleMeter(id: String) = channelStore.updateChannel(id) { it.copy(meter = !it.meter) }

    /** Adds a channel ([id] null) or saves changes to one. */
    fun saveChannel(id: String?, draft: ChannelDraft) {
        if (id == null) {
            val channel = ChannelCatalog.normalize(
                Channel(
                    id = makeId("ch"),
                    name = draft.name,
                    description = draft.description,
                    kind = draft.kind,
                    url = draft.url,
                    poster = draft.poster,
                ),
            ) ?: return
            channelStore.updateChannels { it + channel }
            checkChannel(channel)
            return
        }
        channelStore.updateChannel(id) { old ->
            val updated = old.copy(
                name = draft.name.trim(),
                description = draft.description.trim(),
                kind = draft.kind,
                url = draft.url.trim(),
                poster = draft.poster.trim(),
            )
            val changed = updated.name != old.name || updated.description != old.description ||
                updated.kind != old.kind || updated.url != old.url || updated.poster != old.poster
            ChannelCatalog.normalize(if (changed) updated.copy(edited = true) else updated) ?: old
        }
        channelStore.channels.firstOrNull { it.id == id }?.let { checkChannel(it) }
    }

    /** Removed built-in and Knesset channels are remembered so they don't come back by themselves. */
    fun removeChannel(id: String) {
        val state = channelStore.state.value
        val index = state.channels.indexOfFirst { it.id == id }
        if (index < 0) return
        val channel = state.channels[index]
        val remembered = (channel.builtin || channel.isKnesset) && channel.id !in state.removed
        channelStore.update {
            it.copy(
                channels = it.channels.filterNot { c -> c.id == id },
                removed = if (remembered) it.removed + id else it.removed,
            )
        }
        _events.tryEmit(UiEvent.ChannelRemoved(RemovedChannel(channel, index, remembered)))
    }

    fun undoRemoveChannel(removed: RemovedChannel) {
        channelStore.update { state ->
            // A reset in the meantime may have brought the channel back already.
            if (state.channels.any { it.id == removed.channel.id }) return@update state
            val list = state.channels.toMutableList()
            list.add(removed.index.coerceAtMost(list.size), removed.channel)
            state.copy(channels = list, removed = if (removed.remembered) state.removed - removed.channel.id else state.removed)
        }
        checkChannel(removed.channel)
    }

    /** Back to the built-in channels; Knesset streams are found again right away. */
    fun resetChannels() {
        channelStore.reset()
        _availability.value = emptyMap()
        channelStore.channels.filter { it.wantsScreen }.forEach { checkChannel(it) }
        runDiscovery(announce = true)
        _events.tryEmit(UiEvent.ChannelsReset)
    }

    suspend fun testStream(url: String): StreamCheck.Result = StreamCheck.check(http, url)

    /* ---------- News ---------- */

    fun removeSource(id: String) {
        news.remove(id)?.let { _events.tryEmit(UiEvent.SourceRemoved(it)) }
    }

    fun resetSources() {
        news.reset()
        _events.tryEmit(UiEvent.SourcesReset)
    }

    /* ---------- Links ---------- */

    /** Plays a stream from a newscenter://play link in the spotlight, without saving it. */
    fun openPreview(url: String, name: String?) {
        if (!isHttpUrl(url)) return
        Log.i(PlayerPool.TAG, "preview ${hostName(url)}")
        preview.value = Channel(
            id = PREVIEW_ID,
            name = name?.trim()?.takeIf { it.isNotEmpty() } ?: hostName(url),
            description = "newscenter://",
            url = url.trim(),
        )
        mix.value = mix.value.focus(PREVIEW_ID)
        layout.value = Layout(spotlightId = PREVIEW_ID)
    }

    fun closePreview() {
        preview.value = null
        layout.update { Layout(spotlightId = it.spotlightId?.takeIf { id -> id != PREVIEW_ID }) }
    }

    /* ---------- Knesset screen ---------- */

    /**
     * Makes a Knesset stream the big one and the only one heard, like the desktop's Knesset view.
     * False when it isn't on the Watch screen (off air or switched off).
     */
    fun watchKnesset(id: String): Boolean {
        val state = watch.value
        if (state.shown.none { it.id == id }) return false
        if (!state.isFocused(id)) focus(id)
        return true
    }

    fun openRecording(url: String, title: String) {
        if (!isHttpUrl(url) || isBlockedAddress(url)) return
        Log.i(PlayerPool.TAG, "recording ${hostName(url)}")
        _recording.value = Recording(url.trim(), title.trim())
    }

    fun closeRecording() {
        _recording.value = null
    }

    fun showMessage(text: String) {
        if (text.isNotBlank()) _events.tryEmit(UiEvent.Message(text))
    }

    /* ---------- Settings ---------- */

    fun setThemeMode(value: ThemeMode) = settingsRepository.setThemeMode(value)

    fun setPureBlack(value: Boolean) = settingsRepository.setPureBlack(value)

    fun setDynamicColor(value: Boolean) = settingsRepository.setDynamicColor(value)

    fun setAccentColor(value: Int) = settingsRepository.setAccentColor(value)

    fun setTileSize(value: TileSize) = settingsRepository.setTileSize(value)

    fun setGridDataSaver(value: Boolean) = settingsRepository.setGridDataSaver(value)

    fun setKeepScreenOn(value: Boolean) = settingsRepository.setKeepScreenOn(value)

    fun setPictureInPicture(value: Boolean) = settingsRepository.setPictureInPicture(value)

    fun setShowMeters(value: Boolean) = settingsRepository.setShowMeters(value)

    fun dismissCrashReport() {
        CrashReporter.clear(getApplication())
        _crashReport.value = null
    }

    companion object {
        const val PREVIEW_ID = "preview"
        const val MAX_VOLUME = 2f
        private const val UNITY_SNAP = 0.04f
        private const val DISCOVERY_INTERVAL_MS = 5L * 60 * 1000
        private const val RECHECK_TICK_MS = 15_000L
        private const val RECHECK_OFF_AIR_MS = 60_000L
    }
}
