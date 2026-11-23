package io.github.eyalshimshi.newscenter.ui.news

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.data.NewsCatalog
import io.github.eyalshimshi.newscenter.model.NewsSource
import io.github.eyalshimshi.newscenter.ui.NewsCenterViewModel
import io.github.eyalshimshi.newscenter.ui.NewsController
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import io.github.eyalshimshi.newscenter.ui.openUrl
import io.github.eyalshimshi.newscenter.ui.watch.channelColor
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

/**
 * The latest headlines from the news sites you switched on, newest first, like the desktop app's
 * News panel. Headlines refresh every few minutes while this tab is open.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewsScreen(viewModel: NewsCenterViewModel, onOpenSources: () -> Unit) {
    val news = viewModel.news
    val state by news.state.collectAsStateWithLifecycle()
    val runtime by news.runtime.collectAsStateWithLifecycle()
    val headlines by news.headlines.collectAsStateWithLifecycle()
    val filter by news.filter.collectAsStateWithLifecycle()
    val now by news.clock.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val enabled = state.sources.filter { it.enabled }
    val loading = enabled.any { runtime[it.id]?.loading == true }
    var pulled by remember { mutableStateOf(false) }

    LaunchedEffect(news) {
        while (true) {
            news.loadDue()
            delay(TICK_MS)
        }
    }
    // A pull shows the indicator until the feeds it started have loaded (at least briefly).
    LaunchedEffect(pulled, loading) {
        if (pulled && !loading) {
            delay(PULL_MIN_MS)
            pulled = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.nav_news)) },
            actions = {
                IconButton(onClick = onOpenSources) {
                    Icon(AppIcons.RssFeed, contentDescription = stringResource(R.string.news_sources))
                }
                IconButton(onClick = { news.loadDue(force = true) }) {
                    Icon(AppIcons.Refresh, contentDescription = stringResource(R.string.action_refresh))
                }
            },
            windowInsets = WindowInsets(0, 0, 0, 0),
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = Color.Transparent,
                scrolledContainerColor = Color.Transparent,
            ),
        )
        if (enabled.isEmpty()) {
            NoSources(onOpenSources)
        } else {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item(key = "all") {
                    FilterChip(
                        selected = filter == null,
                        onClick = { news.filter.value = null },
                        label = { Text(stringResource(R.string.news_all)) },
                    )
                }
                items(enabled, key = { it.id }) { source ->
                    FilterChip(
                        selected = filter == source.id,
                        onClick = { news.filter.value = if (filter == source.id) null else source.id },
                        label = { Text(source.name) },
                        leadingIcon = { SourceDot(source) },
                    )
                }
            }
            val problems = enabled.count { source ->
                val status = runtime[source.id]?.status
                status == NewsController.Status.ERROR || status == NewsController.Status.BLOCKED
            }
            if (problems > 0) {
                Text(
                    pluralStringResource(R.plurals.news_problems, problems, problems),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onOpenSources)
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                )
            }
            PullToRefreshBox(
                isRefreshing = pulled,
                onRefresh = {
                    pulled = true
                    news.loadDue(force = true)
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    contentPadding = PaddingValues(bottom = 16.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    if (headlines.isEmpty()) {
                        item(key = "empty") {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(48.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (loading) {
                                    CircularProgressIndicator()
                                } else {
                                    Text(
                                        stringResource(R.string.news_empty),
                                        textAlign = TextAlign.Center,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                    items(headlines, key = { it.source.id + "\n" + it.headline.key }) { entry ->
                        HeadlineRow(entry, now, onClick = { openUrl(context, entry.headline.link) })
                        HorizontalDivider(
                            modifier = Modifier.padding(horizontal = 16.dp),
                            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NoSources(onOpenSources: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(AppIcons.Newspaper, contentDescription = null, modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.news_no_sources), style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        Spacer(Modifier.height(24.dp))
        Button(onClick = onOpenSources) { Text(stringResource(R.string.action_choose_sources)) }
    }
}

@Composable
private fun HeadlineRow(entry: NewsCatalog.Entry, now: Long, onClick: () -> Unit) {
    val item = entry.headline
    val fresh = now - item.time < NewsCatalog.FRESH_MS
    ListItem(
        modifier = Modifier.clickable(enabled = item.link.isNotEmpty(), onClick = onClick),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        overlineContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SourceDot(entry.source)
                Spacer(Modifier.width(6.dp))
                Text(
                    "${entry.source.name} · ${newsTime(item.time, now)}",
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (fresh) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        stringResource(R.string.news_new),
                        color = MaterialTheme.colorScheme.tertiary,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        },
        headlineContent = {
            Text(item.title, maxLines = 4, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
        },
    )
}

@Composable
fun SourceDot(source: NewsSource, size: androidx.compose.ui.unit.Dp = 10.dp) {
    Box(
        Modifier
            .size(size)
            .background(sourceColor(source), CircleShape),
    )
}

fun sourceColor(source: NewsSource): Color =
    runCatching { Color(android.graphics.Color.parseColor(source.color)) }.getOrNull() ?: channelColor(source.id)

/** "14:05 · 5 min", "14:05", "Yesterday 22:10" or "3 Jun 09:15", in the app's language. */
@Composable
private fun newsTime(time: Long, now: Long): String {
    val locale = LocalConfiguration.current.locales[0]
    val zone = ZoneId.systemDefault()
    val moment = Instant.ofEpochMilli(time).atZone(zone)
    val clock = moment.format(DateTimeFormatter.ofPattern("HH:mm", locale))
    val minutes = ((now - time) / 60_000L).toInt()
    val today = LocalDate.now(zone)
    return when {
        minutes < 1 -> stringResource(R.string.news_time_now, clock)
        minutes < 60 -> stringResource(R.string.news_time_minutes, clock, minutes)
        moment.toLocalDate() == today -> clock
        moment.toLocalDate() == today.minusDays(1) -> stringResource(R.string.news_time_yesterday, clock)
        else -> moment.format(DateTimeFormatter.ofPattern("d MMM HH:mm", locale))
    }
}

private const val TICK_MS = 30_000L
private const val PULL_MIN_MS = 600L
