package com.nothing.voiceagent.localllm

import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Cordova plugin bridge: JS `LocalLLM.chat(prompt)` -> here -> LlamaBridge (JNI) -> llama.cpp.
 *
 * Model loading happens once, off the main thread, the first time `chat` or `loadModel`
 * is called. Keep inference calls off the UI thread — a 3B model on a phone CPU takes
 * real time per response.
 */
class LocalLLMPlugin : CordovaPlugin() {

    private val bridge = LlamaBridge()
    private var modelLoaded = false
    private var visionModelLoaded = false

    override fun execute(action: String, args: JSONArray, callbackContext: CallbackContext): Boolean {
        when (action) {
            "chat" -> {
                val prompt = args.getString(0)
                CoroutineScope(Dispatchers.Default).launch {
                    ensureModelLoaded()
                    val response = bridge.chat(prompt)
                    callbackContext.sendPluginResult(PluginResult(PluginResult.Status.OK, response))
                }
                return true
            }
            "loadModel" -> {
                val modelFileName = args.getString(0)
                CoroutineScope(Dispatchers.Default).launch {
                    loadModel(modelFileName)
                    callbackContext.success()
                }
                return true
            }
            "describeImage" -> {
                val imagePath = args.getString(0)
                val prompt = args.getString(1)
                CoroutineScope(Dispatchers.Default).launch {
                    ensureVisionModelLoaded()
                    val response = bridge.describeImage(imagePath, prompt)
                    callbackContext.sendPluginResult(PluginResult(PluginResult.Status.OK, response))
                }
                return true
            }
            else -> return false
        }
    }

    private fun ensureModelLoaded() {
        if (!modelLoaded) {
            // Qwen3-0.6B, Q4_K_M — see MODEL.md. Newer training data than Qwen2.5-1.5B at
            // roughly comparable speed (Qwen3-1.7B was noticeably slower — ~15s vs ~5s
            // per turn). Qwen3's chain-of-thought "thinking" mode is suppressed via the
            // "/no_think" suffix llama_bridge.cpp appends to every prompt, and any
            // leftover <think></think> tags are stripped in local-llm.service.ts.
            // Expected at filesDir/<this-name> — pushed there via adb for testing rather
            // than the download-on-first-run flow MODEL.md describes.
            loadModel("qwen3-0.6b-instruct-q4_k_m.gguf")
        }
    }

    private fun loadModel(modelFileName: String) {
        val modelPath = cordova.activity.filesDir.resolve(modelFileName).absolutePath
        bridge.loadModel(modelPath)
        modelLoaded = true
    }

    private fun ensureVisionModelLoaded() {
        if (!visionModelLoaded) {
            // SmolVLM2-2.2B-Instruct, Q4_K_M — see MODEL.md's "Photo description" section.
            // Stepped up from SmolVLM-500M after it badly misidentified a clear, correctly
            // oriented test photo (a coffee mug called a "tree or person") — same tradeoff
            // pattern as the text model: bigger costs speed, but 500M was too inaccurate
            // to be useful. Needs both the base language model GGUF and its mmproj (vision
            // encoder) GGUF, pushed to filesDir the same way as the text model (adb, for now).
            val modelPath = cordova.activity.filesDir.resolve("smolvlm2-2.2b-instruct-q4_k_m.gguf").absolutePath
            val mmprojPath = cordova.activity.filesDir.resolve("smolvlm2-2.2b-instruct-mmproj-q8_0.gguf").absolutePath
            bridge.loadVisionModel(modelPath, mmprojPath)
            visionModelLoaded = true
        }
    }
}
