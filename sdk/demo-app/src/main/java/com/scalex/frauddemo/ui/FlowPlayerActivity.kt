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
import com.scalex.frauddemo.core.ScenarioFlowEngine
import com.scalex.frauddemo.ui.screens.CheckoutFragment
import com.scalex.frauddemo.ui.screens.LoginFragment
import com.scalex.frauddemo.ui.screens.OtpFragment
import com.scalex.frauddemo.ui.screens.SignupFragment
import com.scalex.frauddemo.ui.screens.TerminalFragment
import com.scalex.frauddemo.ui.screens.WalletFragment
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class FlowPlayerActivity : AppCompatActivity() {

    private lateinit var engine: ScenarioFlowEngine

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_flow_player)

        val scenarioId = intent.getStringExtra("SCENARIO_ID") ?: run { finish(); return }
        val scenario = ScenarioDefinitions.build(scenarioId) ?: run { finish(); return }

        val tvIcon        = findViewById<TextView>(R.id.tv_scenario_icon)
        val tvName        = findViewById<TextView>(R.id.tv_scenario_name)
        val tvStepCounter = findViewById<TextView>(R.id.tv_step_counter)
        val tvBadge       = findViewById<TextView>(R.id.tv_badge)
        val pbProgress    = findViewById<ProgressBar>(R.id.pb_progress)
        val tvStatus      = findViewById<TextView>(R.id.tv_status)
        val tvEventLabel  = findViewById<TextView>(R.id.tv_event_label)

        tvIcon.text = scenario.icon
        tvName.text = scenario.displayName

        val sender = DemoEventSender(this)
        engine = ScenarioFlowEngine(sender)

        lifecycleScope.launch {
            engine.state.collect { state ->
                when (state) {
                    is ScenarioFlowEngine.FlowState.Running -> {
                        val step  = state.currentStep
                        val total = state.totalSteps
                        val idx   = state.stepIndex

                        tvStepCounter.text = "Step ${idx + 1} of $total"
                        pbProgress.progress = ((idx.toFloat() / total) * 100).toInt()
                        tvEventLabel.text = "FIRING EVENT"
                        tvStatus.text = "${step.eventType}  ·  ${step.statusMessage}"
                        tvStatus.setTextColor(Color.parseColor("#94A3B8"))

                        tvBadge.visibility = if (step.badge != null) {
                            tvBadge.text = step.badge; View.VISIBLE
                        } else View.GONE

                        swapFragment(step.screenLabel, step.badge, step.delayBeforeMs, idx)
                    }

                    is ScenarioFlowEngine.FlowState.StepComplete -> {
                        // Brief green flash to confirm event sent
                        tvEventLabel.text = if (state.success) "SENT ✓" else "RETRY"
                        tvStatus.setTextColor(
                            Color.parseColor(if (state.success) "#4ADE80" else "#F87171")
                        )
                        delay(300)
                        tvStatus.setTextColor(Color.parseColor("#94A3B8"))
                    }

                    is ScenarioFlowEngine.FlowState.Finished -> {
                        pbProgress.progress = 100
                        tvStepCounter.text = "Complete ✓"
                        tvEventLabel.text = "DONE"
                        tvStatus.text = "All events fired — check the dashboard"
                        tvStatus.setTextColor(Color.parseColor("#4ADE80"))
                    }

                    is ScenarioFlowEngine.FlowState.Error -> {
                        tvStatus.text = "Error: ${state.message}"
                        finish()
                    }

                    else -> {}
                }
            }
        }

        engine.launch(scenario, lifecycleScope)
    }

    private fun swapFragment(screenLabel: String, badge: String?, delayMs: Long, stepIndex: Int) {
        val fragment: Fragment = when (screenLabel) {
            "otp"      -> OtpFragment.newInstance(badge, stepIndex + 1, delayMs)
            "wallet"   -> WalletFragment.newInstance(badge, delayMs)
            "checkout" -> CheckoutFragment.newInstance(badge, delayMs)
            "terminal" -> TerminalFragment.newInstance(badge, stepIndex, delayMs)
            "signup"   -> SignupFragment.newInstance(badge, delayMs)
            else       -> LoginFragment.newInstance(badge, delayMs)
        }
        supportFragmentManager.beginTransaction()
            .setCustomAnimations(android.R.anim.fade_in, android.R.anim.fade_out)
            .replace(R.id.fragment_container, fragment)
            .commitAllowingStateLoss()
    }

    override fun onBackPressed() {
        engine.cancel()
        super.onBackPressed()
    }
}
