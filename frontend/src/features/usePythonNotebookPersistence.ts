import {
  type Dispatch,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import {
  defaultPythonNotebookState,
  normalizePythonNotebookState,
  type PythonNotebookState,
  type PythonNotebookStatus,
} from "../PythonNotebookPanel";
import { apiFetch } from "../api";
import type {
  ChatMessage,
  PythonNotebookPayload,
  TutoringSession,
} from "../types";

type PythonNotebookPersistenceOptions = {
  applyRuntimeActions: (actions: Array<Record<string, unknown>>) => void;
  session: TutoringSession | null;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSession: Dispatch<SetStateAction<TutoringSession | null>>;
};

export function usePythonNotebookPersistence({
  applyRuntimeActions,
  session,
  setMessages,
  setSession,
}: PythonNotebookPersistenceOptions) {
  const notebookSaveTimerRef = useRef<number | null>(null);
  const notebookSaveVersionRef = useRef(0);
  const [pythonNotebook, setPythonNotebook] = useState<PythonNotebookState>(
    defaultPythonNotebookState(),
  );
  const [pythonNotebookStatus, setPythonNotebookStatus] =
    useState<PythonNotebookStatus>("idle");
  const [pythonNotebookError, setPythonNotebookError] = useState("");

  function clearNotebookSaveTimer() {
    if (notebookSaveTimerRef.current !== null) {
      window.clearTimeout(notebookSaveTimerRef.current);
      notebookSaveTimerRef.current = null;
    }
  }

  async function persistPythonNotebook(
    notebook: PythonNotebookState,
    action: "save" | "run" | "format" = "save",
    options: { cellId?: string; runAll?: boolean } = {},
  ) {
    if (!session) return false;

    const version = notebookSaveVersionRef.current + 1;
    notebookSaveVersionRef.current = version;
    if (action !== "save") {
      clearNotebookSaveTimer();
    }

    setPythonNotebookStatus(
      action === "run" ? "running" : action === "format" ? "formatting" : "saving",
    );
    setPythonNotebookError("");

    try {
      const payload = await apiFetch<PythonNotebookPayload>(
        `/api/sessions/${session.id}/notebook/`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            cellId: options.cellId ?? notebook.activeCellId,
            notebook,
            runAll: Boolean(options.runAll),
          }),
        },
      );

      if (notebookSaveVersionRef.current !== version) return false;

      setSession(payload.session);
      setMessages(payload.messages);
      setPythonNotebook(normalizePythonNotebookState(payload.notebook));
      applyRuntimeActions(payload.actions);
      setPythonNotebookStatus("idle");
      return true;
    } catch (error) {
      if (notebookSaveVersionRef.current !== version) return false;
      setPythonNotebookStatus("idle");
      setPythonNotebookError(
        error instanceof Error ? error.message : "Could not update Python notebook.",
      );
      return false;
    }
  }

  function queuePythonNotebookSave(nextNotebook: PythonNotebookState) {
    clearNotebookSaveTimer();
    notebookSaveTimerRef.current = window.setTimeout(() => {
      notebookSaveTimerRef.current = null;
      void persistPythonNotebook(nextNotebook, "save");
    }, 500);
  }

  function changePythonNotebook(nextNotebook: PythonNotebookState) {
    const updatedNotebook = {
      ...nextNotebook,
      updatedAt: new Date().toISOString(),
    };
    setPythonNotebook(updatedNotebook);
    queuePythonNotebookSave(updatedNotebook);
  }

  function clearPythonNotebookOutputs() {
    changePythonNotebook({
      ...pythonNotebook,
      cells: pythonNotebook.cells.map((cell) => {
        const { output: _output, ...rest } = cell;
        return rest;
      }),
    });
  }

  function runPythonNotebookCell(cellId: string) {
    const nextNotebook = {
      ...pythonNotebook,
      activeCellId: cellId,
      updatedAt: new Date().toISOString(),
    };
    setPythonNotebook(nextNotebook);
    void persistPythonNotebook(nextNotebook, "run", { cellId });
  }

  function runPythonNotebookAll() {
    void persistPythonNotebook(pythonNotebook, "run", { runAll: true });
  }

  function formatPythonNotebookCell(cellId: string) {
    const nextNotebook = {
      ...pythonNotebook,
      activeCellId: cellId,
      updatedAt: new Date().toISOString(),
    };
    setPythonNotebook(nextNotebook);
    void persistPythonNotebook(nextNotebook, "format", { cellId });
  }

  return {
    changePythonNotebook,
    clearNotebookSaveTimer,
    clearPythonNotebookOutputs,
    formatPythonNotebookCell,
    pythonNotebook,
    pythonNotebookError,
    pythonNotebookStatus,
    runPythonNotebookAll,
    runPythonNotebookCell,
    setPythonNotebook,
    setPythonNotebookError,
    setPythonNotebookStatus,
  };
}
