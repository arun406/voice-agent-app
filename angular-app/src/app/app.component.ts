import { Component, signal } from '@angular/core';
import { AssistantComponent } from './assistant/assistant.component';
import { ZITADEL_ISSUER } from './config/auth.config';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AssistantComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  /**
   * Skip the login gate entirely until auth.config.ts's placeholder is replaced with
   * a real Zitadel issuer — otherwise every other feature (photo description,
   * general chat) would be blocked behind a sign-in screen that can't work yet.
   * Once you set real values there, this flips on automatically.
   */
  readonly authRequired = !ZITADEL_ISSUER.includes('your-instance');
  readonly signInError = signal<string | null>(null);

  constructor(readonly auth: AuthService) {}

  async signIn(): Promise<void> {
    this.signInError.set(null);
    try {
      await this.auth.login();
    } catch (err) {
      this.signInError.set(String(err));
    }
  }
}
