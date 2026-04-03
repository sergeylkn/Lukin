package com.ytrutranslator.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Transparent activity that intercepts:
 *  1. ACTION_SEND (text/plain) — YouTube "Share" button → we get the URL
 *  2. ACTION_VIEW (youtube.com or youtu.be) — direct deep link
 *
 * Extracts the video ID, starts FloatingTranslatorService if needed,
 * broadcasts the video ID, then immediately finishes (no UI shown).
 */
class ShareReceiverActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val text = when (intent?.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        }

        val videoId = extractVideoId(text)

        if (videoId != null) {
            // Start the overlay service if it's not already running
            val svcIntent = Intent(this, FloatingTranslatorService::class.java)
            startForegroundService(svcIntent)

            // Tell the service about the new video
            val bcast = Intent(FloatingTranslatorService.ACTION_VIDEO_DETECTED).apply {
                setPackage(packageName)
                putExtra(FloatingTranslatorService.EXTRA_VIDEO_ID, videoId)
            }
            sendBroadcast(bcast)
        }

        finish()
    }

    private fun extractVideoId(url: String?): String? {
        url ?: return null
        val match = Regex(
            """(?:youtube\.com/watch\?(?:[^&]*&)*v=|youtu\.be/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"""
        ).find(url)
        return match?.groupValues?.get(1)
    }
}
