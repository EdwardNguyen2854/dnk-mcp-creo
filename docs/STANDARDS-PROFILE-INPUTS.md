# Standards profile — unresolved project inputs

**Status:** decision worksheet only. It is not a configured profile, standards adoption, or compliance claim. Every project-specific value remains **TBD** until supplied or approved by the responsible design authority.

The candidate standards in [`ROADMAP.md`](ROADMAP.md) are research candidates only. Their presence in that list does not establish applicability, edition, precedence, or customer/company adoption. Creo/OTK API capability is separate from standards conformity.

Current API reconnaissance is summarized in [the PTC PMI research note](research/CREO-OTK-PMI-API.md); it is a static documentation review, not live-validated PMI support or standards evidence. Official ISO candidate catalog facts and access limits are summarized in [the standards-status research note](research/ISO-CANDIDATE-STANDARDS-STATUS.md); those facts do not constitute an adoption decision.

## Decisions required before an ISO-profiled manufacturing release

| Area | Required decision | Authoritative source / approver | Status |
|---|---|---|---|
| Applicable standards | Exact standards and editions for digital product definition, drawings, dimensioning, geometrical specifications, datums, and surface texture; identify scope, exclusions, and contract precedence | Customer specification and/or company engineering authority | TBD |
| Customer/company overlays | Applicable company/customer conventions, precedence when they conflict with a cited standard, and controlled document revisions | Customer/company controlled documents and authorized owner | TBD |
| Model and drawing units | Model units, drawing units, displayed precision, and any conversion/rounding rules | Design authority | TBD |
| Projection and sheets | Projection method, permitted sheet sizes/orientations, frame/template, scale policy, and view-layout rules | Design authority / drawing template owner | TBD |
| Title block and revision | Required fields, formats, numbering/revision scheme, change history, and mandatory notes | Document-control authority | TBD |
| Dimensional tolerances | General dimensional tolerance policy, exceptions, and whether a general-tolerance standard is explicitly adopted | Design authority | TBD |
| Geometrical specifications | Required characteristics, datum reference frame policy, datum precedence, modifiers, and validation/approval responsibilities | Design authority | TBD |
| Fits and interfaces | Permitted fit classes and mating-part/interface intent; no fit may be inferred from geometry alone | Design authority | TBD |
| Material and process | Material, condition, treatment, manufacturing process, and inspection requirements when required | Design authority / manufacturing authority | TBD |
| Surface texture | Which identified surfaces require texture indications, symbols/parameters, and confirmed process or functional basis | Design authority | TBD |
| PMI/drawing association | Required semantic annotation types, stable model/geometry references, drawing visibility rules, and readback evidence | Design authority plus Creo workflow owner | TBD |
| Approval and release | Named roles for drawn/checked/approved, required evidence, signatures, and criteria distinguishing review from manufacturing release | Authorized engineering/release authority | TBD |
| Deliverables | Required native Creo files and export formats (PDF/DXF/etc.), destination and retention rules | Customer/company release process | TBD |

## Safe default behavior until decisions are supplied

- Missing required profile fields must remain explicitly unresolved and block a manufacturing-release claim.
- Do not synthesize tolerances, datums, material, fits, process, surface finish, revision values, title-block content, projection, or approval identities from geometry or generic examples.
- A profile may describe a review workflow, but review status must not be mislabeled as manufacturing release.
- The installed CAD review skill contains example review defaults (including a sample sheet, projection, units, and revision). Those are not approved project values and are intentionally not copied into this worksheet.
- Keep standards-profile validation configurable and fail closed when required inputs are absent or conflicting.

## User drawing-workflow preference (non-normative)

When authoring a drawing, create one master view first, then use the project/projection workflow to create dependent views. This is a workflow preference, not a standards requirement.
