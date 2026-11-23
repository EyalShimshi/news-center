package io.github.eyalshimshi.newscenter.ui.channels

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.ui.ChannelStatus
import io.github.eyalshimshi.newscenter.ui.NewsCenterViewModel
import io.github.eyalshimshi.newscenter.ui.channelStatus
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import io.github.eyalshimshi.newscenter.ui.components.groupItemShape
import io.github.eyalshimshi.newscenter.ui.watch.ChannelBadge
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

/**
 * Every channel, in the Watch screen's order: switch channels on and off, drag to reorder, tap to
 * edit. Knesset streams appear by themselves when knesset.tv lists them.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelsScreen(viewModel: NewsCenterViewModel, onOpenSettings: () -> Unit) {
    val state by viewModel.channels.collectAsStateWithLifecycle()
    val availability by viewModel.availability.collectAsStateWithLifecycle()
    val discovering by viewModel.discovering.collectAsStateWithLifecycle()
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var adding by rememberSaveable { mutableStateOf(false) }
    var confirmReset by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    var ordered by remember(state.channels) { mutableStateOf(state.channels) }
    val haptics = LocalHapticFeedback.current
    val listState = rememberLazyListState()
    val reorderState = rememberReorderableLazyListState(listState) { from, to ->
        val fromIndex = ordered.indexOfFirst { it.id == from.key }
        val toIndex = ordered.indexOfFirst { it.id == to.key }
        if (fromIndex >= 0 && toIndex >= 0) {
            ordered = ordered.toMutableList().apply { add(toIndex, removeAt(fromIndex)) }
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }
    val moveUp = stringResource(R.string.action_move_earlier)
    val moveDown = stringResource(R.string.action_move_later)

    fun move(channel: Channel, step: Int) {
        val index = ordered.indexOfFirst { it.id == channel.id }
        val target = index + step
        if (index < 0 || target !in ordered.indices) return
        val updated = ordered.toMutableList().apply { add(target, removeAt(index)) }
        ordered = updated
        viewModel.applyOrder(updated.map { it.id })
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            TopAppBar(
                title = { Text(stringResource(R.string.nav_channels)) },
                actions = {
                    if (discovering) {
                        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.5.dp)
                        }
                    } else {
                        IconButton(onClick = { viewModel.runDiscovery(announce = true) }) {
                            Icon(AppIcons.Refresh, contentDescription = stringResource(R.string.action_find_knesset))
                        }
                    }
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(AppIcons.MoreVert, contentDescription = stringResource(R.string.action_more))
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.action_reset_channels)) },
                                onClick = {
                                    menu = false
                                    confirmReset = true
                                },
                                leadingIcon = { Icon(AppIcons.Restore, contentDescription = null) },
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
            Text(
                stringResource(R.string.channels_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp),
            )
            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(ordered, key = { it.id }) { channel ->
                    val index = ordered.indexOfFirst { it.id == channel.id }
                    ReorderableItem(reorderState, key = channel.id) { isDragging ->
                        val elevation by animateDpAsState(if (isDragging) 6.dp else 0.dp, label = "drag-elevation")
                        Surface(
                            shape = groupItemShape(index, ordered.size),
                            color = MaterialTheme.colorScheme.surfaceContainer,
                            shadowElevation = elevation,
                            modifier = Modifier.padding(bottom = 2.dp),
                        ) {
                            ChannelRow(
                                channel = channel,
                                status = channelStatus(channel, availability),
                                onToggle = { enabled -> viewModel.setEnabled(channel.id, enabled) },
                                onEdit = { editing = channel.id },
                                handle = Modifier
                                    .draggableHandle(
                                        onDragStarted = { haptics.performHapticFeedback(HapticFeedbackType.LongPress) },
                                        onDragStopped = { viewModel.applyOrder(ordered.map { it.id }) },
                                    )
                                    .semantics {
                                        customActions = listOf(
                                            CustomAccessibilityAction(moveUp) {
                                                move(channel, -1)
                                                true
                                            },
                                            CustomAccessibilityAction(moveDown) {
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
        ExtendedFloatingActionButton(
            onClick = { adding = true },
            icon = { Icon(AppIcons.Add, contentDescription = null) },
            text = { Text(stringResource(R.string.action_add_channel)) },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
        )
    }

    val editingChannel = editing?.let { id -> state.channels.firstOrNull { it.id == id } }
    if (adding || editingChannel != null) {
        ChannelEditor(
            channel = editingChannel,
            onTest = viewModel::testStream,
            onSave = { draft, meter ->
                viewModel.saveChannel(editingChannel?.id, draft)
                if (editingChannel != null && meter != editingChannel.meter) viewModel.toggleMeter(editingChannel.id)
                adding = false
                editing = null
            },
            onDelete = editingChannel?.let { channel ->
                {
                    viewModel.removeChannel(channel.id)
                    editing = null
                }
            },
            onDismiss = {
                adding = false
                editing = null
            },
        )
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text(stringResource(R.string.reset_channels_title)) },
            text = { Text(stringResource(R.string.reset_channels_body)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmReset = false
                        viewModel.resetChannels()
                    },
                ) { Text(stringResource(R.string.action_reset)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmReset = false }) { Text(stringResource(R.string.action_cancel)) }
            },
        )
    }
}

@Composable
private fun ChannelRow(
    channel: Channel,
    status: ChannelStatus,
    onToggle: (Boolean) -> Unit,
    onEdit: () -> Unit,
    handle: Modifier,
) {
    val statusText = stringResource(statusLabel(status))
    val details = listOf(channel.now.ifEmpty { channel.description }, statusText).filter { it.isNotEmpty() }.joinToString(" · ")
    ListItem(
        modifier = Modifier.clickable(onClickLabel = stringResource(R.string.action_edit), onClick = onEdit),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    AppIcons.DragIndicator,
                    contentDescription = stringResource(R.string.action_drag),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = handle.padding(end = 8.dp),
                )
                ChannelBadge(channel, size = 40.dp)
            }
        },
        headlineContent = { Text(channel.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(
                details,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = if (status == ChannelStatus.LIVE) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        trailingContent = { Switch(checked = channel.enabled, onCheckedChange = onToggle) },
    )
}

fun statusLabel(status: ChannelStatus): Int = when (status) {
    ChannelStatus.HIDDEN -> R.string.status_hidden
    ChannelStatus.UNLISTED -> R.string.status_unlisted
    ChannelStatus.CHECKING -> R.string.status_checking
    ChannelStatus.LIVE -> R.string.status_live
    ChannelStatus.OFF_AIR -> R.string.status_off_air
    ChannelStatus.UNREACHABLE -> R.string.status_unreachable
    ChannelStatus.WEB -> R.string.status_web
}
