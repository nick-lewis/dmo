# New Editor Browser Smoke

Use this after frontend refactors that can affect `/next` routing, tab restore, or the active script workspace.

## Target

Start from a URL with an event, script, and tab hash:

```text
http://localhost:5173/experiences/<experience-id>/next#event=<event-id>&script=0&tab=fine-tuning
```

## Checks

1. Hard refresh the page.
2. Confirm the URL still includes:
   - `/next`
   - `event=<event-id>`
   - `script=0`
   - `tab=fine-tuning`
3. Confirm the editor renders:
   - Events panel is visible.
   - Fine Tuning tab is selected or the Fine Tuning panel content is visible.
   - Script workspace tab buttons are visible: Audio, Display Text, Slides & Actions, Fine Tuning.
4. Confirm the browser console has no errors after load.
5. Switch to Display Text, hard refresh, and confirm the URL restores `tab=display`.
6. Switch back to Fine Tuning and confirm the Fine Tuning panel loads without console errors.

## Notes

- This smoke is intentionally narrow. It catches the common regressions from editor refactors: hash state loss, selected script loss, broken tab rendering, and runtime crashes.
- Keep deeper behavior checks in focused tests when the logic can be pure. Use this browser smoke for wiring that only fails once the full app is mounted.
