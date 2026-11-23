package io.github.eyalshimshi.newscenter.ui.news

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.data.FeedInspection
import io.github.eyalshimshi.newscenter.data.FeedProblem
import io.github.eyalshimshi.newscenter.data.hostName
import io.github.eyalshimshi.newscenter.data.isHttpUrl
import io.github.eyalshimshi.newscenter.model.NewsSource
import io.github.eyalshimshi.newscenter.ui.NewsCenterViewModel
import io.github.eyalshimshi.newscenter.ui.NewsController
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import io.github.eyalshimshi.newscenter.ui.components.groupItemShape
import kotlinx.coroutines.launch

/** Every news source, grouped by language: switch them on and off, add any RSS or Atom feed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewsSourcesScreen(viewModel: NewsCenterViewModel, onBack: () -> Unit) {
    val news = viewModel.news
    val state by news.state.collectAsStateWithLifecycle()
    val runtime by news.runtime.collectAsStateWithLifecycle()
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var adding by rememberSaveable { mutableStateOf(false) }
    var confirmReset by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val groups = listOf(
        "he" to stringResource(R.string.sources_hebrew),
        "en" to stringResource(R.string.sources_english),
        "" to stringResource(R.string.sources_yours),
    )

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            TopAppBar(
                title = { Text(stringResource(R.string.news_sources)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(AppIcons.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(AppIcons.MoreVert, contentDescription = stringResource(R.string.action_more))
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.action_reset_sources)) },
                                onClick = {
                                    menu = false
                                    confirmReset = true
                                },
                                leadingIcon = { Icon(AppIcons.Restore, contentDescription = null) },
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
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                groups.forEach { (lang, title) ->
                    val list = state.sources.filter { (if (it.builtin) it.lang else "") == lang }
                    if (list.isEmpty()) return@forEach
                    item(key = "header:$lang") {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 8.dp),
                        )
                    }
                    itemsIndexed(list, key = { _, source -> source.id }) { index, source ->
                        Surface(
                            shape = groupItemShape(index, list.size),
                            color = MaterialTheme.colorScheme.surfaceContainer,
                            modifier = Modifier.padding(bottom = 2.dp),
                        ) {
                            SourceRow(
                                source = source,
                                runtime = runtime[source.id],
                                onToggle = { enabled -> news.setEnabled(source.id, enabled) },
                                onEdit = { editing = source.id },
                            )
                        }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { adding = true },
            icon = { Icon(AppIcons.Add, contentDescription = null) },
            text = { Text(stringResource(R.string.action_add_source)) },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
        )
    }

    val editingSource = editing?.let { id -> state.sources.firstOrNull { it.id == id } }
    if (adding || editingSource != null) {
        SourceEditor(
            source = editingSource,
            onInspect = news::inspect,
            onSave = { name, url ->
                news.save(editingSource?.id, name, url)
                adding = false
                editing = null
            },
            onDelete = editingSource?.let { source ->
                {
                    viewModel.removeSource(source.id)
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
            title = { Text(stringResource(R.string.reset_sources_title)) },
            text = { Text(stringResource(R.string.reset_sources_body)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmReset = false
                        viewModel.resetSources()
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
private fun SourceRow(
    source: NewsSource,
    runtime: NewsController.SourceRuntime?,
    onToggle: (Boolean) -> Unit,
    onEdit: () -> Unit,
) {
    val status = when {
        !source.enabled -> hostName(source.url)
        runtime == null || (runtime.loading && runtime.status == NewsController.Status.IDLE) -> stringResource(R.string.status_loading)
        runtime.status == NewsController.Status.OK -> pluralStringResource(R.plurals.headline_count, runtime.items.size, runtime.items.size)
        runtime.problem != null -> problemText(runtime.problem, runtime.detail)
        else -> stringResource(R.string.status_loading)
    }
    val failing = source.enabled && runtime != null &&
        (runtime.status == NewsController.Status.ERROR || runtime.status == NewsController.Status.BLOCKED)
    ListItem(
        modifier = Modifier.clickable(onClickLabel = stringResource(R.string.action_edit), onClick = onEdit),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = { SourceDot(source, size = 14.dp) },
        headlineContent = { Text(source.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(
                status,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = if (failing) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        trailingContent = { Switch(checked = source.enabled, onCheckedChange = onToggle) },
    )
}

@Composable
fun problemText(problem: FeedProblem, detail: String): String = when (problem) {
    FeedProblem.UNREACHABLE -> stringResource(R.string.feed_unreachable, detail)
    FeedProblem.BLOCKED -> stringResource(R.string.feed_blocked)
    FeedProblem.HTTP_ERROR -> stringResource(R.string.feed_http_error, detail)
    FeedProblem.WEB_PAGE -> stringResource(R.string.feed_web_page)
    FeedProblem.NOT_A_FEED -> stringResource(R.string.feed_not_a_feed)
    FeedProblem.PAGE_WITHOUT_FEED -> stringResource(R.string.feed_page_without_feed)
}

/** Adds a news source ([source] null) or edits one. "Test feed" checks it and fills in its name. */
@Composable
private fun SourceEditor(
    source: NewsSource?,
    onInspect: suspend (String) -> FeedInspection,
    onSave: (String, String) -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    var address by rememberSaveable { mutableStateOf(source?.url.orEmpty()) }
    var name by rememberSaveable { mutableStateOf(source?.name.orEmpty()) }
    var addressError by remember { mutableStateOf(false) }
    var nameError by remember { mutableStateOf(false) }
    var testing by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<FeedInspection?>(null) }
    val scope = rememberCoroutineScope()

    fun test() {
        val url = address.trim()
        if (!isHttpUrl(url)) {
            addressError = true
            return
        }
        testing = true
        result = null
        scope.launch {
            val inspection = onInspect(url)
            if (inspection is FeedInspection.Found) {
                address = inspection.url
                if (name.isBlank()) name = inspection.feed.title.ifBlank { hostName(inspection.url) }
            }
            result = inspection
            testing = false
        }
    }

    fun save() {
        val url = address.trim()
        addressError = !isHttpUrl(url)
        nameError = name.isBlank()
        if (addressError || nameError) return
        onSave(name.trim(), url)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (source == null) R.string.add_source_title else R.string.edit_source_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(
                    value = address,
                    onValueChange = {
                        address = it
                        addressError = false
                        result = null
                    },
                    label = { Text(stringResource(R.string.field_feed_address)) },
                    supportingText = {
                        Text(stringResource(if (addressError) R.string.address_invalid else R.string.field_feed_hint))
                    },
                    isError = addressError,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(4.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = {
                        name = it
                        nameError = false
                    },
                    label = { Text(stringResource(R.string.field_name)) },
                    isError = nameError,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { test() }, enabled = !testing) { Text(stringResource(R.string.action_test_feed)) }
                    if (testing) {
                        Spacer(Modifier.width(8.dp))
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    }
                }
                when (val inspection = result) {
                    is FeedInspection.Found -> Text(
                        if (inspection.discovered) {
                            pluralStringResource(R.plurals.feed_found_on_page, inspection.feed.items.size, inspection.feed.items.size)
                        } else {
                            pluralStringResource(R.plurals.feed_found, inspection.feed.items.size, inspection.feed.items.size)
                        },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    is FeedInspection.Problem -> Text(
                        problemText(inspection.problem, inspection.detail),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                    null -> Unit
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { save() }) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = {
            Row {
                if (onDelete != null) {
                    TextButton(onClick = onDelete) { Text(stringResource(R.string.action_remove)) }
                }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
            }
        },
    )
}
