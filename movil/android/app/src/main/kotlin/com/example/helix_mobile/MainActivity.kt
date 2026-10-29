package com.example.helix_mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val requestCode = 7432
    private var pendingServiceResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "dev.helix.assistant.mobile/background_connection",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> startBackgroundConnection(result)
                "stop" -> {
                    stopService(Intent(this, MobileConnectionService::class.java))
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun startBackgroundConnection(result: MethodChannel.Result) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            if (pendingServiceResult != null) {
                result.error("REQUEST_IN_PROGRESS", "Notification permission is pending", null)
                return
            }
            pendingServiceResult = result
            requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                requestCode,
            )
            return
        }
        startConnectionService(result, notificationsAllowed = true)
    }

    private fun startConnectionService(
        result: MethodChannel.Result,
        notificationsAllowed: Boolean,
    ) {
        val intent = Intent(this, MobileConnectionService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        result.success(notificationsAllowed)
    }

    @Deprecated("Deprecated in Android")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != this.requestCode) return
        val result = pendingServiceResult ?: return
        pendingServiceResult = null
        val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        startConnectionService(result, notificationsAllowed = granted)
    }
}
