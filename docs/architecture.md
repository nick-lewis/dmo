# DMO Architecture Map

DMO is organized around behavior islands. Keep new work close to the feature or domain it changes, and avoid growing `frontend/src/App.tsx`, `core/views.py`, or `core/tests.py` back into catch-all files.

## Frontend

- `frontend/src/App.tsx`: route selection and top-level composition only.
- `frontend/src/types.ts`: shared frontend API and domain shapes.
- `frontend/src/api.ts`: API fetch helpers and route builders.
- `frontend/src/persistence.ts`: cookie, local storage, and browser persistence helpers.
- `frontend/src/scriptMarkers.ts`: script marker parsing, building, and timeline utilities.
- `frontend/src/actionRegistry.ts`: frontend action labels, descriptions, tones, and default configs.
- `frontend/src/features/`: feature components and hooks for editor, runtime, script audio, snapshots, chat, and panel study flows.
- `frontend/src/components/`: reusable presentational components that are not owned by one feature.

When adding frontend behavior, prefer one of these paths:

- Feature-specific state or UI: add it under `frontend/src/features/`.
- Shared API or payload shape: update `frontend/src/types.ts` and `frontend/src/api.ts`.
- Shared browser persistence: update `frontend/src/persistence.ts`.
- Script marker behavior: update `frontend/src/scriptMarkers.ts`.
- Action metadata: update `frontend/src/actionRegistry.ts` and matching backend tests.

## Backend

- `core/views.py`: legacy compatibility note only. Do not add new endpoints here.
- `dmo_5_2026/urls.py`: routes HTTP paths to focused view modules.
- `core/*_views.py`: thin HTTP handlers for one resource or runtime surface.
- `core/experience_services.py`: experience create, duplicate, import/export, snapshot, and start-event services.
- `core/runtime.py`: runtime state, context rules, conditions, and action execution.
- `core/runtime_execution.py`: runtime action serialization and execution helpers.
- `core/realtime_services.py`: realtime tools, instructions, model/voice validation, classifier/check evaluation, and prompt debug.
- `core/script_audio_services.py`: script audio inventory, generation orchestration, display transcript payloads, and slide recache iteration.
- `core/script_markers.py`: backend marker parsing, cue timing, and marker-to-runtime-action resolution.
- `core/checkpoints.py`: checkpoint payloads, fingerprints, summaries, save, and restore helpers.
- `core/validation.py`: validation for action config, conditions, chat tools, checks, classifiers, conversation choices, and emitted runtime actions.
- `core/serializers.py`: API/export serializers for users, sessions, messages, tutor settings, events, experiences, and checkpoints.

When adding backend behavior, prefer one of these paths:

- New or changed HTTP endpoint: add a focused `core/*_views.py` handler and route it in `dmo_5_2026/urls.py`.
- Business logic used by more than one endpoint or test: put it in the matching service/domain module.
- Runtime action behavior: update `core/runtime.py`, `core/runtime_execution.py`, and targeted runtime tests.
- Payload shape changes: update `core/serializers.py`, frontend types, and contract tests together.
- Validation changes: update `core/validation.py` and focused validation or API tests.

## Tests

- `core/tests.py`: legacy pointer only.
- `core/tests_contracts.py`: frontend/backend registry and API contract drift tests.
- `core/tests_conversation_runtime.py`: realtime chat, tools, conversation checks, and runtime conversation behavior.
- `core/tests_event_editor_api.py`: event editor API behavior and slide recache flows.
- `core/tests_experience_content.py`: experience import, export, duplication, and content serialization.
- `core/tests_interactive_runtime_actions.py`: emitted app actions and interactive runtime actions.
- `core/tests_realtime_models.py`: realtime model and voice registry validation.
- `core/tests_runtime_context.py`: runtime state, context, conditions, and event chains.
- `core/tests_script_audio.py`: script audio generation, inventory, cache, and display transcript behavior.
- `core/tests_seed_commands.py`: seed command smoke tests.
- `core/tests_slides.py`: slide resolution and marker behavior.

Add tests beside the behavior island they protect. If a test patches a function, patch the module boundary the production code calls.
