import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getMainPanelAppDefinition,
  type MainPanelAppHost,
  type RuntimeInteractive,
} from "../mainPanelApps";
import type {
  ResolvedSlide,
  SlideStatus,
} from "../types";


const slideDissolveDurationMs = 320;


export function MainPanelContent({
  context,
  emitInteractiveActions,
  error,
  interactive,
  interactiveState,
  onInteractiveComplete,
  onInteractiveEvent,
  onInteractiveSaveContext,
  onInteractiveStateChange,
  slide,
  status,
}: {
  context: Record<string, unknown>;
  emitInteractiveActions: (actions: Array<Record<string, unknown>>) => void;
  error: string;
  interactive: RuntimeInteractive | null;
  interactiveState: Record<string, unknown>;
  onInteractiveComplete: (
    state?: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) => void;
  onInteractiveEvent: (eventSlug: string, state?: Record<string, unknown>) => void;
  onInteractiveSaveContext: (
    values: Record<string, unknown>,
    state?: Record<string, unknown>,
  ) => Promise<void>;
  onInteractiveStateChange: (state: Record<string, unknown>) => void;
  slide: ResolvedSlide | null;
  status: SlideStatus;
}) {
  if (interactive) {
    return (
      <InteractiveWorkspace
        context={context}
        emitActions={emitInteractiveActions}
        interactive={interactive}
        onComplete={onInteractiveComplete}
        onRunEvent={onInteractiveEvent}
        onSaveContext={onInteractiveSaveContext}
        onStateChange={onInteractiveStateChange}
        state={interactiveState}
      />
    );
  }

  if (slide) {
    return <DissolveSlideWorkspace slide={slide} />;
  }

  if (error) {
    return (
      <div className="slide-workspace empty error">
        <div className="slide-empty-state">
          <span>Slide unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label={status === "loading" ? "Loading slide" : "Empty slide panel"}
      className="slide-workspace empty"
    />
  );
}


function slideRenderKey(slide: ResolvedSlide) {
  return [
    slide.imageUrl,
    slide.pageId,
    slide.presentationId,
    slide.slideRef,
  ].join("::");
}


function DissolveSlideWorkspace({ slide }: { slide: ResolvedSlide }) {
  const [currentSlide, setCurrentSlide] = useState<ResolvedSlide | null>(null);
  const [incomingSlide, setIncomingSlide] = useState<ResolvedSlide | null>(null);
  const [isDissolving, setIsDissolving] = useState(false);
  const [currentVisible, setCurrentVisible] = useState(false);
  const currentKeyRef = useRef("");
  const timeoutRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  function clearPendingTransition() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }

  useEffect(() => {
    return clearPendingTransition;
  }, []);

  useEffect(() => {
    const nextKey = slideRenderKey(slide);
    if (!currentKeyRef.current) {
      let cancelled = false;
      clearPendingTransition();

      const fadeInInitialSlide = () => {
        if (cancelled) return;

        currentKeyRef.current = nextKey;
        setCurrentSlide(slide);
        setIncomingSlide(null);
        setIsDissolving(false);
        setCurrentVisible(false);
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = window.requestAnimationFrame(() => {
            if (!cancelled) {
              setCurrentVisible(true);
            }
          });
        });
      };

      const image = new Image();
      image.onload = fadeInInitialSlide;
      image.onerror = fadeInInitialSlide;
      image.src = slide.imageUrl;

      return () => {
        cancelled = true;
        clearPendingTransition();
      };
    }

    if (nextKey === currentKeyRef.current) {
      setCurrentSlide(slide);
      setCurrentVisible(true);
      return;
    }

    let cancelled = false;
    clearPendingTransition();

    const startTransition = () => {
      if (cancelled) return;

      setIncomingSlide(slide);
      setIsDissolving(false);
      setCurrentVisible(true);
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = window.requestAnimationFrame(() => {
          if (!cancelled) {
            setIsDissolving(true);
          }
        });
      });
      timeoutRef.current = window.setTimeout(() => {
        if (cancelled) return;

        currentKeyRef.current = nextKey;
        setCurrentSlide(slide);
        setIncomingSlide(null);
        setIsDissolving(false);
        setCurrentVisible(true);
        timeoutRef.current = null;
      }, slideDissolveDurationMs + 80);
    };

    const image = new Image();
    image.onload = startTransition;
    image.onerror = startTransition;
    image.src = slide.imageUrl;

    return () => {
      cancelled = true;
      clearPendingTransition();
    };
  }, [slide.imageUrl, slide.pageId, slide.presentationId, slide.slideRef]);

  return (
    <div className="slide-workspace">
      <div
        className="slide-image-stage dissolve-stage"
        style={
          {
            "--slide-dissolve-duration": `${slideDissolveDurationMs}ms`,
          } as CSSProperties
        }
      >
        {/* Google slide exports are opaque, so keeping the current layer fully
            visible while the next layer fades in preserves unchanged pixels. */}
        {currentSlide ? (
          <div
            className={[
              "slide-dissolve-layer",
              "current",
              currentVisible ? "visible" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <img
              alt={`Google slide ${currentSlide.slideRef}`}
              className="google-slide-image"
              src={currentSlide.imageUrl}
            />
          </div>
        ) : null}
        {incomingSlide ? (
          <div
            className={[
              "slide-dissolve-layer",
              "incoming",
              isDissolving ? "visible" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <img
              alt={`Google slide ${incomingSlide.slideRef}`}
              className="google-slide-image"
              src={incomingSlide.imageUrl}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}


function InteractiveWorkspace({
  context,
  emitActions,
  interactive,
  onComplete,
  onRunEvent,
  onSaveContext,
  onStateChange,
  state,
}: {
  context: Record<string, unknown>;
  emitActions: (
    actions: Array<Record<string, unknown>>,
    state?: Record<string, unknown>,
  ) => void;
  interactive: RuntimeInteractive;
  onComplete: (
    state?: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) => void;
  onRunEvent: (eventSlug: string, state?: Record<string, unknown>) => void;
  onSaveContext: (
    values: Record<string, unknown>,
    state?: Record<string, unknown>,
  ) => Promise<void>;
  onStateChange: (state: Record<string, unknown>) => void;
  state: Record<string, unknown>;
}) {
  const appDefinition = getMainPanelAppDefinition(interactive.interactiveId);
  const host: MainPanelAppHost = {
    context,
    emitActions,
    runEvent: onRunEvent,
    saveContext: (values) => onSaveContext(values, state),
    setState: onStateChange,
    submit: onComplete,
  };

  if (appDefinition) {
    const AppComponent = appDefinition.Component;
    return (
      <AppComponent
        host={host}
        interactive={interactive}
        state={state}
      />
    );
  }

  return (
    <div className="interactive-workspace">
      <div className="interactive-shell unavailable-interactive">
        <div className="interactive-header">
          <span>{interactive.interactiveId || "app"}</span>
          <strong>App unavailable</strong>
        </div>
        <p>This main-panel app is not registered in the app code.</p>
      </div>
    </div>
  );
}
