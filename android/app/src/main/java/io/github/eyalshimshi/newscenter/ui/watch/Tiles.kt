package io.github.eyalshimshi.newscenter.ui.watch

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.playback.PlayerPool
import io.github.eyalshimshi.newscenter.ui.components.AppIcons

/** How a tile's sound is set right now. */
data class TileSound(val muted: Boolean, val soloed: Boolean, val audible: Boolean, val volume: Float)

/**
 * A channel in the grid. Tapping it puts it in the spotlight with its sound alone (the desktop
 * app's center button); [gestures] carries the long-press drag that rearranges the tiles.
 */
@Composable
fun ChannelTile(
    channel: Channel,
    pool: PlayerPool,
    sound: TileSound,
    showMeter: Boolean,
    compact: Boolean,
    onFocus: () -> Unit,
    onToggleMute: () -> Unit,
    onToggleSolo: () -> Unit,
    gestures: Modifier,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .clip(shape)
            .background(Color.Black),
    ) {
        if (channel.isPage) {
            PageView(channel, muted = !sound.audible, volume = sound.volume, modifier = Modifier.fillMaxSize())
        } else {
            val tile = rememberTilePlayer(pool, channel)
            VideoSurface(tile, Modifier.fillMaxSize())
            StatusOverlay(tile, compact = compact, modifier = Modifier.fillMaxSize())
            if (showMeter) {
                LevelMeter(
                    tile.meter,
                    Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = 6.dp)
                        .width(7.dp)
                        .fillMaxHeight(0.6f),
                )
            }
        }
        // Over the picture (and over a web page, which would otherwise take the touches).
        Box(
            Modifier
                .fillMaxSize()
                .then(gestures)
                .clickable(onClickLabel = stringResource(R.string.action_spotlight), onClick = onFocus),
        )
        TileCaption(channel, sound.audible, compact, Modifier.align(Alignment.BottomStart))
        MuteSoloButtons(
            muted = sound.muted,
            soloed = sound.soloed,
            onToggleMute = onToggleMute,
            onToggleSolo = onToggleSolo,
            size = if (compact) 28.dp else 34.dp,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(6.dp),
        )
    }
}

@Composable
private fun TileCaption(channel: Channel, audible: Boolean, compact: Boolean, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f))))
            .padding(start = 10.dp, end = 10.dp, top = 14.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (audible) {
            Icon(
                AppIcons.VolumeUp,
                contentDescription = stringResource(R.string.audible),
                tint = Color.White,
                modifier = Modifier.size(if (compact) 14.dp else 16.dp),
            )
            Spacer(Modifier.width(4.dp))
        }
        Text(
            text = channel.name,
            color = Color.White,
            style = if (compact) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The big channel: the picture at full width, with its name, what's on, and its controls. */
@Composable
fun SpotlightCard(
    channel: Channel,
    pool: PlayerPool,
    sound: TileSound,
    showMeter: Boolean,
    isPreview: Boolean,
    onToggleMute: () -> Unit,
    onToggleSolo: () -> Unit,
    onFullscreen: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .background(Color.Black),
            ) {
                if (channel.isPage) {
                    // Here the page takes touches, so its own play button and prompts can be used.
                    PageView(channel, muted = !sound.audible, volume = sound.volume, modifier = Modifier.fillMaxSize())
                } else {
                    val tile = rememberTilePlayer(pool, channel)
                    VideoSurface(tile, Modifier.fillMaxSize())
                    StatusOverlay(tile, compact = false, modifier = Modifier.fillMaxSize())
                    if (showMeter) {
                        LevelMeter(
                            tile.meter,
                            Modifier
                                .align(Alignment.CenterStart)
                                .padding(start = 8.dp)
                                .width(9.dp)
                                .fillMaxHeight(0.6f),
                        )
                    }
                }
            }
            Row(
                modifier = Modifier.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = channel.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val subtitle = channel.now.ifEmpty { channel.description }
                    if (subtitle.isNotEmpty()) {
                        Text(
                            text = subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                MuteSoloButtons(
                    muted = sound.muted,
                    soloed = sound.soloed,
                    onToggleMute = onToggleMute,
                    onToggleSolo = onToggleSolo,
                    size = 40.dp,
                )
                if (!channel.isPage) {
                    IconButton(onClick = onFullscreen) {
                        Icon(AppIcons.Fullscreen, contentDescription = stringResource(R.string.action_fullscreen))
                    }
                }
                IconButton(onClick = onClose) {
                    Icon(
                        if (isPreview) AppIcons.Close else AppIcons.GridView,
                        contentDescription = stringResource(if (isPreview) R.string.action_close_preview else R.string.action_back_to_grid),
                    )
                }
            }
        }
    }
}

/** Shown while there's nothing on screen: checking, all off air, or nothing switched on. */
@Composable
fun WatchEmptyState(
    checking: Boolean,
    wanted: Int,
    offAir: Int,
    onManageChannels: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        when {
            checking -> {
                CircularProgressIndicator()
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.watch_checking), style = MaterialTheme.typography.bodyLarge)
            }
            wanted == 0 -> {
                Icon(AppIcons.LiveTv, contentDescription = null, modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.watch_none_title), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.watch_none_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(24.dp))
                Button(onClick = onManageChannels) { Text(stringResource(R.string.action_choose_channels)) }
            }
            else -> {
                Icon(AppIcons.LiveTv, contentDescription = null, modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.watch_off_air_title), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(
                    pluralStringResource(R.plurals.watch_off_air_body, offAir, offAir),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(24.dp))
                OutlinedButton(onClick = onRefresh) { Text(stringResource(R.string.action_refresh)) }
            }
        }
    }
}
