package com.scalex.frauddemo

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.scalex.frauddemo.ui.ScenarioSelectorActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(Intent(this, ScenarioSelectorActivity::class.java))
        finish()
    }
}
