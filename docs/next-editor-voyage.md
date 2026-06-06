# Next Editor Voyage Notes

These notes capture the working design metaphor for the new experience editor so it does not get lost in chat history. The legacy editor and old pedagogy project are the old map: useful records of prior routes, workarounds, action order, branch logic, brittle spots, and things that worked. The new editor is the maiden voyage toward a cleaner translation world for cognitive task analysis and executable tutoring behavior.

## North Star

The new editor should feel less like a form builder and more like a navigable map, working journal, and scriptable cockpit.

The captain's job is to solve the learning and logic problems. The first mate's job is to keep useful records in the right places: what changed, why it changed, what old-map clue mattered, where a branch came from, what conundrum is unresolved, and what needs to be tested later.

That means the system should help preserve reasoning as part of the work, not ask the user to constantly stop and fill out forms.

## Core Objects

- **Map**: the event graph, routes, start points, dead ends, disconnected events, and branch structure.
- **Route evidence**: what led down a path, including conditions, learner choices, classifier results, tool outcomes, or state changes.
- **Script**: Python-styled DSL and raw script text that express behavior flexibly without saving brittle executable files.
- **Log**: chronological design memory about changes, decisions, old-map references, and test notes.
- **Conundrum**: an unresolved design, logic, pedagogy, data, or implementation problem attached to the relevant event, route, script, or snapshot.
- **Checkpoint**: a snapshot with automatic date/time and enough context to return to a known point in the traversal.

## Design Principles

- Inspect first, edit intentionally.
- Selection should reveal context without forcing edit mode.
- Editing should happen when the user chooses a specific object: event, route, on-entry script, voice script, note, or setting.
- The graph should show reasoning, not just destinations.
- Edge information should answer "why did we go this way?" rather than "what does the next event do?"
- Old editor functionality should remain available as reference material while the new editor develops its own structure.
- The new editor should avoid copying the legacy interface visually.
- Flexibility matters: arbitrary logic, conditionals, comments, loops, helper calls, and custom actions need a real path in the DSL model.

## System Implications

1. **Legacy as reference, not foundation**
   Preserve old events, scripts, and actions as old-map material. The new editor can read, compare, migrate, and reference them without inheriting the old visual model.

2. **Source and compiled behavior must be separate**
   The DSL should be stored as source in the database, then parsed, validated, and compiled into safe runnable actions. This keeps the flexibility of code without returning to brittle file-writing workarounds.

3. **The first-mate layer should be mostly automatic**
   The system should be able to generate draft log entries from editor actions and collaboration history. The user should be able to inspect, correct, pin, delete, or promote entries, but should not have to manually document every step.

4. **Notes need structure**
   A generic notes field is not enough. We need at least voyage log entries, route notes, conundrums, old-map references, captain decisions, and checkpoint notes.

5. **Routes deserve first-class design space**
   Branches should carry conditions, evidence, rationale, and test hints. This matters as much as the event body itself.

6. **Snapshots become checkpoints**
   Saving and loading snapshots is part of traversal. Loading should preserve the current state first so the user can return.

7. **Testing should become path-based**
   The editor should eventually support testing a route: start here, take this branch, see which actions fired, inspect state changes, and compare expected reasoning with actual runtime behavior.

## Near-Term Product Anchors

- Keep the graph visible by default; collapse is a deliberate user choice.
- Event cards should stay inspectable and lightweight.
- Event detail should start with editable title and description, then grow around focused sections.
- On-entry should use a full-featured Python-styled DSL editor with custom completions and right-click action insertion.
- Script action detail should show the literal editable script first, without legacy action cues.
- Route/edge surfaces should prioritize what led to the path.
- Settings should live behind intentional controls rather than always-on forms.
- Checkpoints and logs should be accessible from the broad editor context, not as a permanent on-screen form section.

## Open Questions

- What is the smallest useful first version of the first-mate log?
- Which log entries can be generated automatically from local editor actions alone?
- Which entries need explicit collaboration context from Codex/user conversation?
- How should old-map references point to legacy editor artifacts without coupling the new editor to legacy UI state?
- Should conundrums live as their own model, or begin as structured metadata in the experience payload?
- What should the DSL compiler output be for existing runtime actions, and how much should remain directly editable in the old editor?
