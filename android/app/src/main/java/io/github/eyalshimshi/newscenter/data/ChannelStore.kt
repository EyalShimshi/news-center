package io.github.eyalshimshi.newscenter.data

import android.content.SharedPreferences
import io.github.eyalshimshi.newscenter.model.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.updateAndGet
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** The user's channel list, in their order, kept in sync with the built-in list. */
class ChannelStore(
    private val prefs: SharedPreferences,
    private val json: Json,
    private val builtins: List<Channel>,
) {
    data class State(val channels: List<Channel>, val removed: Set<String>)

    private val _state = MutableStateFlow(load())
    val state: StateFlow<State> = _state.asStateFlow()

    val channels: List<Channel> get() = _state.value.channels

    fun update(transform: (State) -> State): State {
        val next = _state.updateAndGet(transform)
        save(next)
        return next
    }

    fun updateChannels(transform: (List<Channel>) -> List<Channel>) {
        update { it.copy(channels = transform(it.channels)) }
    }

    fun updateChannel(id: String, transform: (Channel) -> Channel) {
        updateChannels { list -> list.map { if (it.id == id) transform(it) else it } }
    }

    /** Back to the built-in list: added channels are removed; Knesset streams are found again. */
    fun reset() {
        update { State(builtins, emptySet()) }
    }

    private fun load(): State {
        val removed = runCatching {
            json.decodeFromString(ListSerializer(String.serializer()), prefs.getString(KEY_REMOVED, null) ?: "[]")
        }.getOrDefault(emptyList()).toSet()
        val saved = prefs.getString(KEY_CHANNELS, null)?.let { text ->
            runCatching { json.decodeFromString(ListSerializer(Channel.serializer()), text) }.getOrNull()
        }
        val channels = if (saved == null) {
            builtins
        } else {
            ChannelCatalog.mergeBuiltins(saved.mapNotNull(ChannelCatalog::normalize), removed, builtins)
        }
        return State(channels, removed)
    }

    private fun save(state: State) {
        prefs.edit()
            .putString(KEY_CHANNELS, json.encodeToString(ListSerializer(Channel.serializer()), state.channels))
            .putString(KEY_REMOVED, json.encodeToString(ListSerializer(String.serializer()), state.removed.toList()))
            .apply()
    }

    private companion object {
        const val KEY_CHANNELS = "channels_v1"
        const val KEY_REMOVED = "channels_removed_v1"
    }
}
