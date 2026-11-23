package io.github.eyalshimshi.newscenter.data

import android.content.SharedPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged

enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** How big the Watch screen's tiles are: Large fits one per row on a phone held upright. */
enum class TileSize(val minWidthDp: Int) { LARGE(320), MEDIUM(160), SMALL(110) }

data class AppSettings(
    // Video looks best on dark, so News Center starts dark (like the desktop app).
    val themeMode: ThemeMode = ThemeMode.DARK,
    val pureBlack: Boolean = false,
    val dynamicColor: Boolean = false,
    /** Seed of the app's colors when [dynamicColor] is off; null is News Center's blue. */
    val accentColor: Int? = null,
    val tileSize: TileSize = TileSize.MEDIUM,
    /** Grid tiles play at most 480p; the spotlight and fullscreen channel play at full quality. */
    val gridDataSaver: Boolean = true,
    val keepScreenOn: Boolean = true,
    /** Leaving the app while a channel is in the spotlight keeps it playing in a small window. */
    val pictureInPicture: Boolean = true,
    /** Shows the level meters on the tiles (each channel can also hide its own). */
    val showMeters: Boolean = true,
)

class SettingsRepository(private val prefs: SharedPreferences) {

    private object Keys {
        const val THEME = "theme_mode"
        const val PURE_BLACK = "pure_black"
        const val DYNAMIC_COLOR = "dynamic_color"
        const val ACCENT_COLOR = "accent_color"
        const val TILE_SIZE = "tile_size"
        const val GRID_DATA_SAVER = "grid_data_saver"
        const val KEEP_SCREEN_ON = "keep_screen_on"
        const val PICTURE_IN_PICTURE = "picture_in_picture"
        const val SHOW_METERS = "show_meters"
        const val MASTER_VOLUME = "master_volume"
    }

    val settings: Flow<AppSettings> = prefs
        .observe { p ->
            AppSettings(
                themeMode = p.getString(Keys.THEME, null).toEnum(ThemeMode.DARK),
                pureBlack = p.getBoolean(Keys.PURE_BLACK, false),
                dynamicColor = p.getBoolean(Keys.DYNAMIC_COLOR, false),
                accentColor = if (p.contains(Keys.ACCENT_COLOR)) p.getInt(Keys.ACCENT_COLOR, 0) else null,
                tileSize = p.getString(Keys.TILE_SIZE, null).toEnum(TileSize.MEDIUM),
                gridDataSaver = p.getBoolean(Keys.GRID_DATA_SAVER, true),
                keepScreenOn = p.getBoolean(Keys.KEEP_SCREEN_ON, true),
                pictureInPicture = p.getBoolean(Keys.PICTURE_IN_PICTURE, true),
                showMeters = p.getBoolean(Keys.SHOW_METERS, true),
            )
        }
        .distinctUntilChanged()

    fun setThemeMode(value: ThemeMode) = putString(Keys.THEME, value.name)

    fun setPureBlack(value: Boolean) = putBoolean(Keys.PURE_BLACK, value)

    fun setDynamicColor(value: Boolean) = putBoolean(Keys.DYNAMIC_COLOR, value)

    /** Picks the app's accent color; this turns wallpaper colors off. */
    fun setAccentColor(value: Int) {
        prefs.edit().putInt(Keys.ACCENT_COLOR, value).putBoolean(Keys.DYNAMIC_COLOR, false).apply()
    }

    fun setTileSize(value: TileSize) = putString(Keys.TILE_SIZE, value.name)

    fun setGridDataSaver(value: Boolean) = putBoolean(Keys.GRID_DATA_SAVER, value)

    fun setKeepScreenOn(value: Boolean) = putBoolean(Keys.KEEP_SCREEN_ON, value)

    fun setPictureInPicture(value: Boolean) = putBoolean(Keys.PICTURE_IN_PICTURE, value)

    fun setShowMeters(value: Boolean) = putBoolean(Keys.SHOW_METERS, value)

    /** The master volume, 0–2 (up to 200%). Mute and solo are never saved: every start is muted. */
    fun masterVolume(): Float = prefs.getFloat(Keys.MASTER_VOLUME, 1f).coerceIn(0f, MAX_VOLUME)

    fun setMasterVolume(value: Float) {
        prefs.edit().putFloat(Keys.MASTER_VOLUME, value.coerceIn(0f, MAX_VOLUME)).apply()
    }

    private fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    private fun putBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).apply()
    }

    companion object {
        const val MAX_VOLUME = 2f
    }
}

private inline fun <reified T : Enum<T>> String?.toEnum(default: T): T =
    this?.let { name -> enumValues<T>().firstOrNull { it.name == name } } ?: default
