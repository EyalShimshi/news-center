package io.github.eyalshimshi.newscenter.playback

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.tanh

/**
 * Sits in a channel's audio path: measures its level for the tile's meter (before any volume
 * change, so a muted channel still shows activity, as in the desktop app) and applies the boost
 * above 100%, with a soft limiter so boosted sound doesn't distort.
 */
@OptIn(UnstableApi::class)
class LevelMeterProcessor : BaseAudioProcessor() {

    /** Gain applied to the samples: 1 is unchanged, up to 4 (+12 dB) for a 200% volume. */
    @Volatile
    var gain: Float = 1f

    @Volatile
    private var peakLeft = 0f

    @Volatile
    private var peakRight = 0f

    /** The loudest left and right samples (0–1) since the last call, for the meter. */
    fun takePeaks(): Pair<Float, Float> {
        val peaks = peakLeft to peakRight
        peakLeft = 0f
        peakRight = 0f
        return peaks
    }

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        val supported = inputAudioFormat.encoding == C.ENCODING_PCM_16BIT || inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
        return if (supported) inputAudioFormat else AudioProcessor.AudioFormat.NOT_SET
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val remaining = inputBuffer.remaining()
        if (remaining == 0) return
        val format = inputAudioFormat
        val channels = max(1, format.channelCount)
        val isFloat = format.encoding == C.ENCODING_PCM_FLOAT
        val output = replaceOutputBuffer(remaining)
        val boost = gain
        var left = 0f
        var right = 0f
        var channel = 0
        if (isFloat) {
            while (inputBuffer.remaining() >= 4) {
                val sample = inputBuffer.getFloat()
                val level = abs(sample)
                if (channel == 0) left = max(left, level) else if (channel == 1) right = max(right, level)
                output.putFloat(if (boost == 1f) sample else limit(sample * boost))
                channel = if (channel + 1 >= channels) 0 else channel + 1
            }
        } else {
            while (inputBuffer.remaining() >= 2) {
                val sample = inputBuffer.getShort() / 32768f
                val level = abs(sample)
                if (channel == 0) left = max(left, level) else if (channel == 1) right = max(right, level)
                val out = if (boost == 1f) sample else limit(sample * boost)
                output.putShort((out * 32767f).roundToInt().coerceIn(-32768, 32767).toShort())
                channel = if (channel + 1 >= channels) 0 else channel + 1
            }
        }
        // An odd trailing byte (never expected) is passed on unchanged.
        while (inputBuffer.hasRemaining()) output.put(inputBuffer.get())
        output.flip()
        if (channels == 1) right = left
        if (left > peakLeft) peakLeft = left
        if (right > peakRight) peakRight = right
    }

    override fun onReset() {
        peakLeft = 0f
        peakRight = 0f
    }

    private companion object {
        /** Up to here the boost is linear; above it, peaks are rounded off towards full scale. */
        const val KNEE = 0.85f

        fun limit(sample: Float): Float {
            val size = abs(sample)
            if (size <= KNEE) return sample
            val limited = KNEE + (1f - KNEE) * tanh((size - KNEE) / (1f - KNEE))
            return if (sample < 0f) -limited else limited
        }
    }
}
