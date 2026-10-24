# Bandly Router Compatibility Specification

## Purpose
Document compatibility by manufacturer, exact router model, firmware,
and individual feature. This knowledge base does not change production
behavior by itself.

## Record structure
Every record uses the structure defined in `router.schema.json`.

Required top-level fields:
- `recordId`: unique stable identifier; lowercase letters, digits, dots,
  underscores, and hyphens only; must start with a letter or digit.
- `manufacturer`: non-empty manufacturer name.
- `featureId`: non-empty identifier for one feature.
- `verification`: verification state and review metadata.
- `evidence`: one or more evidence objects.
- `limitations`: list of strings; use an empty list if none are known.
- `riskLevel`: `LOW`, `MEDIUM`, or `HIGH`.

Optional identity and description fields:
- `model`
- `hardwareVersion`
- `softwareVersion`
- `claim`

## Verification
`verification` contains:
- `status`: `DISCOVERED`, `CODE_TESTED`, `DEVICE_TESTED`,
  `APPROVED`, or `UNSUPPORTED`.
- `checkedAt`: date/time when the record was checked.
- `reviewer`: reviewer identity or null.
- `testNotes`: test notes or null.

`APPROVED` additionally requires a reviewer, test notes, and at least one
`physical_device_test` evidence item. Approval must reflect a real test
on the specific device and firmware, not a manufacturer-level assumption.

## Evidence
Each evidence object contains:
- `type`: `official_documentation`, `source_code`, `automated_test`,
  `physical_device_test`, or `other`.
- `reference`: source identifier, URL, or test artifact reference.
- `supports`: the specific claim supported by this evidence.
- `accessedAt`: optional access date/time or null.

Distinguish documented claims from code tests and physical-device results.
Do not invent sources or imply that a test ran when it did not.

## Safety and compatibility rules
- Never infer feature support from manufacturer alone.
- Record the exact model and firmware when known.
- Never store passwords, cookies, tokens, IMEI, or personal data.
- Never execute router write operations during identity discovery.
- A failed identity lookup must not prevent router connection.
- Preserve existing router safety guards and backward compatibility.
- High-risk features require explicit review before production use.

## Import and release policy
- Place candidate JSON records in `incoming/`.
- Run the validator and inspect the importer's dry-run output first.
- Only records with status `APPROVED` may be imported using `--apply`.
- Unknown manufacturers must be added to the known list only after review.
- Importing knowledge records is not a production deployment.
- Any application integration requires a separate review and test plan.
