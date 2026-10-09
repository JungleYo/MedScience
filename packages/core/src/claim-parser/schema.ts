/**
 * Versioned, provider-neutral schema for biomedical claim parsing.
 *
 * This module intentionally contains data contracts only. It does not decide
 * whether a claim is true and it does not fetch evidence.
 */

export const CLAIM_SCHEMA_VERSION = '1.0.0';
export const CLAIM_PARSER_VERSION = '1.0.0';

export const CLAIM_TYPE_IDS = [
  'T01',
  'T02',
  'T03',
  'T04',
  'T05',
  'T06',
  'T07',
  'T08',
  'T09',
  'T10',
  'T11',
  'T12',
  'OTHER',
  'UNKNOWN',
  'NEEDS_REVIEW',
] as const;

export type ClaimTypeId = (typeof CLAIM_TYPE_IDS)[number];

export const CLAIM_TYPE_LABELS: Record<ClaimTypeId, string> = {
  T01: 'INTERVENTION',
  T02: 'ASSOCIATION_CAUSATION',
  T03: 'DIAGNOSTIC',
  T04: 'PROGNOSTIC',
  T05: 'PREDICTIVE',
  T06: 'EPIDEMIOLOGICAL',
  T07: 'MECHANISTIC',
  T08: 'BIOLOGICAL_PROPERTY',
  T09: 'BIOMARKER_MEASUREMENT',
  T10: 'HEALTH_ECONOMIC',
  T11: 'HEALTHCARE_PRACTICE',
  T12: 'METHODOLOGICAL',
  OTHER: 'OTHER',
  UNKNOWN: 'UNKNOWN',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
};

export const RELATION_TYPES = [
  'EFFECT',
  'ASSOCIATION',
  'CAUSATION',
  'COMPARISON',
  'MECHANISM',
  'PREDICTION',
  'ATTRIBUTE',
  'QUANTIFICATION',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export const OPERATOR_TYPES = [
  'SUPERIORITY',
  'INFERIORITY',
  'NON_INFERIORITY',
  'EQUIVALENCE',
  'NULL_EFFECT',
  'NON_SIGNIFICANT_RESULT',
  'THRESHOLD',
  'NEGATION',
  'CONDITIONAL',
  'TEMPORAL',
  'DOSE_RESPONSE',
  'INTERACTION',
  'MEDIATION',
  'SUBGROUP_DIFFERENCE',
] as const;

export type ClaimOperator = (typeof OPERATOR_TYPES)[number];

export const COMPOSITION_OPERATORS = ['AND', 'OR', 'NOT', 'IF_THEN'] as const;
export type CompositionOperator = (typeof COMPOSITION_OPERATORS)[number];

export const QUANTIFIERS = ['ALL', 'SOME', 'MOST', 'AVERAGE', 'POPULATION_LEVEL', 'UNSPECIFIED'] as const;
export type Quantifier = (typeof QUANTIFIERS)[number];

export const MODALITIES = ['ASSERTED', 'POSSIBLE', 'PROBABLE', 'HYPOTHETICAL', 'REPORTED'] as const;
export type Modality = (typeof MODALITIES)[number];

export const POLARITIES = ['AFFIRMED', 'NEGATED', 'MIXED', 'UNKNOWN'] as const;
export type Polarity = (typeof POLARITIES)[number];

export type ExtractionStatus = 'explicit' | 'normalized' | 'unknown' | 'needs_review';

export interface SourceSpan {
  start: number;
  end: number;
  text: string;
}

export interface ProvenancedValue<T = string> {
  value: T | null;
  source_text: string | null;
  source_span: SourceSpan | null;
  extraction_status: ExtractionStatus;
}

export interface ClaimEntity extends ProvenancedValue<string> {
  normalized: string | null;
  role?: string | null;
}

export interface Measurement {
  metric: string;
  value: number | null;
  unit: string | null;
  operator: '>' | '>=' | '<' | '<=' | '=' | 'approx' | null;
  approximate: boolean;
  relative_or_absolute: 'RELATIVE' | 'ABSOLUTE' | 'UNSPECIFIED';
  source_text: string;
  source_span: SourceSpan | null;
}

export interface AgeConstraint {
  age_min: number | null;
  age_max: number | null;
  min_inclusive: boolean | null;
  max_inclusive: boolean | null;
  unit: 'years' | 'months' | 'days' | null;
  source_text: string | null;
  source_span: SourceSpan | null;
}

export interface PopulationConstraints {
  description: ProvenancedValue<string> | null;
  age: AgeConstraint | null;
  sex: ProvenancedValue<string> | null;
  disease: ProvenancedValue<string> | null;
  disease_stage: ProvenancedValue<string> | null;
  inclusion_criteria: ProvenancedValue<string>[];
  exclusion_criteria: ProvenancedValue<string>[];
  subgroup: ProvenancedValue<string> | null;
}

export interface InterventionConstraints {
  intervention: ClaimEntity | null;
  dose: ProvenancedValue<string> | null;
  route: ProvenancedValue<string> | null;
  frequency: ProvenancedValue<string> | null;
  duration: ProvenancedValue<string> | null;
  exposure: ClaimEntity | null;
}

export interface ComparatorConstraints {
  comparators: ClaimEntity[];
  comparator_type: 'PLACEBO' | 'STANDARD_CARE' | 'NO_INTERVENTION' | 'ACTIVE' | 'UNSPECIFIED';
  source_text: string | null;
  source_span: SourceSpan | null;
}

export interface OutcomeConstraints {
  outcome: ClaimEntity | null;
  direction: 'INCREASE' | 'DECREASE' | 'NO_CHANGE' | 'IMPROVEMENT' | 'WORSENING' | 'PREDICTION' | 'UNSPECIFIED';
  effect_size: Measurement | null;
  clinical_endpoint_type: ProvenancedValue<string> | null;
}

export interface TemporalConstraints {
  start_time: ProvenancedValue<string> | null;
  observation_time: ProvenancedValue<string> | null;
  follow_up: ProvenancedValue<string> | null;
  time_window: ProvenancedValue<string> | null;
}

export interface StatisticalConstraints {
  effect_measure: ProvenancedValue<string> | null;
  effect_value: number | null;
  confidence_interval: { lower: number | null; upper: number | null; level: number | null; source_text: string | null } | null;
  p_value: number | null;
  significance_threshold: number | null;
  non_inferiority_margin: number | null;
  equivalence_margin: number | null;
  relative_or_absolute: 'RELATIVE' | 'ABSOLUTE' | 'UNSPECIFIED';
}

export interface ContextConstraints {
  geography: ProvenancedValue<string> | null;
  healthcare_setting: ProvenancedValue<string> | null;
  research_setting: ProvenancedValue<string> | null;
  other: ProvenancedValue<string>[];
}

export interface ClaimConstraints {
  population: PopulationConstraints;
  intervention: InterventionConstraints;
  comparator: ComparatorConstraints | null;
  outcome: OutcomeConstraints;
  temporal: TemporalConstraints;
  statistical: StatisticalConstraints;
  context: ContextConstraints;
  type_specific: Record<string, unknown>;
}

export interface AtomicClaim {
  id: string;
  original_text: string;
  normalized_statement: string;
  source_span: SourceSpan;
  primary_type: ClaimTypeId;
  secondary_types: ClaimTypeId[];
  classification_status: 'certain' | 'ambiguous' | 'unknown';
  classification_rationale: string;
  subject: ClaimEntity | null;
  predicate: ClaimEntity | null;
  object: ClaimEntity | null;
  relation: RelationType;
  operators: ClaimOperator[];
  polarity: Polarity;
  quantifier: Quantifier;
  modality: Modality;
  constraints: ClaimConstraints;
  measurements: Measurement[];
  unresolved_fields: string[];
  warnings: string[];
}

export interface CompositionNode {
  operator: CompositionOperator;
  members: string[];
  source_text: string | null;
  source_span: SourceSpan | null;
  scope?: string | null;
}

export interface ParserMetadata {
  parser_version: string;
  schema_version: string;
  method: 'deterministic' | 'model' | 'model_with_deterministic_fallback';
  model_name: string | null;
  attempts: number;
  model_error: string | null;
  validation_errors: string[];
  created_at: string;
}

export interface StructuredClaim {
  schema_version: string;
  original_claim: string;
  language: 'zh' | 'en' | 'mixed' | 'unknown';
  parse_status: 'success' | 'needs_review' | 'failed';
  atomic_claims: AtomicClaim[];
  composition: CompositionNode[];
  global_constraints: ClaimConstraints;
  unresolved_fields: string[];
  warnings: string[];
  parser_metadata: ParserMetadata;
}

export interface ClaimParserOptions {
  modelProvider?: import('../client/ModelProvider.js').ModelProvider;
  model?: string;
  maxModelAttempts?: number;
  fallbackToDeterministic?: boolean;
  now?: () => Date;
}

export interface ClaimParseValidationResult {
  valid: boolean;
  errors: string[];
  value?: StructuredClaim;
}

const SOURCE_SPAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['start', 'end', 'text'],
  properties: {
    start: { type: 'integer', minimum: 0 },
    end: { type: 'integer', minimum: 0 },
    text: { type: 'string' },
  },
} as const;

const PROVENANCED_VALUE_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['value', 'source_text', 'source_span', 'extraction_status'],
  properties: {
    value: {},
    source_text: { type: ['string', 'null'] },
    source_span: { anyOf: [SOURCE_SPAN_SCHEMA, { type: 'null' }] },
    extraction_status: { enum: ['explicit', 'normalized', 'unknown', 'needs_review'] },
  },
} as const;

const ENTITY_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['value', 'normalized', 'source_text', 'source_span', 'extraction_status', 'role'],
  properties: {
    value: { type: ['string', 'null'] },
    normalized: { type: ['string', 'null'] },
    source_text: { type: ['string', 'null'] },
    source_span: { anyOf: [SOURCE_SPAN_SCHEMA, { type: 'null' }] },
    extraction_status: { enum: ['explicit', 'normalized', 'unknown', 'needs_review'] },
    role: { type: ['string', 'null'] },
  },
} as const;

const MEASUREMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['metric', 'value', 'unit', 'operator', 'approximate', 'relative_or_absolute', 'source_text', 'source_span'],
  properties: {
    metric: { type: 'string' },
    value: { type: ['number', 'null'] },
    unit: { type: ['string', 'null'] },
    operator: { enum: ['>', '>=', '<', '<=', '=', 'approx', null] },
    approximate: { type: 'boolean' },
    relative_or_absolute: { enum: ['RELATIVE', 'ABSOLUTE', 'UNSPECIFIED'] },
    source_text: { type: 'string' },
    source_span: { anyOf: [SOURCE_SPAN_SCHEMA, { type: 'null' }] },
  },
} as const;

const CONSTRAINTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['population', 'intervention', 'comparator', 'outcome', 'temporal', 'statistical', 'context', 'type_specific'],
  properties: {
    population: { type: 'object' },
    intervention: { type: 'object' },
    comparator: { type: ['object', 'null'] },
    outcome: { type: 'object' },
    temporal: { type: 'object' },
    statistical: { type: 'object' },
    context: { type: 'object' },
    type_specific: { type: 'object' },
  },
} as const;

const ATOMIC_CLAIM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'original_text',
    'normalized_statement',
    'source_span',
    'primary_type',
    'secondary_types',
    'classification_status',
    'classification_rationale',
    'subject',
    'predicate',
    'object',
    'relation',
    'operators',
    'polarity',
    'quantifier',
    'modality',
    'constraints',
    'measurements',
    'unresolved_fields',
    'warnings',
  ],
  properties: {
    id: { type: 'string' },
    original_text: { type: 'string' },
    normalized_statement: { type: 'string' },
    source_span: SOURCE_SPAN_SCHEMA,
    primary_type: { enum: CLAIM_TYPE_IDS },
    secondary_types: { type: 'array', items: { enum: CLAIM_TYPE_IDS } },
    classification_status: { enum: ['certain', 'ambiguous', 'unknown'] },
    classification_rationale: { type: 'string' },
    subject: ENTITY_SCHEMA,
    predicate: ENTITY_SCHEMA,
    object: ENTITY_SCHEMA,
    relation: { enum: RELATION_TYPES },
    operators: { type: 'array', items: { enum: OPERATOR_TYPES } },
    polarity: { enum: POLARITIES },
    quantifier: { enum: QUANTIFIERS },
    modality: { enum: MODALITIES },
    constraints: CONSTRAINTS_SCHEMA,
    measurements: { type: 'array', items: MEASUREMENT_SCHEMA },
    unresolved_fields: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

const COMPOSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['operator', 'members', 'source_text', 'source_span', 'scope'],
  properties: {
    operator: { enum: COMPOSITION_OPERATORS },
    members: { type: 'array', items: { type: 'string' } },
    source_text: { type: ['string', 'null'] },
    source_span: { anyOf: [SOURCE_SPAN_SCHEMA, { type: 'null' }] },
    scope: { type: ['string', 'null'] },
  },
} as const;

const PARSER_METADATA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['parser_version', 'schema_version', 'method', 'model_name', 'attempts', 'model_error', 'validation_errors', 'created_at'],
  properties: {
    parser_version: { type: 'string' },
    schema_version: { type: 'string' },
    method: { enum: ['deterministic', 'model', 'model_with_deterministic_fallback'] },
    model_name: { type: ['string', 'null'] },
    attempts: { type: 'integer', minimum: 0 },
    model_error: { type: ['string', 'null'] },
    validation_errors: { type: 'array', items: { type: 'string' } },
    created_at: { type: 'string' },
  },
} as const;

/** A JSON Schema-shaped contract for providers that support tool calling. */
export const CLAIM_STRUCTURED_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'original_claim',
    'language',
    'parse_status',
    'atomic_claims',
    'composition',
    'global_constraints',
    'unresolved_fields',
    'warnings',
    'parser_metadata',
  ],
  properties: {
    schema_version: { type: 'string' },
    original_claim: { type: 'string' },
    language: { enum: ['zh', 'en', 'mixed', 'unknown'] },
    parse_status: { enum: ['success', 'needs_review', 'failed'] },
    atomic_claims: { type: 'array', items: ATOMIC_CLAIM_SCHEMA },
    composition: { type: 'array', items: COMPOSITION_SCHEMA },
    global_constraints: CONSTRAINTS_SCHEMA,
    unresolved_fields: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    parser_metadata: PARSER_METADATA_SCHEMA,
  },
} as const;

export function isClaimTypeId(value: unknown): value is ClaimTypeId {
  return typeof value === 'string' && (CLAIM_TYPE_IDS as readonly string[]).includes(value);
}

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === 'string' && (RELATION_TYPES as readonly string[]).includes(value);
}

export function isClaimOperator(value: unknown): value is ClaimOperator {
  return typeof value === 'string' && (OPERATOR_TYPES as readonly string[]).includes(value);
}

export function isCompositionOperator(value: unknown): value is CompositionOperator {
  return typeof value === 'string' && (COMPOSITION_OPERATORS as readonly string[]).includes(value);
}
