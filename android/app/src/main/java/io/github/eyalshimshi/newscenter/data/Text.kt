package io.github.eyalshimshi.newscenter.data

import java.net.URI
import java.net.URLDecoder
import java.util.Locale
import kotlin.random.Random

private val WHITESPACE = Regex("\\s+")

/** Collapses whitespace and trims to [maxLength] characters; null becomes "". */
fun cleanText(value: String?, maxLength: Int): String =
    value?.replace(WHITESPACE, " ")?.trim()?.take(maxLength)?.trim().orEmpty()

/** True for an absolute http(s) address with a host. */
fun isHttpUrl(value: String?): Boolean {
    val text = value?.trim().orEmpty()
    if (text.isEmpty()) return false
    val uri = runCatching { URI(text) }.getOrNull() ?: return false
    val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return false
    return (scheme == "http" || scheme == "https") && !uri.rawAuthority.isNullOrEmpty()
}

/** [reference] resolved against [base], like a browser resolves a link; null when either is invalid. */
fun resolveUrl(base: String, reference: String): String? = runCatching {
    URI(base.trim()).resolve(reference.trim()).toString()
}.getOrNull()

/** The host of [url] ("www.knesset.tv"), or "" when it has none. */
fun hostName(url: String): String = runCatching { URI(url.trim()).host }.getOrNull().orEmpty()

/** Sites News Center never contacts, whatever a saved source or a redirect says. */
val BLOCKED_DOMAINS = listOf("srugim.co.il")

/** True when [url] is on a blocked site (or one of its subdomains). */
fun isBlockedAddress(url: String): Boolean {
    val host = hostName(url).lowercase(Locale.ROOT).trimEnd('.')
    return BLOCKED_DOMAINS.any { host == it || host.endsWith(".$it") }
}

/**
 * The first value of query parameter [name] in [url], decoded like a browser's URLSearchParams
 * does. A parameter that holds another address (?src=https://…/a.m3u8) keeps everything up to the
 * next "&".
 */
fun queryParam(url: String, name: String): String? {
    val query = url.substringAfter('?', "").substringBefore('#')
    if (query.isEmpty()) return null
    for (part in query.split('&')) {
        val key = decodeComponent(part.substringBefore('='))
        if (key == name) return decodeComponent(part.substringAfter('=', ""))
    }
    return null
}

private fun decodeComponent(value: String): String =
    runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)

/** A new unique id such as "ch-mb3k9x2a7f". */
fun makeId(prefix: String): String =
    "$prefix-${System.currentTimeMillis().toString(36)}${Random.nextInt(36 * 36 * 36 * 36).toString(36)}"
