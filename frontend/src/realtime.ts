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
  onDelta: (delta: string) => void;
  reject: (error: Error) => void;
  resolve: (content: RealtimeTurnResult) => void;
  text: string;
  timeoutId: number;
  toolCall: RealtimeToolCall | null;
};

export type RealtimeToolCall = {
  arguments: Record<string, unknown>;
  callId: string;
  name: string;
};

export type RealtimeTurnResult = {
  text: string;
  toolCall: RealtimeToolCall | null;
};

type ServerEvent = {
  arguments?: string;
  call_id?: string;
  delta?: string;
  error?: {
    message?: string;
  };
  item?: unknown;
  name?: string;
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
      return stringValue(partObject.text) || stringValue(partObject.transcript);
    })
    .join("");
}

function itemText(item: unknown) {
  const itemObject = objectValue(item);
  if (!itemObject) return "";
  return contentText(itemObject.content);
}

function responseText(response: unknown) {
  const responseObject = objectValue(response);
  const output = responseObject?.output;
  if (!Array.isArray(output)) return "";

  return output.map(itemText).join("");
}

function textFromServerEvent(event: ServerEvent) {
  return (
    stringValue(event.text) ||
    stringValue(event.transcript) ||
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
  if (typeof value !== "string" || !value.trim()) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    return objectValue(parsed) ?? {};
  } catch {
    return {};
  }
}

function toolCallFromRecord(value: Record<string, unknown> | null) {
  if (!value || stringValue(value.type) !== "function_call") return null;

  const name = stringValue(value.name);
  if (!name) return null;

  return {
    arguments: parseToolArguments(value.arguments),
    callId: stringValue(value.call_id),
    name,
  };
}

function toolCallFromResponse(response: unknown) {
  const responseObject = objectValue(response);
  const output = responseObject?.output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    const toolCall = toolCallFromRecord(objectValue(item));
    if (toolCall) return toolCall;
  }
  return null;
}

function toolCallFromServerEvent(event: ServerEvent) {
  if (event.type === "response.function_call_arguments.done") {
    const name = stringValue(event.name);
    if (!name) return null;
    return {
      arguments: parseToolArguments(event.arguments),
      callId: stringValue(event.call_id),
      name,
    };
  }

  return toolCallFromResponse(event.response);
}

export class DluRealtimeConnection {
  private activeResponse: ActiveResponse | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private channel: RTCDataChannel | null = null;
  private peerConnection: RTCPeerConnection | null = null;

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
        onDelta,
        reject,
        resolve,
        text: "",
        timeoutId,
        toolCall: null,
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

    const eventType = event.type ?? "";
    if (eventType === "error") {
      const message = event.error?.message || "Realtime API error.";
      this.callbacks.onError?.(message);
      this.rejectActiveResponse(message);
      this.setStatus("error");
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

    const toolCall = toolCallFromServerEvent(event);
    if (toolCall && this.activeResponse) {
      this.activeResponse.toolCall = toolCall;
      if (eventType === "response.function_call_arguments.done") return;
    }

    if (eventType === "response.done") {
      this.finishActiveResponse(textFromServerEvent(event), toolCall);
    }
  };

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
      text: finalText || activeResponse.text,
      toolCall: toolCall ?? activeResponse.toolCall,
    });
    this.setStatus("connected");
  }

  private rejectActiveResponse(message: string) {
    const activeResponse = this.activeResponse;
    if (!activeResponse || activeResponse.done) return;

    activeResponse.done = true;
    window.clearTimeout(activeResponse.timeoutId);
    this.activeResponse = null;
    activeResponse.reject(new Error(message));
  }

  private setStatus(status: RealtimeStatus) {
    this.callbacks.onStatusChange?.(status);
  }
}
