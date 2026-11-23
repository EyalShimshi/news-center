package io.github.eyalshimshi.newscenter.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import io.github.eyalshimshi.newscenter.data.AppSettings
import io.github.eyalshimshi.newscenter.data.ThemeMode

@Composable
fun isDarkTheme(settings: AppSettings): Boolean = when (settings.themeMode) {
    ThemeMode.SYSTEM -> isSystemInDarkTheme()
    ThemeMode.LIGHT -> false
    ThemeMode.DARK -> true
}

/** Accent colors offered in Settings. The first is News Center's blue, from its icon (the default). */
val ACCENT_PRESETS: List<Int> = listOf(
    0xFF4B5FD6.toInt(),
    0xFF8A5CF6.toInt(),
    0xFF006A6A.toInt(),
    0xFF386A20.toInt(),
    0xFF8B5000.toInt(),
    0xFFC0392B.toInt(),
    0xFFB4236C.toInt(),
    0xFF0061A4.toInt(),
)

/** Level meter colors, the same green-to-red as the desktop app's meters. */
object MeterColors {
    val Low = Color(0xFF3DDC84)
    val Mid = Color(0xFFFFCF33)
    val High = Color(0xFFFF4D4D)
}

/**
 * Wallpaper colors when dynamic color is on; otherwise a scheme generated from the chosen accent.
 * Pure black keeps backgrounds black on OLED screens while accents stay colored.
 */
@Composable
fun NewsCenterTheme(settings: AppSettings, content: @Composable () -> Unit) {
    val dark = isDarkTheme(settings)
    val context = LocalContext.current
    val accent = settings.accentColor ?: ACCENT_PRESETS.first()
    val base = when {
        settings.dynamicColor && dark -> dynamicDarkColorScheme(context)
        settings.dynamicColor -> dynamicLightColorScheme(context)
        else -> remember(accent, dark) { SeedScheme.colorScheme(Color(accent), dark) }
    }
    val scheme = if (dark && settings.pureBlack) base.withPureBlack() else base
    MaterialTheme(colorScheme = scheme, content = content)
}

fun ColorScheme.withPureBlack(): ColorScheme = copy(
    background = Color.Black,
    surface = Color.Black,
    surfaceDim = Color.Black,
    surfaceContainerLowest = Color.Black,
    surfaceContainerLow = Color(0xFF0A0A0C),
    surfaceContainer = Color(0xFF111114),
    surfaceContainerHigh = Color(0xFF18181B),
    surfaceContainerHighest = Color(0xFF1F1F23),
)
