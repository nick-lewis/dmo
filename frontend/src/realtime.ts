export const realtimeModelOptions = [
  {
    id: "gpt-realtime-mini",
    label: "Mini",
  },
  {
    id: "gpt-realtime-1.5",
    label: "1.5",
  },
  {
    id: "gpt-realtime-2",
    label: "2",
  },
] as const;

export type RealtimeModelId = (typeof realtimeModelOptions)[number]["id"];

export const realtimeVoiceOptions = [
  { id: "marin", label: "Marin" },
  { id: "cedar", label: "Cedar" },
  { id: "verse", label: "Verse" },
  { id: "ash", label: "Ash" },
  { id: "ballad", label: "Ballad" },
  { id: "coral", label: "Coral" },
  { id: "echo", label: "Echo" },
  { id: "sage", label: "Sage" },
  { id: "shimmer", label: "Shimmer" },
  { id: "alloy", label: "Alloy" },
] as const;

export type RealtimeVoiceId = (typeof realtimeVoiceOptions)[number]["id"];

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "streaming"
  | "audio-blocked"
  | "error";

type RealtimeConnectionConfig = {
  fetchClientSecret: (request: {
    sessionId: string;
    model: RealtimeModelId;
    voice: RealtimeVoiceId;
  }) => Promise<unknown>;
  model: RealtimeModelId;
  sessionId: string;
  voice: RealtimeVoiceId;
};

type RealtimeConnectionCallbacks = {
  onError?: (message: string) => void;
  onStatusChange?: (status: RealtimeStatus) => void;
};

type ActiveResponse = {
  done: boolean;
  eventSummaries: string[];
  onDelta: (delta: string) => void;
  reject: (error: Error) => void;
  resolve: (content: RealtimeTurnResult) => void;
  text: string;
  timeoutId: number;
  toolCall: RealtimeToolCall | null;
  toolCallDraft: RealtimeToolCallDraft;
};

export type RealtimeToolCall = {
  arguments: Record<string, unknown>;
  callId: string;
  name: string;
};

export type RealtimeTurnResult = {
  eventSummaries: string[];
  text: string;
  toolCall: RealtimeToolCall | null;
};

type RealtimeToolCallDraft = {
  argumentsText: string;
  callId: string;
  itemId: string;
  name: string;
  outputIndex: string;
};

type ServerEvent = {
  arguments?: string;
  call_id?: string;
  delta?: string;
  error?: {
    message?: string;
  };
  item?: unknown;
  item_id?: string;
  name?: string;
  output_index?: number | string;
  part?: unknown;
  response?: unknown;
  text?: string;
  transcript?: string;
  type?: string;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function indexValue(value: unknown) {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : "";
}

function clientSecretValue(payload: unknown) {
  const root = objectValue(payload);
  if (!root) return "";

  const clientSecret = objectValue(root.clientSecret);
  const directValue = stringValue(root.value) || stringValue(clientSecret?.value);
  if (directValue) return directValue;

  const nestedSecret = objectValue(root.client_secret) ?? objectValue(clientSecret?.client_secret);
  return stringValue(nestedSecret?.value);
}

function contentText(content: unknown) {
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      const partObject = objectValue(part);
      if (!partObject) return "";
      const audio =
        objectValue(partObject.audio) ?? objectValue(partObject.output_audio);
      return (
        stringValue(partObject.text) ||
        stringValue(partObject.transcript) ||
        stringValue(audio?.transcript)
      );
    })
    .join("");
}

function itemText(item: unknown) {
  const itemObject = objectValue(item);
  if (!itemObject) return "";
  return (
    stringValue(itemObject.text) ||
    stringValue(itemObject.transcript) ||
    contentText(itemObject.content)
  );
}

function partText(part: unknown) {
  const partObject = objectValue(part);
  if (!partObject) return "";
  return stringValue(partObject.text) || stringValue(partObject.transcript);
}

function responseText(response: unknown) {
  const responseObject = objectValue(response);
  const directText =
    stringValue(responseObject?.output_text) ||
    stringValue(responseObject?.text) ||
    stringValue(responseObject?.transcript);
  if (directText) return directText;

  const output = responseObject?.output;
  if (!Array.isArray(output)) return "";

  return output.map(itemText).join("");
}

function textFromServerEvent(event: ServerEvent) {
  return (
    stringValue(event.text) ||
    stringValue(event.transcript) ||
    partText(event.part) ||
    itemText(event.item) ||
    responseText(event.response)
  );
}

function parseServerEvent(event: MessageEvent) {
  if (typeof event.data !== "string") return null;

  try {
    const parsed = JSON.parse(event.data) as unknown;
    return objectValue(parsed) as ServerEvent | null;
  } catch {
    return null;
  }
}

function parseToolArguments(value: unknown) {
  const objectArgument = objectValue(value);
  if (objectArgument) return objectArgument;

  if (typeof value !== "string" || !value.trim()) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    return objectValue(parsed) ?? {};
  } catch {
    return {};
  }
}

function functionCallLike(value: Record<string, unknown> | null) {
  if (!value) return false;
  const type = stringValue(value.type);
  return type === "function_call" || type === "tool_call" || type === "function";
}

function toolCallDraftFromRecord(value: Record<string, unknown> | null) {
  if (!functionCallLike(value)) return null;

  const functionObject = objectValue(value?.function);
  const argumentsValue = value?.arguments ?? functionObject?.arguments;
  return {
    argumentsText:
      typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue ?? {}),
    callId:
      stringValue(value?.call_id) ||
      stringValue(value?.callId) ||
      stringValue(functionObject?.call_id),
    itemId: stringValue(value?.id) || stringValue(value?.item_id),
    name: stringValue(value?.name) || stringValue(functionObject?.name),
    outputIndex: indexValue(value?.output_index),
  };
}

function toolCallDraftsFromResponse(response: unknown) {
  const responseObject = objectValue(response);
  const output = responseObject?.output;
  if (!Array.isArray(output)) return [];

  const drafts: RealtimeToolCallDraft[] = [];
  for (const item of output) {
    const draft = toolCallDraftFromRecord(objectValue(item));
    if (draft) drafts.push(draft);
  }
  return drafts;
}

function mergeToolCallDraft(
  current: RealtimeToolCallDraft,
  next: Partial<RealtimeToolCallDraft>,
) {
  return {
    argumentsText:
      next.argumentsText !== undefined ? next.argumentsText : current.argumentsText,
    callId: next.callId || current.callId,
    itemId: next.itemId || current.itemId,
    name: next.name || current.name,
    outputIndex: next.outputIndex || current.outputIndex,
  };
}

function completedToolCallFromDraft(draft: RealtimeToolCallDraft) {
  if (!draft.name) return null;

  return {
    arguments: parseToolArguments(draft.argumentsText),
    callId: draft.callId,
    name: draft.name,
  };
}

function contentSummary(content: unknown) {
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      const partObject = objectValue(part);
      if (!partObject) return "part";
      const type = stringValue(partObject.type) || "part";
      const flags = [
        stringValue(partObject.text) ? "text" : "",
        stringValue(partObject.transcript) ? "transcript" : "",
      ].filter(Boolean);
      return flags.length ? `${type}:${flags.join("+")}` : type;
    })
    .join(",");
}

function itemSummary(item: unknown) {
  const itemObject = objectValue(item);
  if (!itemObject) return "";

  const parts = [stringValue(itemObject.type) || "item"];
  const name = stringValue(itemObject.name);
  const status = stringValue(itemObject.status);
  const content = contentSummary(itemObject.content);
  if (name) parts.push(`name=${name}`);
  if (status) parts.push(`status=${status}`);
  if (stringValue(itemObject.call_id)) parts.push("call_id");
  if (stringValue(itemObject.arguments)) parts.push("arguments");
  if (content) parts.push(`content=${content}`);
  return parts.join(":");
}

function responseSummary(response: unknown) {
  const responseObject = objectValue(response);
  if (!responseObject) return "";

  const status = stringValue(responseObject.status);
  const output = responseObject.output;
  const outputSummary = Array.isArray(output)
    ? output.map(itemSummary).filter(Boolean).join(",")
    : "";
  const parts = [
    status ? `status=${status}` : "",
    outputSummary ? `output=[${outputSummary}]` : "",
  ].filter(Boolean);
  return parts.join(":");
}

function summarizeServerEvent(event: ServerEvent) {
  const parts = [event.type || "event"];
  const item = itemSummary(event.item);
  const response = responseSummary(event.response);
  if (item) parts.push(`item(${item})`);
  if (response) parts.push(`response(${response})`);
  if (stringValue(event.name)) parts.push(`name=${event.name}`);
  if (stringValue(event.call_id)) parts.push("call_id");
  if (stringValue(event.item_id)) parts.push("item_id");
  if (indexValue(event.output_index)) parts.push(`output_index=${event.output_index}`);
  if (stringValue(event.text)) parts.push("text");
  if (stringValue(event.transcript)) parts.push("transcript");
  if (stringValue(event.delta)) parts.push("delta");
  if (stringValue(event.arguments)) parts.push("arguments");
  return parts.join(" ");
}

export class DluRealtimeConnection {
  private activeResponse: ActiveResponse | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private channel: RTCDataChannel | null = null;
  private isOutputAudioBufferActive = false;
  private peerConnection: RTCPeerConnection | null = null;
  private recentEventSummaries: string[] = [];

  private constructor(
    private readonly config: RealtimeConnectionConfig,
    private readonly callbacks: RealtimeConnectionCallbacks = {},
  ) {}

  static async connect(
    config: RealtimeConnectionConfig,
    callbacks: RealtimeConnectionCallbacks = {},
  ) {
    const connection = new DluRealtimeConnection(config, callbacks);
    await connection.open();
    return connection;
  }

  matches(sessionId: string, model: RealtimeModelId, voice: RealtimeVoiceId) {
    return (
      this.config.sessionId === sessionId &&
      this.config.model === model &&
      this.config.voice === voice
    );
  }

  async sendUserText(content: string, onDelta: (delta: string) => void) {
    if (this.activeResponse) {
      throw new Error("dLU is still responding.");
    }

    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("Realtime connection is not ready.");
    }

    this.setStatus("streaming");

    return new Promise<RealtimeTurnResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.rejectActiveResponse("dLU response timed out.");
      }, 120000);

      this.activeResponse = {
        done: false,
        eventSummaries: [],
        onDelta,
        reject,
        resolve,
        text: "",
        timeoutId,
        toolCall: null,
        toolCallDraft: {
          argumentsText: "",
          callId: "",
          itemId: "",
          name: "",
          outputIndex: "",
        },
      };

      try {
        this.sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: content,
              },
            ],
          },
        });
        this.sendEvent({
          type: "response.create",
          response: {
            output_modalities: ["audio"],
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not send message to dLU.";
        this.rejectActiveResponse(message);
      }
    });
  }

  close(nextStatus: RealtimeStatus = "idle") {
    this.rejectActiveResponse("Realtime connection closed.");
    this.channel?.removeEventListener("message", this.handleMessage);
    this.channel?.close();
    this.peerConnection?.close();
    this.audioElement?.remove();
    this.channel = null;
    this.isOutputAudioBufferActive = false;
    this.peerConnection = null;
    this.audioElement = null;
    this.setStatus(nextStatus);
  }

  private async open() {
    this.setStatus("connecting");

    try {
      const tokenPayload = await this.config.fetchClientSecret({
        sessionId: this.config.sessionId,
        model: this.config.model,
        voice: this.config.voice,
      });
      const ephemeralKey = clientSecretValue(tokenPayload);
      if (!ephemeralKey) {
        throw new Error("Realtime client secret was missing from the server response.");
      }

      const peerConnection = new RTCPeerConnection();
      const channel = peerConnection.createDataChannel("oai-events");
      const audioElement = document.createElement("audio");

      audioElement.autoplay = true;
      audioElement.style.display = "none";
      audioElement.setAttribute("playsinline", "true");
      document.body.appendChild(audioElement);

      this.peerConnection = peerConnection;
      this.channel = channel;
      this.audioElement = audioElement;

      peerConnection.addTransceiver("audio", { direction: "recvonly" });
      peerConnection.ontrack = (event) => {
        audioElement.srcObject = event.streams[0] ?? null;
        void audioElement.play().catch(() => {
          this.setStatus("audio-blocked");
        });
      };

      channel.addEventListener("message", this.handleMessage);
      channel.addEventListener("close", () => {
        this.rejectActiveResponse("Realtime connection closed.");
      });
      channel.addEventListener("error", () => {
        this.rejectActiveResponse("Realtime data channel error.");
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const offerSdp = peerConnection.localDescription?.sdp ?? offer.sdp ?? "";
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offerSdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });
      const answerSdp = await sdpResponse.text();

      if (!sdpResponse.ok) {
        throw new Error(answerSdp || "OpenAI rejected the Realtime connection.");
      }

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
      await this.waitForChannelOpen();
      this.setStatus("connected");
    } catch (error) {
      this.close("error");
      throw error;
    }
  }

  private waitForChannelOpen() {
    const channel = this.channel;
    if (!channel) {
      throw new Error("Realtime data channel was not created.");
    }

    if (channel.readyState === "open") {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Realtime data channel did not open."));
      }, 15000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        channel.removeEventListener("open", handleOpen);
        channel.removeEventListener("close", handleClose);
        channel.removeEventListener("error", handleError);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleClose = () => {
        cleanup();
        reject(new Error("Realtime data channel closed before it opened."));
      };
      const handleError = () => {
        cleanup();
        reject(new Error("Realtime data channel failed."));
      };

      channel.addEventListener("open", handleOpen);
      channel.addEventListener("close", handleClose);
      channel.addEventListener("error", handleError);
    });
  }

  private sendEvent(event: Record<string, unknown>) {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("Realtime connection is not ready.");
    }

    this.channel.send(JSON.stringify(event));
  }

  private handleMessage = (messageEvent: MessageEvent) => {
    const event = parseServerEvent(messageEvent);
    if (!event) return;

    this.captureEventSummary(event);

    const eventType = event.type ?? "";
    if (eventType === "error") {
      const message = event.error?.message || "Realtime API error.";
      this.callbacks.onError?.(message);
      this.rejectActiveResponse(message);
      this.isOutputAudioBufferActive = false;
      this.setStatus("error");
      return;
    }

    if (eventType === "output_audio_buffer.started") {
      this.isOutputAudioBufferActive = true;
      this.setStatus("streaming");
      return;
    }

    if (
      eventType === "output_audio_buffer.stopped" ||
      eventType === "output_audio_buffer.cleared"
    ) {
      this.isOutputAudioBufferActive = false;
      if (!this.activeResponse) {
        this.setStatus("connected");
      }
      return;
    }

    if (
      eventType === "response.output_audio_transcript.delta" ||
      eventType === "response.audio_transcript.delta" ||
      eventType === "response.output_text.delta" ||
      eventType === "response.text.delta"
    ) {
      this.appendDelta(event.delta ?? "");
      return;
    }

    if (
      eventType === "response.output_audio_transcript.done" ||
      eventType === "response.audio_transcript.done" ||
      eventType === "response.output_text.done" ||
      eventType === "response.text.done"
    ) {
      this.replaceEmptyText(textFromServerEvent(event));
      return;
    }

    const toolCall = this.updateToolCallFromEvent(event);
    if (toolCall && eventType === "response.function_call_arguments.done") return;

    if (eventType === "response.done") {
      this.finishActiveResponse(textFromServerEvent(event), toolCall);
    }
  };

  private captureEventSummary(event: ServerEvent) {
    const summary = summarizeServerEvent(event);
    this.recentEventSummaries.push(summary);
    if (this.recentEventSummaries.length > 60) {
      this.recentEventSummaries.shift();
    }

    const diagnosticsWindow = window as Window & {
      __dluRealtimeEvents?: string[];
    };
    diagnosticsWindow.__dluRealtimeEvents = [...this.recentEventSummaries];
    console.debug("[dLU realtime]", summary);

    if (!this.activeResponse) return;

    this.activeResponse.eventSummaries.push(summary);
    if (this.activeResponse.eventSummaries.length > 40) {
      this.activeResponse.eventSummaries.shift();
    }
  }

  private updateToolCallFromEvent(event: ServerEvent) {
    const activeResponse = this.activeResponse;
    if (!activeResponse) return null;

    let draft = activeResponse.toolCallDraft;
    const itemDraft = toolCallDraftFromRecord(objectValue(event.item));
    if (itemDraft) {
      draft = mergeToolCallDraft(draft, {
        ...itemDraft,
        outputIndex: itemDraft.outputIndex || indexValue(event.output_index),
      });
    }

    if (event.type === "response.function_call_arguments.delta") {
      draft = mergeToolCallDraft(draft, {
        argumentsText: `${draft.argumentsText}${event.delta ?? ""}`,
        callId: stringValue(event.call_id),
        itemId: stringValue(event.item_id),
        name: stringValue(event.name),
        outputIndex: indexValue(event.output_index),
      });
    }

    if (event.type === "response.function_call_arguments.done") {
      draft = mergeToolCallDraft(draft, {
        argumentsText: stringValue(event.arguments) || draft.argumentsText,
        callId: stringValue(event.call_id),
        itemId: stringValue(event.item_id),
        name: stringValue(event.name),
        outputIndex: indexValue(event.output_index),
      });
    }

    for (const responseDraft of toolCallDraftsFromResponse(event.response)) {
      draft = mergeToolCallDraft(draft, responseDraft);
    }

    activeResponse.toolCallDraft = draft;
    const toolCall = completedToolCallFromDraft(draft);
    if (toolCall) activeResponse.toolCall = toolCall;
    return activeResponse.toolCall;
  }

  private appendDelta(delta: string) {
    if (!this.activeResponse || !delta) return;

    this.activeResponse.text += delta;
    this.activeResponse.onDelta(delta);
  }

  private replaceEmptyText(text: string) {
    if (!this.activeResponse || this.activeResponse.text || !text) return;

    this.activeResponse.text = text;
    this.activeResponse.onDelta(text);
  }

  private finishActiveResponse(
    finalText: string,
    toolCall: RealtimeToolCall | null = null,
  ) {
    const activeResponse = this.activeResponse;
    if (!activeResponse || activeResponse.done) return;

    activeResponse.done = true;
    window.clearTimeout(activeResponse.timeoutId);
    this.activeResponse = null;
    activeResponse.resolve({
      eventSummaries:
        activeResponse.eventSummaries.length > 0
          ? [...activeResponse.eventSummaries]
          : [...this.recentEventSummaries],
      text: finalText || activeResponse.text,
      toolCall: toolCall ?? activeResponse.toolCall,
    });
    if (!this.isOutputAudioBufferActive) {
      this.setStatus("connected");
    }
  }

  private rejectActiveResponse(message: string) {
    const activeResponse = this.activeResponse;
    if (!activeResponse || activeResponse.done) return;

    activeResponse.done = true;
    window.clearTimeout(activeResponse.timeoutId);
    this.activeResponse = null;
    activeResponse.reject(new Error(message));
    if (!this.isOutputAudioBufferActive) {
      this.setStatus("connected");
    }
  }

  private setStatus(status: RealtimeStatus) {
    this.callbacks.onStatusChange?.(status);
  }
}
