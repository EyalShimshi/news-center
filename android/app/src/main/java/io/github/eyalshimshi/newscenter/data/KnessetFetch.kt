package io.github.eyalshimshi.newscenter.data

import java.net.URI
import java.util.Locale

/**
 * What the Knesset screen's page may read through the app: the Knesset's open data and its
 * website's API, both on knesset.gov.il over HTTPS. Anything else is refused, so the page can't be
 * used to reach other sites.
 */
object KnessetFetch {
    private const val KNESSET_DOMAIN = "knesset.gov.il"

    fun isAllowed(url: String): Boolean {
        if (!isHttpUrl(url) || isBlockedAddress(url)) return false
        val uri = runCatching { URI(url.trim()) }.getOrNull() ?: return false
        val host = uri.host?.lowercase(Locale.ROOT)?.trimEnd('.') ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            (host == KNESSET_DOMAIN || host.endsWith(".$KNESSET_DOMAIN"))
    }

    /**
     * The status the page is given for a reply: a WebView accepts only 100-299 and 400-599 (Http
     * follows redirects itself, so a 3xx here is a broken one).
     */
    fun pageStatus(status: Int): Int = if (status in 100..299 || status in 400..599) status else 502
}
