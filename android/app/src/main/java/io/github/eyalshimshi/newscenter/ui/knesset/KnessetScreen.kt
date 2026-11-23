package io.github.eyalshimshi.newscenter.ui.knesset

import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.ui.KnessetStream
import io.github.eyalshimshi.newscenter.ui.NewsCenterViewModel
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Knesset's day-to-day work in Hebrew, as in the Windows app's Knesset view: today's sessions,
 * the committees, the plenum, votes, legislation, MKs, the government and a guide. A live session
 * opens on the Watch screen, big and heard alone; recordings play over everything (RecordingPlayer).
 */
@Composable
fun KnessetScreen(web: KnessetWeb, viewModel: NewsCenterViewModel, onWatch: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val theme = remember(colors) { themeJson(colors) }
    val streams by viewModel.knessetStreams.collectAsStateWithLifecycle()
    val notOnAir = stringResource(R.string.knesset_not_on_air)
    val currentOnWatch by rememberUpdatedState(onWatch)

    val page = remember(web.generation) { web.obtain(theme) }
    LaunchedEffect(theme) { web.setTheme(theme) }
    LaunchedEffect(streams) { web.setChannels(channelsJson(streams)) }

    DisposableEffect(web, viewModel, notOnAir) {
        web.onRequest = { request ->
            when (request) {
                is KnessetRequest.Watch -> if (viewModel.watchKnesset(request.id)) currentOnWatch() else viewModel.showMessage(notOnAir)
                is KnessetRequest.Play -> viewModel.openRecording(request.url, request.title)
                KnessetRequest.RefreshChannels -> viewModel.runDiscovery(announce = false)
                is KnessetRequest.Message -> viewModel.showMessage(request.text)
            }
        }
        onDispose { web.onRequest = null }
    }

    // Out of sight (another tab, or the app in the background), the page counts as hidden.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, page) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> web.onShown()
                Lifecycle.Event.ON_STOP -> web.onHidden()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            web.onHidden()
        }
    }

    BackHandler(enabled = web.canGoBack) { web.back() }

    key(page) {
        AndroidView(
            // The same page comes back each time the tab is shown; it's destroyed with the screen.
            factory = {
                (page.parent as? ViewGroup)?.removeView(page)
                page
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/** The Material colors the page uses (index.html sets them as --m-* variables). */
private fun themeJson(colors: ColorScheme): String {
    val roles = linkedMapOf(
        "background" to colors.background,
        "surfaceContainerLow" to colors.surfaceContainerLow,
        "surfaceContainer" to colors.surfaceContainer,
        "surfaceContainerHigh" to colors.surfaceContainerHigh,
        "surfaceContainerHighest" to colors.surfaceContainerHighest,
        "onSurface" to colors.onSurface,
        "onSurfaceVariant" to colors.onSurfaceVariant,
        "outline" to colors.outline,
        "outlineVariant" to colors.outlineVariant,
        "primary" to colors.primary,
        "onPrimary" to colors.onPrimary,
        "primaryContainer" to colors.primaryContainer,
        "onPrimaryContainer" to colors.onPrimaryContainer,
        "secondaryContainer" to colors.secondaryContainer,
        "onSecondaryContainer" to colors.onSecondaryContainer,
        "error" to colors.error,
    )
    val values = JSONObject()
    roles.forEach { (name, color) -> values.put(name, hex(color)) }
    return JSONObject().put("dark", colors.background.luminance() < 0.5f).put("colors", values).toString()
}

private fun hex(color: Color): String = String.format(Locale.ROOT, "#%06X", color.toArgb() and 0xFFFFFF)

private fun channelsJson(streams: List<KnessetStream>): String = JSONArray().apply {
    for (stream in streams) {
        put(
            JSONObject()
                .put("id", stream.id)
                .put("name", stream.name)
                .put("url", stream.url)
                .put("now", stream.now)
                .put("main", stream.main)
                .put("live", stream.live),
        )
    }
}.toString()
