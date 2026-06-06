package com.ajna.sdk

import android.view.MotionEvent

object BehavioralIntelligence {
    private val touchTimestamps = mutableListOf<Long>()
    private val pressures = mutableListOf<Float>()
    private val areas = mutableListOf<Float>()

    fun recordTouchEvent(event: MotionEvent) {
        touchTimestamps.add(event.eventTime)
        pressures.add(event.pressure)
        areas.add(event.size)
    }

    fun collectBehavioralTelemetry(): Map<String, Any> {
        val count = touchTimestamps.size

        val pressureAvg = if (pressures.isEmpty()) 0.0 else pressures.map { it.toDouble() }.average()
        val areaAvg = if (areas.isEmpty()) 0.0 else areas.map { it.toDouble() }.average()

        val cadenceVariance = if (touchTimestamps.size < 2) {
            0.0
        } else {
            val deltas = touchTimestamps.zipWithNext { a, b -> (b - a).toDouble() }
            val mean = deltas.average()
            deltas.map { d -> (d - mean) * (d - mean) }.average()
        }

        val result = mapOf<String, Any>(
            "touch_pressure_avg" to pressureAvg,
            "touch_area_avg" to areaAvg,
            "tap_cadence_variance" to cadenceVariance,
            "interaction_count" to count
        )

        touchTimestamps.clear()
        pressures.clear()
        areas.clear()

        return result
    }
}
