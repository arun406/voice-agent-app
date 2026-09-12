package com.nothing.voiceagent.localllm

/**
 * JNI wrapper around llama.cpp. The native side (llama_bridge.cpp, not yet written)
 * needs to be built with the Android NDK against llama.cpp's C API — see README.md.
 *
 * This class is the only place that touches JNI; LocalLLMPlugin never calls
 * System.loadLibrary directly.
 */
class LlamaBridge {

    companion object {
        init {
            System.loadLibrary("llama_bridge")
        }
    }

    /** Loads a GGUF model file from an absolute path. Blocking — call off the main thread. */
    external fun loadModel(absoluteModelPath: String): Boolean

    /** Runs one completion against the loaded model. Blocking — call off the main thread. */
    external fun chat(prompt: String): String

    external fun unloadModel()

    /** Loads the vision model (SmolVLM) + its mmproj vision encoder. Blocking. */
    external fun loadVisionModel(absoluteModelPath: String, absoluteMmprojPath: String): Boolean

    /** Describes an image file given a text prompt. Blocking — call off the main thread. */
    external fun describeImage(absoluteImagePath: String, prompt: String): String

    external fun unloadVisionModel()
}
