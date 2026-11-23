package io.github.eyalshimshi.newscenter.playback

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager

/**
 * One audio-focus request for the whole app (the players don't ask for it themselves, or they
 * would take it from each other). Losing focus, to a call or another app, mutes every channel.
 */
class AudioFocus(context: Context, private val onLost: () -> Unit) {

    private val audioManager: AudioManager? = context.getSystemService(AudioManager::class.java)
    private var held = false

    private val request: AudioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build(),
        )
        .setOnAudioFocusChangeListener { change ->
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                held = false
                onLost()
            }
        }
        .build()

    /** Holds focus while any channel can be heard. */
    fun update(wantsSound: Boolean) {
        val manager = audioManager ?: return
        if (wantsSound && !held) {
            held = manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            if (!held) onLost()
        } else if (!wantsSound && held) {
            manager.abandonAudioFocusRequest(request)
            held = false
        }
    }
}
