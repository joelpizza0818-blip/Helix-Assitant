---
name: data-analysis
description: Analyze CSV, JSON, spreadsheet, and tabular data with reproducible calculations, schema validation, anomalies, and explicit limitations.
version: 2.0.0
triggers: [csv, json, datos, tabla, analiza, analizar]
tools: [document_tool, filesystem_tool]
permissions: []
dependencies: []
---

# Data Analysis Skill

For attached data, establish schema, size, encoding, units, and time zone before calculating. Work from an immutable source or derived copy.

## Procedure

1. Profile row count, columns, types, missingness, duplicates, invalid values, ranges, and coercions.
2. Define filters, denominator, grouping, time window, and aggregation rules.
3. Calculate reproducibly and keep raw values distinct from rounded display values.
4. Check totals, sample rows, unmatched keys, and reasonable alternate assumptions.
5. Report findings, anomalies, exclusions, limitations, and next actions.

## Integrity

Never silently drop rows or fabricate missing values. Preserve identifiers as strings when needed, distinguish null/blank/zero/unknown, and minimize PII exposure. Correlation is not causation. Charts must label units, filters, sample size, and missing-data effects.

## Examples

- User: "Find the products with the highest failure rate."
  Agent: validates the failure field, defines the denominator, calculates rates, and reports counts plus exclusions.
- User: "Compare these CSV files."
  Agent: aligns schemas and keys and reports added, removed, changed, duplicate, and unmatched rows.
