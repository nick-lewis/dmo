import { useEffect, useMemo, useRef, useState } from "react";

import { PlayIcon, RefreshIcon, StopIcon } from "../components/Icons";
import {
  clampScriptTextAudioRevealSpeed,
  defaultScriptTextAudioRevealSpeed,
  readScriptTextAudioRevealSpeed,
  scriptTextPauseBoundaries,
  scriptTextPreviewIndexAtAudioTime,
  writeScriptTextAudioRevealSpeed,
} from "./useScriptAudioPlayback";

const sampleText = `Ah hello there, my name is D-Lou, and I hear you want to try out the learning experience I have been building.

Now, the idea is that we will work together as I guide you through a few introductory topics in deep learning.

But first I need you to meet someone. This is Liddle Lou, and right now Liddle Lou is not much of a conversationalist.

By building one capability at a time, Liddle Lou could start to learn how to do more interesting things.`;

const speedPresets = [1, 1.25, 1.5, 1.65, 1.85, 2, 2.5, 3];

function formatSeconds(value: number) {
  return `${value.toFixed(2)}s`;
}

export function ScriptTextSpeedLab() {
  const animationFrameRef = useRef(0);
  const startedAtRef = useRef(0);
  const startPositionRef = useRef(0);
  const [durationSeconds, setDurationSeconds] = useState(22);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [revealSpeed, setRevealSpeed] = useState(readScriptTextAudioRevealSpeed);
  const [text, setText] = useState(sampleText);

  const boundaries = useMemo(
    () => scriptTextPauseBoundaries(text, durationSeconds),
    [durationSeconds, text],
  );
  const visibleIndex = scriptTextPreviewIndexAtAudioTime({
    audioTimeSeconds: positionSeconds,
    durationSeconds,
    revealSpeed,
    text,
  });
  const visibleText = text.slice(0, visibleIndex);
  const progressPercent = durationSeconds
    ? Math.min(100, (positionSeconds / durationSeconds) * 100)
    : 0;

  useEffect(() => {
    writeScriptTextAudioRevealSpeed(revealSpeed);
  }, [revealSpeed]);

  useEffect(() => {
    if (!isPlaying) return undefined;

    function tick(now: number) {
      const elapsedSeconds = (now - startedAtRef.current) / 1000;
      const nextPosition = Math.min(
        durationSeconds,
        startPositionRef.current + elapsedSeconds,
      );
      setPositionSeconds(nextPosition);
      if (nextPosition >= durationSeconds) {
        setIsPlaying(false);
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    }

    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameRef.current);
  }, [durationSeconds, isPlaying]);

  function togglePlayback() {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    const nextStartPosition =
      positionSeconds >= durationSeconds ? 0 : positionSeconds;
    setPositionSeconds(nextStartPosition);
    startPositionRef.current = nextStartPosition;
    startedAtRef.current = performance.now();
    setIsPlaying(true);
  }

  function resetPreview() {
    setIsPlaying(false);
    setPositionSeconds(0);
  }

  function changeRevealSpeed(value: number) {
    setRevealSpeed(clampScriptTextAudioRevealSpeed(value));
  }

  return (
    <main className="panel-study script-speed-lab-page">
      <section className="script-speed-lab" aria-label="Script text speed lab">
        <div className="script-speed-lab-header">
          <div>
            <span>Script Text Speed</span>
            <h1>{revealSpeed.toFixed(2)}x</h1>
          </div>
          <button className="header-action" onClick={() => window.history.back()} type="button">
            Back
          </button>
        </div>

        <div className="script-speed-lab-grid">
          <section className="script-speed-lab-controls" aria-label="Speed controls">
            <label className="script-speed-control">
              <span>Reveal speed</span>
              <input
                max="4"
                min="0.7"
                onChange={(event) => changeRevealSpeed(Number(event.target.value))}
                step="0.05"
                type="range"
                value={revealSpeed}
              />
            </label>
            <div className="script-speed-presets" aria-label="Speed presets">
              {speedPresets.map((preset) => (
                <button
                  aria-pressed={Math.abs(revealSpeed - preset) < 0.001}
                  key={preset}
                  onClick={() => changeRevealSpeed(preset)}
                  type="button"
                >
                  {preset.toFixed(preset % 1 ? 2 : 0)}x
                </button>
              ))}
            </div>
            <label className="script-speed-control">
              <span>Audio length</span>
              <input
                max="45"
                min="8"
                onChange={(event) => {
                  const nextDuration = Number(event.target.value);
                  setDurationSeconds(nextDuration);
                  setPositionSeconds((current) => Math.min(current, nextDuration));
                }}
                step="1"
                type="range"
                value={durationSeconds}
              />
            </label>
            <textarea
              aria-label="Sample display text"
              className="script-speed-textarea"
              onChange={(event) => {
                setText(event.target.value);
                resetPreview();
              }}
              spellCheck={false}
              value={text}
            />
          </section>

          <section className="script-speed-lab-preview" aria-label="Live preview">
            <div className="script-speed-transport">
              <button
                aria-label={isPlaying ? "Pause preview" : "Play preview"}
                className="next-script-audio-preview-button has-audio"
                onClick={togglePlayback}
                type="button"
              >
                {isPlaying ? <StopIcon /> : <PlayIcon />}
              </button>
              <button
                aria-label="Reset preview"
                className="next-script-audio-preview-button"
                onClick={resetPreview}
                type="button"
              >
                <RefreshIcon />
              </button>
              <strong>
                {formatSeconds(positionSeconds)} / {formatSeconds(durationSeconds)}
              </strong>
              <span>Saved {revealSpeed.toFixed(2)}x</span>
            </div>

            <div className="script-speed-timeline" aria-label="Simulated audio">
              <span style={{ width: `${progressPercent}%` }} />
              {boundaries.map((boundary) => (
                <i
                  aria-hidden="true"
                  key={`${boundary.index}-${boundary.timeSeconds}`}
                  style={{
                    left: `${(boundary.timeSeconds / durationSeconds) * 100}%`,
                  }}
                />
              ))}
            </div>

            <div className="script-speed-chat-frame">
              <div className="chat-message tutor script-speed-message">
                <span>D-Lou</span>
                <p>{visibleText || "..."}</p>
              </div>
            </div>

            <div className="script-speed-readout">
              <span>{visibleIndex} / {text.length} characters</span>
              <span>{boundaries.length} page breaks</span>
              <span>Default {defaultScriptTextAudioRevealSpeed.toFixed(2)}x</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
