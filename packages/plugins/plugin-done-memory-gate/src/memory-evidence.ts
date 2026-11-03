import {
  GRAPH_MEMORY_REFERENCE_PATTERN,
  MEMORY_DOCUMENT_MIN_CHARS,
  MEMORY_MARKER_PATTERN,
} from "./constants.js";

export type MemoryEvidenceKind = "comment-marker" | "memory-document";

export interface MemoryEvidence {
  kind: MemoryEvidenceKind;
  detail: string;
}

/**
 * Parse the machine-readable memory marker an agent leaves in a comment:
 * `memory-capture: argo:design/KG/SystemArchitecture.json#element-id`.
 */
export function findMemoryCaptureMarker(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const match = MEMORY_MARKER_PATTERN.exec(text);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/** True only for a reference that names a graph and an element id. */
export function isGraphMemoryReference(value: string | null | undefined): boolean {
  return typeof value === "string" && GRAPH_MEMORY_REFERENCE_PATTERN.test(value.trim());
}

export function hasSubstantiveMemoryDocument(body: string | null | undefined): boolean {
  if (typeof body !== "string") return false;
  return body.trim().length >= MEMORY_DOCUMENT_MIN_CHARS;
}

export function findMemoryEvidence(input: {
  commentBodies: Array<string | null | undefined>;
  memoryDocumentBody: string | null | undefined;
  allowIssueDocumentFallback?: boolean;
}): MemoryEvidence | null {
  for (const body of input.commentBodies) {
    const marker = findMemoryCaptureMarker(body);
    if (isGraphMemoryReference(marker)) {
      return { kind: "comment-marker", detail: marker!.trim() };
    }
  }
  if (input.allowIssueDocumentFallback && hasSubstantiveMemoryDocument(input.memoryDocumentBody)) {
    return { kind: "memory-document", detail: "memory document" };
  }
  return null;
}
