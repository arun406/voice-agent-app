import { Component } from '@angular/core';
import { AssistantOrchestratorService } from '../services/assistant-orchestrator.service';
import { MapsService } from '../services/maps.service';
import { extractLocation, LatLng } from '../utils/extract-location';

@Component({
  selector: 'app-assistant',
  standalone: true,
  imports: [],
  templateUrl: './assistant.component.html',
  styleUrl: './assistant.component.css'
})
export class AssistantComponent {
  readonly eqBars = [0, 1, 2, 3, 4, 5, 6];

  constructor(readonly assistant: AssistantOrchestratorService, private maps: MapsService) {}

  onOrbClick(): void {
    const state = this.assistant.state();
    if (state === 'idle' || state === 'error') {
      this.assistant.startTurn();
    } else if (state === 'listening') {
      this.assistant.cancel();
    }
  }

  stateLabel(): string {
    switch (this.assistant.state()) {
      case 'idle':
        return 'Tap to speak';
      case 'listening':
        return 'Listening…';
      case 'thinking':
        return 'Thinking…';
      case 'speaking':
        return 'Speaking…';
      case 'error':
        return 'Something went wrong — tap to try again';
    }
  }

  onTakePhoto(): void {
    this.assistant.describePhoto('camera');
  }

  onChoosePhoto(): void {
    this.assistant.describePhoto('gallery');
  }

  /** A list-shaped result — e.g. "today's assignments" — either the raw array or a
   *  single-array-property wrapper some APIs use (`{assignments: [...]}`, `{items: [...]}`). */
  resultList(): Record<string, unknown>[] | null {
    const result = this.assistant.turn()?.toolResult;
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object') {
      const values = Object.values(result as Record<string, unknown>);
      if (values.length === 1 && Array.isArray(values[0])) {
        return values[0] as Record<string, unknown>[];
      }
    }
    return null;
  }

  /** Flat key/value rendering for a single-record result (no list). */
  resultEntries(): [string, unknown][] {
    if (this.resultList()) return [];
    const result = this.assistant.turn()?.toolResult;
    if (!result || typeof result !== 'object') return [];
    return Object.entries(result as Record<string, unknown>);
  }

  entriesFor(item: Record<string, unknown>): [string, unknown][] {
    return Object.entries(item);
  }

  locationFor(item: unknown): LatLng | null {
    return extractLocation(item);
  }

  getDirections(item: unknown): void {
    const loc = extractLocation(item);
    if (loc) this.maps.openDirections(loc.latitude, loc.longitude);
  }
}
