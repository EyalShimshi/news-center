package io.github.eyalshimshi.newscenter.data

import io.github.eyalshimshi.newscenter.BuildConfig
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URISyntaxException
import java.nio.charset.Charset
import kotlin.math.min

const val REPOSITORY_URL = "https://github.com/EyalShimshi/news-center"

/** The privacy policy, linked from Settings. */
const val PRIVACY_POLICY_URL = "$REPOSITORY_URL/blob/main/PRIVACY.md"

/** Used when the system WebView can't tell its own User-Agent (for example while it updates). */
val FALLBACK_USER_AGENT: String =
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 NewsCenter/${BuildConfig.VERSION_NAME}"

/** A text response: the status, the address it finally came from, and the decoded body. */
data class TextResponse(val status: Int, val url: String, val text: String) {
    val ok: Boolean get() = status in 200..299
}

/**
 * Small blocking GETs for web pages, feeds and playlists. Call from a background thread. Redirects
 * are followed by hand, because HttpURLConnection doesn't follow one from http to https.
 */
class Http(private val userAgent: () -> String) {

    /**
     * Throws only IOException: anything else that goes wrong (an odd redirect, a platform bug)
     * becomes one too, so a bad answer from a site can never crash the app.
     */
    fun fetchText(url: String, maxBytes: Int = MAX_BYTES, timeoutMs: Int = TIMEOUT_MS): TextResponse = try {
        fetch(url, maxBytes, timeoutMs)
    } catch (e: IOException) {
        throw e
    } catch (e: RuntimeException) {
        throw IOException("Request failed: ${e.javaClass.simpleName}", e)
    }

    private fun fetch(url: String, maxBytes: Int, timeoutMs: Int): TextResponse {
        var current = url.trim()
        repeat(MAX_REDIRECTS + 1) {
            if (!isHttpUrl(current)) throw IOException("Not a web address")
            if (isBlockedAddress(current)) throw IOException("This site is blocked in News Center")
            val address = try {
                URI(current).toASCIIString()
            } catch (e: URISyntaxException) {
                throw IOException("Invalid address", e)
            }
            val connection = URI(address).toURL().openConnection() as? HttpURLConnection
                ?: throw IOException("Not a web address")
            try {
                connection.connectTimeout = timeoutMs
                connection.readTimeout = timeoutMs
                connection.instanceFollowRedirects = false
                connection.useCaches = false
                connection.setRequestProperty("User-Agent", userAgent())
                connection.setRequestProperty("Accept-Language", "he-IL,he;q=0.9,en;q=0.8")
                val code = connection.responseCode
                val location = connection.getHeaderField("Location")
                if (code in 300..399 && !location.isNullOrBlank()) {
                    current = resolveUrl(address, location) ?: throw IOException("Bad redirect from ${hostName(address)}")
                    return@repeat
                }
                val stream: InputStream? = if (code >= 400) connection.errorStream else connection.inputStream
                val bytes = stream?.use { readLimited(it, maxBytes) } ?: ByteArray(0)
                return TextResponse(code, address, decodeBody(bytes, connection.contentType))
            } finally {
                connection.disconnect()
            }
        }
        throw IOException("Too many redirects from ${hostName(url)}")
    }

    private fun readLimited(input: InputStream, maxBytes: Int): ByteArray {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(16 * 1024)
        while (true) {
            val read = input.read(chunk)
            if (read < 0) break
            buffer.write(chunk, 0, read)
            if (buffer.size() > maxBytes) throw IOException("The answer is too large")
        }
        return buffer.toByteArray()
    }

    companion object {
        private const val MAX_REDIRECTS = 5
        private const val MAX_BYTES = 4 * 1024 * 1024
        private const val TIMEOUT_MS = 15_000

        private val CHARSET_IN_TYPE = Regex("""charset\s*=\s*["']?([\w.:-]+)""", RegexOption.IGNORE_CASE)
        private val DECLARED_CHARSET = Regex(
            """<\?xml[^>]*?\bencoding\s*=\s*["']([\w.:-]+)|<meta[^>]+?charset\s*=\s*["']?([\w.:-]+)""",
            RegexOption.IGNORE_CASE,
        )

        /**
         * Like the desktop app: the charset the server names, else the one the document declares
         * (feeds such as <?xml encoding="windows-1255"?>), else UTF-8.
         */
        fun decodeBody(bytes: ByteArray, contentType: String?): String {
            val head = String(bytes, 0, min(bytes.size, 2048), Charsets.ISO_8859_1)
            val named = CHARSET_IN_TYPE.find(contentType.orEmpty())?.groupValues?.get(1)
            val declared = DECLARED_CHARSET.find(head)?.let { match -> match.groupValues[1].ifEmpty { match.groupValues[2] } }
            for (label in listOf(named, declared, "UTF-8")) {
                if (label.isNullOrEmpty()) continue
                val charset = runCatching { Charset.forName(label) }.getOrNull() ?: continue
                return String(bytes, charset).removePrefix("\uFEFF")
            }
            return String(bytes, Charsets.UTF_8).removePrefix("\uFEFF")
        }
    }
}
