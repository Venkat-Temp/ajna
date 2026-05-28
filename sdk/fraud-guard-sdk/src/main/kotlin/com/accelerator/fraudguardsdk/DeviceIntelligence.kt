package com.accelerator.fraudguardsdk

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.provider.Settings
import java.io.File
import java.net.NetworkInterface

object DeviceIntelligence {

    fun getDeviceFingerprint(): String {
        return "${Build.MANUFACTURER}-${Build.MODEL}-${Build.VERSION.RELEASE}-${Build.BOARD}"
    }

    fun isRooted(): Boolean {
        val rootPaths = arrayOf(
            "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su",
            "/system/xbin/su", "/data/local/xbin/su", "/data/local/bin/su",
            "/system/sd/xbin/su", "/system/bin/failsafe/su", "/data/local/su",
            "/system/xbin/daemonsu"
        )
        for (path in rootPaths) {
            if (File(path).exists()) return true
        }
        // Check for su binary in PATH
        return try {
            Runtime.getRuntime().exec(arrayOf("which", "su")).waitFor() == 0
        } catch (e: Exception) {
            false
        }
    }

    fun isEmulator(): Boolean {
        return (Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.startsWith("unknown")
                || Build.MODEL.contains("google_sdk", ignoreCase = true)
                || Build.MODEL.contains("Emulator", ignoreCase = true)
                || Build.MODEL.contains("Android SDK built for x86")
                || Build.MANUFACTURER.contains("Genymotion", ignoreCase = true)
                || (Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic"))
                || "google_sdk" == Build.PRODUCT
                || Build.HARDWARE == "goldfish"
                || Build.HARDWARE == "ranchu")
    }

    fun isVpnActive(): Boolean {
        return try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return false
            for (iface in interfaces) {
                if (iface.isUp && !iface.isLoopback) {
                    val name = iface.name
                    if (name.contains("tun") || name.contains("ppp") || name.contains("pptp")) {
                        return true
                    }
                }
            }
            false
        } catch (e: Exception) {
            false
        }
    }

    // GPS spoofing: detect if mock location is enabled (developer setting or injected provider)
    fun isGPSSpoofed(context: Context): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.Secure.getInt(
                    context.contentResolver,
                    Settings.Secure.ALLOW_MOCK_LOCATION, 0
                ) != 0
            } else {
                @Suppress("DEPRECATION")
                Settings.Secure.getString(
                    context.contentResolver,
                    Settings.Secure.ALLOW_MOCK_LOCATION
                ) != "0"
            }
        } catch (e: Exception) {
            false
        }
    }

    // App tamper: check if the installer is not the Play Store
    fun isAppTampered(context: Context): Boolean {
        return try {
            val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                context.packageManager
                    .getInstallSourceInfo(context.packageName)
                    .installingPackageName
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getInstallerPackageName(context.packageName)
            }
            installer != "com.android.vending" && installer != "com.google.android.feedback"
        } catch (e: Exception) {
            false
        }
    }

    // Debug mode: check if the app was signed with a debug certificate
    fun isDebugMode(context: Context): Boolean {
        return try {
            (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        } catch (e: Exception) {
            false
        }
    }

    fun collectTelemetry(context: Context): Map<String, Any> {
        return mapOf(
            "os" to "Android",
            "os_version" to Build.VERSION.RELEASE,
            "model" to Build.MODEL,
            "manufacturer" to Build.MANUFACTURER,
            "fingerprint" to getDeviceFingerprint(),
            "rooted" to isRooted(),
            "emulator" to isEmulator(),
            "vpn" to isVpnActive(),
            "gps_spoofed" to isGPSSpoofed(context),
            "app_tamper" to isAppTampered(context),
            "debug_mode" to isDebugMode(context),
        )
    }
}
