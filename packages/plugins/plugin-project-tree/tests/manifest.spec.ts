import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.js";
import { PAGE_ROUTE } from "../src/constants.js";

describe("project tree plugin wiring", () => {
  it("keeps the stable /organization route and a sidebar entry", () => {
    expect(PAGE_ROUTE).toBe("organization");
    const slots = manifest.ui?.slots ?? [];
    const page = slots.find((slot) => slot.type === "page");
    const sidebar = slots.find((slot) => slot.type === "sidebar");
    expect(page?.routePath).toBe("organization");
    expect(page?.exportName).toBeTruthy();
    expect(sidebar?.exportName).toBeTruthy();
  });

  it("asks for read capabilities plus the narrow structure-write capability", () => {
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining(["projects.read", "projects.structure.write", "agents.read"]),
    );
    expect(manifest.capabilities?.filter((capability) => capability.includes("write"))).toEqual([
      "projects.structure.write",
    ]);
  });
});
