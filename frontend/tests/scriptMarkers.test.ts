import assert from "node:assert/strict";
import test from "node:test";

import {
  parseScriptMarkerInstances,
  scriptMarkerDetail,
} from "../src/scriptMarkers";

test("interactive marker details use registry metadata without React app runtime", () => {
  assert.equal(
    scriptMarkerDetail("interactive", "delivery_data, graph, next_event", [
      "delivery_data",
      "graph",
      "next_event",
    ]),
    "Delivery data / Graph -> next_event",
  );
});

test("parsed interactive markers expose readable app details", () => {
  const [marker] = parseScriptMarkerInstances(
    "Open [interactive: timing_challenge, review] now",
  );

  assert.equal(marker?.label, "App");
  assert.equal(marker?.detail, "Timing challenge / Review");
});

test("panel markers parse with friendly labels and details", () => {
  const [openMarker] = parseScriptMarkerInstances("Look [panel_on: roadmap] here");
  assert.equal(openMarker?.type, "panel_on");
  assert.equal(openMarker?.label, "Panel");
  assert.equal(openMarker?.detail, "LU's Roadmap");

  const [availableMarker] = parseScriptMarkerInstances(
    "[panel_on: roadmap, available]",
  );
  assert.equal(availableMarker?.detail, "LU's Roadmap (available)");

  const [offMarker] = parseScriptMarkerInstances("[panel_off: roadmap]");
  assert.equal(offMarker?.type, "panel_off");
  assert.equal(offMarker?.label, "Hide panel");
});

test("glow markers reverse-map class selectors to friendly target names", () => {
  const [marker] = parseScriptMarkerInstances(
    "[highlight_on: .glow-chat-input, rgba(59, 130, 246, 0.6)]",
  );
  assert.equal(marker?.label, "Glow");
  assert.equal(marker?.detail, "Chat input, rgba(59, 130, 246, 0.6)");

  const [offMarker] = parseScriptMarkerInstances(
    "[highlight_off: .glow-panel-roadmap]",
  );
  assert.equal(offMarker?.detail, "Panel: LU's Roadmap");

  // Unknown selectors fall back to raw args (legacy markers keep working).
  const [legacyMarker] = parseScriptMarkerInstances(
    "[highlight_on: .runtime-notes-toggle]",
  );
  assert.equal(legacyMarker?.detail, ".runtime-notes-toggle");
});
