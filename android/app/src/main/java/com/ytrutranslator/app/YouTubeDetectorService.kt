package com.ytrutranslator.app

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Accessibility service that watches for YouTube video URLs in:
 *  - Chrome, Firefox, Brave, Edge and other browsers (reads address bar)
 *  - YouTube app (reads video URL from content / window state)
 *
 * When a new video ID is detected, it broadcasts ACTION_VIDEO_DETECTED
 * to FloatingTranslatorService.
 */
class YouTubeDetectorService : AccessibilityService() {

    private var lastVideoId: String? = null

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> scanForVideo(event)
            else -> {}
        }
    }

    override fun onInterrupt() {}

    // ── Scan ──────────────────────────────────────────────────────────────────
    private fun scanForVideo(event: AccessibilityEvent) {
        // Fast path: check event text directly (URL bar change)
        event.text?.forEach { text ->
            val id = extractVideoId(text?.toString())
            if (id != null) { notify(id); return }
        }

        // Slower path: walk window tree (needed for YouTube app)
        val root = rootInActiveWindow ?: return
        val id = walkTree(root)
        root.recycle()
        if (id != null) notify(id)
    }

    private fun walkTree(node: AccessibilityNodeInfo): String? {
        // Check this node's text / description
        val id = extractVideoId(node.text?.toString())
            ?: extractVideoId(node.contentDescription?.toString())
        if (id != null) return id

        // Check URL in EditText (Chrome address bar)
        if (node.className?.contains("EditText") == true) {
            val id2 = extractVideoId(node.text?.toString())
            if (id2 != null) return id2
        }

        // Recurse (limit depth to avoid ANR)
        for (i in 0 until minOf(node.childCount, 30)) {
            val child = node.getChild(i) ?: continue
            val found = walkTree(child)
            child.recycle()
            if (found != null) return found
        }
        return null
    }

    // ── Video ID extraction ────────────────────────────────────────────────────
    private val YT_PATTERN = Regex(
        """(?:youtube\.com/watch\?(?:[^&]*&)*v=|youtu\.be/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"""
    )

    private fun extractVideoId(text: String?): String? {
        text ?: return null
        return YT_PATTERN.find(text)?.groupValues?.get(1)
    }

    // ── Broadcast ─────────────────────────────────────────────────────────────
    private fun notify(videoId: String) {
        if (videoId == lastVideoId) return
        lastVideoId = videoId

        val intent = Intent(FloatingTranslatorService.ACTION_VIDEO_DETECTED).apply {
            setPackage(packageName)
            putExtra(FloatingTranslatorService.EXTRA_VIDEO_ID, videoId)
        }
        sendBroadcast(intent)
    }
}
