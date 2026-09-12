import { Injectable, signal } from '@angular/core';
import { MCP_SERVER_URL } from '../config/mcp.config';
import { TOOLS } from '../config/tools.config';
import { AssistantState, AssistantTurn, ToolDefinition } from '../models/assistant.models';
import { LocalLlmService } from './local-llm.service';
import { McpService } from './mcp.service';
import { PhotoService } from './photo.service';
import { SpeechService } from './speech.service';
import { ToolExecutorService } from './tool-executor.service';

/** Drives one full voice turn: listen -> plan tool call -> execute -> phrase -> speak. */
@Injectable({ providedIn: 'root' })
export class AssistantOrchestratorService {
  readonly state = signal<AssistantState>('idle');
  readonly turn = signal<AssistantTurn | null>(null);

  /** Description from the most recent "Take photo"/"Choose photo" — lets a follow-up
   *  voice question ("what color is it") be answered without needing a new photo. */
  private lastPhotoDescription: string | null = null;

  /** Tools discovered from the MCP server (assignments, damage assessment, etc.), fetched once and cached. */
  private mcpTools: ToolDefinition[] = [];
  private mcpToolsLoaded: Promise<void> | null = null;

  constructor(
    private speech: SpeechService,
    private llm: LocalLlmService,
    private toolExecutor: ToolExecutorService,
    private photo: PhotoService,
    private mcp: McpService
  ) {}

  async startTurn(): Promise<void> {
    this.state.set('listening');
    this.turn.set(null);

    let transcript: string;
    try {
      transcript = await this.speech.listen();
    } catch (err) {
      this.fail(String(err));
      return;
    }

    this.state.set('thinking');
    const turn: AssistantTurn = { transcript };
    this.turn.set({ ...turn });

    // The small on-device text model is unreliable at routing anything mentioning a
    // photo/picture — it kept mismatching these to getCurrentDateTime instead of
    // recognizing there's no matching tool (see MODEL.md). Handle it deterministically
    // instead of going through the flawed LLM routing step.
    if (/\b(photo|picture|image)\b/i.test(transcript)) {
      const wantsNewPhoto = /\b(take|new|another|capture)\b/i.test(transcript);
      if (this.lastPhotoDescription && !wantsNewPhoto) {
        // A follow-up question about the photo already shown — answer from its
        // description rather than opening the camera again.
        try {
          const answer = await this.llm.phraseAnswer(transcript, { photoDescription: this.lastPhotoDescription });
          turn.answer = answer;
          this.turn.set({ ...turn });
          this.state.set('speaking');
          await this.speech.speak(answer);
          this.state.set('idle');
        } catch (err) {
          this.fail(String(err));
        }
      } else {
        await this.runDescribePhoto('camera', transcript);
      }
      return;
    }

    try {
      await this.ensureMcpToolsLoaded();
      const allTools = [...TOOLS, ...this.mcpTools];

      const toolCall = await this.llm.planToolCall(transcript, allTools);
      turn.toolCall = toolCall ?? undefined;
      this.turn.set({ ...turn });

      let answer: string;
      if (toolCall) {
        const result = await this.toolExecutor.execute(toolCall, this.mcpTools);
        turn.toolResult = result;
        this.turn.set({ ...turn });
        answer = await this.llm.phraseAnswer(transcript, result);
      } else {
        // Nothing matched a backend tool — fall back to the model's own general
        // knowledge rather than refusing outright.
        answer = await this.llm.answerGenerally(transcript);
      }

      turn.answer = answer;
      this.turn.set({ ...turn });

      this.state.set('speaking');
      await this.speech.speak(answer);
      this.state.set('idle');
    } catch (err) {
      this.fail(String(err));
    }
  }

  /** Triggered by the Take photo / Choose photo buttons. */
  async describePhoto(source: 'camera' | 'gallery'): Promise<void> {
    this.state.set('thinking');
    this.turn.set(null);
    await this.runDescribePhoto(source);
  }

  private async runDescribePhoto(source: 'camera' | 'gallery', spokenTranscript?: string): Promise<void> {
    const label = spokenTranscript ?? (source === 'camera' ? '📷 Photo taken' : '🖼️ Photo selected');
    const turn: AssistantTurn = { transcript: label };
    this.turn.set({ ...turn });

    try {
      const imagePath = source === 'camera' ? await this.photo.takePhoto() : await this.photo.choosePhoto();
      const answer = await this.llm.describePhoto(imagePath);
      this.lastPhotoDescription = answer;
      turn.answer = answer;
      this.turn.set({ ...turn });

      this.state.set('speaking');
      await this.speech.speak(answer);
      this.state.set('idle');
    } catch (err) {
      this.fail(String(err));
    }
  }

  /**
   * Fetches the MCP server's tool list once per app session (assignments, damage
   * assessment, survey/inspection, restoration, switching, ...) and caches it for the
   * LLM router. Fails soft: until MCP_SERVER_URL is a real deployed URL (see
   * mcp.config.ts), or if the network call fails for any other reason, the assistant
   * still works with just the local tools in tools.config.ts instead of breaking
   * every voice turn.
   */
  private ensureMcpToolsLoaded(): Promise<void> {
    if (MCP_SERVER_URL.includes('your-mcp-server.example.com')) {
      return Promise.resolve();
    }
    if (!this.mcpToolsLoaded) {
      this.mcpToolsLoaded = this.mcp
        .listTools()
        .then((tools) => {
          this.mcpTools = tools;
        })
        .catch((err) => {
          console.error('Failed to load MCP tools — continuing with local tools only.', err);
          this.mcpToolsLoaded = null; // retry on the next turn instead of failing forever
        });
    }
    return this.mcpToolsLoaded;
  }

  cancel(): void {
    this.speech.stopListening();
    this.state.set('idle');
  }

  private fail(message: string): void {
    this.turn.update((t) => ({ ...(t ?? { transcript: '' }), error: message }));
    this.state.set('error');
  }
}
