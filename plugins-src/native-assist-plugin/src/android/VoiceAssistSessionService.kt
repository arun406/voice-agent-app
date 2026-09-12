package com.nothing.voiceagent.assist

import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

/** Android calls this to create a new VoiceAssistSession each time the assist gesture fires. */
class VoiceAssistSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: android.os.Bundle?): VoiceInteractionSession {
        return VoiceAssistSession(this)
    }
}
