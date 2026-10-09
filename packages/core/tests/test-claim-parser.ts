import {
  ClaimParser,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StructuredClaim,
  parseClaim,
  validateStructuredClaim,
} from '../src/index.js';

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function parsed(claim: string): StructuredClaim {
  const result = parseClaim(claim, { now: () => new Date('2026-01-01T00:00:00.000Z') });
  const validation = validateStructuredClaim(result);
  assertTrue(validation.valid, `${claim}: deterministic output failed validation: ${validation.errors.join('; ')}`);
  return result;
}

class StubProvider implements ModelProvider {
  public readonly name = 'claim-parser-test-provider';
  public readonly isExternal = false;
  public calls = 0;
  public constructor(private readonly responseFactory: (request: ModelRequest, call: number) => ModelResponse | Promise<ModelResponse>) {}
  public async listModels(): Promise<string[]> { return ['claim-parser-test-model']; }
  public async generate(request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    return this.responseFactory(request, this.calls);
  }
  public async stream(request: ModelRequest, onDelta: (chunk: string) => void): Promise<ModelResponse> {
    const response = await this.generate(request);
    if (response.content) onDelta(response.content);
    return response;
  }
}

function withModelMetadata(result: StructuredClaim): StructuredClaim {
  return {
    ...result,
    parser_metadata: {
      ...result.parser_metadata,
      method: 'deterministic',
      model_name: null,
      attempts: 0,
    },
  };
}

async function runTests(): Promise<void> {
  console.log('=== Claim Structured Parser tests ===');

  const intervention = parsed('药物 A 可以显著降低疾病 B 患者的死亡率。');
  assertTrue(intervention.atomic_claims[0].primary_type === 'T01', 'intervention type is T01');
  assertTrue(intervention.atomic_claims[0].relation === 'EFFECT', 'intervention relation is EFFECT');
  assertTrue(intervention.atomic_claims[0].constraints.outcome.outcome?.normalized === 'mortality', 'mortality outcome extracted');
  assertTrue(intervention.parse_status === 'needs_review', 'undefined significance language is reviewable');
  assertTrue(intervention.atomic_claims[0].constraints.comparator === null, 'missing comparator is not fabricated');

  const superiority = parsed('药物 A 在降低血压方面优于药物 B。');
  assertTrue(superiority.atomic_claims[0].operators.includes('SUPERIORITY'), 'superiority operator extracted');
  assertTrue(superiority.atomic_claims[0].constraints.comparator?.comparators[0]?.value === '药物 B', 'comparator extracted');

  const nonInferiority = parsed('治疗 A 在预防疾病复发方面不劣于治疗 B。');
  assertTrue(nonInferiority.atomic_claims[0].operators.includes('NON_INFERIORITY'), 'non-inferiority operator extracted');
  assertTrue(nonInferiority.atomic_claims[0].unresolved_fields.includes('non_inferiority_margin'), 'missing non-inferiority margin is explicit');

  const conditional = parsed('在 65 岁以上患者中，药物 A 在治疗 12 周后能够降低收缩压。');
  const age = conditional.atomic_claims[0].constraints.population.age;
  assertTrue(age?.age_min === 65 && age.min_inclusive === true, 'inclusive age boundary extracted');
  assertTrue(conditional.atomic_claims[0].constraints.temporal.follow_up?.value?.includes('12 周') === true, '12-week follow-up extracted');
  assertTrue(conditional.atomic_claims[0].constraints.outcome.outcome?.normalized === 'systolic blood pressure', 'systolic blood pressure extracted');

  const association = parsed('睡眠不足与心血管疾病风险升高相关。');
  const causation = parsed('睡眠不足会导致心血管疾病风险升高。');
  assertTrue(association.atomic_claims[0].primary_type === 'T02' && association.atomic_claims[0].relation === 'ASSOCIATION', 'association stays association');
  assertTrue(causation.atomic_claims[0].primary_type === 'T02' && causation.atomic_claims[0].relation === 'CAUSATION', 'causation stays causation');

  const mechanism = parsed('药物 A 通过抑制炎症通路 M 改善疾病 B 的症状。');
  assertTrue(mechanism.atomic_claims[0].primary_type === 'T07', 'mechanistic type extracted');
  assertTrue(mechanism.atomic_claims[0].relation === 'MECHANISM' && mechanism.atomic_claims[0].operators.includes('MEDIATION'), 'mechanism dependency retained');

  const nonSignificant = parsed('药物 A 在主要终点上未观察到统计学显著获益。');
  assertTrue(nonSignificant.atomic_claims[0].operators.includes('NON_SIGNIFICANT_RESULT'), 'non-significant result extracted');
  assertTrue(!nonSignificant.atomic_claims[0].operators.includes('NULL_EFFECT'), 'non-significant result is not null effect');

  const composite = parsed('药物 A 能够降低死亡率，但会增加严重出血风险。');
  assertTrue(composite.atomic_claims.length === 2, 'compound claim split into two atomics');
  assertTrue(composite.composition[0]?.operator === 'AND' && composite.composition[0].members.length === 2, 'compound relation retained');
  assertTrue(composite.atomic_claims[0].constraints.outcome.outcome?.normalized === 'mortality', 'first compound outcome retained');
  assertTrue(composite.atomic_claims[1].constraints.outcome.outcome?.normalized === 'major bleeding risk', 'second compound outcome retained');

  const diagnostic = parsed('检测方法 A 诊断疾病 B 的敏感度超过 90%。');
  assertTrue(diagnostic.atomic_claims[0].primary_type === 'T03', 'diagnostic type extracted');
  assertTrue(diagnostic.atomic_claims[0].measurements.some((item) => item.metric === 'sensitivity' && item.value === 90 && item.operator === '>'), 'sensitivity threshold extracted');

  const epidemiology = parsed('2020 年某地区成年人糖尿病患病率约为 12%。');
  assertTrue(epidemiology.atomic_claims[0].primary_type === 'T06', 'epidemiological type extracted');
  assertTrue(epidemiology.atomic_claims[0].constraints.context.geography?.value === '某地区', 'geography extracted');
  assertTrue(epidemiology.atomic_claims[0].measurements.some((item) => item.metric === 'prevalence' && item.value === 12 && item.approximate), 'approximate prevalence extracted');

  const predictive = parsed('模型 A 能够预测患者未来一年的心肌梗死风险，其 AUC 为 0.85。');
  assertTrue(predictive.atomic_claims[0].primary_type === 'T05' && predictive.atomic_claims[0].relation === 'PREDICTION', 'predictive type and relation extracted');
  assertTrue(predictive.atomic_claims[0].constraints.temporal.time_window?.value?.includes('未来一年') === true, 'prediction horizon retained');
  assertTrue(predictive.atomic_claims[0].measurements.some((item) => item.metric === 'AUC' && item.value === 0.85), 'AUC extracted');

  const economic = parsed('与标准治疗相比，治疗 A 具有更好的成本效果。');
  assertTrue(economic.atomic_claims[0].primary_type === 'T10' && economic.atomic_claims[0].relation === 'COMPARISON', 'health-economic comparison extracted');
  assertTrue(economic.atomic_claims[0].constraints.comparator?.comparators[0]?.value === '标准治疗', 'standard-care comparator extracted');

  const biological = parsed('蛋白 A 主要定位于细胞核。');
  assertTrue(biological.atomic_claims[0].primary_type === 'T08' && biological.atomic_claims[0].relation === 'ATTRIBUTE', 'biological property extracted');
  assertTrue(biological.atomic_claims[0].constraints.outcome.outcome?.normalized === 'cellular localization', 'localization attribute retained');

  const modality = parsed('药物 A 可能降低疾病 B 的死亡率。');
  assertTrue(modality.atomic_claims[0].modality === 'POSSIBLE', 'possible modality retained');

  const prognostic = parsed('疾病进展与五年生存率相关。');
  assertTrue(prognostic.atomic_claims[0].primary_type === 'T04', 'prognostic type extracted');
  const biomarker = parsed('生物标志物 X 的浓度测量值为 5 ng/mL。');
  assertTrue(biomarker.atomic_claims[0].primary_type === 'T09', 'biomarker measurement type extracted');
  assertTrue(biomarker.atomic_claims[0].measurements.some((item) => item.value === 5 && item.unit === 'ng/mL'), 'biomarker measurement value extracted');
  const practice = parsed('在基层医疗中，电子提醒可以提高患者的治疗依从性。');
  assertTrue(practice.atomic_claims[0].primary_type === 'T11', 'healthcare practice type extracted');
  const methodological = parsed('该随机对照试验采用盲法分析。');
  assertTrue(methodological.atomic_claims[0].primary_type === 'T12', 'methodological type extracted');

  assertTrue(parsed('  ').parse_status === 'needs_review', 'empty claim is explicit review state');
  assertTrue(parsed('Drug A 可以降低 blood pressure。').language === 'mixed', 'mixed language detected');
  const incomplete = parsed('药物 A 优于');
  assertTrue(incomplete.parse_status === 'needs_review' && incomplete.atomic_claims[0].unresolved_fields.includes('comparator'), 'incomplete comparison is reviewable');
  const multipleComparators = parsed('药物 A 优于药物 B 和药物 C。');
  assertTrue((multipleComparators.atomic_claims[0].constraints.comparator?.comparators.length || 0) === 2, 'multiple comparators preserved');
  const multiNegation = parsed('药物 A 不会不降低死亡率。');
  assertTrue(multiNegation.atomic_claims[0].operators.includes('NEGATION'), 'negation scope is represented');

  const validOutput = withModelMetadata(parsed('药物 A 可能降低疾病 B 的死亡率。'));
  const validProvider = new StubProvider(() => ({ content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'claim', name: 'parse_structured_claim', arguments: validOutput as any }] }));
  const modelResult = await new ClaimParser({ modelProvider: validProvider, now: () => new Date('2026-01-01T00:00:00.000Z') }).parseClaimAsync('药物 A 可能降低疾病 B 的死亡率。');
  assertTrue(modelResult.parser_metadata.method === 'model' && modelResult.parser_metadata.attempts === 1, 'valid model structured output accepted');

  const invalidJsonProvider = new StubProvider(() => ({ content: 'not json', finishReason: 'stop' }));
  const invalidJsonResult = await new ClaimParser({ modelProvider: invalidJsonProvider, maxModelAttempts: 2 }).parseClaimAsync('药物 A 降低死亡率。');
  assertTrue(invalidJsonResult.parse_status === 'needs_review' && invalidJsonResult.parser_metadata.method === 'model_with_deterministic_fallback', 'invalid JSON uses explicit deterministic fallback');

  const missingFieldProvider = new StubProvider(() => ({ content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'claim', name: 'parse_structured_claim', arguments: { schema_version: '1.0.0' } as any }] }));
  const missingFieldResult = await new ClaimParser({ modelProvider: missingFieldProvider, maxModelAttempts: 1, fallbackToDeterministic: false }).parseClaimAsync('药物 A 降低死亡率。');
  assertTrue(missingFieldResult.parse_status === 'failed' && missingFieldResult.parser_metadata.validation_errors.some((error) => error.includes('original_claim')), 'missing model fields fail closed');

  const unknownEnumProvider = new StubProvider(() => ({ content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'claim', name: 'parse_structured_claim', arguments: { ...validOutput, original_claim: '药物 A 降低死亡率。', atomic_claims: [{ ...validOutput.atomic_claims[0], original_text: '药物 A 降低死亡率。', source_span: { start: 0, end: 12, text: '药物 A 降低死亡率。' }, primary_type: 'T99' }] } as any }] }));
  const unknownEnumResult = await new ClaimParser({ modelProvider: unknownEnumProvider, maxModelAttempts: 1, fallbackToDeterministic: false }).parseClaimAsync('药物 A 降低死亡率。');
  assertTrue(unknownEnumResult.parse_status === 'failed' && unknownEnumResult.parser_metadata.validation_errors.some((error) => error.includes('primary_type')), 'unknown enum fails closed');

  const unavailableProvider = new StubProvider(() => { throw new Error('simulated model outage'); });
  const unavailableResult = await new ClaimParser({ modelProvider: unavailableProvider, maxModelAttempts: 1 }).parseClaimAsync('药物 A 降低死亡率。');
  assertTrue(unavailableResult.parse_status === 'needs_review' && unavailableResult.parser_metadata.model_error?.includes('simulated model outage') === true, 'model outage is structured and reviewable');

  console.log('✔ Claim Structured Parser tests passed');
}

runTests().catch((error) => {
  console.error('✖ Claim Structured Parser tests failed:', error);
  process.exit(1);
});
