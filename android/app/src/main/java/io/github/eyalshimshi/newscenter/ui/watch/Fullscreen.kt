package io.github.eyalshimshi.newscenter.ui.watch

import android.content.pm.ActivityInfo
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.playback.PlayerPool
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import kotlinx.coroutines.delay

/**
 * One channel filling the app's window. On a phone it turns sideways and hides the system bars;
 * in split screen or a freeform window it fills just the app's window, like the desktop app's
 * fullscreen stays inside its window.
 */
@Composable
fun FullscreenPlayer(
    channel: Channel,
    pool: PlayerPool,
    sound: TileSound,
    onToggleMute: () -> Unit,
    onToggleSolo: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onExit: () -> Unit,
) {
    val activity = LocalActivity.current
    val view = LocalView.current
    DisposableEffect(activity) {
        val window = activity?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        val previousOrientation = activity?.requestedOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        if (activity != null && !activity.isInMultiWindowMode) {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
        onDispose {
            controller?.show(WindowInsetsCompat.Type.systemBars())
            activity?.requestedOrientation = previousOrientation
        }
    }
    BackHandler(onBack = onExit)

    var controlsVisible by remember { mutableStateOf(true) }
    LaunchedEffect(controlsVisible, channel.id) {
        if (controlsVisible) {
            delay(CONTROLS_TIMEOUT_MS)
            controlsVisible = false
        }
    }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        if (channel.isPage) {
            PageView(channel, muted = !sound.audible, volume = sound.volume, modifier = Modifier.fillMaxSize())
        } else {
            val tile = rememberTilePlayer(pool, channel)
            VideoSurface(tile, Modifier.fillMaxSize())
            // A tap anywhere shows or hides the controls.
            Box(
                Modifier
                    .fillMaxSize()
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        controlsVisible = !controlsVisible
                    },
            )
            StatusOverlay(tile, compact = false, modifier = Modifier.fillMaxSize())
        }
        AnimatedVisibility(visible = controlsVisible || channel.isPage, enter = fadeIn(), exit = fadeOut()) {
            FullscreenControls(
                channel = channel,
                sound = sound,
                onToggleMute = onToggleMute,
                onToggleSolo = onToggleSolo,
                onPrevious = onPrevious,
                onNext = onNext,
                onExit = onExit,
            )
        }
    }
}

@Composable
private fun FullscreenControls(
    channel: Channel,
    sound: TileSound,
    onToggleMute: () -> Unit,
    onToggleSolo: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onExit: () -> Unit,
) {
    val buttonColors = IconButtonDefaults.filledTonalIconButtonColors(
        containerColor = Color.Black.copy(alpha = 0.55f),
        contentColor = Color.White,
    )
    Box(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent)))
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onExit) {
                Icon(AppIcons.FullscreenExit, contentDescription = stringResource(R.string.action_exit_fullscreen), tint = Color.White)
            }
            Spacer(Modifier.width(8.dp))
            Text(
                text = channel.name,
                color = Color.White,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            MuteSoloButtons(
                muted = sound.muted,
                soloed = sound.soloed,
                onToggleMute = onToggleMute,
                onToggleSolo = onToggleSolo,
                size = 40.dp,
            )
        }
        if (!channel.isPage) {
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                FilledTonalIconButton(onClick = onPrevious, colors = buttonColors) {
                    Icon(AppIcons.SkipPrevious, contentDescription = stringResource(R.string.action_previous_channel))
                }
                FilledTonalIconButton(onClick = onNext, colors = buttonColors) {
                    Icon(AppIcons.SkipNext, contentDescription = stringResource(R.string.action_next_channel))
                }
            }
        }
    }
}

/** Picture-in-picture: just the spotlight channel's picture. */
@Composable
fun PipPlayer(channel: Channel?, pool: PlayerPool) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        if (channel != null && channel.isStream) {
            val tile = rememberTilePlayer(pool, channel)
            VideoSurface(tile, Modifier.fillMaxSize())
        }
    }
}

private const val CONTROLS_TIMEOUT_MS = 3_500L
