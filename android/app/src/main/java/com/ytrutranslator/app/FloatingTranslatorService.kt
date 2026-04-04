package com.ytrutranslator.app

import android.app.*
import android.content.*
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.os.*
import android.speech.tts.TextToSpeech
import android.view.*
import android.widget.*
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors

class FloatingTranslatorService : Service(), TextToSpeech.OnInitListener {

    companion object {
        const val ACTION_VIDEO_DETECTED = "com.ytrutranslator.VIDEO_DETECTED"
        const val EXTRA_VIDEO_ID = "videoId"
        const val CHANNEL_ID = "yt_translator"
        const val NOTIF_ID = 1001
    }

    // ── State ──────────────────────────────────────────────────────────────────
    private lateinit var windowManager: WindowManager
    private var overlayRoot: LinearLayout? = null
    private lateinit var tts: TextToSpeech
    private val executor = Executors.newSingleThreadExecutor()
    private val uiHandler = Handler(Looper.getMainLooper())

    var language = "ru"          // "ru" | "uk"
    private var isTranslating = false
    private var currentVideoId: String? = null
    private val pendingRunnables = mutableListOf<Runnable>()

    data class Segment(val start: Double, val dur: Double, val text: String)

    // ── Broadcast receiver: new video detected ────────────────────────────────
    private val videoReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val vid = intent.getStringExtra(EXTRA_VIDEO_ID) ?: return
            onVideoDetected(vid)
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIF_ID, buildNotification())
        tts = TextToSpeech(this, this)
        registerReceiver(videoReceiver, IntentFilter(ACTION_VIDEO_DETECTED),
            RECEIVER_NOT_EXPORTED)
        buildOverlay()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        super.onDestroy()
        cancelPending()
        tts.shutdown()
        try { unregisterReceiver(videoReceiver) } catch (_: Exception) {}
        overlayRoot?.let { windowManager.removeView(it) }
    }

    override fun onBind(intent: Intent?) = null

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) setTtsLanguage()
    }

    private fun setTtsLanguage() {
        val locale = if (language == "uk") Locale("uk", "UA") else Locale("ru", "RU")
        tts.language = locale
    }

    // ── Overlay UI ─────────────────────────────────────────────────────────────
    private fun buildOverlay() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val ctx = this

        // Root container
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = GradientDrawable().apply {
                setColor(Color.argb(220, 8, 8, 8))
                cornerRadius = dp(18).toFloat()
            }
            minimumWidth = dp(220)
        }

        // ── Top row: lang | status | spacer | toggle | close ──────────────────
        val topRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val langBtn = textBtn(ctx, if (language == "ru") "🇷🇺 RU" else "🇺🇦 UK", Color.WHITE) {
            language = if (language == "ru") "uk" else "ru"
            (it as Button).text = if (language == "ru") "🇷🇺 RU" else "🇺🇦 UK"
            setTtsLanguage()
            // Restart translation in new language
            currentVideoId?.let { id -> if (isTranslating) onVideoDetected(id) }
        }

        val statusDot = TextView(ctx).apply {
            text = "●"
            setTextColor(Color.parseColor("#666666"))
            textSize = 10f
            setPadding(dp(8), 0, 0, 0)
            tag = "dot"
        }

        val spacer = View(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
        }

        val toggleBtn = textBtn(ctx, "▶", Color.WHITE) {
            if (isTranslating) {
                stopTranslation()
                (it as Button).text = "▶"
            } else {
                currentVideoId?.let { id -> onVideoDetected(id) }
                    ?: updateSubtitle("Открой YouTube видео")
                (it as Button).text = "⏸"
            }
        }
        toggleBtn.tag = "toggle"

        val closeBtn = textBtn(ctx, "✕", Color.parseColor("#ff5555")) { stopSelf() }

        topRow.addView(langBtn)
        topRow.addView(statusDot)
        topRow.addView(spacer)
        topRow.addView(toggleBtn)
        topRow.addView(closeBtn)

        // ── Subtitle text ──────────────────────────────────────────────────────
        val subtitle = TextView(ctx).apply {
            text = "Открой YouTube в браузере\nили нажми «Поделиться» в YouTube"
            setTextColor(Color.parseColor("#cccccc"))
            textSize = 13f
            maxLines = 4
            setPadding(dp(2), dp(6), dp(2), dp(2))
            tag = "subtitle"
        }

        root.addView(topRow)
        root.addView(subtitle)

        // ── Window params ──────────────────────────────────────────────────────
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(12); y = dp(80)
        }

        // ── Drag to move ───────────────────────────────────────────────────────
        var dragStartX = 0f; var dragStartY = 0f
        var paramStartX = 0; var paramStartY = 0
        var isDrag = false

        root.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    dragStartX = event.rawX; dragStartY = event.rawY
                    paramStartX = params.x; paramStartY = params.y
                    isDrag = false; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - dragStartX).toInt()
                    val dy = (event.rawY - dragStartY).toInt()
                    if (isDrag || dx * dx + dy * dy > 16) {
                        isDrag = true
                        params.x = paramStartX + dx
                        params.y = paramStartY + dy
                        windowManager.updateViewLayout(root, params)
                    }
                    true
                }
                else -> false
            }
        }

        windowManager.addView(root, params)
        overlayRoot = root
    }

    private fun textBtn(ctx: Context, label: String, color: Int, onClick: (View) -> Unit) =
        Button(ctx).apply {
            text = label
            setTextColor(color)
            setBackgroundColor(Color.TRANSPARENT)
            textSize = 13f
            setPadding(dp(8), dp(4), dp(8), dp(4))
            setOnClickListener(onClick)
        }

    private fun updateSubtitle(text: String) = uiHandler.post {
        overlayRoot?.findViewWithTag<TextView>("subtitle")?.text = text
    }

    private fun setDot(active: Boolean) = uiHandler.post {
        overlayRoot?.findViewWithTag<TextView>("dot")
            ?.setTextColor(if (active) Color.parseColor("#4caf50") else Color.parseColor("#666666"))
    }

    // ── Video detection callback ───────────────────────────────────────────────
    fun onVideoDetected(videoId: String) {
        if (videoId == currentVideoId && isTranslating) return
        currentVideoId = videoId
        stopTranslation()
        step("[$videoId] Запрос субтитров...")
        setDot(false)

        executor.execute {
            try {
                val segs = fetchSubtitles(videoId)
                uiHandler.post {
                    if (segs.isEmpty()) {
                        step("⚠ Субтитры не найдены (${segs.size})")
                        return@post
                    }
                    schedulePlayback(segs)
                    setDot(true)
                    updateSubtitle("✓ ${segs.size} фраз — нажми ▶ когда начнёшь видео")
                }
            } catch (e: Exception) {
                val msg = e.message ?: e.javaClass.simpleName
                android.util.Log.e("YTTranslator", "fetchSubtitles failed", e)
                uiHandler.post { updateSubtitle("⚠ $msg") }
            }
        }
    }

    /** Post a status message to subtitle view AND logcat simultaneously. */
    private fun step(msg: String) {
        android.util.Log.d("YTTranslator", msg)
        updateSubtitle(msg)
    }

    // ── Playback scheduling ────────────────────────────────────────────────────
    private fun schedulePlayback(segs: List<Segment>) {
        cancelPending()
        isTranslating = true
        val startMs = SystemClock.elapsedRealtime()

        // Update toggle button
        uiHandler.post {
            overlayRoot?.findViewWithTag<Button>("toggle")?.text = "⏸"
        }

        segs.forEach { seg ->
            val delayMs = (seg.start * 1000).toLong()
            val r = Runnable {
                speakAndShow(seg.text)
            }
            pendingRunnables += r
            uiHandler.postDelayed(r, delayMs)
        }
    }

    private fun speakAndShow(text: String) {
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "seg_${System.nanoTime()}")
        updateSubtitle(text)
    }

    private fun stopTranslation() {
        cancelPending()
        tts.stop()
        isTranslating = false
        uiHandler.post {
            overlayRoot?.findViewWithTag<Button>("toggle")?.text = "▶"
        }
    }

    private fun cancelPending() {
        pendingRunnables.forEach { uiHandler.removeCallbacks(it) }
        pendingRunnables.clear()
    }

    // ── Subtitle fetching (runs on executor thread) ────────────────────────────
    private fun fetchSubtitles(videoId: String): List<Segment> {
        // 1. Parse YouTube page as real browser (gets signed caption URLs)
        step("1/3 Загружаю страницу YouTube...")
        runCatching { fetchViaWebPage(videoId) }.onFailure {
            android.util.Log.w("YTTranslator", "webPage failed: ${it.message}")
        }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { return it }

        // 2. InnerTube API (4 clients)
        step("2/3 Пробую InnerTube API...")
        val tracks = fetchCaptionTracks(videoId)
        if (tracks.isNotEmpty()) {
            android.util.Log.d("YTTranslator", "InnerTube: ${tracks.size} tracks: ${tracks.map { it.second }}")
            val track = tracks.firstOrNull { it.second == "en" }
                ?: tracks.firstOrNull { it.second.startsWith("en") }
                ?: tracks.first()
            val baseUrl = track.first
                .replace(Regex("&fmt=[^&]*"), "")
                .replace(Regex("&tlang=[^&]*"), "")
            runCatching { parseXml(httpGet("$baseUrl&fmt=xml&tlang=$language")) }
                .getOrNull()?.takeIf { it.isNotEmpty() }?.let { return it }
        } else {
            android.util.Log.w("YTTranslator", "InnerTube: no tracks returned")
        }

        // 3. Direct timedtext API
        step("3/3 Прямой timedtext API...")
        return fetchViaTimedtextApi(videoId)
    }

    /**
     * Fetch YouTube page as iPhone Safari → extract ytInitialPlayerResponse →
     * use signed caption URLs inside it. Works for all public videos.
     */
    private fun fetchViaWebPage(videoId: String): List<Segment> {
        val iphoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) " +
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
        val desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        // Embed page first — no cookies needed, no consent, works for all public videos
        val candidates = listOf(
            "https://www.youtube.com/embed/$videoId" to desktopUA,
            "https://m.youtube.com/watch?v=$videoId&hl=en" to iphoneUA,
            "https://www.youtube.com/watch?v=$videoId&hl=en" to desktopUA
        )

        for ((url, ua) in candidates) {
            val html = runCatching {
                httpGet(url, mapOf(
                    "User-Agent" to ua,
                    "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language" to "en-US,en;q=0.9"
                ))
            }.getOrNull() ?: continue

            android.util.Log.d("YTTranslator", "webPage($url): ${html.length} chars")

            val json = findPlayerResponseJson(html) ?: run {
                android.util.Log.w("YTTranslator", "no ytInitialPlayerResponse in $url")
                continue
            }
            android.util.Log.d("YTTranslator", "playerResponse: ${json.take(120)}")

            val tracks = parseTracks(json)
            android.util.Log.d("YTTranslator", "tracks: ${tracks.size} → ${tracks.map { it.second }}")
            if (tracks.isEmpty()) continue

            val track = tracks.firstOrNull { it.second == "en" }
                ?: tracks.firstOrNull { it.second.startsWith("en") }
                ?: tracks.first()

            val baseUrl = track.first
                .replace(Regex("&fmt=[^&]*"), "")
                .replace(Regex("&tlang=[^&]*"), "")

            val xml = runCatching { httpGet("$baseUrl&fmt=xml&tlang=$language") }.getOrNull() ?: continue
            android.util.Log.d("YTTranslator", "xml: ${xml.take(120)}")
            val segs = parseXml(xml)
            if (segs.isNotEmpty()) return segs
        }
        return emptyList()
    }

    /** Find ytInitialPlayerResponse JSON in page HTML, handling both assignment forms. */
    private fun findPlayerResponseJson(html: String): String? {
        val markers = listOf(
            "ytInitialPlayerResponse = ",
            "var ytInitialPlayerResponse = ",
            "ytInitialPlayerResponse="
        )
        for (marker in markers) {
            val idx = html.indexOf(marker)
            if (idx == -1) continue
            val jsonStart = idx + marker.length
            if (jsonStart >= html.length || html[jsonStart] != '{') continue
            val json = extractJsonObject(html, jsonStart)
            if (json.length > 100) return json  // sanity check
        }
        return null
    }

    /** Extract a balanced JSON object starting at [start] (must point at '{'}). */
    private fun extractJsonObject(html: String, start: Int): String {
        var depth = 0
        var inStr = false
        var escape = false
        var i = start
        while (i < html.length) {
            val c = html[i]
            when {
                escape            -> escape = false
                c == '\\' && inStr -> escape = true
                c == '"'          -> inStr = !inStr
                !inStr && c == '{' -> depth++
                !inStr && c == '}' -> { depth--; if (depth == 0) return html.substring(start, i + 1) }
            }
            i++
        }
        return ""
    }

    /** Direct timedtext API — last resort */
    private fun fetchViaTimedtextApi(videoId: String): List<Segment> {
        val variants = listOf(
            "https://www.youtube.com/api/timedtext?v=$videoId&lang=en&fmt=xml&kind=asr&tlang=$language",
            "https://www.youtube.com/api/timedtext?v=$videoId&lang=en&fmt=xml&tlang=$language",
            "https://www.youtube.com/api/timedtext?v=$videoId&lang=en&fmt=xml&kind=asr"
        )
        for (url in variants) {
            val xml = runCatching { httpGet(url) }.getOrNull() ?: continue
            android.util.Log.d("YTTranslator", "timedtext direct: ${xml.take(80)}")
            val segs = parseXml(xml)
            if (segs.isNotEmpty()) return segs
        }
        throw Exception("Субтитры недоступны (все методы исчерпаны)")
    }

    private fun fetchCaptionTracks(videoId: String): List<Pair<String, String>> {
        // Client 1: IOS — no API key, low bot detection
        val iosResp = runCatching {
            httpPost(
                "https://www.youtube.com/youtubei/v1/player",
                buildInnerTubeBody(videoId, "IOS", "19.09.3"),
                mapOf(
                    "Content-Type" to "application/json",
                    "User-Agent" to "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 16_1 like Mac OS X)",
                    "X-YouTube-Client-Name" to "5",
                    "X-YouTube-Client-Version" to "19.09.3"
                )
            )
        }.getOrNull()
        parseTracks(iosResp).takeIf { it.isNotEmpty() }?.let { return it }

        // Client 2: ANDROID_EMBEDDED_PLAYER — designed for 3rd-party apps, no API key
        val androidEmbedResp = runCatching {
            httpPost(
                "https://www.youtube.com/youtubei/v1/player",
                """{"videoId":"$videoId","contentCheckOk":true,"racyCheckOk":true,"context":{"client":{"clientName":"ANDROID_EMBEDDED_PLAYER","clientVersion":"17.31.35","androidSdkVersion":30,"hl":"en","gl":"US"},"thirdParty":{"embedUrl":"https://www.youtube.com/"}}}""",
                mapOf(
                    "Content-Type" to "application/json",
                    "User-Agent" to "com.google.android.youtube/17.31.35 (Linux; U; Android 11; en_US; Pixel 4; Build/RQ3A.210805.001; 2t84dn) gzip",
                    "X-YouTube-Client-Name" to "55",
                    "X-YouTube-Client-Version" to "17.31.35"
                )
            )
        }.getOrNull()
        parseTracks(androidEmbedResp).takeIf { it.isNotEmpty() }?.let { return it }

        // Client 3: TVHTML5 Embedded — bypasses many restrictions
        val tvResp = runCatching {
            httpPost(
                "https://www.youtube.com/youtubei/v1/player",
                """{"videoId":"$videoId","contentCheckOk":true,"racyCheckOk":true,"context":{"client":{"clientName":"TVHTML5_SIMPLY_EMBEDDED_PLAYER","clientVersion":"2.0","hl":"en","gl":"US"},"thirdParty":{"embedUrl":"https://www.youtube.com/"}}}""",
                mapOf(
                    "Content-Type" to "application/json",
                    "User-Agent" to "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1",
                    "X-YouTube-Client-Name" to "85",
                    "X-YouTube-Client-Version" to "2.0"
                )
            )
        }.getOrNull()
        parseTracks(tvResp).takeIf { it.isNotEmpty() }?.let { return it }

        // Client 4: MWEB — mobile web client
        val mwebResp = runCatching {
            httpPost(
                "https://www.youtube.com/youtubei/v1/player",
                buildInnerTubeBody(videoId, "MWEB", "2.20240101.07.00"),
                mapOf(
                    "Content-Type" to "application/json",
                    "User-Agent" to "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1",
                    "X-YouTube-Client-Name" to "2",
                    "X-YouTube-Client-Version" to "2.20240101.07.00"
                )
            )
        }.getOrNull()
        parseTracks(mwebResp).takeIf { it.isNotEmpty() }?.let { return it }

        // Client 5: WEB fallback
        val webResp = runCatching {
            httpPost(
                "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
                buildInnerTubeBody(videoId, "WEB", "2.20240101.00.00"),
                mapOf(
                    "Content-Type" to "application/json",
                    "User-Agent" to "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "X-YouTube-Client-Name" to "1"
                )
            )
        }.getOrNull()
        return parseTracks(webResp)
    }

    private fun buildInnerTubeBody(videoId: String, clientName: String, clientVersion: String): String {
        val extra = if (clientName == "IOS")
            ""","deviceModel":"iPhone14,3","osName":"iPhone","osVersion":"16.1.0"""" else ""
        return """{"videoId":"$videoId","context":{"client":{"clientName":"$clientName","clientVersion":"$clientVersion","hl":"en","gl":"US"$extra}}}"""
    }

    private fun parseTracks(json: String?): List<Pair<String, String>> {
        json ?: return emptyList()
        return runCatching {
            val arr = JSONObject(json)
                .optJSONObject("captions")
                ?.optJSONObject("playerCaptionsTracklistRenderer")
                ?.optJSONArray("captionTracks")
                ?: return emptyList()
            (0 until arr.length()).map { i ->
                val t = arr.getJSONObject(i)
                Pair(t.optString("baseUrl"), t.optString("languageCode"))
            }
        }.getOrDefault(emptyList())
    }

    private fun parseXml(xml: String): List<Segment> {
        val result = mutableListOf<Segment>()
        val re = Regex("""<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)</text>""")
        re.findAll(xml).forEach { m ->
            val text = m.groupValues[3]
                .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", "\"").replace("&#39;", "'").replace(Regex("<[^>]+>"), "")
                .trim()
            if (text.isNotEmpty())
                result += Segment(m.groupValues[1].toDouble(), m.groupValues[2].toDouble(), text)
        }
        return result
    }

    // ── HTTP helpers ───────────────────────────────────────────────────────────
    private fun httpPost(url: String, body: String, headers: Map<String, String>): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        conn.outputStream.use { it.write(body.toByteArray()) }
        return conn.inputStream.bufferedReader().readText()
    }

    private fun httpGet(url: String, extraHeaders: Map<String, String> = emptyMap()): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 12_000
        conn.readTimeout = 20_000
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9")
        extraHeaders.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        return conn.inputStream.bufferedReader().readText()
    }

    // ── Notification (required for foreground service) ─────────────────────────
    private fun createChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "YouTube Переводчик",
            NotificationManager.IMPORTANCE_LOW).apply { description = "Фоновый перевод" }
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("YouTube Переводчик активен")
            .setContentText("Оверлей работает поверх приложений")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    // ── dp helper ──────────────────────────────────────────────────────────────
    private fun dp(value: Int) =
        (value * resources.displayMetrics.density + 0.5f).toInt()
}
