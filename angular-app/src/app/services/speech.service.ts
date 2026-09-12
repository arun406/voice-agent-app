import { Injectable } from '@angular/core';

declare const window: any;

/**
 * Speech I/O. On a real device build, this talks to Cordova plugins
 * (cordova-plugin-speechrecognition / cordova-plugin-tts). In a plain browser
 * (dev mode), it falls back to the Web Speech API so the UI is testable
 * without a device build.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private recognition: any;

  async listen(): Promise<string> {
    // Real device: native Cordova speech recognition plugin. Needs the RECORD_AUDIO
    // runtime permission granted before startListening will work — request it first
    // if it hasn't been (cordova-plugin-speechrecognition's own hasPermission/
    // requestPermission, backed by Android's runtime permission dialog).
    const sr = window.plugins?.speechRecognition;
    if (sr) {
      const hasPermission = await new Promise<boolean>((resolve) => {
        sr.hasPermission((granted: boolean) => resolve(granted), () => resolve(false));
      });
      if (!hasPermission) {
        await new Promise<void>((resolve, reject) => {
          sr.requestPermission(() => resolve(), () => reject(new Error('not-allowed')));
        });
      }
      return new Promise((resolve, reject) => {
        sr.startListening(
          (matches: string[]) => resolve(matches[0] ?? ''),
          (err: unknown) => reject(err),
          // showPopup: false keeps recognition headless so our own listening UI stays
          // in control — otherwise this plugin hands off to Android's system "Speak
          // now" dialog instead.
          { language: 'en-US', showPartial: false, showPopup: false }
        );
      });
    }

    // Browser dev-mode fallback.
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return Promise.reject(new Error('No speech recognition available in this browser.'));
    }
    return new Promise((resolve, reject) => {
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'en-US';
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;
      this.recognition.onresult = (event: any) => resolve(event.results[0][0].transcript);
      this.recognition.onerror = (event: any) => reject(new Error(event.error));
      this.recognition.start();
    });
  }

  stopListening(): void {
    if (window.plugins?.speechRecognition) {
      window.plugins.speechRecognition.stopListening();
    }
    this.recognition?.stop();
  }

  speak(text: string): Promise<void> {
    if (window.TTS?.speak) {
      return new Promise((resolve, reject) => {
        window.TTS.speak(text, resolve, reject);
      });
    }
    if (window.speechSynthesis) {
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    }
    return Promise.resolve();
  }
}
