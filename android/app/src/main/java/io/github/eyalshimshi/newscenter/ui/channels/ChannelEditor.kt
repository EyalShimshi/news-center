package io.github.eyalshimshi.newscenter.ui.channels

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.data.ChannelCatalog
import io.github.eyalshimshi.newscenter.data.StreamCheck
import io.github.eyalshimshi.newscenter.data.isHttpUrl
import io.github.eyalshimshi.newscenter.model.Availability
import io.github.eyalshimshi.newscenter.model.Channel
import io.github.eyalshimshi.newscenter.ui.ChannelDraft
import kotlinx.coroutines.launch

/** Adds a channel ([channel] null) or edits one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelEditor(
    channel: Channel?,
    onTest: suspend (String) -> StreamCheck.Result,
    onSave: (ChannelDraft, Boolean) -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    var kind by rememberSaveable { mutableStateOf(channel?.kind ?: Channel.KIND_STREAM) }
    var name by rememberSaveable { mutableStateOf(channel?.name.orEmpty()) }
    var address by rememberSaveable { mutableStateOf(channel?.url.orEmpty()) }
    var description by rememberSaveable { mutableStateOf(channel?.description.orEmpty()) }
    var meter by rememberSaveable { mutableStateOf(channel?.meter ?: true) }
    var nameError by remember { mutableStateOf(false) }
    var addressError by remember { mutableStateOf(false) }
    var testing by remember { mutableStateOf(false) }
    var testResult by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val isStream = kind != Channel.KIND_PAGE

    fun save() {
        val cleanName = name.trim()
        nameError = cleanName.isEmpty()
        var url: String? = null
        var poster = channel?.poster.orEmpty()
        if (isStream) {
            val parsed = ChannelCatalog.parseStreamInput(address)
            url = parsed?.url
            if (parsed != null && parsed.poster.isNotEmpty()) poster = parsed.poster
        } else {
            url = address.trim().takeIf { isHttpUrl(it) }
        }
        addressError = url == null
        if (nameError || url == null) return
        onSave(ChannelDraft(cleanName, description.trim(), kind, url, poster), meter)
    }

    fun test() {
        val parsed = ChannelCatalog.parseStreamInput(address)
        if (parsed == null) {
            addressError = true
            return
        }
        if (parsed.extracted) address = parsed.url
        testing = true
        testResult = null
        scope.launch {
            val result = onTest(parsed.url)
            testResult = when (result.availability) {
                Availability.LIVE -> result.maxHeight?.let { context.getString(R.string.test_live_quality, it) }
                    ?: context.getString(R.string.test_live)
                Availability.OFFLINE -> context.getString(R.string.test_off_air, result.detail)
                else -> context.getString(R.string.test_failed)
            }
            testing = false
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (channel == null) R.string.add_channel_title else R.string.edit_channel_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(
                        selected = isStream,
                        onClick = {
                            kind = Channel.KIND_STREAM
                            testResult = null
                        },
                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                    ) { Text(stringResource(R.string.kind_stream)) }
                    SegmentedButton(
                        selected = !isStream,
                        onClick = {
                            kind = Channel.KIND_PAGE
                            testResult = null
                        },
                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                    ) { Text(stringResource(R.string.kind_page)) }
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = {
                        name = it
                        nameError = false
                    },
                    label = { Text(stringResource(R.string.field_name)) },
                    singleLine = true,
                    isError = nameError,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = address,
                    onValueChange = {
                        address = it
                        addressError = false
                        testResult = null
                    },
                    label = { Text(stringResource(if (isStream) R.string.field_stream_address else R.string.field_page_address)) },
                    supportingText = {
                        Text(
                            stringResource(
                                when {
                                    addressError -> R.string.address_invalid
                                    isStream -> R.string.field_stream_hint
                                    else -> R.string.field_page_hint
                                },
                            ),
                        )
                    },
                    isError = addressError,
                    maxLines = 4,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(4.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text(stringResource(R.string.field_description)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (isStream) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { test() }, enabled = !testing) { Text(stringResource(R.string.action_test_stream)) }
                        if (testing) {
                            Spacer(Modifier.width(8.dp))
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        }
                    }
                    testResult?.let { message ->
                        Text(message, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (channel != null) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .toggleable(value = meter, onValueChange = { meter = it }, role = Role.Checkbox),
                        ) {
                            Checkbox(checked = meter, onCheckedChange = null)
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.field_meter))
                        }
                    }
                } else {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.page_channel_note),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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
