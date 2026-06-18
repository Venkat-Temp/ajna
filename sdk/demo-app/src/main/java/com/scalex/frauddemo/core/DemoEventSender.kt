package com.scalex.frauddemo.core

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class DemoEventSender(context: Context) {

    private val appContext = context.applicationContext
    private val url = "http://10.0.2.2:8000/api/v1/events"

    // Persistent device ID — read from the same SharedPrefs key the SDK uses so
    // device identity is consistent if the full SDK is also initialized elsewhere.
    // We do NOT call AjnaSDK.init() here because that fires a session_start event
    // with an unprovisioned API key, causing 401 on every call.
    private val deviceId: String = run {
        val prefs = appContext.getSharedPreferences("ajna_prefs", Context.MODE_PRIVATE)
        prefs.getString("device_id_v2", null)?.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString().also { id ->
                prefs.edit().putString("device_id_v2", id).apply()
            }
    }

    data class DeviceFlags(
        val rooted: Boolean = false,
        val emulator: Boolean = true,
        val vpn: Boolean = false,
        val gps_spoofed: Boolean = false,
        val app_tamper: Boolean = true,
        val debug_mode: Boolean = true,
        val app_cloned: Boolean = false,
        val has_sensors: Boolean = false
    )

    data class BehavioralPayload(
        val tap_cadence_variance: Double = 150.0,
        val interaction_count: Int = 5,
        val touch_pressure_avg: Double = 0.0,
        val touch_area_avg: Double = 0.0
    )

    suspend fun send(
        eventType: String,
        userId: String,
        deviceFlags: DeviceFlags = DeviceFlags(),
        behavioral: BehavioralPayload? = null,
        overrideDeviceId: String? = null
    ): Boolean {
        val effectiveDeviceId = overrideDeviceId ?: deviceId

        val deviceJson = JSONObject().apply {
            put("rooted", deviceFlags.rooted)
            put("emulator", deviceFlags.emulator)
            put("vpn", deviceFlags.vpn)
            put("gps_spoofed", deviceFlags.gps_spoofed)
            put("app_tamper", deviceFlags.app_tamper)
            put("debug_mode", deviceFlags.debug_mode)
            put("app_cloned", deviceFlags.app_cloned)
            put("has_sensors", deviceFlags.has_sensors)
        }

        val payload = JSONObject().apply {
            put("event_id", "evt_${UUID.randomUUID()}")
            put("user_id", userId)
            put("device_id", effectiveDeviceId)
            put("event_type", eventType)
            put("timestamp", System.currentTimeMillis().toString())
            put("device", deviceJson)
            behavioral?.let { b ->
                put("behavioral", JSONObject().apply {
                    put("tap_cadence_variance", b.tap_cadence_variance)
                    put("interaction_count", b.interaction_count)
                    put("touch_pressure_avg", b.touch_pressure_avg)
                    put("touch_area_avg", b.touch_area_avg)
                })
            }
        }

        return withContext(Dispatchers.IO) {
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 5_000
                conn.readTimeout = 10_000
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                // No X-API-Key header — backend accepts keyless requests (soft auth)
                conn.doOutput = true
                conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                conn.disconnect()
                if (code !in 200..299) Log.w(TAG, "Send failed HTTP $code — $eventType")
                code in 200..299
            } catch (e: Exception) {
                Log.e(TAG, "Send exception — $eventType", e)
                false
            }
        }
    }

    companion object {
        private const val TAG = "DemoEventSender"
    }
}
