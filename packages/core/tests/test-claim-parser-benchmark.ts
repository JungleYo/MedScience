import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaim, parseClaimAsync, validateStructuredClaim, StructuredClaim } from '../src/index.js';

interface ChallengeCase { id: string; tier: string; claim: string; expected_primary_type: string | null; semantic_expectations: string[] }

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')) as T;
}
function allText(result: StructuredClaim): string { return result.atomic_claims.map((atomic) => atomic.original_text).join(' '); }
function measurements(result: StructuredClaim): StructuredClaim['atomic_claims'][number]['measurements'] { return result.atomic_claims.flatMap((atomic) => atomic.measurements); }
function hasMeasurement(result: StructuredClaim, metric: string, value?: number): boolean { return measurements(result).some((item) => item.metric === metric && (value === undefined || item.value === value)); }
function hasOutcome(result: StructuredClaim, value: string): boolean { return result.atomic_claims.some((atomic) => atomic.constraints.outcome.outcome?.normalized === value); }

function evaluateExpectation(expectation: string, result: StructuredClaim): { label: string; pass: boolean } {
  const atomics = result.atomic_claims;
  const text = allText(result);
  if (/relation=ASSOCIATION/.test(expectation)) return { label: 'association relation', pass: atomics.some((atomic) => atomic.relation === 'ASSOCIATION') };
  if (/不得解释为已证明因果关系/.test(expectation)) return { label: 'association is not causation', pass: !atomics.some((atomic) => atomic.relation === 'CAUSATION') };
  if (/两个独立诊断性能指标/.test(expectation)) return { label: 'sensitivity and specificity', pass: hasMeasurement(result, 'sensitivity', 92) && hasMeasurement(result, 'specificity', 88) };
  if (/五年是生存时间窗/.test(expectation)) return { label: 'survival window and approximate percentage', pass: hasOutcome(result, 'overall survival') && result.atomic_claims.some((atomic) => atomic.constraints.temporal.time_window?.value?.includes('五年') === true) && measurements(result).some((item) => item.value === 65 && item.approximate) };
  if (/AUC=0.81/.test(expectation)) return { label: 'AUC value', pass: hasMeasurement(result, 'AUC', 0.81) && result.atomic_claims.some((atomic) => atomic.constraints.temporal.time_window?.value?.includes('未来一年') === true) };
  if (/外部验证是研究环境/.test(expectation)) return { label: 'validation is not intervention', pass: !atomics.some((atomic) => atomic.primary_type === 'T01') };
  if (/提取年份、地区、人群、年发病率及单位/.test(expectation)) return { label: 'epidemiology context', pass: hasMeasurement(result, 'incidence', 120) && measurements(result).some((item) => item.unit === 'per 100,000 persons') && atomics[0]?.constraints.context.geography?.value === '某地区' };
  if (/120\/100000不能解析成120%/.test(expectation)) return { label: 'rate is not percentage', pass: measurements(result).some((item) => item.metric === 'incidence' && item.percentage_kind === 'RATE' && item.unit !== '%') };
  if (/保留药物A→/.test(expectation)) return { label: 'mechanism chain remains one atom', pass: atomics.length === 1 && atomics[0]?.relation === 'MECHANISM' && atomics[0]?.primary_type === 'T07' };
  if (/实体=蛋白M/.test(expectation)) return { label: 'localization qualifier', pass: atomics.length === 1 && atomics[0]?.primary_type === 'T08' && atomics[0]?.constraints.type_specific.localization_qualifier === 'mainly' };
  if (/Cronbach alpha=0.89/.test(expectation)) return { label: 'Cronbach alpha', pass: hasMeasurement(result, "Cronbach's alpha", 0.89) };
  if (/比较对象与ICER数值/.test(expectation)) return { label: 'health economic details', pass: hasMeasurement(result, 'ICER', 15000) && Boolean(atomics[0]?.constraints.comparator?.comparators.length) && atomics[0]?.constraints.context.research_setting !== null };
  if (/不能自动推导具有成本效果/.test(expectation)) return { label: 'economic interpretation is not fabricated', pass: !text.includes('cost-effective') || !atomics.some((atomic) => atomic.constraints.type_specific.cost_effective === true) };
  if (/医疗实践类型/.test(expectation)) return { label: 'healthcare practice and possible modality', pass: atomics[0]?.primary_type === 'T11' && atomics[0]?.modality === 'POSSIBLE' && atomics[0]?.constraints.context.healthcare_setting !== null };
  if (/方法学类型/.test(expectation)) return { label: 'methodological type and condition', pass: atomics[0]?.primary_type === 'T12' && atomics[0]?.constraints.conditions.some((item) => item.parameter === 'sample_size') === true };
  if (/NON_SIGNIFICANT_RESULT/.test(expectation)) return { label: 'non-significant status', pass: atomics.some((atomic) => atomic.operators.includes('NON_SIGNIFICANT_RESULT') && atomic.epistemic_status.status === 'NON_SIGNIFICANT_RESULT') && !atomics.some((atomic) => atomic.operators.includes('NULL_EFFECT') || atomic.operators.includes('EQUIVALENCE')) };
  if (/否定作用范围/.test(expectation)) return { label: 'predicate negation scope', pass: atomics.some((atomic) => atomic.negation_scope?.target === 'PREDICATE' && atomic.polarity === 'NEGATED') };
  if (/逻辑是NOT ALL/.test(expectation)) return { label: 'not-all quantifier', pass: atomics.some((atomic) => atomic.quantifier === 'NOT_ALL' && atomic.negation_scope?.target === 'QUANTIFIER') };
  if (/modality=PROBABLE/.test(expectation)) return { label: 'probable modality', pass: atomics.some((atomic) => atomic.modality === 'PROBABLE') };
  if (/至少区分不同药物与不同结局/.test(expectation)) return { label: 'drug/outcome separation', pass: atomics.length >= 2 && new Set(atomics.map((atomic) => atomic.constraints.outcome.outcome?.normalized).filter(Boolean)).size >= 2 };
  if (/保留POSSIBLE与/.test(expectation)) return { label: 'possible plus not established', pass: atomics.some((atomic) => atomic.modality === 'POSSIBLE') && atomics.some((atomic) => atomic.epistemic_status.status === 'NOT_ESTABLISHED') };
  if (/两个原子断言，AND连接/.test(expectation)) return { label: 'shared intervention AND', pass: atomics.length === 2 && result.logical_tree.nodes.some((node) => node.operator === 'AND') && atomics[1]?.inherited_fields.some((field) => field.field.includes('intervention')) === true };
  if (/保留OR与NOT-AND/.test(expectation)) return { label: 'nested OR and epistemic NOT', pass: result.logical_tree.nodes.some((node) => node.operator === 'OR') && result.logical_tree.nodes.some((node) => node.operator === 'NOT') };
  if (/未证明非劣效/.test(expectation)) return { label: 'not established non-inferiority', pass: atomics.some((atomic) => atomic.epistemic_status.status === 'NOT_ESTABLISHED' && atomic.operators.includes('NON_INFERIORITY') && !atomic.operators.includes('INFERIORITY')) };
  if (/双重否定与证据模态/.test(expectation)) return { label: 'double negation epistemic status', pass: atomics.some((atomic) => atomic.epistemic_status.status === 'NOT_ESTABLISHED' && !atomic.operators.includes('NULL_EFFECT')) };
  if (/age_min=65/.test(expectation)) return { label: 'age condition', pass: atomics.some((atomic) => atomic.constraints.population.age?.age_min === 65 && atomic.constraints.population.age.min_inclusive === true && atomic.constraints.context.geography === null) };
  if (/两个不同时间点/.test(expectation)) return { label: 'time-local conclusions', pass: atomics.length === 2 && atomics.every((atomic) => atomic.constraints.temporal.follow_up !== null || atomic.constraints.temporal.observation_time !== null || atomic.constraints.temporal.time_window !== null) };
  if (/DOSE_RESPONSE/.test(expectation)) return { label: 'dose-response fields', pass: atomics.some((atomic) => atomic.operators.includes('DOSE_RESPONSE') && atomic.constraints.type_specific.dose_response !== undefined && atomic.constraints.conditions.some((item) => item.value === 10)) };
  if (/识别eGFR阈值/.test(expectation)) return { label: 'eGFR threshold', pass: atomics.some((atomic) => atomic.constraints.conditions.some((item) => item.parameter === 'eGFR' && item.value === 30 && item.operator === '<') && atomic.constraints.type_specific.normative_status === 'NOT_RECOMMENDED') };
  if (/合用风险与/.test(expectation)) return { label: 'combination and interaction status', pass: atomics.length === 2 && atomics.some((atomic) => atomic.epistemic_status.status === 'NOT_ESTABLISHED') };
  if (/区分RELATIVE与ABSOLUTE/.test(expectation)) return { label: 'relative versus absolute', pass: measurements(result).some((item) => item.relative_or_absolute === 'RELATIVE') && measurements(result).some((item) => item.relative_or_absolute === 'ABSOLUTE') };
  if (/提取HR=0.78/.test(expectation)) return { label: 'HR CI p comparator', pass: hasMeasurement(result, 'hazard_ratio', 0.78) && hasMeasurement(result, 'p-value', 0.03) && measurements(result).some((item) => item.metric === 'confidence_interval' && item.numeric?.lower === 0.62 && item.numeric.upper === 0.98) && Boolean(atomics[0]?.constraints.comparator?.comparators.length) };
  if (/分清两个疾病分期/.test(expectation)) return { label: 'stage-local evidence', pass: atomics.length === 2 && atomics.some((atomic) => atomic.epistemic_status.status === 'INSUFFICIENT_EVIDENCE') };
  if (/language=mixed/.test(expectation)) return { label: 'mixed-language split and negation', pass: result.language === 'mixed' && atomics.length >= 2 && atomics.some((atomic) => atomic.negation_scope !== null) };
  if (/parse_status 应为/.test(expectation)) return { label: 'incomplete claim review', pass: result.parse_status !== 'success' && result.unresolved_fields.length > 0 };
  if (/必须标示非成功状态/.test(expectation)) return { label: 'empty input review', pass: result.parse_status !== 'success' && result.unresolved_fields.includes('claim_text') && atomics.length === 0 };
  if (/允许效果终点缺失/.test(expectation)) return { label: 'missing outcome is unresolved', pass: result.parse_status !== 'success' && result.unresolved_fields.some((field) => field.endsWith('.outcome')) };
  if (/保留单一机制主张/.test(expectation)) return { label: 'parallel mechanism remains one claim', pass: atomics.length === 1 && atomics[0]?.relation === 'MECHANISM' };
  if (/^Intervention=/.test(expectation)) return { label: 'intervention/comparator/population', pass: atomics[0]?.constraints.intervention.intervention?.value === '药物A' && atomics[0]?.constraints.comparator?.comparators.some((item) => item.value === '安慰剂') === true && atomics[0]?.constraints.population.disease?.value?.includes('2型糖尿病') === true };
  if (/24周是治疗观察期/.test(expectation)) return { label: 'follow-up and percentage points', pass: atomics.some((atomic) => atomic.constraints.temporal.follow_up?.value?.includes('24周') === true) && measurements(result).some((item) => item.value === 0.8 && item.relative_or_absolute !== 'RELATIVE' && item.metric === 'HbA1c') };
  if (/不得虚构参考标准/.test(expectation)) return { label: 'no fabricated reference standard', pass: !atomics.some((atomic) => Object.prototype.hasOwnProperty.call(atomic.constraints.type_specific, 'reference_standard')) };
  if (/不得误认为治疗效果/.test(expectation)) return { label: 'prognosis is not treatment', pass: !atomics.some((atomic) => atomic.primary_type === 'T01') };
  if (/不要自动把机制当成独立验证过的事实/.test(expectation)) return { label: 'mechanism is not verification', pass: atomics.length === 1 && atomics[0]?.relation === 'MECHANISM' && atomics[0]?.epistemic_status.status !== 'REPORTED_FINDING' };
  if (/保留“主要”的限定/.test(expectation)) return { label: 'mainly qualifier', pass: atomics[0]?.constraints.type_specific.localization_qualifier === 'mainly' };
  if (/不要解释为诊断准确率/.test(expectation)) return { label: 'not diagnostic accuracy', pass: atomics[0]?.primary_type !== 'T03' && !hasMeasurement(result, 'sensitivity') && !hasMeasurement(result, 'specificity') };
  if (/识别基层医疗为环境/.test(expectation)) return { label: 'healthcare setting is not geography', pass: atomics[0]?.constraints.context.healthcare_setting !== null && atomics[0]?.constraints.context.geography === null };
  if (/不应当被分类为医疗干预效果/.test(expectation)) return { label: 'method is not intervention', pass: !atomics.some((atomic) => atomic.primary_type === 'T01') };
  if (/不得出现NULL_EFFECT/.test(expectation)) return { label: 'non-significant is not null', pass: !atomics.some((atomic) => atomic.operators.includes('NULL_EFFECT') || atomic.operators.includes('EQUIVALENCE')) };
  if (/不能将句意改成增加死亡率/.test(expectation)) return { label: 'negation does not reverse direction', pass: !atomics.some((atomic) => atomic.constraints.outcome.direction === 'INCREASE') };
  if (/不能变成所有患者都不获益/.test(expectation)) return { label: 'not-all is not none', pass: !atomics.some((atomic) => atomic.quantifier === 'NONE') };
  if (/不能降为POSSIBLE或升为ASSERTED/.test(expectation)) return { label: 'probable remains probable', pass: atomics.some((atomic) => atomic.modality === 'PROBABLE') };
  if (/不能将“只有B降低死亡率”套用给A/.test(expectation)) return { label: 'outcome scope is local', pass: atomics.length >= 2 && new Set(atomics.map((atomic) => atomic.constraints.outcome.outcome?.normalized).filter(Boolean)).size >= 2 };
  if (/不能单纯把后一分句解析为A无效/.test(expectation)) return { label: 'not-established is not null', pass: !atomics.some((atomic) => atomic.epistemic_status.status === 'ASSERTED_NULL_EFFECT') };
  if (/不能将出血风险作为死亡率效应的直接否定/.test(expectation)) return { label: 'safety effect is not negation', pass: atomics.every((atomic) => atomic.polarity !== 'NEGATED') };
  if (/不能使用单一AND节点/.test(expectation)) return { label: 'nested logic is preserved', pass: result.logical_tree.nodes.some((node) => node.operator === 'OR') && result.logical_tree.nodes.some((node) => node.operator === 'NOT') };
  if (/不得与INFERIORITY混淆/.test(expectation)) return { label: 'not-established is not inferiority', pass: !atomics.some((atomic) => atomic.operators.includes('INFERIORITY')) };
  if (/不能直接转成已证实存在治疗获益/.test(expectation)) return { label: 'double negative is not benefit', pass: !atomics.some((atomic) => atomic.epistemic_status.status === 'ASSERTED_EFFECT' && atomic.polarity === 'AFFIRMED') };
  if (/患者亚组不能填入geography/.test(expectation)) return { label: 'age subgroup is local', pass: !atomics.some((atomic) => atomic.constraints.context.geography !== null) };
  if (/不能合并成无时间限定/.test(expectation)) return { label: 'time scope remains local', pass: atomics.length >= 2 && atomics.every((atomic) => atomic.constraints.temporal.follow_up !== null || atomic.constraints.temporal.observation_time !== null || atomic.constraints.temporal.time_window !== null) };
  if (/5%未指明绝对\/相对/.test(expectation)) return { label: 'unspecified percentage semantics', pass: measurements(result).some((item) => item.value === 5 && item.relative_or_absolute === 'UNSPECIFIED') };
  if (/这是建议\/规范性表述/.test(expectation)) return { label: 'normative status is not causality', pass: atomics.some((atomic) => atomic.constraints.type_specific.normative_status === 'NOT_RECOMMENDED') && !atomics.some((atomic) => atomic.relation === 'CAUSATION') };
  if (/合用效应不等同显著的交互作用/.test(expectation)) return { label: 'interaction is not inferred', pass: atomics.some((atomic) => atomic.epistemic_status.status === 'NOT_ESTABLISHED') && !atomics.some((atomic) => atomic.epistemic_status.status === 'ASSERTED_EFFECT' && atomic.operators.includes('INTERACTION')) };
  if (/不将20%与2个百分点当成冲突/.test(expectation)) return { label: 'effect measures remain distinct', pass: measurements(result).some((item) => item.relative_or_absolute === 'RELATIVE') && measurements(result).some((item) => item.relative_or_absolute === 'ABSOLUTE') };
  if (/不要推断未说明的具体结局/.test(expectation)) return { label: 'HR does not invent outcome', pass: atomics.every((atomic) => atomic.constraints.outcome.outcome === null) };
  if (/早期证据不足不意味着/.test(expectation)) return { label: 'insufficient evidence is not null', pass: atomics.some((atomic) => atomic.epistemic_status.status === 'INSUFFICIENT_EVIDENCE') && !atomics.some((atomic) => atomic.epistemic_status.status === 'ASSERTED_NULL_EFFECT') };
  if (/识别两种结局/.test(expectation)) return { label: 'mixed-language outcomes', pass: atomics.length >= 2 && new Set(atomics.map((atomic) => atomic.constraints.outcome.outcome?.normalized).filter(Boolean)).size >= 2 && atomics.some((atomic) => atomic.negation_scope !== null) };
  if (/不得凭空补全比较对象/.test(expectation)) return { label: 'missing comparator remains missing', pass: atomics[0]?.constraints.comparator === null };
  if (/不应输出一个确定的科学类型/.test(expectation)) return { label: 'empty has no type', pass: atomics.length === 0 };
  if (/不能捏造具体疾病/.test(expectation)) return { label: 'missing outcome has no fabricated detail', pass: atomics[0]?.constraints.outcome.outcome === null && measurements(result).length === 0 };
  if (/不得把“和”错误/.test(expectation)) return { label: 'parallel mechanism remains one claim', pass: atomics.length === 1 && atomics[0]?.relation === 'MECHANISM' };
  return { label: `unhandled expectation: ${expectation}`, pass: false };
}

function evaluateCase(testCase: ChallengeCase, result: StructuredClaim): { id: string; tier: string; status: 'PASS' | 'PARTIAL' | 'FAIL'; failed: string[] } {
  const checks: Array<{ label: string; pass: boolean }> = [];
  if (testCase.expected_primary_type !== null) checks.push({ label: `primary_type=${testCase.expected_primary_type}`, pass: result.atomic_claims[0]?.primary_type === testCase.expected_primary_type });
  checks.push(...testCase.semantic_expectations.map((expectation) => evaluateExpectation(expectation, result)));
  const failed = checks.filter((check) => !check.pass).map((check) => check.label);
  return { id: testCase.id, tier: testCase.tier, status: failed.length === 0 ? 'PASS' : failed.length < checks.length ? 'PARTIAL' : 'FAIL', failed };
}

async function run(): Promise<void> {
  const challenge = readFixture<{ case_count: number; cases: ChallengeCase[] }>('medscience_claim_parser_challenge_set.json');
  const supplemental = readFixture<{ cases: ChallengeCase[] }>('medscience_claim_parser_supplemental.json');
  if (challenge.case_count !== 35 || challenge.cases.length !== 35) throw new Error('Challenge fixture must contain exactly 35 cases.');
  const ids = new Set(challenge.cases.map((testCase) => testCase.id));
  if (supplemental.cases.length < 10 || supplemental.cases.some((testCase) => ids.has(testCase.id))) throw new Error('Supplemental claims must contain at least 10 non-duplicate cases.');
  const results: Array<{ id: string; tier: string; status: string; failed: string[] }> = [];
  for (const testCase of challenge.cases) {
    const sync = parseClaim(testCase.claim);
    const asyncResult = await parseClaimAsync(testCase.claim);
    const validation = validateStructuredClaim(sync);
    if (!validation.valid || asyncResult.original_claim !== testCase.claim || asyncResult.schema_version !== sync.schema_version) throw new Error(`${testCase.id} produced invalid or inconsistent parser output: ${validation.errors.join('; ')}`);
    results.push(evaluateCase(testCase, sync));
  }
  for (const testCase of supplemental.cases) {
    const result = parseClaim(testCase.claim);
    if (!validateStructuredClaim(result).valid) throw new Error(`${testCase.id} produced invalid supplemental output.`);
  }
  const counts = results.reduce((acc, result) => { acc[result.status] += 1; return acc; }, { PASS: 0, PARTIAL: 0, FAIL: 0 });
  const groupCounts = Object.fromEntries([...new Set(challenge.cases.map((testCase) => testCase.tier))].map((tier) => [tier, results.filter((result) => result.tier === tier).reduce((acc, result) => { acc[result.status] += 1; return acc; }, { PASS: 0, PARTIAL: 0, FAIL: 0 })]));
  console.log(JSON.stringify({ mode: 'deterministic', challenge_cases: challenge.cases.length, supplemental_cases: supplemental.cases.length, counts, group_counts: groupCounts, results, model_assisted: 'NOT_RUN (no provider configured; use an explicit provider in an integration benchmark)' }, null, 2));
  console.log(`✔ Claim Parser benchmark completed: ${counts.PASS} PASS, ${counts.PARTIAL} PARTIAL, ${counts.FAIL} FAIL; supplemental=${supplemental.cases.length}; model-assisted=NOT_RUN`);
}

run().catch((error) => { console.error('✖ Claim Parser benchmark failed:', error); process.exit(1); });
