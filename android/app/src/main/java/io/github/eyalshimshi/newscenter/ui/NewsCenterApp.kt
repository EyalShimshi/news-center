package io.github.eyalshimshi.newscenter.ui

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import io.github.eyalshimshi.newscenter.NewsCenterApplication
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.data.AppSettings
import io.github.eyalshimshi.newscenter.ui.channels.ChannelsScreen
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import io.github.eyalshimshi.newscenter.ui.components.CrashDialog
import io.github.eyalshimshi.newscenter.ui.knesset.KnessetScreen
import io.github.eyalshimshi.newscenter.ui.knesset.KnessetWeb
import io.github.eyalshimshi.newscenter.ui.knesset.RecordingPlayer
import io.github.eyalshimshi.newscenter.ui.news.NewsScreen
import io.github.eyalshimshi.newscenter.ui.news.NewsSourcesScreen
import io.github.eyalshimshi.newscenter.ui.settings.SettingsScreen
import io.github.eyalshimshi.newscenter.ui.watch.FullscreenPlayer
import io.github.eyalshimshi.newscenter.ui.watch.PipPlayer
import io.github.eyalshimshi.newscenter.ui.watch.WatchScreen
import io.github.eyalshimshi.newscenter.ui.watch.soundOf
import kotlinx.coroutines.launch

private class TopLevelDestination(
    val route: Any,
    val matches: (NavDestination) -> Boolean,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
    @StringRes val label: Int,
)

private val TOP_LEVEL = listOf(
    TopLevelDestination(WatchRoute, { it.hasRoute(WatchRoute::class) }, AppIcons.LiveTvOutlined, AppIcons.LiveTv, R.string.nav_watch),
    TopLevelDestination(ChannelsRoute, { it.hasRoute(ChannelsRoute::class) }, AppIcons.TuneOutlined, AppIcons.Tune, R.string.nav_channels),
    TopLevelDestination(NewsRoute, { it.hasRoute(NewsRoute::class) }, AppIcons.NewspaperOutlined, AppIcons.Newspaper, R.string.nav_news),
    TopLevelDestination(KnessetRoute, { it.hasRoute(KnessetRoute::class) }, AppIcons.AccountBalanceOutlined, AppIcons.AccountBalance, R.string.nav_knesset),
)

@Composable
fun NewsCenterApp(viewModel: NewsCenterViewModel, settings: AppSettings, inPictureInPicture: Boolean) {
    val watch by viewModel.watch.collectAsStateWithLifecycle()
    val volume by viewModel.masterVolume.collectAsStateWithLifecycle()
    val crashReport by viewModel.crashReport.collectAsStateWithLifecycle()
    val recording by viewModel.recording.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    val container = (context.applicationContext as NewsCenterApplication).container

    // The Knesset page lives as long as this screen, so switching tabs keeps its place.
    val knessetWeb = remember { KnessetWeb(context, container.http) }
    DisposableEffect(knessetWeb) { onDispose { knessetWeb.destroy() } }

    // The screen stays on while channels are on screen.
    val view = LocalView.current
    val keepScreenOn = settings.keepScreenOn && watch.shown.isNotEmpty()
    DisposableEffect(keepScreenOn) {
        view.keepScreenOn = keepScreenOn
        onDispose { view.keepScreenOn = false }
    }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event -> launch { showEvent(context, snackbar, viewModel, event) } }
    }

    val fullscreen = watch.fullscreen
    if (inPictureInPicture) {
        PipPlayer(fullscreen ?: watch.spotlight, viewModel.pool)
    } else {
        Box(Modifier.fillMaxSize()) {
            // A web page can't be in two places, so the grid steps aside while it fills the screen.
            if (fullscreen == null || fullscreen.isStream) {
                MainScaffold(viewModel, settings, navController, snackbar, knessetWeb, playing = watch.audible.isNotEmpty())
            }
            if (fullscreen != null) {
                FullscreenPlayer(
                    channel = fullscreen,
                    pool = viewModel.pool,
                    sound = soundOf(watch, fullscreen.id, volume),
                    onToggleMute = { viewModel.toggleMute(fullscreen.id) },
                    onToggleSolo = { viewModel.toggleSolo(fullscreen.id) },
                    onPrevious = { viewModel.fullscreenStep(-1) },
                    onNext = { viewModel.fullscreenStep(1) },
                    onExit = viewModel::closeFullscreen,
                )
            }
            recording?.let { current ->
                RecordingPlayer(
                    recording = current,
                    httpClient = container.httpClient,
                    userAgent = container.userAgent,
                    onClose = viewModel::closeRecording,
                )
            }
        }
    }

    crashReport?.let { report -> CrashDialog(report = report, onDismiss = viewModel::dismissCrashReport) }
}

private suspend fun showEvent(context: Context, snackbar: SnackbarHostState, viewModel: NewsCenterViewModel, event: UiEvent) {
    when (event) {
        is UiEvent.ChannelRemoved -> {
            val result = snackbar.showSnackbar(
                message = context.getString(R.string.channel_removed, event.removed.channel.name),
                actionLabel = context.getString(R.string.action_undo),
                duration = SnackbarDuration.Long,
            )
            if (result == SnackbarResult.ActionPerformed) viewModel.undoRemoveChannel(event.removed)
        }
        is UiEvent.SourceRemoved -> {
            val result = snackbar.showSnackbar(
                message = context.getString(R.string.source_removed, event.removed.source.name),
                actionLabel = context.getString(R.string.action_undo),
                duration = SnackbarDuration.Long,
            )
            if (result == SnackbarResult.ActionPerformed) viewModel.news.restore(event.removed)
        }
        is UiEvent.NewKnesset -> snackbar.showSnackbar(
            if (event.names.size == 1) {
                context.getString(R.string.event_new_knesset, event.names.first())
            } else {
                context.resources.getQuantityString(R.plurals.event_new_knesset_many, event.names.size, event.names.size)
            },
        )
        is UiEvent.WentLive -> snackbar.showSnackbar(context.getString(R.string.event_went_live, event.name))
        is UiEvent.Refreshed -> snackbar.showSnackbar(
            buildString {
                append(context.resources.getQuantityString(R.plurals.event_refreshed, event.onScreen, event.onScreen))
                if (event.offAir > 0) append(context.resources.getQuantityString(R.plurals.event_refreshed_off_air, event.offAir, event.offAir))
                if (event.added > 0) append(context.resources.getQuantityString(R.plurals.event_refreshed_new, event.added, event.added))
            },
        )
        is UiEvent.DiscoveryFailed -> snackbar.showSnackbar(context.getString(R.string.event_discovery_failed))
        is UiEvent.Message -> snackbar.showSnackbar(event.text)
        UiEvent.ChannelsReset -> snackbar.showSnackbar(context.getString(R.string.event_channels_reset))
        UiEvent.SourcesReset -> snackbar.showSnackbar(context.getString(R.string.event_sources_reset))
        UiEvent.SoundStopped -> snackbar.showSnackbar(context.getString(R.string.event_sound_stopped))
    }
}

@Composable
private fun MainScaffold(
    viewModel: NewsCenterViewModel,
    settings: AppSettings,
    navController: NavHostController,
    snackbar: SnackbarHostState,
    knessetWeb: KnessetWeb,
    playing: Boolean,
) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val destination = backStackEntry?.destination
    val currentTopLevel = TOP_LEVEL.firstOrNull { top -> destination?.hierarchy?.any(top.matches) == true }
    val wide = LocalConfiguration.current.screenWidthDp >= WIDE_SCREEN_DP
    val showRail = wide && currentTopLevel != null
    val showBar = !wide && currentTopLevel != null

    Row(Modifier.fillMaxSize()) {
        if (showRail) {
            NavigationRail {
                TOP_LEVEL.forEach { top ->
                    val selected = top == currentTopLevel
                    NavigationRailItem(
                        selected = selected,
                        onClick = { navController.navigateTopLevel(top) },
                        icon = { DestinationIcon(top, selected, playing) },
                        label = { Text(stringResource(top.label)) },
                    )
                }
            }
        }
        Scaffold(
            modifier = Modifier.weight(1f),
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                if (showBar) {
                    NavigationBar {
                        TOP_LEVEL.forEach { top ->
                            val selected = top == currentTopLevel
                            NavigationBarItem(
                                selected = selected,
                                onClick = { navController.navigateTopLevel(top) },
                                icon = { DestinationIcon(top, selected, playing) },
                                label = { Text(stringResource(top.label)) },
                            )
                        }
                    }
                }
            },
            contentWindowInsets = if (showRail) {
                WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.End + WindowInsetsSides.Bottom)
            } else {
                WindowInsets.safeDrawing
            },
        ) { padding ->
            NavHost(
                navController = navController,
                startDestination = WatchRoute,
                modifier = Modifier
                    .padding(padding)
                    .consumeWindowInsets(padding),
            ) {
                composable<WatchRoute> {
                    WatchScreen(
                        viewModel = viewModel,
                        settings = settings,
                        onOpenSettings = { navController.navigate(SettingsRoute) },
                        onOpenChannels = { navController.navigateTopLevel(TOP_LEVEL[1]) },
                    )
                }
                composable<ChannelsRoute> {
                    ChannelsScreen(viewModel = viewModel, onOpenSettings = { navController.navigate(SettingsRoute) })
                }
                composable<NewsRoute> {
                    NewsScreen(viewModel = viewModel, onOpenSources = { navController.navigate(NewsSourcesRoute) })
                }
                composable<NewsSourcesRoute> {
                    NewsSourcesScreen(viewModel = viewModel, onBack = { navController.popBackStack() })
                }
                composable<KnessetRoute> {
                    KnessetScreen(
                        web = knessetWeb,
                        viewModel = viewModel,
                        onWatch = { navController.navigateTopLevel(TOP_LEVEL[0]) },
                    )
                }
                composable<SettingsRoute> {
                    SettingsScreen(viewModel = viewModel, settings = settings, onBack = { navController.popBackStack() })
                }
            }
        }
    }
}

/** A tab's icon; Watch shows a dot while a channel can be heard, even from another tab. */
@Composable
private fun DestinationIcon(top: TopLevelDestination, selected: Boolean, playing: Boolean) {
    val icon = if (selected) top.selectedIcon else top.icon
    if (top.route == WatchRoute && playing) {
        BadgedBox(badge = { Badge() }) { Icon(icon, contentDescription = null) }
    } else {
        Icon(icon, contentDescription = null)
    }
}

private fun NavHostController.navigateTopLevel(destination: TopLevelDestination) {
    navigate(destination.route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

private const val WIDE_SCREEN_DP = 600
