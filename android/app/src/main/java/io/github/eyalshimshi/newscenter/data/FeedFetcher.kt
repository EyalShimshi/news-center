package io.github.eyalshimshi.newscenter.data

import io.github.eyalshimshi.newscenter.model.Feed
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Why a feed couldn't be read; the UI words each one. */
enum class FeedProblem { UNREACHABLE, BLOCKED, HTTP_ERROR, WEB_PAGE, NOT_A_FEED, PAGE_WITHOUT_FEED }

sealed interface FeedResult {
    data class Ok(val feed: Feed) : FeedResult

    data class Failed(val problem: FeedProblem, val detail: String = "") : FeedResult
}

/** A feed address checked in the source editor: the feed itself, or the one a home page names. */
sealed interface FeedInspection {
    data class Found(val url: String, val feed: Feed, val discovered: Boolean) : FeedInspection

    data class Problem(val problem: FeedProblem, val detail: String = "") : FeedInspection
}

object FeedFetcher {

    private class Answer(val result: FeedResult, val page: String?, val pageUrl: String)

    suspend fun request(http: Http, url: String): FeedResult = fetch(http, url).result

    private suspend fun fetch(http: Http, url: String): Answer = withContext(Dispatchers.IO) {
        val response = try {
            http.fetchText(url)
        } catch (e: IOException) {
            return@withContext Answer(FeedResult.Failed(FeedProblem.UNREACHABLE, hostName(url)), null, url)
        }
        val feed = if (response.ok) {
            try {
                FeedParser.parse(response.text, response.url)
            } catch (e: RuntimeException) {
                null
            }
        } else {
            null
        }
        when {
            feed != null -> Answer(FeedResult.Ok(feed), null, response.url)
            FeedParser.isIsolationPage(response.text) -> Answer(FeedResult.Failed(FeedProblem.BLOCKED), null, response.url)
            !response.ok -> Answer(FeedResult.Failed(FeedProblem.HTTP_ERROR, response.status.toString()), null, response.url)
            FeedParser.isHtmlPage(response.text) -> Answer(FeedResult.Failed(FeedProblem.WEB_PAGE), response.text, response.url)
            else -> Answer(FeedResult.Failed(FeedProblem.NOT_A_FEED), null, response.url)
        }
    }

    /** A news site's home page usually names its feed in a <link rel="alternate"> tag. */
    suspend fun inspect(http: Http, address: String): FeedInspection {
        val first = fetch(http, address)
        when (val result = first.result) {
            is FeedResult.Ok -> return FeedInspection.Found(address, result.feed, discovered = false)
            is FeedResult.Failed -> if (first.page == null) return FeedInspection.Problem(result.problem, result.detail)
        }
        val page = first.page ?: return FeedInspection.Problem(FeedProblem.NOT_A_FEED)
        val feedUrl = withContext(Dispatchers.Default) { runCatching { FeedParser.findFeedLink(page, first.pageUrl) }.getOrNull() }
            ?: return FeedInspection.Problem(FeedProblem.PAGE_WITHOUT_FEED)
        return when (val found = fetch(http, feedUrl).result) {
            is FeedResult.Ok -> FeedInspection.Found(feedUrl, found.feed, discovered = true)
            is FeedResult.Failed -> FeedInspection.Problem(found.problem, found.detail)
        }
    }
}
