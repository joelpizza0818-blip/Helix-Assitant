---
name: data-analysis
description: Inspect CSV, JSON, and tabular files and explain useful findings.
version: 1.0.0
triggers: ["csv", "json", "datos", "tabla", "analiza", "analizar"]
tools: ["document_tool", "filesystem_tool"]
permissions: []
---

For attached data files, first establish the schema and relevant size limits, then report patterns, anomalies, and limitations. Preserve exact values when they matter and never invent missing rows or calculations.
