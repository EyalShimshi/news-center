package io.github.eyalshimshi.newscenter.data

import android.content.SharedPreferences
import io.github.eyalshimshi.newscenter.model.NewsSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.updateAndGet
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** The news sources: built-in ones plus the user's, each switched on or off. */
class NewsStore(
    private val prefs: SharedPreferences,
    private val json: Json,
    private val builtins: List<NewsSource>,
) {
    data class State(val sources: List<NewsSource>, val removed: Set<String>)

    private val _state = MutableStateFlow(load())
    val state: StateFlow<State> = _state.asStateFlow()

    fun update(transform: (State) -> State): State {
        val next = _state.updateAndGet(transform)
        save(next)
        return next
    }

    fun updateSource(id: String, transform: (NewsSource) -> NewsSource) {
        update { state -> state.copy(sources = state.sources.map { if (it.id == id) transform(it) else it }) }
    }

    /** Back to the built-in sources with the default ones switched on; added sources are removed. */
    fun reset() {
        update { State(builtins, emptySet()) }
    }

    private fun load(): State {
        val removed = runCatching {
            json.decodeFromString(ListSerializer(String.serializer()), prefs.getString(KEY_REMOVED, null) ?: "[]")
        }.getOrDefault(emptyList()).toSet()
        val saved = prefs.getString(KEY_SOURCES, null)?.let { text ->
            runCatching { json.decodeFromString(ListSerializer(NewsSource.serializer()), text) }.getOrNull()
        }
        val sources = if (saved == null) {
            builtins
        } else {
            NewsCatalog.mergeSources(saved.mapNotNull(NewsCatalog::normalize), removed, builtins)
        }
        return State(sources, removed)
    }

    private fun save(state: State) {
        prefs.edit()
            .putString(KEY_SOURCES, json.encodeToString(ListSerializer(NewsSource.serializer()), state.sources))
            .putString(KEY_REMOVED, json.encodeToString(ListSerializer(String.serializer()), state.removed.toList()))
            .apply()
    }

    private companion object {
        const val KEY_SOURCES = "news_sources_v1"
        const val KEY_REMOVED = "news_removed_v1"
    }
}
