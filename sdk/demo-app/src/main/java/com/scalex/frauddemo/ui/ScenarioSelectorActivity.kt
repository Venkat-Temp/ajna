package com.scalex.frauddemo.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.scalex.frauddemo.R
import com.scalex.frauddemo.core.ScenarioDefinitions

class ScenarioSelectorActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_scenario_selector)

        val rv = findViewById<RecyclerView>(R.id.rv_scenarios)
        rv.layoutManager = GridLayoutManager(this, 2)
        rv.adapter = ScenarioAdapter(ScenarioDefinitions.allMeta) { meta ->
            startActivity(
                Intent(this, InteractiveFlowActivity::class.java)
                    .putExtra("SCENARIO_ID", meta.id)
            )
        }
    }

    private class ScenarioAdapter(
        private val items: List<ScenarioDefinitions.ScenarioMeta>,
        private val onClick: (ScenarioDefinitions.ScenarioMeta) -> Unit
    ) : RecyclerView.Adapter<ScenarioAdapter.VH>() {

        inner class VH(view: View) : RecyclerView.ViewHolder(view) {
            val icon:  TextView = view.findViewById(R.id.tv_icon)
            val name:  TextView = view.findViewById(R.id.tv_name)
            val steps: TextView = view.findViewById(R.id.tv_step_count)
            val badge: TextView = view.findViewById(R.id.tv_risk_badge)
            val desc:  TextView = view.findViewById(R.id.tv_description)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
            VH(LayoutInflater.from(parent.context).inflate(R.layout.item_scenario_card, parent, false))

        override fun getItemCount() = items.size

        override fun onBindViewHolder(holder: VH, position: Int) {
            val meta = items[position]
            holder.icon.text  = meta.icon
            holder.name.text  = meta.displayName
            holder.steps.text = "${meta.stepCount} events"
            holder.badge.text = meta.riskBadge
            holder.badge.setTextColor(0xFFFFFFFF.toInt())
            holder.desc.text  = meta.description
            holder.itemView.setOnClickListener { onClick(meta) }
        }
    }
}
