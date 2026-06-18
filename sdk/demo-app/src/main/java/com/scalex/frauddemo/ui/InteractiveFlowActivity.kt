package com.scalex.frauddemo.ui

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.scalex.frauddemo.R
import com.scalex.frauddemo.core.DemoEventSender
import com.scalex.frauddemo.core.ScenarioDefinitions
import com.scalex.frauddemo.core.ScenarioStep
import com.scalex.frauddemo.ui.screens.CheckoutFragment
import com.scalex.frauddemo.ui.screens.CompletionFragment
import com.scalex.frauddemo.ui.screens.LoginFragment
import com.scalex.frauddemo.ui.screens.OtpFragment
import com.scalex.frauddemo.ui.screens.SignupFragment
import com.scalex.frauddemo.ui.screens.TerminalFragment
import com.scalex.frauddemo.ui.screens.WalletFragment
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Interactive demo activity. Each fragment shows a real form with EditText fields and a
 * real action button. Tapping the button fires an event to the backend and advances the
 * scenario to the next step. The Python script drives the same activity via ADB input commands.
 */
class InteractiveFlowActivity : AppCompatActivity() {

    // Shared with all child fragments
    interface ActionCallback {
        fun onAction()
    }

    private var stepIndex = 0
    private var isFiring = false
    private lateinit var steps: List<ScenarioStep>
    private lateinit var sender: DemoEventSender

    private lateinit var tvIcon: TextView
    private lateinit var tvName: TextView
    private lateinit var tvStepCounter: TextView
    private lateinit var tvResult: TextView
    private lateinit var pbProgress: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_interactive_flow)

        val scenarioId = intent.getStringExtra("SCENARIO_ID") ?: run { finish(); return }
        val scenario = ScenarioDefinitions.build(scenarioId) ?: run { finish(); return }

        steps = scenario.steps
        sender = DemoEventSender(this)

        tvIcon        = findViewById(R.id.tv_scenario_icon)
        tvName        = findViewById(R.id.tv_scenario_name)
        tvStepCounter = findViewById(R.id.tv_step_counter)
        tvResult      = findViewById(R.id.tv_result)
        pbProgress    = findViewById(R.id.pb_progress)

        tvIcon.text = scenario.icon
        tvName.text = scenario.displayName

        stepIndex = savedInstanceState?.getInt("step_index", 0) ?: 0
        showStep(stepIndex)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt("step_index", stepIndex)
    }

    /** Called by child fragments when the user taps the action button. */
    fun onAction() {
        if (isFiring || stepIndex >= steps.size) return
        isFiring = true

        val step = steps[stepIndex]

        lifecycleScope.launch {
            setResultBanner(null)

            val ok = sender.send(
                eventType       = step.eventType,
                userId          = step.userId,
                deviceFlags     = step.deviceFlags,
                behavioral      = step.behavioral,
                overrideDeviceId = step.overrideDeviceId
            )

            showResultBanner(ok, step.eventType)
            delay(700)
            setResultBanner(null)

            stepIndex++
            if (stepIndex < steps.size) {
                showStep(stepIndex)
            } else {
                showComplete()
            }
            isFiring = false
        }
    }

    private fun showStep(index: Int) {
        val step  = steps[index]
        val total = steps.size

        tvStepCounter.text = "Step ${index + 1} of $total"
        pbProgress.progress = ((index.toFloat() / total) * 100).toInt()

        val fragment: Fragment = when (step.screenLabel) {
            "otp"      -> OtpFragment.newInstance(step.badge, index + 1, 0L)
            "wallet"   -> WalletFragment.newInstance(step.badge, 0L)
            "checkout" -> CheckoutFragment.newInstance(step.badge, 0L)
            "terminal" -> TerminalFragment.newInstance(step.badge, index, 0L)
            "signup"   -> SignupFragment.newInstance(step.badge, 0L)
            else       -> LoginFragment.newInstance(step.badge, 0L)
        }

        supportFragmentManager.beginTransaction()
            .setCustomAnimations(android.R.anim.fade_in, android.R.anim.fade_out)
            .replace(R.id.fragment_container, fragment)
            .commitAllowingStateLoss()
    }

    private fun showComplete() {
        tvStepCounter.text = "All done ✓"
        pbProgress.progress = 100

        supportFragmentManager.beginTransaction()
            .setCustomAnimations(android.R.anim.fade_in, android.R.anim.fade_out)
            .replace(R.id.fragment_container, CompletionFragment())
            .commitAllowingStateLoss()
    }

    private fun showResultBanner(ok: Boolean, eventType: String) {
        tvResult.visibility = View.VISIBLE
        if (ok) {
            tvResult.text = "✓ $eventType sent"
            tvResult.setTextColor(Color.parseColor("#4ADE80"))
            tvResult.setBackgroundColor(Color.parseColor("#0A2E0A"))
        } else {
            tvResult.text = "✗ send failed"
            tvResult.setTextColor(Color.parseColor("#F87171"))
            tvResult.setBackgroundColor(Color.parseColor("#2E0A0A"))
        }
    }

    private fun setResultBanner(msg: String?) {
        if (msg == null) {
            tvResult.visibility = View.GONE
        } else {
            tvResult.visibility = View.VISIBLE
            tvResult.text = msg
        }
    }

    override fun onBackPressed() {
        super.onBackPressed()
    }
}
