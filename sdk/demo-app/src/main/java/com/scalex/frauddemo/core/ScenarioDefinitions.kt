package com.scalex.frauddemo.core

import java.util.UUID

data class ScenarioStep(
    val screenLabel: String,
    val statusMessage: String,
    val eventType: String,
    val userId: String,
    val deviceFlags: DemoEventSender.DeviceFlags,
    val behavioral: DemoEventSender.BehavioralPayload? = null,
    val overrideDeviceId: String? = null,
    val badge: String? = null,
    val delayBeforeMs: Long = 1200L
)

data class ScenarioDefinition(
    val id: String,
    val displayName: String,
    val description: String,
    val icon: String,
    val riskBadge: String,
    val steps: List<ScenarioStep>
)

object ScenarioDefinitions {

    data class ScenarioMeta(
        val id: String,
        val displayName: String,
        val description: String,
        val icon: String,
        val stepCount: Int,
        val riskBadge: String
    )

    val allMeta: List<ScenarioMeta> = listOf(
        ScenarioMeta("emulator_farm",      "Device Farm",        "25 signups from a single emulator",      "🤖", 25, "FRAUD"),
        ScenarioMeta("otp_attack",         "OTP Brute Force",    "8 OTP failures on one account",          "🔐",  8, "FRAUD"),
        ScenarioMeta("referral_abuse",     "Referral Farm",      "10 referral claims from same device",    "💸", 10, "HIGH"),
        ScenarioMeta("rooted_wallet",      "Rooted Wallet",      "Wallet transfer from rooted device",     "🔓",  3, "FRAUD"),
        ScenarioMeta("gps_spoofing",       "GPS Spoofing",       "Login with spoofed location",            "📍",  2, "FRAUD"),
        ScenarioMeta("account_sharing",    "Multi-Device ATO",   "One user logging in from 4 devices",     "📱",  4, "HIGH"),
        ScenarioMeta("account_takeover",   "Credential Stuffing","1 user × 5 devices with login failures", "⚠️", 15, "FRAUD"),
        ScenarioMeta("checkout_fraud",     "Checkout Fraud",     "Rooted + VPN during high-value checkout","🛒",  3, "FRAUD"),
        ScenarioMeta("bot_farm",           "Bot Farm",           "10 automated signups with bot timing",   "🦾", 10, "FRAUD"),
        ScenarioMeta("app_cloning_abuse",  "App Cloning",        "5 accounts from same cloned app",        "🧬",  5, "HIGH")
    )

    fun build(id: String): ScenarioDefinition? = when (id) {
        "emulator_farm"     -> buildEmulatorFarm()
        "otp_attack"        -> buildOtpAttack()
        "referral_abuse"    -> buildReferralAbuse()
        "rooted_wallet"     -> buildRootedWallet()
        "gps_spoofing"      -> buildGpsSpoofing()
        "account_sharing"   -> buildAccountSharing()
        "account_takeover"  -> buildAccountTakeover()
        "checkout_fraud"    -> buildCheckoutFraud()
        "bot_farm"          -> buildBotFarm()
        "app_cloning_abuse" -> buildAppCloningAbuse()
        else -> null
    }

    private fun randomSuffix() = UUID.randomUUID().toString().take(4)

    private fun buildEmulatorFarm(): ScenarioDefinition {
        val s = randomSuffix()
        val flags = DemoEventSender.DeviceFlags()
        return ScenarioDefinition(
            id = "emulator_farm",
            displayName = "Device Farm",
            description = "25 signups from a single emulator",
            icon = "🤖",
            riskBadge = "FRAUD",
            steps = (0 until 25).map { i ->
                ScenarioStep(
                    screenLabel = "signup",
                    statusMessage = "Creating account ${i + 1} of 25…",
                    eventType = "signup",
                    userId = "farm_user_${s}_$i",
                    deviceFlags = flags,
                    delayBeforeMs = 400L
                )
            }
        )
    }

    private fun buildOtpAttack(): ScenarioDefinition {
        val s = randomSuffix()
        val flags = DemoEventSender.DeviceFlags()
        return ScenarioDefinition(
            id = "otp_attack",
            displayName = "OTP Brute Force",
            description = "8 OTP failures on one account",
            icon = "🔐",
            riskBadge = "FRAUD",
            steps = (1..8).map { i ->
                ScenarioStep(
                    screenLabel = "otp",
                    statusMessage = "Wrong OTP attempt $i of 8…",
                    eventType = "otp_failure",
                    userId = "otp_victim_$s",
                    deviceFlags = flags,
                    delayBeforeMs = 1500L
                )
            }
        )
    }

    private fun buildReferralAbuse(): ScenarioDefinition {
        val s = randomSuffix()
        val flags = DemoEventSender.DeviceFlags()
        return ScenarioDefinition(
            id = "referral_abuse",
            displayName = "Referral Farm",
            description = "10 referral claims from same device",
            icon = "💸",
            riskBadge = "HIGH",
            steps = (0 until 10).map { i ->
                ScenarioStep(
                    screenLabel = "signup",
                    statusMessage = "Claiming referral for account ${i + 1} of 10…",
                    eventType = "referral_claim",
                    userId = "ref_user_${s}_$i",
                    deviceFlags = flags,
                    delayBeforeMs = 800L
                )
            }
        )
    }

    private fun buildRootedWallet(): ScenarioDefinition {
        val s = randomSuffix()
        val flags = DemoEventSender.DeviceFlags(rooted = true)
        return ScenarioDefinition(
            id = "rooted_wallet",
            displayName = "Rooted Wallet",
            description = "Wallet transfer from rooted device",
            icon = "🔓",
            riskBadge = "FRAUD",
            steps = listOf(
                ScenarioStep("login",  "Logging in on rooted device…",          "login",           "wallet_user_$s", flags, badge = "ROOT",  delayBeforeMs = 1500L),
                ScenarioStep("wallet", "Initiating ₹15,000 transfer…",          "wallet_transfer", "wallet_user_$s", flags, badge = "ROOT",  delayBeforeMs = 2000L),
                ScenarioStep("wallet", "Processing payment on rooted device…",  "payment_attempt", "wallet_user_$s", flags, badge = "ROOT",  delayBeforeMs = 1500L)
            )
        )
    }

    private fun buildGpsSpoofing(): ScenarioDefinition {
        val s = randomSuffix()
        val flags = DemoEventSender.DeviceFlags(gps_spoofed = true)
        return ScenarioDefinition(
            id = "gps_spoofing",
            displayName = "GPS Spoofing",
            description = "Login with spoofed location",
            icon = "📍",
            riskBadge = "FRAUD",
            steps = listOf(
                ScenarioStep("login",  "Login from spoofed GPS location…",       "login",            "geo_user_$s", flags, badge = "GPS",   delayBeforeMs = 2000L),
                ScenarioStep("login",  "Account recovery with spoofed location…","account_recovery", "geo_user_$s", flags, badge = "GPS",   delayBeforeMs = 2000L)
            )
        )
    }

    private fun buildAccountSharing(): ScenarioDefinition {
        val s = randomSuffix()
        val userId = "shared_user_$s"
        val flags = DemoEventSender.DeviceFlags()
        return ScenarioDefinition(
            id = "account_sharing",
            displayName = "Multi-Device ATO",
            description = "One user logging in from 4 devices",
            icon = "📱",
            riskBadge = "HIGH",
            steps = (0 until 4).map { i ->
                ScenarioStep(
                    screenLabel = "login",
                    statusMessage = "Login from Device ${i + 1} of 4…",
                    eventType = "login",
                    userId = userId,
                    deviceFlags = flags,
                    overrideDeviceId = "demo_dev_${s}_$i",
                    delayBeforeMs = 2000L
                )
            }
        )
    }

    private fun buildAccountTakeover(): ScenarioDefinition {
        val s = randomSuffix()
        val userId = "ato_victim_$s"
        val flags = DemoEventSender.DeviceFlags()
        val steps = mutableListOf<ScenarioStep>()
        for (d in 0 until 5) {
            val devId = "ato_dev_${s}_$d"
            steps += ScenarioStep("login", "Login attempt from device ${d + 1}…",       "login",         userId, flags, overrideDeviceId = devId, delayBeforeMs = 800L)
            steps += ScenarioStep("login", "Login failed on device ${d + 1}…",          "login_failure", userId, flags, overrideDeviceId = devId, delayBeforeMs = 600L)
            steps += ScenarioStep("login", "Retrying on device ${d + 1}…",              "login_failure", userId, flags, overrideDeviceId = devId, delayBeforeMs = 600L)
        }
        return ScenarioDefinition(
            id = "account_takeover",
            displayName = "Credential Stuffing",
            description = "1 user × 5 devices with login failures",
            icon = "⚠️",
            riskBadge = "FRAUD",
            steps = steps
        )
    }

    private fun buildCheckoutFraud(): ScenarioDefinition {
        val s = randomSuffix()
        val flags = DemoEventSender.DeviceFlags(rooted = true, vpn = true)
        return ScenarioDefinition(
            id = "checkout_fraud",
            displayName = "Checkout Fraud",
            description = "Rooted + VPN during high-value checkout",
            icon = "🛒",
            riskBadge = "FRAUD",
            steps = listOf(
                ScenarioStep("wallet",   "Wallet transfer on rooted + VPN device…", "wallet_transfer",  "checkout_user_$s", flags, badge = "VPN", delayBeforeMs = 2000L),
                ScenarioStep("checkout", "Adding item to cart (rooted device)…",    "payment_attempt",  "checkout_user_$s", flags, badge = "VPN", delayBeforeMs = 1800L),
                ScenarioStep("checkout", "Completing checkout over VPN…",            "checkout",         "checkout_user_$s", flags, badge = "VPN", delayBeforeMs = 1800L)
            )
        )
    }

    private fun buildBotFarm(): ScenarioDefinition {
        val s = randomSuffix()
        val flags = DemoEventSender.DeviceFlags(app_cloned = true, has_sensors = false)
        val botBehavior = DemoEventSender.BehavioralPayload(
            tap_cadence_variance = 2.5,
            interaction_count = 5,
            touch_pressure_avg = 0.0,
            touch_area_avg = 0.0
        )
        return ScenarioDefinition(
            id = "bot_farm",
            displayName = "Bot Farm",
            description = "10 automated signups with bot timing",
            icon = "🦾",
            riskBadge = "FRAUD",
            steps = (0 until 10).map { i ->
                ScenarioStep(
                    screenLabel = "terminal",
                    statusMessage = "Bot registering account ${i + 1} of 10…",
                    eventType = "signup",
                    userId = "bot_user_${s}_$i",
                    deviceFlags = flags,
                    behavioral = botBehavior,
                    badge = "BOT",
                    delayBeforeMs = 150L
                )
            }
        )
    }

    private fun buildAppCloningAbuse(): ScenarioDefinition {
        val s = randomSuffix()
        val flags = DemoEventSender.DeviceFlags(app_cloned = true)
        return ScenarioDefinition(
            id = "app_cloning_abuse",
            displayName = "App Cloning",
            description = "5 accounts from same cloned app",
            icon = "🧬",
            riskBadge = "HIGH",
            steps = (0 until 5).map { i ->
                ScenarioStep(
                    screenLabel = "signup",
                    statusMessage = "Clone instance #${i + 1} creating account…",
                    eventType = "signup",
                    userId = "clone_user_${s}_$i",
                    deviceFlags = flags,
                    badge = "CLONED",
                    delayBeforeMs = 900L
                )
            }
        )
    }
}
