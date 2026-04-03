package com.ytrutranslator.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*

class OverlayModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    override fun getName() = "OverlayModule"

    @ReactMethod
    fun startOverlay(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
            promise.reject("NO_PERMISSION", "Нужно разрешение на отображение поверх приложений")
            return
        }
        ctx.startForegroundService(Intent(ctx, FloatingTranslatorService::class.java))
        promise.resolve(true)
    }

    @ReactMethod
    fun stopOverlay(promise: Promise) {
        ctx.stopService(Intent(ctx, FloatingTranslatorService::class.java))
        promise.resolve(true)
    }

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            Settings.canDrawOverlays(ctx) else true
        promise.resolve(ok)
    }

    @ReactMethod
    fun openOverlaySettings(promise: Promise) {
        runCatching {
            ctx.startActivity(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${ctx.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            promise.resolve(true)
        }.onFailure { promise.reject("ERROR", it.message) }
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        runCatching {
            ctx.startActivity(
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            promise.resolve(true)
        }.onFailure { promise.reject("ERROR", it.message) }
    }

    @ReactMethod
    fun isAccessibilityEnabled(promise: Promise) {
        val enabled = Settings.Secure.getString(
            ctx.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )?.contains(ctx.packageName) ?: false
        promise.resolve(enabled)
    }
}
