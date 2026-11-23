package io.github.eyalshimshi.newscenter.ui

import io.github.eyalshimshi.newscenter.data.FeedFetcher
import io.github.eyalshimshi.newscenter.data.FeedInspection
import io.github.eyalshimshi.newscenter.data.FeedProblem
import io.github.eyalshimshi.newscenter.data.FeedResult
import io.github.eyalshimshi.newscenter.data.Http
import io.github.eyalshimshi.newscenter.data.NewsCatalog
import io.github.eyalshimshi.newscenter.data.NewsStore
import io.github.eyalshimshi.newscenter.data.makeId
import io.github.eyalshimshi.newscenter.model.NewsSource
import io.github.eyalshimshi.newscenter.model.StoredHeadline
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Keeps the switched-on news sources' headlines up to date while the News tab is open, like the
 * desktop app's News panel: every few minutes per source, sooner after a failure.
 */
class NewsController(
    private val store: NewsStore,
    private val http: Http,
    private val scope: CoroutineScope,
) {
    enum class Status { IDLE, OK, ERROR, BLOCKED }

    data class SourceRuntime(
        val url: String = "",
        val status: Status = Status.IDLE,
        val problem: FeedProblem? = null,
        val detail: String = "",
        val items: List<StoredHeadline> = emptyList(),
        val loading: Boolean = false,
        val fetchedAt: Long = 0,
        val nextAt: Long = 0,
        val failures: Int = 0,
    )

    val state: StateFlow<NewsStore.State> = store.state

    private val _runtime = MutableStateFlow<Map<String, SourceRuntime>>(emptyMap())
    val runtime: StateFlow<Map<String, SourceRuntime>> = _runtime.asStateFlow()

    /** The source picked above the headlines, or null for all of them. */
    val filter = MutableStateFlow<String?>(null)

    /** Moves on with every load, so "5 minutes ago" stays right. */
    val clock = MutableStateFlow(System.currentTimeMillis())

    val headlines: StateFlow<List<NewsCatalog.Entry>> =
        combine(store.state, _runtime, filter, clock) { state, runtime, filter, now ->
            NewsCatalog.headlines(state.sources, runtime.mapValues { it.value.items }, filter, now)
        }.stateIn(scope, SharingStarted.Eagerly, emptyList())

    private val pending = HashMap<String, Job>()

    val anyLoading: Boolean get() = pending.values.any { it.isActive }

    /** Loads the switched-on sources that are due (all of them when [force]). */
    fun loadDue(force: Boolean = false) {
        val now = System.currentTimeMillis()
        clock.value = now
        for (source in store.state.value.sources) {
            if (!source.enabled || pending[source.id]?.isActive == true) continue
            val info = _runtime.value[source.id]
            if (force || info == null || info.url != source.url || now >= info.nextAt) load(source)
        }
    }

    private fun load(source: NewsSource) {
        updateRuntime(source.id) { info ->
            if (info.url != source.url) SourceRuntime(url = source.url, loading = true) else info.copy(loading = true)
        }
        pending[source.id] = scope.launch {
            val result = FeedFetcher.request(http, source.url)
            val current = store.state.value.sources.firstOrNull { it.id == source.id }
            val now = System.currentTimeMillis()
            updateRuntime(source.id) { info ->
                when {
                    // The address changed while loading: the next load uses the new one.
                    current?.url != source.url -> info.copy(loading = false)
                    result is FeedResult.Ok -> info.copy(
                        status = Status.OK,
                        problem = null,
                        detail = "",
                        items = NewsCatalog.mergeHeadlines(info.items, result.feed.items, now),
                        loading = false,
                        fetchedAt = now,
                        nextAt = now + REFRESH_MS + Random.nextLong(REFRESH_JITTER_MS),
                        failures = 0,
                    )
                    result is FeedResult.Failed -> info.copy(
                        status = if (result.problem == FeedProblem.BLOCKED) Status.BLOCKED else Status.ERROR,
                        problem = result.problem,
                        detail = result.detail,
                        loading = false,
                        nextAt = now + RETRY_MS[info.failures.coerceAtMost(RETRY_MS.lastIndex)],
                        failures = info.failures + 1,
                    )
                    else -> info.copy(loading = false)
                }
            }
            clock.value = now
        }
    }

    private fun updateRuntime(id: String, transform: (SourceRuntime) -> SourceRuntime) {
        _runtime.update { map -> map + (id to transform(map[id] ?: SourceRuntime())) }
    }

    fun setEnabled(id: String, enabled: Boolean) {
        store.updateSource(id) { it.copy(enabled = enabled) }
        if (!enabled && filter.value == id) filter.value = null
        if (enabled) loadDue()
    }

    /** Removes a source; returns what [restore] needs to undo it. */
    fun remove(id: String): RemovedSource? {
        val state = store.state.value
        val index = state.sources.indexOfFirst { it.id == id }
        if (index < 0) return null
        val source = state.sources[index]
        val remembered = source.builtin && source.id !in state.removed
        store.update { it.copy(sources = it.sources.filterNot { s -> s.id == id }, removed = if (remembered) it.removed + id else it.removed) }
        if (filter.value == id) filter.value = null
        return RemovedSource(source, index, remembered)
    }

    data class RemovedSource(val source: NewsSource, val index: Int, val remembered: Boolean)

    fun restore(removed: RemovedSource) {
        store.update { state ->
            // A reset in the meantime may have brought the source back already.
            if (state.sources.any { it.id == removed.source.id }) return@update state
            val list = state.sources.toMutableList()
            list.add(removed.index.coerceAtMost(list.size), removed.source)
            state.copy(sources = list, removed = if (removed.remembered) state.removed - removed.source.id else state.removed)
        }
        loadDue()
    }

    /** Adds a source or saves changes to one ([id] null adds). New sources start switched on. */
    fun save(id: String?, name: String, url: String) {
        if (id == null) {
            val source = NewsSource(id = makeId("news"), name = name.trim(), url = url.trim(), enabled = true)
            store.update { it.copy(sources = it.sources + source) }
        } else {
            store.updateSource(id) { source ->
                val changed = source.name != name.trim() || source.url != url.trim()
                source.copy(name = name.trim(), url = url.trim(), edited = source.edited || changed)
            }
        }
        loadDue()
    }

    fun reset() {
        store.reset()
        filter.value = null
        loadDue()
    }

    suspend fun inspect(address: String): FeedInspection = FeedFetcher.inspect(http, address)

    private companion object {
        const val REFRESH_MS = 3L * 60 * 1000
        const val REFRESH_JITTER_MS = 20_000L
        val RETRY_MS = longArrayOf(60_000, 3 * 60_000, 10 * 60_000)
    }
}
