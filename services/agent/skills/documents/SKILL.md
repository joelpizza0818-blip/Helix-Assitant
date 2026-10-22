---
name: documents
description: Read, summarize, compare, extract, and edit attached documents while preserving source fidelity and distinguishing facts from interpretation.
version: 2.0.0
triggers: [documento, archivo, pdf, docx, resumen, adjunto]
tools: [document_tool, filesystem_tool]
permissions: []
dependencies: []
---

# Documents Skill

Use for PDF, DOCX, Word, Markdown, and text-document work. Identify filename, format, intended operation, and whether the original must remain untouched.

## Procedure

1. Inspect relevant structure: headings, tables, links, metadata, comments, tracked changes, headers, footers, and media.
2. Extract only relevant content and retain page, section, or table references.
3. Preserve exact wording for legal, technical, archival, and redline work; never invent missing text or citations.
4. For edits, preserve styles, numbering, links, page breaks, language, and accessibility structure.
5. Render modified documents when layout matters and check representative and boundary pages.
6. Re-open or parse the saved output to confirm validity and completeness.

## Output

Separate extracted facts, quotations, interpretation, and proposed text. Report source and output paths, changes, render/parse checks, unresolved layout problems, and whether the source was preserved.

## Examples

- User: "Summarize this PDF."
  Agent: extracts relevant sections, gives page references, and distinguishes source facts from synthesis.
- User: "Edit this proposal."
  Agent: preserves the original, applies focused changes, renders the result, and reports layout checks.
