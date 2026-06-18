package com.scalex.frauddemo.ui.screens

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.scalex.frauddemo.R
import com.scalex.frauddemo.ui.InteractiveFlowActivity

class SignupFragment : Fragment() {

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        inflater.inflate(R.layout.fragment_signup, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val badge   = arguments?.getString(ARG_BADGE)
        val counter = arguments?.getString(ARG_COUNTER)

        view.findViewById<TextView>(R.id.tv_badge).apply {
            if (badge != null) { text = badge; visibility = View.VISIBLE }
        }
        view.findViewById<TextView>(R.id.tv_counter).apply {
            if (counter != null) { text = counter; visibility = View.VISIBLE }
        }

        view.findViewById<TextView>(R.id.btn_action).setOnClickListener {
            (activity as? InteractiveFlowActivity)?.onAction()
        }
    }

    companion object {
        private const val ARG_BADGE   = "badge"
        private const val ARG_COUNTER = "counter"

        fun newInstance(badge: String?, delayMs: Long, counter: String? = null) =
            SignupFragment().apply {
                arguments = Bundle().apply {
                    badge?.let   { putString(ARG_BADGE, it) }
                    counter?.let { putString(ARG_COUNTER, it) }
                }
            }
    }
}
