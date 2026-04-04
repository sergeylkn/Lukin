package com.ytrutranslator.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/**
 * Минимальный Accessibility Service для обнаружения YouTube видео.
 *
 * Принципы безопасности:
 * - canRetrieveWindowContent = false → НЕ читает экран
 * - Слушает ТОЛЬКО typeViewTextChanged (изменение текста в поле)
 * - Обрабатывает только строго проверенные YouTube URL
 * - Не хранит никаких данных кроме последнего video ID
 * - Весь прочий текст (пароли, сообщения, etc.) игнорируется
 *   сразу после проверки regex — не передаётся никуда
 *
 * Как работает: когда пользователь переходит на youtube.com/watch?v=XXX
 * в Chrome/Firefox/др., браузер генерирует TYPE_VIEW_TEXT_CHANGED
 * с новым URL в поле адресной строки. Мы читаем ТОЛЬКО этот текст,
 * проверяем regex, и если это YouTube видео — отправляем video ID
 * нашему FloatingTranslatorService.
 */
class YouTubeDetectorService : AccessibilityService() {

    // Строгий regex: только youtube.com/watch?v=ID или youtu.be/ID
    private val YT_VIDEO_RE = Regex(
        """(?:https?://)?(?:www\.)?(?:youtube\.com/watch\?(?:[^&\s]*&)*v=|youtu\.be/)([a-zA-Z0-9_-]{11})(?:[&?\s]|${'$'})"""
    )

    private var lastVideoId: String? = null

    override fun onServiceConnected() {
        // Дополнительно ограничиваем флаги программно
        serviceInfo = serviceInfo?.apply {
            flags = AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS.inv() and flags
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Принимаем ТОЛЬКО события изменения текста
        if (event?.eventType != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) return

        // Читаем только тот текст, что пришёл в событии — ничего больше
        val texts = event.text ?: return
        for (text in texts) {
            val str = text?.toString() ?: continue
            // Игнорируем слишком короткие строки (не URL) и слишком длинные (не адресная строка)
            if (str.length < 20 || str.length > 500) continue
            // Проверяем строго по YouTube-паттерну
            val videoId = YT_VIDEO_RE.find(str)?.groupValues?.get(1) ?: continue
            if (videoId.length == 11) {
                dispatchVideo(videoId)
                return
            }
        }
    }

    override fun onInterrupt() {}

    private fun dispatchVideo(videoId: String) {
        if (videoId == lastVideoId) return
        lastVideoId = videoId
        sendBroadcast(Intent(FloatingTranslatorService.ACTION_VIDEO_DETECTED).apply {
            setPackage(packageName)
            putExtra(FloatingTranslatorService.EXTRA_VIDEO_ID, videoId)
        })
    }
}
