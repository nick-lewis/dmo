# Stabilization Audit

This pass checks whether the post-refactor code still has obvious large leftover knots worth extracting immediately.

## Current Hotspots

Largest frontend source files:

- `frontend/src/styles.css`: shared application styling.
- `frontend/src/features/ScriptActionEditor.tsx`: script marker editing, slide view, chip editing, timeline editing, and audio preview.
- `frontend/src/features/PanelStudy.tsx`: runtime composition for session, slide, chat, interactive app, notebook, and inspector surfaces.
- `frontend/src/features/ExperienceEditor.tsx`: editor composition around extracted autosave, history, event mutation, validation, script audio, snapshots, and run hooks.

Largest backend source files:

- `core/validation.py`: validation contracts for actions, conditions, tools, checks, classifiers, conversation choices, and emitted runtime actions.
- `core/experience_services.py`: experience lifecycle, duplication, import/export, snapshots, and defaults.
- `core/script_audio_services.py`: script audio inventory, generation, display transcript, and slide recache workflows.
- `core/runtime.py`: runtime state, context rules, conditions, event chains, and debug traces.
- `core/realtime_services.py`: realtime instructions, tools, model/voice registries, checks, classifiers, and prompt debug.

## Decision

No additional extraction was made during this stabilization pass.

The remaining large frontend files are feature surfaces that already compose extracted hooks and subcomponents. `ScriptActionEditor.tsx` is the clearest future candidate, but its remaining logic is tightly coupled local interaction state: textarea selection, chip keyboard handling, drag/drop, timeline scrubbing, marker editing, and audio preview. Pulling that apart safely should happen behind focused tests or during direct feature work, not as an opportunistic cleanup.

The remaining large backend files are domain modules created by the refactor. They are still dense, but they now have clear ownership and focused test files. Further splitting should follow new behavior boundaries, such as a new validator family or a new runtime action subsystem.

## Follow-Up Triggers

Refactor again only when one of these happens:

- A file gets a second independent state machine that can be named and tested on its own.
- A bug fix requires touching the same private helper cluster in more than one place.
- A new feature needs a reusable domain contract, not just local rendering changes.
- A focused test becomes hard to write because the behavior is still trapped inside a UI component.
