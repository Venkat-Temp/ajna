package com.scalex.frauddemo.ui.screens

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.scalex.frauddemo.R
import com.scalex.frauddemo.ui.InteractiveFlowActivity

class WalletFragment : Fragment() {

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        inflater.inflate(R.layout.fragment_wallet, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val badge = arguments?.getString(ARG_BADGE)
        view.findViewById<TextView>(R.id.tv_badge).apply {
            if (badge != null) { text = badge; visibility = View.VISIBLE }
        }

        view.findViewById<TextView>(R.id.btn_action).setOnClickListener {
            (activity as? InteractiveFlowActivity)?.onAction()
        }
    }

    companion object {
        private const val ARG_BADGE = "badge"

        fun newInstance(badge: String?, delayMs: Long) =
            WalletFragment().apply {
                arguments = Bundle().apply { badge?.let { putString(ARG_BADGE, it) } }
            }
    }
}
