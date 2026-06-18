package com.scalex.frauddemo.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class ScenarioFlowEngine(private val sender: DemoEventSender) {

    sealed class FlowState {
        object Idle : FlowState()
        data class Running(
            val stepIndex: Int,
            val totalSteps: Int,
            val currentStep: ScenarioStep
        ) : FlowState()
        data class StepComplete(val stepIndex: Int, val success: Boolean) : FlowState()
        data class Finished(val scenario: ScenarioDefinition) : FlowState()
        data class Error(val message: String) : FlowState()
    }

    private val _state = MutableStateFlow<FlowState>(FlowState.Idle)
    val state: StateFlow<FlowState> = _state

    private var job: Job? = null

    fun launch(scenario: ScenarioDefinition, scope: CoroutineScope) {
        job?.cancel()
        job = scope.launch(Dispatchers.IO) {
            try {
                scenario.steps.forEachIndexed { index, step ->
                    _state.value = FlowState.Running(index, scenario.steps.size, step)
                    delay(step.delayBeforeMs)
                    val ok = sender.send(
                        eventType = step.eventType,
                        userId = step.userId,
                        deviceFlags = step.deviceFlags,
                        behavioral = step.behavioral,
                        overrideDeviceId = step.overrideDeviceId
                    )
                    _state.value = FlowState.StepComplete(index, ok)
                }
                _state.value = FlowState.Finished(scenario)
            } catch (e: CancellationException) {
                _state.value = FlowState.Idle
            } catch (e: Exception) {
                _state.value = FlowState.Error(e.message ?: "Unknown error")
            }
        }
    }

    fun cancel() {
        job?.cancel()
        _state.value = FlowState.Idle
    }
}
