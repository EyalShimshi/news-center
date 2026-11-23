package io.github.eyalshimshi.newscenter.ui

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.Toast
import io.github.eyalshimshi.newscenter.BuildConfig
import io.github.eyalshimshi.newscenter.R
import io.github.eyalshimshi.newscenter.data.REPOSITORY_URL
import java.net.URLEncoder

fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText(context.getString(R.string.app_name), text))
    Toast.makeText(context, R.string.copied, Toast.LENGTH_SHORT).show()
}

/** Opens [url] in the user's browser (or the app that handles it). */
fun openUrl(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(context, R.string.no_browser, Toast.LENGTH_SHORT).show()
    }
}

/** A pre-filled GitHub issue for a problem with the app. */
fun reportProblemUrl(): String {
    val body = buildString {
        appendLine("**What happened?**")
        appendLine()
        appendLine()
        appendLine("---")
        appendLine("News Center for Android ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        appendLine("Android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL}")
    }
    return "$REPOSITORY_URL/issues/new?title=${encode("Problem report")}&body=${encode(body)}"
}

/** A pre-filled GitHub issue with a crash report (shortened to keep the link a safe length). */
fun crashReportUrl(report: String): String {
    val exception = report.substringAfter("\n\n").lineSequence().firstOrNull()?.trim().orEmpty()
    val title = "Crash: " + exception.ifEmpty { "unknown error" }.take(MAX_ISSUE_TITLE_CHARS)
    val body = "**What were you doing when it crashed?**\n\n\n---\n```\n" + report.take(MAX_ISSUE_REPORT_CHARS) + "\n```\n"
    return "$REPOSITORY_URL/issues/new?title=${encode(title)}&body=${encode(body)}"
}

private const val MAX_ISSUE_TITLE_CHARS = 120
private const val MAX_ISSUE_REPORT_CHARS = 3_500

private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
