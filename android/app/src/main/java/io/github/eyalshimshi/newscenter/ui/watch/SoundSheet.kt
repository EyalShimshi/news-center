package io.github.eyalshimshi.newscenter.ui.watch

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.ui.NewsCenterViewModel
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import kotlin.math.roundToInt

/** The master volume (up to 200%), mute all and clear solos — the desktop app's top-bar mixer. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SoundSheet(
    volume: Float,
    anyMuted: Boolean,
    soloActive: Boolean,
    onVolumeChange: (Float) -> Unit,
    onVolumeDone: () -> Unit,
    onToggleMuteAll: () -> Unit,
    onClearSolo: () -> Unit,
    onDismiss: () -> Unit,
) {
    val percent = (volume * 100).roundToInt()
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        ) {
            Text(stringResource(R.string.sound_title), style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (volume == 0f) AppIcons.VolumeOff else AppIcons.VolumeUp, contentDescription = null)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.sound_volume), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Text(
                    text = stringResource(R.string.percent_value, percent),
                    style = MaterialTheme.typography.titleMedium,
                    color = if (percent > 100) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurface,
                )
            }
            val volumeLabel = stringResource(R.string.percent_value, percent)
            Slider(
                value = volume,
                onValueChange = onVolumeChange,
                valueRange = 0f..NewsCenterViewModel.MAX_VOLUME,
                onValueChangeFinished = onVolumeDone,
                modifier = Modifier.semantics { stateDescription = volumeLabel },
            )
            Text(
                stringResource(R.string.sound_boost_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onToggleMuteAll) {
                    Text(stringResource(if (anyMuted) R.string.action_unmute_all else R.string.action_mute_all))
                }
                OutlinedButton(onClick = onClearSolo, enabled = soloActive) {
                    Text(stringResource(R.string.action_clear_solos))
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                stringResource(R.string.sound_rules),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
