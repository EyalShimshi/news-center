package io.github.eyalshimshi.newscenter.ui.watch

import android.view.TextureView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.RememberObserver
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.model.TileStatus
import io.github.eyalshimshi.newscenter.playback.LevelMeterProcessor
import io.github.eyalshimshi.newscenter.playback.PlayerPool
import io.github.eyalshimshi.newscenter.playback.TilePlayer
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import io.github.eyalshimshi.newscenter.ui.theme.MeterColors
import kotlin.math.log10
import kotlin.math.max
import kotlinx.coroutines.delay

/** Holds a channel's player while it's on screen; releasing it lets the pool stop the player. */
private class TileHandle(private val pool: PlayerPool, channel: Channel) : RememberObserver {
    val tile: TilePlayer = pool.acquire(channel)

    override fun onRemembered() = Unit

    override fun onForgotten() = pool.release(tile)

    override fun onAbandoned() = pool.release(tile)
}

/** The channel's player for as long as the caller stays on screen. */
@Composable
fun rememberTilePlayer(pool: PlayerPool, channel: Channel): TilePlayer =
    remember(pool, channel.id, channel.url) { TileHandle(pool, channel) }.tile

/** The channel's picture, letterboxed in black when it isn't the shape of the box. */
@Composable
fun VideoSurface(tile: TilePlayer, modifier: Modifier = Modifier) {
    val aspect by tile.aspect.collectAsStateWithLifecycle()
    val ratio = aspect.takeIf { it in 0.2f..5f } ?: TilePlayer.DEFAULT_ASPECT
    Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        key(tile) {
            AndroidView(
                factory = { context -> TextureView(context).also { tile.attachSurface(it) } },
                onRelease = { view -> tile.detachSurface(view) },
                modifier = Modifier.aspectRatio(ratio),
            )
        }
    }
}

/** Connecting, buffering or reconnecting, shown over the picture. */
@Composable
fun StatusOverlay(tile: TilePlayer, compact: Boolean, modifier: Modifier = Modifier) {
    val status by tile.status.collectAsStateWithLifecycle()
    Box(modifier, contentAlignment = Alignment.Center) {
        when (status) {
            TileStatus.CONNECTING, TileStatus.BUFFERING -> CircularProgressIndicator(
                modifier = Modifier.size(if (compact) 24.dp else 36.dp),
                strokeWidth = 3.dp,
                color = Color.White,
            )
            TileStatus.RECONNECTING -> Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color.Black.copy(alpha = 0.6f),
                contentColor = Color.White,
            ) {
                Row(
                    modifier = Modifier.semantics(mergeDescendants = true) {},
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(6.dp))
                    Icon(AppIcons.ErrorOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                    if (!compact) Text(stringResource(R.string.status_reconnecting), style = MaterialTheme.typography.labelLarge)
                    Box(Modifier.size(6.dp))
                }
            }
            TileStatus.LIVE -> Unit
        }
    }
}

/**
 * The channel's sound level (left and right), green to red like the desktop app's meters. It
 * shows the level before the volume, so a muted channel still shows activity.
 */
@Composable
fun LevelMeter(meter: LevelMeterProcessor, modifier: Modifier = Modifier) {
    val left = remember(meter) { mutableFloatStateOf(0f) }
    val right = remember(meter) { mutableFloatStateOf(0f) }
    LaunchedEffect(meter) {
        var last = System.nanoTime()
        while (true) {
            delay(METER_FRAME_MS)
            val now = System.nanoTime()
            val elapsed = (now - last) / 1_000_000_000f
            last = now
            val (peakLeft, peakRight) = meter.takePeaks()
            left.floatValue = meterLevel(left.floatValue, peakLeft, elapsed)
            right.floatValue = meterLevel(right.floatValue, peakRight, elapsed)
        }
    }
    Canvas(modifier) {
        val gap = size.width * 0.2f
        val barWidth = (size.width - gap) / 2f
        val brush = Brush.verticalGradient(
            0f to MeterColors.High,
            0.25f to MeterColors.Mid,
            0.5f to MeterColors.Low,
            1f to MeterColors.Low,
            startY = 0f,
            endY = size.height,
        )
        val radius = CornerRadius(barWidth / 2f, barWidth / 2f)
        listOf(left.floatValue, right.floatValue).forEachIndexed { index, level ->
            val x = index * (barWidth + gap)
            drawRoundRect(Color.Black.copy(alpha = 0.35f), Offset(x, 0f), Size(barWidth, size.height), radius)
            val height = size.height * level
            if (height > 0.5f) {
                drawRoundRect(brush, Offset(x, size.height - height), Size(barWidth, height), radius)
            }
        }
    }
}

private const val METER_FRAME_MS = 50L
private const val METER_RANGE_DB = 60f
private const val METER_RELEASE_PER_SECOND = 0.9f

private fun meterLevel(current: Float, peak: Float, elapsedSeconds: Float): Float {
    val target = if (peak > 0f) (1f + 20f * log10(peak) / METER_RANGE_DB).coerceIn(0f, 1f) else 0f
    return if (target >= current) target else max(target, current - METER_RELEASE_PER_SECOND * elapsedSeconds)
}

/** The mixer's M and S toggles. */
@Composable
fun MuteSoloButtons(
    muted: Boolean,
    soloed: Boolean,
    onToggleMute: () -> Unit,
    onToggleSolo: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 34.dp,
) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        MixerToggle(
            letter = stringResource(R.string.mute_letter),
            label = stringResource(R.string.action_mute),
            active = muted,
            activeColor = MuteRed,
            activeContent = Color.White,
            size = size,
            onClick = onToggleMute,
        )
        MixerToggle(
            letter = stringResource(R.string.solo_letter),
            label = stringResource(R.string.action_solo),
            active = soloed,
            activeColor = MeterColors.Mid,
            activeContent = Color.Black,
            size = size,
            onClick = onToggleSolo,
        )
    }
}

private val MuteRed = Color(0xFFE5484D)

@Composable
private fun MixerToggle(
    letter: String,
    label: String,
    active: Boolean,
    activeColor: Color,
    activeContent: Color,
    size: Dp,
    onClick: () -> Unit,
) {
    val on = stringResource(R.string.state_on)
    val off = stringResource(R.string.state_off)
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        color = if (active) activeColor else Color.Black.copy(alpha = 0.55f),
        contentColor = if (active) activeContent else Color.White,
        modifier = Modifier
            .size(size)
            .semantics {
                contentDescription = label
                stateDescription = if (active) on else off
                role = Role.Switch
            },
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(letter, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.45f).sp)
        }
    }
}

/** A small square with a channel's initials, for lists. */
@Composable
fun ChannelBadge(channel: Channel, modifier: Modifier = Modifier, size: Dp = 44.dp) {
    val color = channelColor(channel.id)
    Box(
        modifier = modifier
            .size(size)
            .background(color, RoundedCornerShape(size * 0.28f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initials(channel.name),
            color = Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = (size.value * 0.34f).sp,
            maxLines = 1,
        )
    }
}

private val BADGE_COLORS = listOf(
    Color(0xFF4B5FD6), Color(0xFF8A5CF6), Color(0xFFD9485F), Color(0xFF0F9D8A),
    Color(0xFFE08A00), Color(0xFF2E86DE), Color(0xFF6A4C93), Color(0xFF3C8D2F),
)

fun channelColor(id: String): Color {
    var hash = 0
    for (char in id) hash = hash * 31 + char.code
    return BADGE_COLORS[Math.floorMod(hash, BADGE_COLORS.size)]
}

/** "כאן 11" → "11", "Channel 13" → "13", "i24NEWS" → "i2", "ערוץ הכנסת" → "עה". */
fun initials(name: String): String {
    val words = name.split(' ', '·', '-').map { it.trim() }.filter { it.isNotEmpty() }
    words.lastOrNull { word -> word.any { it.isDigit() } }?.let { word ->
        return word.filter { it.isLetterOrDigit() }.take(3)
    }
    return when {
        words.size >= 2 -> "${words[0].first()}${words[1].first()}"
        words.size == 1 -> words[0].take(2)
        else -> "TV"
    }
}
