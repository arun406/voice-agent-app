package com.nothing.voiceagent.assist

import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.json.JSONArray

/**
 * JS-facing helper (window.NativeAssist) for the main app UI — lets the Angular app
 * check whether it's currently set as the system's default Assist app, and deep-link
 * the user to the system settings screen to change it if not.
 */
class NativeAssistPlugin : CordovaPlugin() {

    override fun execute(action: String, args: JSONArray, callbackContext: CallbackContext): Boolean {
        return when (action) {
            "isDefaultAssistant" -> {
                callbackContext.success(if (isDefaultAssistant()) 1 else 0)
                true
            }
            "openAssistantSettings" -> {
                cordova.activity.startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS))
                callbackContext.success()
                true
            }
            else -> false
        }
    }

    private fun isDefaultAssistant(): Boolean {
        val assistSetting = Settings.Secure.getString(cordova.activity.contentResolver, "voice_interaction_service")
        return assistSetting?.startsWith(cordova.activity.packageName) == true
    }
}
