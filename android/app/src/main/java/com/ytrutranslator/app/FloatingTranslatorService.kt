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
        updateSubtitle("⏳ Загрузка субтитров...")
        setDot(false)

        executor.execute {
            try {
                val segs = fetchSubtitles(videoId)
                uiHandler.post {
                    if (segs.isEmpty()) {
                        updateSubtitle("⚠ Нет субтитров у этого видео")
                        return@post
                    }
                    schedulePlayback(segs)
                    setDot(true)
                    updateSubtitle("▶ Синхронизируй с видео — нажми ▶")
                }
            } catch (e: Exception) {
                uiHandler.post { updateSubtitle("⚠ ${e.message?.take(60)}") }
            }
        }
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
        val tracks = fetchCaptionTracks(videoId)
        val track = tracks.firstOrNull { it.second == "en" }
            ?: tracks.firstOrNull { it.second.startsWith("en") }
            ?: tracks.firstOrNull()
            ?: throw Exception("Нет субтитров у этого видео")

        val baseUrl = track.first
            .replace(Regex("&fmt=[^&]*"), "")
            .replace(Regex("&tlang=[^&]*"), "")

        val xml = httpGet("$baseUrl&fmt=xml&tlang=$language")
        return parseXml(xml)
    }

    private fun fetchCaptionTracks(videoId: String): List<Pair<String, String>> {
        // Try IOS client first (no API key, minimal bot detection)
        val iosBody = buildInnerTubeBody(videoId, "IOS", "19.09.3")
        val iosResp = runCatching {
            httpPost(
                "https://www.youtube.com/youtubei/v1/player",
                iosBody,
                mapOf(
                    "Content-Type" to "application/json",
                    "User-Agent" to "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 16_1 like Mac OS X)",
                    "X-YouTube-Client-Name" to "5",
                    "X-YouTube-Client-Version" to "19.09.3"
                )
            )
        }.getOrNull()

        val tracks = parseTracks(iosResp)
        if (tracks.isNotEmpty()) return tracks

        // Fallback: WEB client
        val webBody = buildInnerTubeBody(videoId, "WEB", "2.20240101.00.00")
        val webResp = runCatching {
            httpPost(
                "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
                webBody,
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

    private fun httpGet(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9")
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
