package com.scalex.frauddemo.ui.screens

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.scalex.frauddemo.R
import com.scalex.frauddemo.ui.InteractiveFlowActivity

class TerminalFragment : Fragment() {

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        inflater.inflate(R.layout.fragment_terminal, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val stepIndex = arguments?.getInt(ARG_STEP_INDEX, 0) ?: 0

        // Accumulate log lines up to current step
        val logLines = buildString {
            for (i in 0..stepIndex) {
                append("[BOT-${i + 1}] Generating fingerprint… OK\n")
                append("[BOT-${i + 1}] Sending signup event… ")
                if (i < stepIndex) append("✓ registered\n\n") else append("⟳ pending\n")
            }
        }
        view.findViewById<TextView>(R.id.tv_log).text = logLines.trim()

        view.findViewById<TextView>(R.id.btn_action).setOnClickListener {
            (activity as? InteractiveFlowActivity)?.onAction()
        }
    }

    companion object {
        private const val ARG_STEP_INDEX = "step_index"

        fun newInstance(badge: String?, stepIndex: Int, delayMs: Long) =
            TerminalFragment().apply {
                arguments = Bundle().apply { putInt(ARG_STEP_INDEX, stepIndex) }
            }
    }
}
