package com.ajna.sdk

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

object AjnaSDK {
    private const val TAG = "AjnaSDK"
    private var apiKey: String = ""
    private var ingestionUrl: String = ""
    private var deviceId: String = ""
    private var appContext: Context? = null
    private var isInitialized = false

    private val scope = CoroutineScope(Dispatchers.IO)

    fun init(context: Context, key: String, url: String = "http://10.0.2.2:8000/api/v1/events") {
        appContext = context.applicationContext
        apiKey = key
        ingestionUrl = url

        val prefs = context.getSharedPreferences("ajna_prefs", Context.MODE_PRIVATE)
        // Priority: AccountManager (factory-reset-resistant) → SharedPrefs → SHA-256 composite → UUID fallback
        deviceId = DeviceIntelligence.getAccountManagerDeviceId(context)
            ?: prefs.getString("device_id_v2", null)?.takeIf { it.isNotBlank() }
            ?: run {
                val computed = DeviceIntelligence.getPersistentDeviceId(context)
                val id = if (!computed.isNullOrBlank()) {
                    computed
                } else {
                    prefs.getString("device_id_uuid_fallback", null) ?: UUID.randomUUID().toString().also { uuid ->
                        prefs.edit().putString("device_id_uuid_fallback", uuid).apply()
                    }
                }
                prefs.edit().putString("device_id_v2", id).apply()
                id
            }

        isInitialized = true
        // Begin passive device-handling motion capture (accelerometer + gyroscope) for the session.
        // Listeners are unregistered in stopBehavioralCapture() to avoid leaks.
        BehavioralIntelligence.startMotionCapture(appContext!!)
        Log.i(TAG, "AjnaSDK initialized — Device ID: $deviceId")
        logEvent("session_start", "anonymous")
    }

    fun getDeviceId(): String = deviceId

    /**
     * Stop passive behavioral sensor capture (call from Activity onStop/onDestroy to release the
     * accelerometer + gyroscope listeners). Safe to call multiple times.
     */
    fun stopBehavioralCapture() {
        BehavioralIntelligence.stopMotionCapture()
    }

    fun logEvent(eventType: String, userId: String) {
        logEvent(eventType, userId, null)
    }

    /**
     * Log an event with optional free-form business context (e.g. amount, currency, merchant_id,
     * referral_code). The context map is emitted under a top-level "context" key. Do NOT put PII
     * (plaintext email/phone) here — hash any identifiers before adding them.
     */
    fun logEvent(eventType: String, userId: String, context: Map<String, Any>? = null) {
        if (!isInitialized) {
            Log.e(TAG, "SDK not initialized. Call AjnaSDK.init() first.")
            return
        }
        scope.launch { sendPayload(buildPayload(eventType, userId, context)) }
    }

    private fun buildPayload(eventType: String, userId: String, context: Map<String, Any>?): String {
        val ctx = appContext ?: return "{}"
        val payload = JSONObject().apply {
            put("event_id", "evt_${UUID.randomUUID()}")
            put("user_id", userId)
            put("device_id", deviceId)
            put("event_type", eventType)
            put("timestamp", System.currentTimeMillis().toString())
            put("device", JSONObject(DeviceIntelligence.collectTelemetry(ctx)))
            put("behavioral", JSONObject(BehavioralIntelligence.collectBehavioralTelemetry()))
            if (context != null) {
                put("context", JSONObject(context))
            }
        }
        return payload.toString()
    }

    private suspend fun sendPayload(jsonPayload: String) {
        var delayMs = 1000L
        repeat(3) { attempt ->
            try {
                val conn = URL(ingestionUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 5_000
                conn.readTimeout = 10_000
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("X-API-Key", apiKey)
                conn.doOutput = true
                conn.outputStream.use { it.write(jsonPayload.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                conn.disconnect()
                if (code in 200..299) {
                    Log.d(TAG, "Event ingested: $code")
                    return
                }
                Log.e(TAG, "Ingestion failed: HTTP $code (attempt ${attempt + 1})")
            } catch (e: Exception) {
                Log.e(TAG, "Exception sending event (attempt ${attempt + 1})", e)
            }
            if (attempt < 2) {
                delay(delayMs)
                delayMs *= 2
            }
        }
        Log.e(TAG, "Event dropped after 3 failed attempts")
    }
}
