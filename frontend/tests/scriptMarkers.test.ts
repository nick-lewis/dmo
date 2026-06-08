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
