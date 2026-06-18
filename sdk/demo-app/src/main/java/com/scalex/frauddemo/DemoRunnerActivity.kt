package com.scalex.frauddemo

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import com.scalex.frauddemo.core.ScenarioDefinitions
import com.scalex.frauddemo.ui.InteractiveFlowActivity

/**
 * ADB entry point — launches the interactive flow for a given scenario.
 *   adb shell am start -n com.scalex.frauddemo/.DemoRunnerActivity \
 *     -a com.scalex.frauddemo.RUN_SCENARIO --es SCENARIO otp_attack
 *
 * The Python demo-runner.py script then drives the interactive screens
 * by typing into fields and tapping buttons via adb input commands.
 */
class DemoRunnerActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scenarioId = intent.getStringExtra("SCENARIO")
        if (scenarioId == null || ScenarioDefinitions.build(scenarioId) == null) {
            Log.e(TAG, "Unknown or missing SCENARIO: $scenarioId")
            finish()
            return
        }

        startActivity(
            Intent(this, InteractiveFlowActivity::class.java)
                .putExtra("SCENARIO_ID", scenarioId)
        )
        finish()
    }

    companion object {
        private const val TAG = "DemoRunnerActivity"
    }
}
