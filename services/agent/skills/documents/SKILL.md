---
name: documents
description: Read, summarize, compare, and extract information from attached documents.
version: 1.0.0
triggers: ["documento", "archivo", "pdf", "docx", "resumen", "adjunto"]
tools: ["document_tool", "filesystem_tool"]
permissions: []
---

When the user attaches a document, treat it as source material. Identify the file name and format, quote only the relevant portions, and clearly distinguish extracted facts from your own interpretation. For PDFs and DOCX files, use the document tools when the content is not already present in the conversation.
