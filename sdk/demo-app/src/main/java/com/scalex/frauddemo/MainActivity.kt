package com.scalex.frauddemo

import android.os.Bundle
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.ajna.sdk.AjnaSDK

class MainActivity : AppCompatActivity() {

    private val mockUserId = "usr_mobile_demo_01"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        AjnaSDK.init(this, key = "demo-key-local")

        fun send(eventType: String, label: String) {
            AjnaSDK.logEvent(eventType, mockUserId)
            Toast.makeText(this, "$label sent", Toast.LENGTH_SHORT).show()
        }

        findViewById<Button>(R.id.btn_signup).setOnClickListener { send("signup", "Signup") }
        findViewById<Button>(R.id.btn_login).setOnClickListener { send("login", "Login") }
        findViewById<Button>(R.id.btn_otp_fail).setOnClickListener { send("otp_failure", "OTP Failure") }
        findViewById<Button>(R.id.btn_referral).setOnClickListener { send("referral_claim", "Referral Claim") }
        findViewById<Button>(R.id.btn_wallet_transfer).setOnClickListener { send("wallet_transfer", "Wallet Transfer") }
        findViewById<Button>(R.id.btn_account_recovery).setOnClickListener { send("account_recovery", "Account Recovery") }
    }
}
