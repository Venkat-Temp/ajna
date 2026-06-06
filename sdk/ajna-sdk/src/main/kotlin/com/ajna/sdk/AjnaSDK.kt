package com.ajna.sdk

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
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
        deviceId = prefs.getString("device_id_v2", null)?.takeIf { it.isNotBlank() } ?: run {
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
        Log.i(TAG, "AjnaSDK initialized — Device ID: $deviceId")
        logEvent("session_start", "anonymous")
    }

    fun getDeviceId(): String = deviceId

    fun logEvent(eventType: String, userId: String) {
        if (!isInitialized) {
            Log.e(TAG, "SDK not initialized. Call AjnaSDK.init() first.")
            return
        }
        sendPayload(buildPayload(eventType, userId))
    }

    private fun buildPayload(eventType: String, userId: String): String {
        val ctx = appContext ?: return "{}"
        val payload = JSONObject().apply {
            put("event_id", "evt_${UUID.randomUUID()}")
            put("user_id", userId)
            put("device_id", deviceId)
            put("event_type", eventType)
            put("timestamp", System.currentTimeMillis().toString())
            put("device", JSONObject(DeviceIntelligence.collectTelemetry(ctx)))
            put("behavioral", JSONObject(BehavioralIntelligence.collectBehavioralTelemetry()))
        }
        return payload.toString()
    }

    private fun sendPayload(jsonPayload: String) {
        scope.launch {
            try {
                val conn = URL(ingestionUrl).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("X-API-Key", apiKey)
                conn.doOutput = true
                conn.outputStream.use { it.write(jsonPayload.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                if (code in 200..299) Log.d(TAG, "Event ingested: $code")
                else Log.e(TAG, "Ingestion failed: HTTP $code")
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Exception sending event", e)
            }
        }
    }
}
