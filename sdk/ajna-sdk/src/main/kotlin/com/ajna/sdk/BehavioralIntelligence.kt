package com.ajna.sdk

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.view.MotionEvent
import java.util.Calendar
import kotlin.math.sqrt

/**
 * Passive behavioral-biometric collector.
 *
 * Emits a flat numeric feature map under the payload's "behavioral" key. The backend learns a
 * per-user baseline and flags deviation-from-self, so every field is well-formed (safe default 0.0)
 * even when a sensor or input stream is unavailable.
 *
 * BASELINE CONTRACT — the backend keys its per-user baseline on EXACTLY these fields, which are
 * unchanged in name and type:
 *   - tap_cadence_variance (Double)
 *   - touch_pressure_avg   (Double)
 *   - touch_area_avg       (Double)
 *   - interaction_count    (Int)
 *   - has_sensors          (Boolean)
 *
 * ADDITIVE features introduced in Phase 5 (richer Layer 1 collection):
 *   Keystroke dynamics:  key_dwell_avg, key_flight_avg, key_event_count
 *   Swipe/scroll:        swipe_velocity_avg, swipe_curvature_avg, swipe_count
 *   Device-handling:     motion_accel_variance, motion_gyro_variance, motion_sample_count
 *   Session timing:      session_hour, action_interval_avg, action_count
 *
 * Usage:
 *   BehavioralIntelligence.startMotionCapture(context)        // on session/activity start
 *   BehavioralIntelligence.recordTouchEvent(motionEvent)      // on touch
 *   BehavioralIntelligence.recordKeyEvent(downTimeMs, upTimeMs) // on key/char input
 *   BehavioralIntelligence.recordSwipe(motionEvent)           // on ACTION_MOVE streams
 *   BehavioralIntelligence.recordAction()                     // on a discrete user action
 *   // ... AjnaSDK.logEvent(...) calls collectBehavioralTelemetry() which snapshots + resets
 *   BehavioralIntelligence.stopMotionCapture()                // on session/activity stop
 */
object BehavioralIntelligence {

    // --- Touch (existing baseline inputs) ---
    private val touchTimestamps = mutableListOf<Long>()
    private val pressures = mutableListOf<Float>()
    private val areas = mutableListOf<Float>()

    // --- Keystroke dynamics ---
    // Dwell = key-up minus key-down (how long a key is held).
    // Flight = gap between releasing one key and pressing the next.
    private val keyDwellTimes = mutableListOf<Double>()
    private val keyFlightTimes = mutableListOf<Double>()
    private var lastKeyUpTime: Long = -1L

    // --- Swipe / scroll dynamics ---
    // Track per-gesture point streams to derive velocity and path curvature.
    private val swipeVelocities = mutableListOf<Double>()
    private val swipeCurvatures = mutableListOf<Double>()
    private var swipePoints = mutableListOf<SwipePoint>()

    private data class SwipePoint(val x: Float, val y: Float, val t: Long)

    // --- Device-handling motion (accelerometer + gyroscope) ---
    private val accelMagnitudes = mutableListOf<Double>()
    private val gyroMagnitudes = mutableListOf<Double>()
    private var sensorManager: SensorManager? = null
    private var motionListener: SensorEventListener? = null
    @Volatile private var motionCapturing = false

    // --- Session timing ---
    private val actionTimestamps = mutableListOf<Long>()

    // ---------------------------------------------------------------------
    // Touch (unchanged behavior)
    // ---------------------------------------------------------------------
    fun recordTouchEvent(event: MotionEvent) {
        touchTimestamps.add(event.eventTime)
        pressures.add(event.pressure)
        areas.add(event.size)
    }

    // ---------------------------------------------------------------------
    // Keystroke dynamics
    // ---------------------------------------------------------------------
    /**
     * Record a single keystroke's down/up timestamps (milliseconds, e.g. SystemClock.uptimeMillis()
     * or KeyEvent.getDownTime()/getEventTime()). Dwell and flight are derived passively; no key
     * identity or typed content is ever captured (no PII).
     */
    fun recordKeyEvent(downTimeMs: Long, upTimeMs: Long) {
        if (upTimeMs >= downTimeMs) {
            keyDwellTimes.add((upTimeMs - downTimeMs).toDouble())
        }
        if (lastKeyUpTime >= 0 && downTimeMs >= lastKeyUpTime) {
            keyFlightTimes.add((downTimeMs - lastKeyUpTime).toDouble())
        }
        lastKeyUpTime = upTimeMs
        recordAction()
    }

    // ---------------------------------------------------------------------
    // Swipe / scroll dynamics
    // ---------------------------------------------------------------------
    /**
     * Feed MotionEvent move streams (typically from onTouchEvent / onScroll). DOWN starts a gesture,
     * MOVE accumulates points, UP/CANCEL finalizes velocity and curvature for that gesture.
     */
    fun recordSwipe(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                swipePoints = mutableListOf(SwipePoint(event.x, event.y, event.eventTime))
            }
            MotionEvent.ACTION_MOVE -> {
                swipePoints.add(SwipePoint(event.x, event.y, event.eventTime))
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (event.actionMasked == MotionEvent.ACTION_UP) {
                    swipePoints.add(SwipePoint(event.x, event.y, event.eventTime))
                }
                finalizeSwipe()
            }
        }
    }

    private fun finalizeSwipe() {
        val points = swipePoints
        if (points.size >= 2) {
            // Straight-line displacement and total path length.
            var pathLength = 0.0
            for (i in 1 until points.size) {
                pathLength += dist(points[i - 1], points[i])
            }
            val displacement = dist(points.first(), points.last())
            val durationMs = (points.last().t - points.first().t).toDouble()

            if (durationMs > 0.0) {
                // px per second
                swipeVelocities.add(pathLength / (durationMs / 1000.0))
            }
            if (displacement > 0.0) {
                // Curvature ratio: 1.0 == perfectly straight, >1.0 == curved/erratic path.
                // Bots/automation tend toward 1.0; humans curve.
                swipeCurvatures.add(pathLength / displacement)
            }
        }
        swipePoints = mutableListOf()
    }

    private fun dist(a: SwipePoint, b: SwipePoint): Double {
        val dx = (b.x - a.x).toDouble()
        val dy = (b.y - a.y).toDouble()
        return sqrt(dx * dx + dy * dy)
    }

    // ---------------------------------------------------------------------
    // Device-handling motion (accelerometer + gyroscope)
    // ---------------------------------------------------------------------
    /**
     * Register accelerometer + gyroscope listeners to capture how the device is held/moved during
     * a session. Idempotent. Always pair with stopMotionCapture() to avoid listener leaks.
     */
    fun startMotionCapture(context: Context) {
        if (motionCapturing) return
        try {
            val sm = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
            val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            val gyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
            if (accel == null && gyro == null) return

            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    val v = event.values
                    if (v.size < 3) return
                    val magnitude = sqrt(
                        (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).toDouble()
                    )
                    when (event.sensor.type) {
                        Sensor.TYPE_ACCELEROMETER -> synchronized(accelMagnitudes) {
                            accelMagnitudes.add(magnitude)
                        }
                        Sensor.TYPE_GYROSCOPE -> synchronized(gyroMagnitudes) {
                            gyroMagnitudes.add(magnitude)
                        }
                    }
                }

                override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { /* no-op */ }
            }

            accel?.let { sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_NORMAL) }
            gyro?.let { sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_NORMAL) }
            sensorManager = sm
            motionListener = listener
            motionCapturing = true
        } catch (e: Exception) {
            // Leave motion features at their safe defaults if registration fails.
            motionCapturing = false
        }
    }

    /** Unregister motion listeners. Safe to call when capture was never started. */
    fun stopMotionCapture() {
        try {
            val sm = sensorManager
            val l = motionListener
            if (sm != null && l != null) {
                sm.unregisterListener(l)
            }
        } catch (e: Exception) {
            // ignore
        } finally {
            sensorManager = null
            motionListener = null
            motionCapturing = false
        }
    }

    // ---------------------------------------------------------------------
    // Session timing
    // ---------------------------------------------------------------------
    /** Mark a discrete user action for inter-action timing stats. Called automatically on keystrokes. */
    fun recordAction() {
        actionTimestamps.add(System.currentTimeMillis())
    }

    // ---------------------------------------------------------------------
    // Snapshot + reset
    // ---------------------------------------------------------------------
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

        // Keystroke dynamics
        val keyDwellAvg = if (keyDwellTimes.isEmpty()) 0.0 else keyDwellTimes.average()
        val keyFlightAvg = if (keyFlightTimes.isEmpty()) 0.0 else keyFlightTimes.average()
        val keyEventCount = keyDwellTimes.size

        // Swipe / scroll dynamics
        val swipeVelocityAvg = if (swipeVelocities.isEmpty()) 0.0 else swipeVelocities.average()
        val swipeCurvatureAvg = if (swipeCurvatures.isEmpty()) 0.0 else swipeCurvatures.average()
        val swipeCount = swipeVelocities.size

        // Device-handling motion
        val accelVariance = synchronized(accelMagnitudes) { variance(accelMagnitudes) }
        val gyroVariance = synchronized(gyroMagnitudes) { variance(gyroMagnitudes) }
        val motionSampleCount = synchronized(accelMagnitudes) { accelMagnitudes.size } +
            synchronized(gyroMagnitudes) { gyroMagnitudes.size }

        // Session timing
        val sessionHour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val actionIntervalAvg = if (actionTimestamps.size < 2) {
            0.0
        } else {
            actionTimestamps.zipWithNext { a, b -> (b - a).toDouble() }.average()
        }
        val actionCount = actionTimestamps.size

        val result = mapOf<String, Any>(
            // --- existing baseline fields (UNCHANGED) ---
            "touch_pressure_avg" to pressureAvg,
            "touch_area_avg" to areaAvg,
            "tap_cadence_variance" to cadenceVariance,
            "interaction_count" to count,
            // --- additive: keystroke dynamics ---
            "key_dwell_avg" to keyDwellAvg,
            "key_flight_avg" to keyFlightAvg,
            "key_event_count" to keyEventCount,
            // --- additive: swipe / scroll dynamics ---
            "swipe_velocity_avg" to swipeVelocityAvg,
            "swipe_curvature_avg" to swipeCurvatureAvg,
            "swipe_count" to swipeCount,
            // --- additive: device-handling motion ---
            "motion_accel_variance" to accelVariance,
            "motion_gyro_variance" to gyroVariance,
            "motion_sample_count" to motionSampleCount,
            // --- additive: session timing ---
            "session_hour" to sessionHour,
            "action_interval_avg" to actionIntervalAvg,
            "action_count" to actionCount
        )

        reset()
        return result
    }

    private fun variance(values: List<Double>): Double {
        if (values.size < 2) return 0.0
        val mean = values.average()
        return values.map { d -> (d - mean) * (d - mean) }.average()
    }

    /** Clears per-snapshot accumulators. Motion listeners stay registered until stopMotionCapture(). */
    private fun reset() {
        touchTimestamps.clear()
        pressures.clear()
        areas.clear()
        keyDwellTimes.clear()
        keyFlightTimes.clear()
        lastKeyUpTime = -1L
        swipeVelocities.clear()
        swipeCurvatures.clear()
        swipePoints = mutableListOf()
        synchronized(accelMagnitudes) { accelMagnitudes.clear() }
        synchronized(gyroMagnitudes) { gyroMagnitudes.clear() }
        actionTimestamps.clear()
    }
}
