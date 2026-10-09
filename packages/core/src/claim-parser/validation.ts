import {
  CLAIM_TYPE_IDS,
  COMPOSITION_OPERATORS,
  EPISTEMIC_STATUSES,
  OPERATOR_TYPES,
  PARSER_MODES,
  POLARITIES,
  QUANTIFIERS,
  RELATION_TYPES,
  MODALITIES,
  StructuredClaim,
  ClaimParseValidationResult,
  isClaimOperator,
  isClaimTypeId,
  isCompositionOperator,
  isRelationType,
} from './schema.js';

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function add(errors: string[], condition: boolean, message: string): void {
  if (!condition) errors.push(message);
}

function validateSpan(value: unknown, claim: string, path: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  add(errors, Number.isInteger(value.start) && value.start >= 0, `${path}.start must be a non-negative integer`);
  add(errors, Number.isInteger(value.end) && value.end >= (value.start ?? 0), `${path}.end must be an integer >= start`);
  add(errors, typeof value.text === 'string', `${path}.text must be a string`);
  if (Number.isInteger(value.start) && Number.isInteger(value.end) && typeof value.text === 'string') {
    add(errors, claim.slice(value.start, value.end) === value.text, `${path}.text does not match original_claim at its span`);
  }
}

function validateProvenance(value: unknown, claim: string, path: string, errors: string[]): void {
  if (value === null) return;
  if (!isObject(value)) {
    errors.push(`${path} must be null or an object`);
    return;
  }
  add(errors, value.value === null || typeof value.value === 'string', `${path}.value must be a string or null`);
  add(errors, value.source_text === null || typeof value.source_text === 'string', `${path}.source_text must be a string or null`);
  add(errors, ['explicit', 'normalized', 'unknown', 'needs_review'].includes(value.extraction_status), `${path}.extraction_status is invalid`);
  if (value.source_span !== null) validateSpan(value.source_span, claim, `${path}.source_span`, errors);
  if (value.value !== null) {
    add(errors, value.source_text !== null, `${path} has a value but no source_text`);
    add(errors, value.source_span !== null, `${path} has a value but no source_span`);
  }
}

function validateEntity(value: unknown, claim: string, path: string, errors: string[]): void {
  validateProvenance(value, claim, path, errors);
  if (value !== null && isObject(value)) {
    add(errors, value.normalized === null || typeof value.normalized === 'string', `${path}.normalized must be a string or null`);
  }
}

function validateNumeric(value: unknown, claim: string, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (value === null || !isObject(value)) {
    errors.push(`${path} must be an object or null`);
    return;
  }
  add(errors, ['SCALAR', 'RANGE', 'LOWER_BOUND', 'UPPER_BOUND', 'RATE', 'RATIO'].includes(value.kind), `${path}.kind is invalid`);
  for (const key of ['value', 'lower', 'upper']) add(errors, value[key] === null || typeof value[key] === 'number' && Number.isFinite(value[key]), `${path}.${key} must be a finite number or null`);
  add(errors, value.unit === null || typeof value.unit === 'string', `${path}.unit must be a string or null`);
  add(errors, value.source_text === null || typeof value.source_text === 'string', `${path}.source_text must be a string or null`);
  if (value.source_span !== null) validateSpan(value.source_span, claim, `${path}.source_span`, errors);
  if (typeof value.value === 'number' && value.kind === 'RANGE') add(errors, value.lower !== null && value.upper !== null, `${path} range requires lower and upper`);
  if (value.lower !== null && value.upper !== null) add(errors, value.lower <= value.upper, `${path} lower must be <= upper`);
}

function validateConstraints(value: unknown, claim: string, path: string, errors: string[]): void {
  if (!isObject(value)) { errors.push(`${path} must be an object`); return; }
  add(errors, ['global', 'group', 'atomic'].includes(value.scope), `${path}.scope is invalid`);
  add(errors, isObject(value.population), `${path}.population must be an object`);
  add(errors, isObject(value.intervention), `${path}.intervention must be an object`);
  add(errors, value.comparator === null || isObject(value.comparator), `${path}.comparator must be an object or null`);
  add(errors, isObject(value.outcome), `${path}.outcome must be an object`);
  add(errors, isObject(value.temporal), `${path}.temporal must be an object`);
  add(errors, isObject(value.statistical), `${path}.statistical must be an object`);
  add(errors, isObject(value.context), `${path}.context must be an object`);
  add(errors, Array.isArray(value.conditions), `${path}.conditions must be an array`);
  if (Array.isArray(value.conditions)) value.conditions.forEach((condition: any, index: number) => {
    const conditionPath = `${path}.conditions[${index}]`;
    add(errors, isObject(condition), `${conditionPath} must be an object`);
    if (!isObject(condition)) return;
    add(errors, typeof condition.parameter === 'string' && condition.parameter.length > 0, `${conditionPath}.parameter is required`);
    add(errors, condition.value === null || typeof condition.value === 'number' && Number.isFinite(condition.value), `${conditionPath}.value must be finite or null`);
    add(errors, condition.lower === null || typeof condition.lower === 'number' && Number.isFinite(condition.lower), `${conditionPath}.lower must be finite or null`);
    add(errors, condition.upper === null || typeof condition.upper === 'number' && Number.isFinite(condition.upper), `${conditionPath}.upper must be finite or null`);
    add(errors, typeof condition.source_text === 'string', `${conditionPath}.source_text is required`);
    if (condition.source_span !== null) validateSpan(condition.source_span, claim, `${conditionPath}.source_span`, errors);
  });
  if (isObject(value.statistical)) {
    const p = value.statistical.p_value;
    add(errors, p === null || typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1, `${path}.statistical.p_value must be in [0, 1]`);
    const ci = value.statistical.confidence_interval;
    if (ci !== null) {
      add(errors, isObject(ci), `${path}.statistical.confidence_interval must be an object or null`);
      if (isObject(ci)) {
        add(errors, ci.lower === null || typeof ci.lower === 'number' && Number.isFinite(ci.lower), `${path}.statistical.confidence_interval.lower is invalid`);
        add(errors, ci.upper === null || typeof ci.upper === 'number' && Number.isFinite(ci.upper), `${path}.statistical.confidence_interval.upper is invalid`);
        if (ci.lower !== null && ci.upper !== null) add(errors, ci.lower <= ci.upper, `${path}.statistical.confidence_interval lower must be <= upper`);
      }
    }
  }
}

function validateAtomicClaim(value: unknown, claim: string, path: string, ids: Set<string>, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const required of [
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
    'quantifier_spec',
    'modality',
    'negation_scope',
    'epistemic_status',
    'inherited_fields',
    'constraints',
    'measurements',
    'unresolved_fields',
    'warnings',
  ]) {
    add(errors, hasOwn(value, required), `${path}.${required} is required`);
  }
  add(errors, typeof value.id === 'string' && value.id.length > 0, `${path}.id must be a non-empty string`);
  if (typeof value.id === 'string') {
    add(errors, !ids.has(value.id), `${path}.id is duplicated`);
    ids.add(value.id);
  }
  add(errors, typeof value.original_text === 'string' && value.original_text.length > 0, `${path}.original_text is required`);
  add(errors, typeof value.normalized_statement === 'string', `${path}.normalized_statement must be a string`);
  if (typeof value.source_span === 'object') validateSpan(value.source_span, claim, `${path}.source_span`, errors);
  add(errors, isClaimTypeId(value.primary_type), `${path}.primary_type is unknown; expected one of ${CLAIM_TYPE_IDS.join(', ')}`);
  if (Array.isArray(value.secondary_types)) {
    value.secondary_types.forEach((item: unknown, index: number) => add(errors, isClaimTypeId(item), `${path}.secondary_types[${index}] is unknown`));
  } else errors.push(`${path}.secondary_types must be an array`);
  add(errors, ['certain', 'ambiguous', 'unknown'].includes(value.classification_status), `${path}.classification_status is invalid`);
  add(errors, typeof value.classification_rationale === 'string', `${path}.classification_rationale must be a string`);
  validateEntity(value.subject, claim, `${path}.subject`, errors);
  validateEntity(value.predicate, claim, `${path}.predicate`, errors);
  validateEntity(value.object, claim, `${path}.object`, errors);
  add(errors, isRelationType(value.relation), `${path}.relation is unknown; expected one of ${RELATION_TYPES.join(', ')}`);
  if (Array.isArray(value.operators)) {
    value.operators.forEach((item: unknown, index: number) => add(errors, isClaimOperator(item), `${path}.operators[${index}] is unknown; expected one of ${OPERATOR_TYPES.join(', ')}`));
  } else errors.push(`${path}.operators must be an array`);
  add(errors, (POLARITIES as readonly string[]).includes(value.polarity), `${path}.polarity is invalid`);
  add(errors, (QUANTIFIERS as readonly string[]).includes(value.quantifier), `${path}.quantifier is invalid`);
  add(errors, (MODALITIES as readonly string[]).includes(value.modality), `${path}.modality is invalid`);
  add(errors, isObject(value.quantifier_spec), `${path}.quantifier_spec must be an object`);
  if (isObject(value.quantifier_spec)) {
    add(errors, (QUANTIFIERS as readonly string[]).includes(value.quantifier_spec.kind), `${path}.quantifier_spec.kind is invalid`);
    add(errors, ['POPULATION', 'CLAIM', 'OUTCOME', 'UNKNOWN'].includes(value.quantifier_spec.target), `${path}.quantifier_spec.target is invalid`);
    add(errors, typeof value.quantifier_spec.negated === 'boolean', `${path}.quantifier_spec.negated must be boolean`);
    if (value.quantifier_spec.source_span !== null) validateSpan(value.quantifier_spec.source_span, claim, `${path}.quantifier_spec.source_span`, errors);
  }
  add(errors, value.negation_scope === null || isObject(value.negation_scope), `${path}.negation_scope must be an object or null`);
  if (isObject(value.negation_scope)) {
    add(errors, ['PREDICATE', 'OBJECT', 'CLAIM', 'QUANTIFIER', 'EPISTEMIC_STATUS'].includes(value.negation_scope.target), `${path}.negation_scope.target is invalid`);
    add(errors, ['NOT', 'NONE', 'NOT_ALL', 'NOT_SOME'].includes(value.negation_scope.operator), `${path}.negation_scope.operator is invalid`);
    if (value.negation_scope.source_span !== null) validateSpan(value.negation_scope.source_span, claim, `${path}.negation_scope.source_span`, errors);
  }
  add(errors, isObject(value.epistemic_status), `${path}.epistemic_status must be an object`);
  if (isObject(value.epistemic_status)) {
    add(errors, (EPISTEMIC_STATUSES as readonly string[]).includes(value.epistemic_status.status), `${path}.epistemic_status.status is invalid`);
    if (value.epistemic_status.source_span !== null) validateSpan(value.epistemic_status.source_span, claim, `${path}.epistemic_status.source_span`, errors);
  }
  add(errors, Array.isArray(value.inherited_fields), `${path}.inherited_fields must be an array`);
  add(errors, isObject(value.constraints), `${path}.constraints must be an object`);
  validateConstraints(value.constraints, claim, `${path}.constraints`, errors);
  add(errors, Array.isArray(value.measurements), `${path}.measurements must be an array`);
  if (Array.isArray(value.measurements)) {
    value.measurements.forEach((measurement: any, index: number) => {
      const measurementPath = `${path}.measurements[${index}]`;
      add(errors, isObject(measurement), `${measurementPath} must be an object`);
      if (isObject(measurement)) {
        add(errors, typeof measurement.metric === 'string' && measurement.metric.length > 0, `${measurementPath}.metric is required`);
        add(errors, measurement.value === null || typeof measurement.value === 'number' && Number.isFinite(measurement.value), `${measurementPath}.value must be a finite number or null`);
        add(errors, typeof measurement.source_text === 'string' && measurement.source_text.length > 0, `${measurementPath}.source_text is required`);
        if (measurement.source_span !== null) validateSpan(measurement.source_span, claim, `${measurementPath}.source_span`, errors);
        validateNumeric(measurement.numeric, claim, `${measurementPath}.numeric`, errors);
        add(errors, measurement.percentage_kind === undefined || ['PERCENTAGE', 'PERCENTAGE_POINT', 'RATE', 'RATIO', 'UNSPECIFIED'].includes(measurement.percentage_kind), `${measurementPath}.percentage_kind is invalid`);
      }
    });
  }
  if (Array.isArray(value.unresolved_fields)) value.unresolved_fields.forEach((item: unknown, index: number) => add(errors, typeof item === 'string', `${path}.unresolved_fields[${index}] must be a string`));
  else errors.push(`${path}.unresolved_fields must be an array`);
  if (Array.isArray(value.warnings)) value.warnings.forEach((item: unknown, index: number) => add(errors, typeof item === 'string', `${path}.warnings[${index}] must be a string`));
  else errors.push(`${path}.warnings must be an array`);

  if (typeof value.original_text === 'string' && isObject(value.source_span) && typeof value.source_span.text === 'string') {
    add(errors, value.original_text === value.source_span.text, `${path}.original_text must equal source_span.text`);
  }
}

function validateComposition(value: unknown, claim: string, path: string, ids: Set<string>, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  add(errors, isCompositionOperator(value.operator), `${path}.operator is invalid; expected ${COMPOSITION_OPERATORS.join(', ')}`);
  if (Array.isArray(value.members)) {
    value.members.forEach((member: unknown, index: number) => add(errors, typeof member === 'string' && ids.has(member), `${path}.members[${index}] references an unknown atomic claim`));
  } else errors.push(`${path}.members must be an array`);
  if (value.source_span !== null) validateSpan(value.source_span, claim, `${path}.source_span`, errors);
}

/**
 * Strict runtime validation used for both model output and deterministic
 * output. This is deliberately dependency-free so a parser result cannot
 * bypass validation by changing providers.
 */
export function validateStructuredClaim(value: unknown): ClaimParseValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { valid: false, errors: ['Structured claim must be an object'] };

  for (const required of [
    'schema_version',
    'original_claim',
    'language',
    'parse_status',
    'atomic_claims',
    'composition',
    'logical_tree',
    'global_constraints',
    'group_constraints',
    'unresolved_fields',
    'warnings',
    'parser_metadata',
  ]) add(errors, hasOwn(value, required), `${required} is required`);

  add(errors, typeof value.schema_version === 'string', 'schema_version must be a string');
  add(errors, typeof value.original_claim === 'string', 'original_claim must be a string');
  add(errors, ['zh', 'en', 'mixed', 'unknown'].includes(value.language), 'language is invalid');
  add(errors, ['success', 'needs_review', 'failed'].includes(value.parse_status), 'parse_status is invalid');
  add(errors, isObject(value.global_constraints), 'global_constraints must be an object');
  validateConstraints(value.global_constraints, typeof value.original_claim === 'string' ? value.original_claim : '', 'global_constraints', errors);
  add(errors, isObject(value.logical_tree), 'logical_tree must be an object');
  add(errors, Array.isArray(value.group_constraints), 'group_constraints must be an array');
  add(errors, isObject(value.parser_metadata), 'parser_metadata must be an object');
  if (Array.isArray(value.unresolved_fields)) value.unresolved_fields.forEach((item: unknown, index: number) => add(errors, typeof item === 'string', `unresolved_fields[${index}] must be a string`));
  else errors.push('unresolved_fields must be an array');
  if (Array.isArray(value.warnings)) value.warnings.forEach((item: unknown, index: number) => add(errors, typeof item === 'string', `warnings[${index}] must be a string`));
  else errors.push('warnings must be an array');

  const claim = typeof value.original_claim === 'string' ? value.original_claim : '';
  const ids = new Set<string>();
  if (Array.isArray(value.atomic_claims)) value.atomic_claims.forEach((item: unknown, index: number) => validateAtomicClaim(item, claim, `atomic_claims[${index}]`, ids, errors));
  else errors.push('atomic_claims must be an array');
  if (Array.isArray(value.composition)) value.composition.forEach((item: unknown, index: number) => validateComposition(item, claim, `composition[${index}]`, ids, errors));
  else errors.push('composition must be an array');

  if (isObject(value.logical_tree)) {
    const nodes = value.logical_tree.nodes;
    const nodeIds = new Set<string>();
    add(errors, Array.isArray(nodes), 'logical_tree.nodes must be an array');
    if (Array.isArray(nodes)) {
      nodes.forEach((node: any, index: number) => {
        const path = `logical_tree.nodes[${index}]`;
        add(errors, isObject(node), `${path} must be an object`);
        if (!isObject(node)) return;
        add(errors, typeof node.id === 'string' && !nodeIds.has(node.id), `${path}.id must be unique`);
        if (typeof node.id === 'string') nodeIds.add(node.id);
        add(errors, ['ATOMIC_REF', 'OPERATOR'].includes(node.kind), `${path}.kind is invalid`);
        add(errors, node.operator === null || isCompositionOperator(node.operator), `${path}.operator is invalid`);
        add(errors, node.atomic_claim_id === null || ids.has(node.atomic_claim_id), `${path}.atomic_claim_id references an unknown atomic claim`);
        add(errors, Array.isArray(node.child_ids), `${path}.child_ids must be an array`);
        if (node.source_span !== null) validateSpan(node.source_span, claim, `${path}.source_span`, errors);
      });
      for (const node of nodes as any[]) if (isObject(node) && Array.isArray(node.child_ids)) for (const child of node.child_ids) add(errors, nodeIds.has(child), `logical_tree node ${node.id} references unknown child ${child}`);
    }
    if (value.logical_tree.root_id !== null) add(errors, nodeIds.has(value.logical_tree.root_id), 'logical_tree.root_id references an unknown node');
  }
  if (Array.isArray(value.group_constraints)) value.group_constraints.forEach((group: any, index: number) => {
    const path = `group_constraints[${index}]`;
    add(errors, isObject(group), `${path} must be an object`);
    if (!isObject(group)) return;
    add(errors, Array.isArray(group.atomic_claim_ids), `${path}.atomic_claim_ids must be an array`);
    if (Array.isArray(group.atomic_claim_ids)) group.atomic_claim_ids.forEach((id: unknown) => add(errors, typeof id === 'string' && ids.has(id), `${path}.atomic_claim_ids references an unknown atomic claim`));
    validateConstraints(group.constraints, claim, `${path}.constraints`, errors);
    if (group.source_span !== null) validateSpan(group.source_span, claim, `${path}.source_span`, errors);
  });

  if (isObject(value.parser_metadata)) {
    add(errors, typeof value.parser_metadata.parser_version === 'string', 'parser_metadata.parser_version is required');
    add(errors, typeof value.parser_metadata.schema_version === 'string', 'parser_metadata.schema_version is required');
    add(errors, ['deterministic', 'model', 'model_with_deterministic_fallback'].includes(value.parser_metadata.method), 'parser_metadata.method is invalid');
    add(errors, (PARSER_MODES as readonly string[]).includes(value.parser_metadata.requested_mode), 'parser_metadata.requested_mode is invalid');
    add(errors, ['deterministic', 'model', 'deterministic-fallback'].includes(value.parser_metadata.actual_method), 'parser_metadata.actual_method is invalid');
    add(errors, typeof value.parser_metadata.fallback_used === 'boolean', 'parser_metadata.fallback_used must be boolean');
    add(errors, Number.isInteger(value.parser_metadata.attempts) && value.parser_metadata.attempts >= 0, 'parser_metadata.attempts must be a non-negative integer');
  }

  return errors.length === 0
    ? { valid: true, errors: [], value: value as StructuredClaim }
    : { valid: false, errors };
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isObject(parsed)) return parsed;
    } catch {
      // Try the next bounded candidate. The caller records the final error.
    }
  }
  return undefined;
}
