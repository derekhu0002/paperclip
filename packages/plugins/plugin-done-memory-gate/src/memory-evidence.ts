import {
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

export function hasSubstantiveMemoryDocument(body: string | null | undefined): boolean {
  if (typeof body !== "string") return false;
  return body.trim().length >= MEMORY_DOCUMENT_MIN_CHARS;
}

export function findMemoryEvidence(input: {
  commentBodies: Array<string | null | undefined>;
  memoryDocumentBody: string | null | undefined;
}): MemoryEvidence | null {
  for (const body of input.commentBodies) {
    const marker = findMemoryCaptureMarker(body);
    if (marker) return { kind: "comment-marker", detail: marker };
  }
  if (hasSubstantiveMemoryDocument(input.memoryDocumentBody)) {
    return { kind: "memory-document", detail: "memory document" };
  }
  return null;
}
