package io.github.eyalshimshi.newscenter.ui.settings

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import io.github.eyalshimshi.newscenter.BuildConfig
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.data.AppSettings
import io.github.eyalshimshi.newscenter.data.PRIVACY_POLICY_URL
import io.github.eyalshimshi.newscenter.data.REPOSITORY_URL
import io.github.eyalshimshi.newscenter.data.ThemeMode
import io.github.eyalshimshi.newscenter.data.TileSize
import io.github.eyalshimshi.newscenter.ui.NewsCenterViewModel
import io.github.eyalshimshi.newscenter.ui.components.AppIcons
import io.github.eyalshimshi.newscenter.ui.components.ClickRow
import io.github.eyalshimshi.newscenter.ui.components.GroupCard
import io.github.eyalshimshi.newscenter.ui.components.RadioRow
import io.github.eyalshimshi.newscenter.ui.components.SettingsGroup
import io.github.eyalshimshi.newscenter.ui.components.SwitchRow
import io.github.eyalshimshi.newscenter.ui.openUrl
import io.github.eyalshimshi.newscenter.ui.reportProblemUrl
import io.github.eyalshimshi.newscenter.ui.theme.ACCENT_PRESETS
import io.github.eyalshimshi.newscenter.ui.watch.tileSizeLabel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(viewModel: NewsCenterViewModel, settings: AppSettings, onBack: () -> Unit) {
    val context = LocalContext.current
    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.settings_title)) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(AppIcons.ArrowBack, contentDescription = stringResource(R.string.action_back))
                }
            },
            windowInsets = WindowInsets(0, 0, 0, 0),
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = Color.Transparent,
                scrolledContainerColor = Color.Transparent,
            ),
        )
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            SettingsGroup(stringResource(R.string.settings_watching)) {
                GroupCard {
                    Column {
                        Text(
                            text = stringResource(R.string.tile_size),
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
                        )
                        TileSize.entries.forEach { size ->
                            RadioRow(
                                title = stringResource(tileSizeLabel(size)),
                                selected = settings.tileSize == size,
                                onSelect = { viewModel.setTileSize(size) },
                            )
                        }
                    }
                }
                SwitchRow(
                    title = stringResource(R.string.settings_data_saver),
                    summary = stringResource(R.string.settings_data_saver_summary),
                    checked = settings.gridDataSaver,
                    onChange = viewModel::setGridDataSaver,
                )
                SwitchRow(
                    title = stringResource(R.string.show_meters),
                    summary = stringResource(R.string.settings_meters_summary),
                    checked = settings.showMeters,
                    onChange = viewModel::setShowMeters,
                )
                SwitchRow(
                    title = stringResource(R.string.settings_pip),
                    summary = stringResource(R.string.settings_pip_summary),
                    checked = settings.pictureInPicture,
                    onChange = viewModel::setPictureInPicture,
                )
                SwitchRow(
                    title = stringResource(R.string.settings_keep_screen_on),
                    summary = stringResource(R.string.settings_keep_screen_on_summary),
                    checked = settings.keepScreenOn,
                    onChange = viewModel::setKeepScreenOn,
                )
            }

            SettingsGroup(stringResource(R.string.settings_colors)) {
                ThemeModeCard(selected = settings.themeMode, onSelect = viewModel::setThemeMode)
                SwitchRow(
                    title = stringResource(R.string.settings_dynamic_color),
                    summary = stringResource(R.string.settings_dynamic_color_summary),
                    checked = settings.dynamicColor,
                    onChange = viewModel::setDynamicColor,
                )
                AccentCard(
                    selected = if (settings.dynamicColor) null else settings.accentColor ?: ACCENT_PRESETS.first(),
                    onSelect = viewModel::setAccentColor,
                )
                SwitchRow(
                    title = stringResource(R.string.settings_pure_black),
                    summary = stringResource(R.string.settings_pure_black_summary),
                    checked = settings.pureBlack,
                    onChange = viewModel::setPureBlack,
                )
            }

            SettingsGroup(stringResource(R.string.settings_language)) {
                val currentTags = AppCompatDelegate.getApplicationLocales().toLanguageTags()
                val currentLanguage = when {
                    currentTags.startsWith("he") || currentTags.startsWith("iw") -> "he"
                    currentTags.startsWith("en") -> "en"
                    else -> ""
                }
                GroupCard {
                    Column {
                        LANGUAGES.forEach { (tag, label) ->
                            RadioRow(
                                title = stringResource(label),
                                selected = currentLanguage == tag,
                                onSelect = {
                                    AppCompatDelegate.setApplicationLocales(
                                        if (tag.isEmpty()) LocaleListCompat.getEmptyLocaleList() else LocaleListCompat.forLanguageTags(tag),
                                    )
                                },
                            )
                        }
                    }
                }
            }

            SettingsGroup(stringResource(R.string.settings_about)) {
                ClickRow(
                    title = stringResource(R.string.about_version, BuildConfig.VERSION_NAME),
                    summary = stringResource(R.string.about_license),
                    onClick = { openUrl(context, REPOSITORY_URL) },
                )
                ClickRow(
                    title = stringResource(R.string.about_updates),
                    summary = stringResource(R.string.about_updates_summary),
                    onClick = { openUrl(context, "$REPOSITORY_URL/releases") },
                )
                ClickRow(
                    title = stringResource(R.string.about_privacy),
                    summary = stringResource(R.string.about_privacy_summary),
                    onClick = { openUrl(context, PRIVACY_POLICY_URL) },
                )
                ClickRow(
                    title = stringResource(R.string.action_report),
                    summary = null,
                    onClick = { openUrl(context, reportProblemUrl()) },
                )
                GroupCard {
                    Text(
                        text = stringResource(R.string.about_disclaimer),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

private val LANGUAGES = listOf(
    "" to R.string.language_system,
    "he" to R.string.language_hebrew,
    "en" to R.string.language_english,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThemeModeCard(selected: ThemeMode, onSelect: (ThemeMode) -> Unit) {
    GroupCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(stringResource(R.string.settings_theme), style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(12.dp))
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                ThemeMode.entries.forEachIndexed { index, mode ->
                    SegmentedButton(
                        selected = selected == mode,
                        onClick = { onSelect(mode) },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = ThemeMode.entries.size),
                    ) {
                        Text(
                            stringResource(
                                when (mode) {
                                    ThemeMode.SYSTEM -> R.string.theme_system
                                    ThemeMode.LIGHT -> R.string.theme_light
                                    ThemeMode.DARK -> R.string.theme_dark
                                },
                            ),
                        )
                    }
                }
            }
        }
    }
}

/** Accent color swatches; [selected] is null while wallpaper colors are in use. */
@Composable
private fun AccentCard(selected: Int?, onSelect: (Int) -> Unit) {
    GroupCard {
        Column(modifier = Modifier.padding(vertical = 16.dp)) {
            Text(
                text = stringResource(R.string.settings_accent),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                ACCENT_PRESETS.forEachIndexed { index, color ->
                    AccentSwatch(
                        color = Color(color),
                        selected = selected == color,
                        label = stringResource(R.string.accent_option, index + 1),
                        onClick = { onSelect(color) },
                    )
                }
            }
        }
    }
}

@Composable
private fun AccentSwatch(color: Color, selected: Boolean, label: String, onClick: () -> Unit) {
    val ring = if (selected) {
        Modifier
            .border(width = 3.dp, color = MaterialTheme.colorScheme.onSurface, shape = CircleShape)
            .padding(6.dp)
    } else {
        Modifier
    }
    Box(
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .semantics { contentDescription = label }
            .then(ring)
            .clip(CircleShape)
            .background(color),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Icon(
                imageVector = AppIcons.Check,
                contentDescription = null,
                tint = if (color.luminance() > 0.5f) Color.Black else Color.White,
            )
        }
    }
}
