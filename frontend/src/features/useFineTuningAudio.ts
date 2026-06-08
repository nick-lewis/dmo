import { useEffect, useState } from "react";

export type WaveformState = {
  peaks: number[];
  status: "empty" | "error" | "loading" | "ready";
};

function decodePeaks(audioBuffer: AudioBuffer, bucketCount: number) {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const length = audioBuffer.length;
  const samplesPerBucket = Math.max(1, Math.floor(length / bucketCount));
  const peaks: number[] = [];

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * samplesPerBucket;
    const end =
      bucket === bucketCount - 1
        ? length
        : Math.min(length, start + samplesPerBucket);
    let peak = 0;

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const data = audioBuffer.getChannelData(channelIndex);
      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(data[index] ?? 0));
      }
    }

    peaks.push(peak);
  }

  const maxPeak = Math.max(...peaks, 0);
  if (!maxPeak) return peaks.map(() => 0);
  return peaks.map((peak) => peak / maxPeak);
}

export function useAudioWaveform(audioUrl: string, bucketCount: number) {
  const [waveform, setWaveform] = useState<WaveformState>({
    peaks: [],
    status: "empty",
  });

  useEffect(() => {
    if (!audioUrl) {
      setWaveform({ peaks: [], status: "empty" });
      return undefined;
    }

    let isCancelled = false;
    setWaveform({ peaks: [], status: "loading" });

    const AudioContextConstructor =
      window.AudioContext ||
      (
        window as Window &
          typeof globalThis & {
            webkitAudioContext?: typeof AudioContext;
          }
      ).webkitAudioContext;

    if (!AudioContextConstructor) {
      setWaveform({ peaks: [], status: "error" });
      return undefined;
    }

    const audioContext = new AudioContextConstructor();

    void fetch(audioUrl, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load audio.");
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
      .then((audioBuffer) => {
        if (isCancelled) return;
        setWaveform({
          peaks: decodePeaks(audioBuffer, bucketCount),
          status: "ready",
        });
      })
      .catch(() => {
        if (!isCancelled) setWaveform({ peaks: [], status: "error" });
      })
      .finally(() => {
        void audioContext.close().catch(() => undefined);
      });

    return () => {
      isCancelled = true;
      void audioContext.close().catch(() => undefined);
    };
  }, [audioUrl, bucketCount]);

  return waveform;
}

export function useSeekableAudioUrl(audioUrl: string) {
  const [seekableAudioUrl, setSeekableAudioUrl] = useState("");

  useEffect(() => {
    let isCancelled = false;
    let objectUrl = "";
    setSeekableAudioUrl("");

    if (!audioUrl) return undefined;

    void fetch(audioUrl, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load fine tuning audio.");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (isCancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = "";
          return;
        }
        setSeekableAudioUrl(objectUrl);
      })
      .catch(() => {
        if (!isCancelled) setSeekableAudioUrl(audioUrl);
      });

    return () => {
      isCancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [audioUrl]);

  return seekableAudioUrl;
}
