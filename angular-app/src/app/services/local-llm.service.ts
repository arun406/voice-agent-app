import { Injectable } from '@angular/core';
import { ToolCall, ToolDefinition } from '../models/assistant.models';

declare const window: any;

/**
 * Bridge to the on-device LLM. On a real device build this calls the
 * `local-llm-plugin` Cordova plugin (llama.cpp JNI bridge, see
 * plugins-src/local-llm-plugin) via `window.LocalLLM.chat(prompt)`.
 *
 * That native plugin doesn't exist yet (needs the Android NDK toolchain to
 * build), so until then this falls back to a small deterministic mock so the
 * rest of the pipeline — prompt building, JSON parsing, tool execution,
 * response phrasing — can be built and tested in a browser today.
 */
@Injectable({ providedIn: 'root' })
export class LocalLlmService {
  private async chat(prompt: string): Promise<string> {
    const raw = window.LocalLLM?.chat
      ? await window.LocalLLM.chat(prompt)
      : await this.mockChat(prompt);
    // Qwen3 (and other reasoning-capable models) emit a <think>...</think> block even
    // when the /no_think suffix (llama_bridge.cpp) empties its contents — strip the
    // tags themselves so they never leak into displayed text or spoken TTS output.
    return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  /** Ask the model which tool (if any) to call for this transcript. */
  async planToolCall(transcript: string, tools: ToolDefinition[]): Promise<ToolCall | null> {
    const prompt = this.buildPlanningPrompt(transcript, tools);
    const raw = await this.chat(prompt);
    const parsed = this.parseToolCall(raw, tools);
    if (parsed !== undefined) return parsed;

    // One corrective retry with a stricter reminder — small models often need this.
    const retryPrompt = `${prompt}\n\nYour previous reply was not valid JSON matching the schema. Reply with ONLY the JSON object, nothing else.`;
    const retryRaw = await this.chat(retryPrompt);
    const retryParsed = this.parseToolCall(retryRaw, tools);
    return retryParsed ?? null;
  }

  /** Ask the model to phrase a short spoken answer from a tool result. */
  async phraseAnswer(transcript: string, toolResult: unknown): Promise<string> {
    const prompt = [
      'You are a voice assistant. Phrase a short, natural, spoken-style answer',
      '(one or two sentences, no markdown, no lists) to the user\'s question using the data below.',
      '',
      `User asked: "${transcript}"`,
      `Data: ${JSON.stringify(toolResult)}`
    ].join('\n');
    const raw = await this.chat(prompt);
    return raw.trim();
  }

  /**
   * General knowledge/chat fallback for anything that doesn't match a backend tool —
   * general questions, small talk, etc. Answered from the model's own knowledge,
   * not your backend data, so keep expectations calibrated to a small on-device model.
   */
  async answerGenerally(transcript: string): Promise<string> {
    const prompt = [
      'You are a helpful voice assistant. Answer the user\'s question directly and',
      'conversationally in one or two short sentences, spoken-style — no markdown, no lists.',
      '',
      `User said: "${transcript}"`
    ].join('\n');
    const raw = await this.chat(prompt);
    return raw.trim();
  }

  /**
   * Describes a photo. Uses the separate vision model (SmolVLM) rather than the
   * text-only model chat() calls — see MODEL.md's "Photo description" section.
   */
  async describePhoto(imagePath: string): Promise<string> {
    const prompt = 'Describe this image in detail: what is shown, notable objects, people, text, colors, and setting.';
    if (!window.LocalLLM?.describeImage) {
      return "Photo description isn't available in this browser preview — try it on the device build.";
    }
    const raw = await window.LocalLLM.describeImage(imagePath, prompt);
    return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  private buildPlanningPrompt(transcript: string, tools: ToolDefinition[]): string {
    const toolList = tools.map((t) => ({
      name: t.name,
      description: t.description,
      params: t.params.map((p) => `${p.name}${p.required ? '' : '?'}: ${p.type}`)
    }));
    return [
      'You are a voice assistant that turns spoken commands into a single tool call.',
      'Available tools:',
      JSON.stringify(toolList, null, 2),
      '',
      `User said: "${transcript}"`,
      '',
      'Reply with ONLY a single JSON object, no other text:',
      '- If a tool matches: {"tool": "<name>", "args": { ... }}',
      '- If none matches: {"tool": null}'
    ].join('\n');
  }

  /** Defensive parse: extract the first {...} block, validate against known tools. */
  private parseToolCall(raw: string, tools: ToolDefinition[]): ToolCall | null | undefined {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    let obj: any;
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return undefined;
    }
    if (!obj || obj.tool === null || obj.tool === undefined) return null;

    const tool = tools.find((t) => t.name === obj.tool);
    if (!tool) return undefined;

    const args = obj.args ?? {};
    for (const p of tool.params) {
      if (p.required && !(p.name in args)) return undefined;
    }
    return { tool: obj.tool, args };
  }

  /** Dev-only stand-in for the real on-device model. Not used once local-llm-plugin is wired in. */
  private async mockChat(prompt: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 400));

    const userSaidMatch = prompt.match(/User said: "(.*)"/);
    const transcript = (userSaidMatch?.[1] ?? '').toLowerCase();

    if (prompt.includes('Available tools:')) {
      const orderIdMatch = transcript.match(/\b(\d{3,})\b/);
      if (transcript.includes('order')) {
        return JSON.stringify({
          tool: 'getOrderStatus',
          args: { orderId: orderIdMatch?.[1] ?? '12345' }
        });
      }
      if (transcript.includes('balance') || transcript.includes('account')) {
        return JSON.stringify({ tool: 'getAccountBalance', args: {} });
      }
      return JSON.stringify({ tool: null });
    }

    // Phrasing step.
    const dataMatch = prompt.match(/Data: ([\s\S]*)$/);
    if (dataMatch) {
      return `Here's what I found: ${dataMatch[1]}`;
    }

    // General chat fallback (answerGenerally) — no real knowledge in mock mode.
    return `I'm a mock model in the browser, so I can't really answer "${transcript}" — try this on the device build.`;
  }
}
