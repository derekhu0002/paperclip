import { describe, expect, it } from "vitest";
import {
  findMemoryCaptureMarker,
  findMemoryEvidence,
  hasSubstantiveMemoryDocument,
  isGraphMemoryReference,
} from "../src/memory-evidence.js";
import { MEMORY_DOCUMENT_MIN_CHARS } from "../src/constants.js";
const LONG_MEMORY = "Lessons and key decisions. ".repeat(12);

describe("memory evidence parsing", () => {
  it("extracts a machine-readable memory-capture marker", () => {
    expect(findMemoryCaptureMarker("done\nmemory-capture: argo:graph#element-1")).toBe(
      "argo:graph#element-1",
    );
    expect(findMemoryCaptureMarker("  MEMORY-CAPTURE :  argo:g#e ")).toBe("argo:g#e");
    expect(findMemoryCaptureMarker("no marker here")).toBeNull();
    expect(findMemoryCaptureMarker(null)).toBeNull();
  });

  it("accepts only a graph-qualified element reference", () => {
    expect(isGraphMemoryReference("argo:design/KG/SystemArchitecture.json#memory-1")).toBe(true);
    expect(isGraphMemoryReference("argo:graph#element")).toBe(true);
    expect(isGraphMemoryReference("doc:memory")).toBe(false);
    expect(isGraphMemoryReference("argo:no-element")).toBe(false);
    expect(isGraphMemoryReference("#element-only")).toBe(false);
    expect(isGraphMemoryReference(null)).toBe(false);
  });

  it("accepts only a substantive memory document", () => {
    expect(hasSubstantiveMemoryDocument("short")).toBe(false);
    expect(hasSubstantiveMemoryDocument(" ".repeat(MEMORY_DOCUMENT_MIN_CHARS + 10))).toBe(false);
    expect(hasSubstantiveMemoryDocument(LONG_MEMORY)).toBe(true);
  });

  it("prefers a graph marker and falls back to the document only when allowed", () => {
    expect(findMemoryEvidence({
      commentBodies: ["Finished.\nmemory-capture: argo:x#y"],
      memoryDocumentBody: LONG_MEMORY,
    })).toEqual({ kind: "comment-marker", detail: "argo:x#y" });
    expect(findMemoryEvidence({
      commentBodies: ["memory-capture: doc:memory"],
      memoryDocumentBody: LONG_MEMORY,
    })).toBeNull();
    expect(findMemoryEvidence({
      commentBodies: [],
      memoryDocumentBody: LONG_MEMORY,
    })).toBeNull();
    expect(findMemoryEvidence({
      commentBodies: [],
      memoryDocumentBody: LONG_MEMORY,
      allowIssueDocumentFallback: true,
    })).toEqual({ kind: "memory-document", detail: "memory document" });
    expect(findMemoryEvidence({ commentBodies: [], memoryDocumentBody: null })).toBeNull();
  });
});
