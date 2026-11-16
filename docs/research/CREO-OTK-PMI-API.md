# Creo 9.0.2.0 OTK C++ APIs for semantic PMI

## Scope and confidence

This is a static review of the installed Creo Object TOOLKIT C++ API documentation under:

`<CREO_INSTALL_DIR>\Common Files\otk_cpp_doc\objecttoolkit_Creo\api`

It also compares those documented APIs with the current bridge/server source in this repository. No PMI API was invoked in a running Creo session; the signatures and behavior below are documented capabilities, not live-tested results. The report is research only and does not edit implementation files.

The repository has no existing research-note convention under `docs/`, so this note is placed in `docs/research/`.

This does not select an ISO edition/profile or establish tolerance, datum, surface-texture, or company policy. `docs/ROADMAP.md` explicitly leaves the applicable editions, customer/company conventions, and approval authority to be confirmed before release; its candidate standards list is not a compliance declaration.

## Findings at a glance

Creo 9.0.2.0 OTK documents typed creation and readback APIs for annotation features/elements, notes, set datum tags, GTols, dimensions, and surface-finish symbols. The repo currently has dimension read/write and datum-geometry feature tools, but no corresponding semantic annotation, set-datum-tag, GTol, or surface-finish bridge/tool operations. Listing also needs careful scope handling: several PMI item-type enum values exist, but the documented `pfcModelItemOwner::ListItems` support list for solid models does not include all of them.

## API paths

### 1. Annotation features, annotation elements, and notes

**Create annotation features/elements.** `wfcWSolid::CreateAnnotationFeature(optional pfcComponentPath_ptr CompPath, xbool InvokeUI)` creates an annotation feature. With `InvokeUI=false`, the documented result is a feature automatically containing one general annotation element; the method does not accept note text or a symbol definition as arguments. The created feature is `wfcAnnotationFeature` (`wfcWFeature` subtype), so element enumeration is through feature item traversal rather than a generic `CreateAnnotation` factory. Sources: `t-wfcSolid-WSolid.html` (`CreateAnnotationFeature`); `t-wfcFeature-AnnotationFeature.html`.

`wfcWFeature::VisitItems(wfcVisitingClient_ptr, optional pfcModelItemType)` visits feature items. The documented annotation-element item type is `pfcITEM_ANNOTATION_ELEM`; the docs mark this type as supported for licensed users and specify casting visitor items to `wfcAnnotationElement`. A visitor can be applied to each annotation feature downcast from `pfcModelItemOwner::ListItems(pfcITEM_FEATURE)`. `VisitItems` may throw `pfcXToolkitNotFound` when no annotation elements are found. Sources: `t-wfcFeature-WFeature.html` (`VisitItems`); `t-pfcModelItem-ModelItemOwner.html` (`ListItems`); `t-pfcModelItem-ModelItemType.html`.

**Read annotation elements and their references.** `wfcAnnotation::GetAnnotationElement()` returns an optional `wfcAnnotationElement_ptr`; `wfcAnnotationElement` exposes `GetAnnotation()`, `GetAnnotationFeature()`, `GetAnnotationType()`, and `CollectAnnotationReferences(RefStrength, RefSource)`. The element also exposes `HasMissingReferences(...)`, `IsReferenceStrong(...)`, `IsIncomplete()`, and `IsDependent()`, which support explicit association/readback checks. `CollectAnnotationReferences` can throw when no matching references exist, and the documentation says references from driving-dimension annotation elements cannot be accessed through that method. Sources: `t-wfcAnnotation-Annotation.html`; `t-wfcAnnotation-AnnotationElement.html`; `t-wfcAnnotation-AnnotationReferences.html`; `t-wfcAnnotation-AnnotationRefFilter.html`.

For a selection-backed reference, `wfcAnnotationReferenceSelectionObject::Create(pfcSelection_ptr)` wraps the selection; `GetReference()` retrieves it. The common reference base exposes `GetAnnotationReferenceType()`. The `wfcAnnotationElement` method summary documents reference collection and reference descriptions, but no general add/set-reference operation; do not infer that `CreateAnnotationFeature()` alone establishes a geometry association. Use the object-specific attach/create parameters below or confirm the element's creation schema for other annotation types. Source: `t-wfcAnnotation-AnnotationElement.html`; `t-wfcAnnotation-AnnotationReferenceSelectionObject.html`; `t-wfcAnnotation-AnnotationReference.html`.

**Enumerate annotations.** `wfcWSolid::GetAnnotationsOfActiveState()` returns a `wfcCombStateAnnotations_ptr`, an ordered, zero-based sequence of `wfcCombStateAnnotation` entries for the *active combined state*. Read its size and entries with the sequence methods (`getarraysize()`, `get(i)`), then call `wfcCombStateAnnotation::GetAnnotation()` for the `wfcAnnotation_ptr`; the wrapper also exposes its combined-state option. This is not documented as a model-wide inventory independent of the active combined state. Sources: `t-wfcSolid-WSolid.html` (`GetAnnotationsOfActiveState`); `t-wfcCombState-CombStateAnnotations.html`; `t-wfcCombState-CombStateAnnotation.html`.

`pfcModelItemType` also defines `pfcITEM_GTOL`, `pfcITEM_SET_DATUM_TAG`, `pfcITEM_SURF_FIN`, and `pfcITEM_ANNOTATION_ELEM`. However, the documented solid-model `pfcModelItemOwner::ListItems` supported-type list includes `ITEM_FEATURE`, `ITEM_NOTE`, `ITEM_DIMENSION`, and `ITEM_REF_DIMENSION`, among others, but omits those four PMI-specific types. Do not assume their availability through `ListItems(type)` merely because the enum constants exist. `GetItemById(type,id)` is documented for retrieving a known item; it does not provide a way to discover unknown IDs. Sources: `t-pfcModelItem-ModelItemType.html`; `t-pfcModelItem-ModelItemOwner.html` (`ListItems`, `GetItemById`).

**Display and drawing associativity.** `wfcAnnotation::IsShown(optional pfcDrawing_ptr DrawingModel)` checks whether an annotation is shown in its owner or a specified drawing. `ShowInDrawing(view, optional componentPath)` adds a solid-owned annotation to a drawing view. `Display()` is specifically documented as redisplaying an annotation temporarily undisplayed with `Undisplay()`; it is not a general creation/show call. `DisplayInDrawing(...)` has the corresponding drawing behavior. Sources: `t-wfcAnnotation-Annotation.html` (`IsShown`, `ShowInDrawing`, `Display`, `DisplayInDrawing`).

Keep drawing-copy associativity separate from 3D semantic references: `GetAttachmentAssociativity(drawing)` and `IsAssociative(drawing)` are annotation/drawing checks; `UpdateAttachment(drawing)` and `UpdatePosition(drawing)` update a drawing annotation in relation to its 3D annotation. They do not replace reading the element's semantic references. Source: `t-wfcAnnotation-Annotation.html`.

**3D notes.** `wfcWSolid` documents `CreateFreeNote(TextLines, FreeAttachment)`, `CreateOnItemNote(TextLines, AnnotationPlane, ParametricAttachment)`, `CreateLeaderNote(TextLines, Attachment, DetailLeaderAttachments)`, and `CreateLeaderWithArrowTypeNote(...)`, each returning a `pfcDetailNoteItem_ptr`. These provide explicit free, on-item/parametric, and leader-attached creation paths. For readback, `pfcModelItemOwner::ListItems(pfcITEM_NOTE)` is in the supported solid-item list; the returned note can be inspected through `pfcDetailNoteItem` methods such as `GetTextLines(displayOption)`, `GetAttachment()`, and `GetInstructions(giveParametersAsNames)`. `pfcNote::Display`, `GetLines`, and related legacy members are marked deprecated since Creo 4, with `pfcDetailNoteItem::Show`, `GetTextLines`, and `SetTextLines` listed as successors. Sources: `t-wfcSolid-WSolid.html` (`CreateFreeNote`, `CreateOnItemNote`, `CreateLeaderNote`, `CreateLeaderWithArrowTypeNote`); `t-pfcModelItem-ModelItemOwner.html`; `t-pfcNote-Note.html`; `t-pfcDetail-DetailNoteItem.html`; `t-wfcNote-WNote.html`.

### 2. Datum feature symbol annotations (set datum tags)

Do not conflate datum geometry features (planes, axes, points) with datum feature symbol annotations. `wfcWModel::CreateSetDatumTag(pfcSelection_ptr Selection, xrstring Label, optional wfcAnnotationPlane_ptr Plane)` creates a *datum feature symbol annotation*. The result supports `GetAttachment()` / `SetAttachment()` for its attached selection, `GetPlacement()` for the attached model item when a selection cannot be constructed, `GetLabel()` / `SetLabel()`, annotation-plane access, `Show()`, and drawing-view display checks. `AddReferences(...)`, `GetReferences()`, and `DeleteReference(index)` operate on DFS semantic references, separate from the symbol's attachment. Sources: `t-wfcModel-WModel.html` (`CreateSetDatumTag`); `t-wfcAnnotation-SetDatumTag.html`.

For readback, capture at least the label, attachment/placement, annotation plane, and DFS references, then compare reference type/strength and missing-reference results where available. `GetReferences()` is explicitly documented as returning an array of DFS semantic references. The class also has an ASME display switch; that is a display property, not evidence of standards-profile selection or conformance. The creation method is tagged `LICENSE: 222` in the installed documentation; confirm entitlement in the target Creo session rather than inferring it from the method signature.

### 3. Geometric tolerances (GTols)

`wfcWModel::CreateGTol(wfcGTolType Type, wfcGTolAttach_ptr GtolAttach, xrstring Value)` creates a GTol from its type, placement attachment, and value text. Documented attachment forms include:

- `wfcGTolAttachLeader::Create(LeaderAttachType, Leaders, Location, optional AnnotationPlane)`;
- `wfcGTolAttachDatum::Create(pfcModelItem_ptr Datum)`;
- `wfcGTolAttachAnnotation::Create(wfcAnnotation_ptr Annotation)`;
- `wfcGTolAttachFree::Create(pfcPoint3D_ptr Location, optional AnnotationPlane)`.

The resulting `wfcGTol` exposes `GetGTolAttach()`, `GetValueString()` / `SetValueString()`, and `GetDatumReferences()` / `SetDatumReferences()`. `wfcGTolDatumReferences::Create(optional xrstring Primary, optional xrstring Secondary, optional xrstring Tertiary)` builds an object with optional primary, secondary, and tertiary string fields; `GetPrimary()`, `GetSecondary()`, `GetTertiary()` and their setters read/update them. Treat these as the documented datum-reference values and separately inspect the GTol's geometry/annotation references. It also has `AddReferences(...)` and `GetReferences()`, but the latter is explicitly limited to GTols *not* created as Annotation Elements. For an Annotation Element GTol, use `wfcAnnotationElement::CollectAnnotationReferences(...)` instead. Sources: `t-wfcModel-WModel.html` (`CreateGTol`); `t-wfcGTol-GTol.html`; `t-wfcGTol-GTolAttachLeader.html`; `t-wfcGTol-GTolAttachDatum.html`; `t-wfcGTol-GTolAttachAnnotation.html`; `t-wfcGTol-GTolAttachFree.html`; `t-wfcAnnotation-AnnotationElement.html`.

`wfcGTol` inherits `wfcAnnotation`, including `IsShown`, `ShowInDrawing`, and `Display`; the documented `Display()` semantics are to restore a temporarily undisplayed annotation. The GTol class page does not document a separate GTol-specific `Show()` method. Readback must therefore distinguish GTol placement/value/datum-frame data from display state and drawing display. Do not parse the value string as a standards-conformance result; preserve/read the structured datum-reference object and source text. Sources: `t-wfcGTol-GTol.html` (inheritance and methods); `t-wfcAnnotation-Annotation.html` (`Display`, `IsShown`).

### 4. Dimensions

**Create and list.** `wfcWSolid::CreateDimension(AnnotationPlane, DimensionAttachments, DimSenses, OrientationHint, Location)` and `CreateRefDimension(...)` return `pfcDimension_ptr`. Both accept geometry attachment/sense/orientation/location input and document `pfcXToolkitBadDimAttach` when Creo cannot create the requested attachment/sense combination. Sources: `t-wfcSolid-WSolid.html` (`CreateDimension`, `CreateRefDimension`).

For existing model dimensions, `pfcModelItemOwner::ListItems(pfcITEM_DIMENSION)` and `ListItems(pfcITEM_REF_DIMENSION)` are documented supported solid-model paths; `GetItemById(type,id)` retrieves a known item. `pfcBaseDimension` provides `GetDimValue()`, `SetDimValue(value)`, `GetDimType()`, and `Show(optional DimensionShowInstructions)`. `Show` forces display in the model, and its instructions can target a component or drawing view. `pfcDimension` adds `GetTolerance()` and `IsReference()`. Sources: `t-pfcModelItem-ModelItemOwner.html`; `t-pfcDimension-BaseDimension.html`; `t-pfcDimension-Dimension.html`.

`wfcWDimension::GetDimensionAttachPoints()` and `GetAdditionalReferences(type)` / `AddAdditionalReferences(...)` provide attachment/reference inspection or update. `CreateAnnotationElement(AnnotationPlane)` can create an annotation element for an eligible driving dimension; the method documents errors for dimensions that are non-driving, unsuitable, or already attached. This is not interchangeable with creating a reference dimension. Source: `t-wfcDimension-WDimension.html`.

**Readback boundary.** A full PMI readback should include value, dimension/reference kind, tolerance contents, attachment points, and additional references—not just the numeric value. The existing bridge currently returns dimension ID/name/symbol/value/type, reference flag, and tolerance *type* only; it does not return attachment/reference sets or the actual tolerance values.

### 5. Surface-finish symbols

`wfcWModel::CreateSurfaceFinish(pfcDetailSymbolInstInstructions_ptr SymbolInstructions, wfcAnnotationPlane_ptr AnnotPlane)` creates a surface finish. The instructions must contain zero or more leaders pointing to model surfaces or a model surface attachment, an annotation plane for solid-owned surface finishes, and optionally variant text. PTC directs callers to the Creo TOOLKIT User's Guide for the standard surface-finish symbol names to use; the API signature alone does not define the required symbol or value. The method explicitly says to call `wfcSurfaceFinish::Show()` after creation for the surface finish to display. Sources: `t-wfcModel-WModel.html` (`CreateSurfaceFinish`); `t-wfcAnnotation-SurfaceFinish.html`.

Readback/update methods include `GetReferences()` (surface selections), `GetSurfaceCollection()`, `GetSymbolInstructions(DisplayMode)`, `GetValue()`, `SetValue(value)`, `SetSurfaceCollection(collection)`, and `Modify(instructions, optional plane)`. For symbol-based finishes, `GetValue()` / `SetValue()` address only the variable text `roughness_height`; retrieve or modify other symbol values through `GetSymbolInstructions()` / `Modify()`. Validate target surfaces and full instructions after creation and after reopen, not just the one numeric value. Sources: `t-wfcAnnotation-SurfaceFinish.html`.

## Persistence and saved/reopened readback

PTC documents `pfcModel::CheckIsSaveAllowed(ShowUI)` as checking save eligibility for the model and subordinate models, including current UI-context restrictions; its boolean may differ at different times. `pfcModel::Save()` writes the model to disk and documents write/permission exceptions. `pfcModel::Erase()` removes a model from the session, not from disk. `pfcBaseSession::RetrieveModelWithOpts(descriptor, options)` retrieves a model using the descriptor path; plain `RetrieveModel(descriptor)` only reads from the standard directory and ignores the descriptor path. Sources: `t-pfcModel-Model.html` (`CheckIsSaveAllowed`, `Save`, `Erase`); `t-pfcSession-BaseSession.html` (`RetrieveModel`, `RetrieveModelWithOpts`, `GetModelFromFileName`).

Recommended fixture gate (future implementation/test work, not run for this report):

1. Use an approved disposable fixture and explicit geometry/dimension selections; do not introduce production datum labels, tolerance values, or surface requirements without design-authority inputs.
2. Create one object per intended API path; record the returned item IDs and inspect exact attachments/references, object value, and show state.
3. Check `CheckIsSaveAllowed(false)` and stop/mark the fixture blocked if it returns false; when allowed, call `Save()` and verify Creo clears the modified flag. Do not treat a non-throwing `Save()` alone as proof of persistence: the repo's `AGENTS.md` records observed silent no-op behavior when the save check is false, and the native path also verifies the modified flag.
4. Erase/close the model, confirm it is no longer present in the session, retrieve the saved file afresh, then repeat readback. The repo's `retrieveModel()` first checks `GetModelFromFileName()` and only retrieves if absent; therefore a test must ensure it is not merely inspecting the original in-memory model. Sources: `native/otk-bridge/src/modeling.cxx` (`saveModel`); `native/otk-bridge/src/read.cxx` (`retrieveModel`, `openModel`, `closeModel`).
5. Re-check semantic references/missing references and compare attachments, tolerance data, symbol instructions, and dimension values—not just visibility or rendered text. Treat a successful save/reopen test as persistence evidence for the tested fixture/version, not proof of standards conformance.

At the time of this static review, the server's `creo_save_model` tool is blocked in live mode because Creo version-file cleanup is outside the approved transaction contract (`packages/server/src/policy/safe-write.ts`). The bridge has `model.save` and verifies the modified flag, but an M4 live round-trip test requires resolving that safety gate or another approved transaction path first.

## Repository gap comparison

- The bridge dispatch/capability list includes `model.dimensions`, `model.set_dimension`, lifecycle/save methods, and geometry feature commands, but no semantic annotation, set datum tag, GTol, or surface-finish method (`native/otk-bridge/src/bridge.cxx`). Static search of bridge/server source found no OTK calls to the PMI creation/readback APIs described above.
- `creo_get_dimensions` is a read tool. Native `describeDimensions()` enumerates `ITEM_DIMENSION` and `ITEM_REF_DIMENSION`; its descriptor includes ID, name, symbol, value, dimension type, reference flag, and tolerance type (`packages/server/src/tools/read.ts`; `native/otk-bridge/src/read.cxx`).
- `creo_set_dimension` sets `pfcBaseDimension::SetDimValue()` and verifies the numeric readback. It does not create a displayed PMI dimension, attach a dimension to selected geometry, or read its semantic reference set (`packages/server/src/tools/modeling.ts`; `native/otk-bridge/src/modeling.cxx`).
- `creo_create_datum_plane`, `creo_create_datum_axis`, and `creo_create_datum_point` are geometry-feature authoring tools. They are not `wfcSetDatumTag` datum feature symbol annotations (`packages/server/src/tools/features.ts`).
- The `"gtol"` string in `native/otk-bridge/src/read.cxx` is the name for a family-table column type (`pfcFAM_GTOL`), not GTol annotation-object support.
- `creo_save_model` exists, but the live safety policy blocks it until version-file cleanup is covered (`packages/server/src/tools/modeling.ts`; `packages/server/src/policy/safe-write.ts`).
- `docs/ROADMAP.md` already identifies PMI as a planned increment and requires saved/reopened fixtures, association/unit readback, annotation coverage, and separate treatment of semantic PMI versus cosmetic graphics. Its standards editions/approval authority are intentionally unresolved (`docs/ROADMAP.md`).

## API documentation files consulted

All names below are files in the installed `...\objecttoolkit_Creo\api` directory stated above. Citations in each section identify the owning API page and method.

- Annotation feature and visitation: `t-wfcSolid-WSolid.html`, `t-wfcFeature-AnnotationFeature.html`, `t-wfcFeature-WFeature.html`.
- Combined-state annotations: `t-wfcCombState-CombStateAnnotations.html`, `t-wfcCombState-CombStateAnnotation.html`.
- Annotation/readback/reference types: `t-wfcAnnotation-Annotation.html`, `t-wfcAnnotation-AnnotationElement.html`, `t-wfcAnnotation-AnnotationReferences.html`, `t-wfcAnnotation-AnnotationReference.html`, `t-wfcAnnotation-AnnotationReferenceSelectionObject.html`, `t-wfcAnnotation-AnnotationRefFilter.html`.
- Notes: `t-wfcSolid-WSolid.html`, `t-pfcModelItem-ModelItemOwner.html`, `t-pfcNote-Note.html`, `t-wfcNote-WNote.html`, `t-pfcDetail-DetailNoteItem.html`.
- Datum tags: `t-wfcModel-WModel.html`, `t-wfcAnnotation-SetDatumTag.html`.
- GTols and placement types: `t-wfcModel-WModel.html`, `t-wfcGTol-GTol.html`, `t-wfcGTol-GTolAttach.html`, `t-wfcGTol-GTolAttachLeader.html`, `t-wfcGTol-GTolAttachDatum.html`, `t-wfcGTol-GTolAttachAnnotation.html`, `t-wfcGTol-GTolAttachFree.html`, `t-wfcGTol-GTolDatumReferences.html`.
- Dimensions and item listing: `t-wfcSolid-WSolid.html`, `t-wfcDimension-WDimension.html`, `t-pfcDimension-BaseDimension.html`, `t-pfcDimension-Dimension.html`, `t-pfcModelItem-ModelItemOwner.html`, `t-pfcModelItem-ModelItemType.html`.
- Surface finishes: `t-wfcModel-WModel.html`, `t-wfcAnnotation-SurfaceFinish.html`.
- Save/retrieve lifecycle: `t-pfcModel-Model.html`, `t-pfcSession-BaseSession.html`.
