package io.github.eyalshimshi.newscenter.ui.watch

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.data.AppSettings
import io.github.eyalshimshi.newscenter.data.TileSize
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.playback.MixState
import io.github.eyalshimshi.newscenter.ui.NewsCenterViewModel
import io.github.eyalshimshi.newscenter.ui.WatchState
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyGridState

/** How a channel sounds right now, for its tile. */
fun soundOf(watch: WatchState, id: String, volume: Float): TileSound = TileSound(
    muted = watch.mix.isMuted(id),
    soloed = watch.mix.isSoloed(id),
    audible = id in watch.audible,
    volume = MixState.loudness(volume).coerceAtMost(1f),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WatchScreen(
    viewModel: NewsCenterViewModel,
    settings: AppSettings,
    onOpenSettings: () -> Unit,
    onOpenChannels: () -> Unit,
) {
    val watch by viewModel.watch.collectAsStateWithLifecycle()
    val volume by viewModel.masterVolume.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()
    var soundSheet by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.app_name)) },
            actions = {
                IconButton(onClick = { soundSheet = true }) {
                    Icon(
                        if (watch.audible.isEmpty() || volume == 0f) AppIcons.VolumeOff else AppIcons.VolumeUp,
                        contentDescription = stringResource(R.string.sound_title),
                    )
                }
                if (refreshing) {
                    Box(Modifier.size(48.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.5.dp)
                    }
                } else {
                    IconButton(onClick = viewModel::refreshAll) {
                        Icon(AppIcons.Refresh, contentDescription = stringResource(R.string.action_refresh))
                    }
                }
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(AppIcons.MoreVert, contentDescription = stringResource(R.string.action_more))
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        Text(
                            stringResource(R.string.tile_size),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                        TileSize.entries.forEach { size ->
                            DropdownMenuItem(
                                text = { Text(stringResource(tileSizeLabel(size))) },
                                onClick = {
                                    viewModel.setTileSize(size)
                                    menu = false
                                },
                                leadingIcon = { RadioButton(selected = settings.tileSize == size, onClick = null) },
                            )
                        }
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.show_meters)) },
                            onClick = {
                                viewModel.setShowMeters(!settings.showMeters)
                                menu = false
                            },
                            leadingIcon = { Checkbox(checked = settings.showMeters, onCheckedChange = null) },
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.settings_title)) },
                            onClick = {
                                menu = false
                                onOpenSettings()
                            },
                            leadingIcon = { Icon(AppIcons.Settings, contentDescription = null) },
                        )
                    }
                }
            },
            windowInsets = WindowInsets(0, 0, 0, 0),
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = Color.Transparent,
                scrolledContainerColor = Color.Transparent,
            ),
        )
        if (watch.shown.isEmpty()) {
            WatchEmptyState(
                checking = watch.checking,
                wanted = watch.wanted,
                offAir = watch.offAir,
                onManageChannels = onOpenChannels,
                onRefresh = viewModel::refreshAll,
            )
        } else {
            WatchGrid(viewModel, watch, settings, volume)
        }
    }

    if (soundSheet) {
        SoundSheet(
            volume = volume,
            anyMuted = watch.shown.any { watch.mix.isMuted(it.id) },
            soloActive = watch.shown.any { watch.mix.isSoloed(it.id) },
            onVolumeChange = viewModel::setMasterVolume,
            onVolumeDone = viewModel::saveMasterVolume,
            onToggleMuteAll = viewModel::toggleMuteAll,
            onClearSolo = viewModel::clearSolo,
            onDismiss = {
                viewModel.saveMasterVolume()
                soundSheet = false
            },
        )
    }
}

fun tileSizeLabel(size: TileSize): Int = when (size) {
    TileSize.LARGE -> R.string.tile_size_large
    TileSize.MEDIUM -> R.string.tile_size_medium
    TileSize.SMALL -> R.string.tile_size_small
}

/**
 * The spotlight channel at full width, then every other channel in a grid. Long-press a tile and
 * drag it to rearrange; the order is the same as in the channel list.
 */
@Composable
private fun WatchGrid(viewModel: NewsCenterViewModel, watch: WatchState, settings: AppSettings, volume: Float) {
    val pool = viewModel.pool
    val spotlight = watch.spotlight
    val gridChannels = remember(watch.shown, spotlight?.id) { watch.shown.filter { it.id != spotlight?.id } }
    var ordered by remember(gridChannels) { mutableStateOf(gridChannels) }
    val haptics = LocalHapticFeedback.current
    val gridState = rememberLazyGridState()
    val reorderState = rememberReorderableLazyGridState(gridState) { from, to ->
        val fromIndex = ordered.indexOfFirst { it.id == from.key }
        val toIndex = ordered.indexOfFirst { it.id == to.key }
        if (fromIndex >= 0 && toIndex >= 0) {
            ordered = ordered.toMutableList().apply { add(toIndex, removeAt(fromIndex)) }
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }
    val compact = settings.tileSize == TileSize.SMALL
    val moveEarlier = stringResource(R.string.action_move_earlier)
    val moveLater = stringResource(R.string.action_move_later)

    // A lazy grid keeps its first visible item in place, so anything added above it would appear out
    // of sight. A new spotlight channel is always brought into view (like the desktop app reveals
    // it), and channels that come on air above the top tile are shown while the grid is at its top.
    LaunchedEffect(spotlight?.id) {
        if (spotlight != null) gridState.animateScrollToItem(0)
    }
    val firstKey = if (spotlight != null) SPOTLIGHT_KEY else gridChannels.firstOrNull()?.id
    LaunchedEffect(firstKey) {
        if (gridState.firstVisibleItemIndex <= 1) gridState.scrollToItem(0)
    }

    fun move(channel: Channel, step: Int) {
        val index = ordered.indexOfFirst { it.id == channel.id }
        val target = index + step
        if (index < 0 || target !in ordered.indices) return
        val updated = ordered.toMutableList().apply { add(target, removeAt(index)) }
        ordered = updated
        viewModel.applyOrder(updated.map { it.id })
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = settings.tileSize.minWidthDp.dp),
        state = gridState,
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        if (spotlight != null) {
            item(key = SPOTLIGHT_KEY, span = { GridItemSpan(maxLineSpan) }) {
                SpotlightCard(
                    channel = spotlight,
                    pool = pool,
                    sound = soundOf(watch, spotlight.id, volume),
                    showMeter = settings.showMeters && spotlight.meter,
                    isPreview = spotlight.id == NewsCenterViewModel.PREVIEW_ID,
                    onToggleMute = { viewModel.toggleMute(spotlight.id) },
                    onToggleSolo = { viewModel.toggleSolo(spotlight.id) },
                    onFullscreen = { viewModel.openFullscreen(spotlight.id) },
                    onClose = {
                        if (spotlight.id == NewsCenterViewModel.PREVIEW_ID) viewModel.closePreview() else viewModel.closeSpotlight()
                    },
                    modifier = Modifier.padding(bottom = 4.dp),
                )
            }
        }
        items(ordered, key = { it.id }) { channel ->
            ReorderableItem(reorderState, key = channel.id) { isDragging ->
                val elevation by animateDpAsState(if (isDragging) 8.dp else 0.dp, label = "drag-elevation")
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    shadowElevation = elevation,
                    color = Color.Transparent,
                ) {
                    ChannelTile(
                        channel = channel,
                        pool = pool,
                        sound = soundOf(watch, channel.id, volume),
                        showMeter = settings.showMeters && channel.meter,
                        compact = compact,
                        onFocus = { viewModel.focus(channel.id) },
                        onToggleMute = { viewModel.toggleMute(channel.id) },
                        onToggleSolo = { viewModel.toggleSolo(channel.id) },
                        gestures = Modifier
                            .longPressDraggableHandle(
                                onDragStarted = { haptics.performHapticFeedback(HapticFeedbackType.LongPress) },
                                onDragStopped = { viewModel.applyOrder(ordered.map { it.id }) },
                            )
                            .semantics {
                                customActions = listOf(
                                    CustomAccessibilityAction(moveEarlier) {
                                        move(channel, -1)
                                        true
                                    },
                                    CustomAccessibilityAction(moveLater) {
                                        move(channel, 1)
                                        true
                                    },
                                )
                            },
                    )
                }
            }
        }
    }
}

private const val SPOTLIGHT_KEY = "\u0000spotlight"
