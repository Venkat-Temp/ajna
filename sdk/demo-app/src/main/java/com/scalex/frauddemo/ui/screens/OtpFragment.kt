package com.scalex.frauddemo.ui.screens

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.scalex.frauddemo.R
import com.scalex.frauddemo.ui.InteractiveFlowActivity

class OtpFragment : Fragment() {

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        inflater.inflate(R.layout.fragment_otp, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val attempt = arguments?.getInt(ARG_ATTEMPT, 0) ?: 0

        val tvAttempt = view.findViewById<TextView>(R.id.tv_attempt)
        val tvError   = view.findViewById<TextView>(R.id.tv_error)
        val etOtp     = view.findViewById<EditText>(R.id.et_otp)

        if (attempt > 0) {
            tvAttempt.text = "Attempt $attempt"
            tvError.visibility = View.VISIBLE   // show error after first failure
            etOtp.text.clear()                  // clear field for next attempt
        }

        view.findViewById<TextView>(R.id.btn_action).setOnClickListener {
            (activity as? InteractiveFlowActivity)?.onAction()
        }
    }

    companion object {
        private const val ARG_ATTEMPT = "attempt"

        fun newInstance(badge: String?, attempt: Int, delayMs: Long) =
            OtpFragment().apply {
                arguments = Bundle().apply { putInt(ARG_ATTEMPT, attempt) }
            }
    }
}
