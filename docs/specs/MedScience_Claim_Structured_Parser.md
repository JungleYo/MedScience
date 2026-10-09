# MedScience Claim Structured Parser

## Responsibility and boundary

The Claim Structured Parser converts a biomedical claim into a versioned,
traceable object for downstream hypothesis generation, evidence search, and
logical review.

It is deliberately not a claim verifier and it does not generate
counter-evidence:

```text
Claim parsing          -> What does the text say and how is it scoped?
Claim verification     -> Is the statement supported by admissible evidence?
Counter-evidence       -> Which testable alternatives or contrary evidence should be searched?
```

The parser does not decide truth, add medical facts, turn association into
causation, treat non-significance as no effect, or invent missing dose,
comparator, time, or population values.

## Module layout

The implementation lives in `packages/core/src/claim-parser/`:

- `schema.ts`: versioned TypeScript contracts, enums, provenance types, and the
  tool-call schema.
- `deterministic.ts`: local, API-free baseline parser. It handles common
  Chinese, English, and mixed-language biomedical phrasing and is also the
  reviewable fallback for model failures.
- `prompt.ts`: model instructions and bounded repair prompt.
- `validation.ts`: dependency-free runtime validation for enums, numeric values,
  atomic-claim references, and exact source spans.
- `parser.ts`: public parser class, model-provider integration, bounded repair,
  and deterministic fallback.

The module is exported from `packages/core/src/index.ts`. It uses the existing
`ModelProvider` interface; it does not create a second LLM client or credential
configuration path.

## Three-layer taxonomy

Each `AtomicClaim` keeps the following layers separate:

### Layer 1: base semantic type

The stable type identifiers are:

| ID | Type |
|---|---|
| T01 | INTERVENTION |
| T02 | ASSOCIATION_CAUSATION |
| T03 | DIAGNOSTIC |
| T04 | PROGNOSTIC |
| T05 | PREDICTIVE |
| T06 | EPIDEMIOLOGICAL |
| T07 | MECHANISTIC |
| T08 | BIOLOGICAL_PROPERTY |
| T09 | BIOMARKER_MEASUREMENT |
| T10 | HEALTH_ECONOMIC |
| T11 | HEALTHCARE_PRACTICE |
| T12 | METHODOLOGICAL |

`OTHER`, `UNKNOWN`, and `NEEDS_REVIEW` are reserved extension/status values.
`primary_type`, `secondary_types`, `classification_status`, and
`classification_rationale` are independent of logical operators.

### Layer 2: logical structure and operators

Relations include `EFFECT`, `ASSOCIATION`, `CAUSATION`, `COMPARISON`,
`MECHANISM`, `PREDICTION`, `ATTRIBUTE`, and `QUANTIFICATION`.

Operators are composable rather than mutually exclusive:

```text
SUPERIORITY, INFERIORITY, NON_INFERIORITY, EQUIVALENCE,
NULL_EFFECT, NON_SIGNIFICANT_RESULT, THRESHOLD,
NEGATION, CONDITIONAL, TEMPORAL, DOSE_RESPONSE,
INTERACTION, MEDIATION, SUBGROUP_DIFFERENCE
```

Atomic claims can be connected by `AND`, `OR`, `NOT`, or `IF_THEN` nodes in the
authoritative recursive `logical_tree`. The legacy `composition` array remains
for v1 consumers, but new consumers should follow `logical_tree.root_id` and
validate every child reference. This preserves nested structures such as
`(A OR B) AND NOT(confirmed(A AND B))`; it does not flatten alternatives into
one conjunction.
`NON_SIGNIFICANT_RESULT` is intentionally distinct from `NULL_EFFECT` and
`EQUIVALENCE`. A possible or reported statement remains a modality, not a
calibrated probability.

Each atomic claim also carries `epistemic_status`, `negation_scope`, and a
structured `quantifier_spec`. Examples include `NOT_ALL` for “not all”,
`NOT_ESTABLISHED` for “not shown”, and `NON_SIGNIFICANT_RESULT` for a
non-significant result. These fields describe what the source establishes;
they never turn a lack of evidence into an asserted null effect.

### Layer 3: scope and constraints

The common constraint object contains population, intervention/exposure,
comparator, outcome, temporal, statistical, and context sections. Each section
can be null or partial. Type-specific extensions are stored in
`constraints.type_specific`, so diagnostic claims do not need a forced PICO
shape and economic claims can later add perspective, cost, effectiveness, and
time horizon fields without changing the top-level contract.

Every non-null extracted value should include `source_text`, an exact
`source_span`, and an `extraction_status` (`explicit`, `normalized`,
`unknown`, or `needs_review`). A normalized value such as `mortality` can keep
the original Chinese phrase `死亡率` as its source text.

`ClaimConstraints.scope` is one of `global`, `group`, or `atomic`. The
deterministic parser does not copy a local population, time point, or outcome
into `global_constraints`. Explicitly shared constraints are represented in
`group_constraints`; omitted subjects or interventions in a compound claim
are marked in `inherited_fields` rather than silently duplicated.

Measurements have both the legacy fields and a `numeric` representation. The
latter distinguishes scalars, ranges, bounds, ratios, and rates, including
confidence intervals, p-values, denominators such as `100000 persons`, and
percentage points. Relative and absolute effects remain separate, while an
unspecified percentage remains `UNSPECIFIED`. Thresholds and dose increments
are stored in `constraints.conditions` with their unit and scope.

## Output schema

The top-level object contains:

```ts
{
  schema_version: string;
  original_claim: string;
  language: 'zh' | 'en' | 'mixed' | 'unknown';
  parse_status: 'success' | 'needs_review' | 'failed';
  atomic_claims: AtomicClaim[];
  composition: CompositionNode[];
  logical_tree: LogicalExpressionTree;
  global_constraints: ClaimConstraints;
  group_constraints: ConstraintGroup[];
  unresolved_fields: string[];
  warnings: string[];
  parser_metadata: ParserMetadata;
}
```

An atomic claim contains the original text and span, normalized statement,
three-layer semantic fields, scope metadata, constraints, measurements,
unresolved fields, and warnings. The schema and parser are currently `2.0.0`.
The v1 fields `composition`, `method`, and the common constraint sections
remain present for compatibility.

## Calling the parser

For a local deterministic parse:

```ts
import { parseClaim, validateStructuredClaim } from '@medscience/core';

const result = parseClaim('药物 A 在降低血压方面优于药物 B。');
const validation = validateStructuredClaim(result);
if (!validation.valid) throw new Error(validation.errors.join('; '));
```

For model-assisted parsing, inject the existing provider. `parseClaimAsync`
uses a required `parse_structured_claim` tool call, validates the result, and
tries at most two bounded repairs by default:

```ts
import { ClaimParser, GenericModelClient } from '@medscience/core';

const provider = new GenericModelClient(activeModelProfile);
const parser = new ClaimParser({ modelProvider: provider });
const result = await parser.parseClaimAsync(claim);
```

Use `mode: 'deterministic'` to force the local parser even when a provider is
available. Use `mode: 'model-assisted'` with `parseClaimAsync` when a provider
is intended. `parser_metadata.requested_mode`, `actual_method`,
`fallback_used`, and `fallback_reason` make the distinction machine-readable.
The synchronous API cannot call a provider and therefore marks an explicit
model-assisted request as `deterministic-fallback`.

If the provider is unavailable or returns invalid JSON/enums/references, the
default behavior is `needs_review` plus a deterministic result and structured
`parser_metadata.model_error`/`validation_errors`. Set
`fallbackToDeterministic: false` when a caller needs a strict model-only gate;
then the result is `failed` and includes the validation errors. No unit test
requires an API key.

## Examples

### Intervention effect

Input: `药物 A 可以显著降低疾病 B 患者的死亡率。`

Relevant output:

```json
{
  "primary_type": "T01",
  "relation": "EFFECT",
  "constraints": {
    "outcome": {
      "outcome": { "normalized": "mortality", "source_text": "降低疾病 B 患者的死亡率" },
      "direction": "DECREASE"
    }
  },
  "unresolved_fields": ["significance_definition"]
}
```

The missing p-value or threshold is reviewable; it is not silently invented.

### Non-inferiority comparison

Input: `治疗 A 在预防疾病复发方面不劣于治疗 B。`

The parser emits `T01`, relation `COMPARISON`, operator
`NON_INFERIORITY`, and comparator `治疗 B`. Because no margin appears in the
text, `non_inferiority_margin` is listed in `unresolved_fields`.

### Compound safety and efficacy claim

Input: `药物 A 能够降低死亡率，但会增加严重出血风险。`

The result contains two atomics connected by `AND`; their outcomes are
`mortality` and `major bleeding risk`. The intervention from the first clause
is retained as shared context for the second clause. The safety statement is
not converted into a negation of the mortality statement.

## Challenge benchmark

The challenge fixture is
`packages/core/tests/fixtures/medscience_claim_parser_challenge_set.json`.
It contains exactly 35 cases across basic, logic, scope, and robustness tiers;
the parser never hardcodes their expected outputs. The supplemental fixture
contains 10 independent claims. Run:

```bash
npx tsx packages/core/tests/test-claim-parser-benchmark.ts
```

The benchmark evaluates both `parseClaim` and `parseClaimAsync`, validates
source spans and logical references, and emits per-case `PASS`, `PARTIAL`, or
`FAIL` results, including basic/logic/scope/robustness group counts and failure
reasons. Without a configured provider the deterministic result is reported
separately and model-assisted status is `NOT_RUN`; no API key is required for
the local benchmark.

## Extending the parser

To add a base type, add its stable identifier and label in `schema.ts`, add the
deterministic cue and precedence rule in `deterministic.ts`, and add fixture
coverage. Existing consumers can continue to accept the union's extension
values while handling unknown types explicitly.

To add a logical relation or operator, extend the corresponding const tuple and
union in `schema.ts`, add it to the model tool schema/prompt if needed, and add
semantic validation plus tests for scope. Operators should remain composable;
do not create a new base type merely for a modifier such as dose response,
negation, or time.

## Known limitations and next steps

The deterministic path is a conservative lexical parser, not a full biomedical
semantic parser. Complex anaphora, nested conditionals, long-distance negation,
study-specific endpoint normalization, and multilingual terminology need model
or human review. Its source spans and unresolved fields make those limitations
visible rather than silently filling them.

The future Counter-Hypothesis Generator should consume `StructuredClaim` after
checking `validateStructuredClaim`. It can use each atomic ID, relation,
polarity, modality, comparator, outcome direction, and unresolved field to
create testable alternatives. It must not treat `parse_status: success` as
evidence of truth and must preserve the atomic/composition graph when handing
queries to the evidence search executor.
