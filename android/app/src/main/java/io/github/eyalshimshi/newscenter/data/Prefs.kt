package io.github.eyalshimshi.newscenter.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate

/** The app's single preferences file. */
fun Context.newsCenterPreferences(): SharedPreferences =
    applicationContext.getSharedPreferences("newscenter", Context.MODE_PRIVATE)

/** Emits [read] right away and again after every change to these preferences. */
internal fun <T> SharedPreferences.observe(read: (SharedPreferences) -> T): Flow<T> = callbackFlow {
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { prefs, _ -> trySend(read(prefs)) }
    registerOnSharedPreferenceChangeListener(listener)
    trySend(read(this@observe))
    awaitClose { unregisterOnSharedPreferenceChangeListener(listener) }
}.conflate()
