import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { AssistantOrchestratorService } from './app/services/assistant-orchestrator.service';

declare const window: any;

// Cordova plugins (window.plugins.*, window.TTS, …) don't exist until cordova.js
// loads and fires `deviceready` — see index.html's script tag. In a plain browser
// (ng serve) that script 404s and sets __cordovaUnavailable synchronously before this
// module runs, so we skip straight to bootstrapping instead of waiting for an event
// that would never fire.
function whenReady(): Promise<void> {
  if (window.__cordovaUnavailable) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    document.addEventListener('deviceready', () => resolve(), { once: true });
  });
}

whenReady()
  .then(() => bootstrapApplication(AppComponent, appConfig))
  .then((appRef) => {
    // Called from VoiceAssistSession.kt (via webView.evaluateJavascript) right after
    // the assist-gesture overlay is shown, so the assistant starts listening
    // immediately instead of waiting for a tap — matching Siri's behavior.
    window.startAssistantTurn = () => {
      appRef.injector.get(AssistantOrchestratorService).startTurn();
    };

    // Match the status bar to the app's dark theme (light/white icons on a dark
    // background) instead of the system default — otherwise it reads as a pale
    // strip pasted on top of a dark screen rather than part of one native surface.
    if (window.StatusBar) {
      window.StatusBar.overlaysWebView(false);
      window.StatusBar.backgroundColorByHexString('#05050a');
      window.StatusBar.styleLightContent();
    }
  })
  .catch((err) => console.error(err));
