import {
  AgeConstraint, AtomicClaim, ClaimConstraints, ClaimEntity, ClaimOperator,
  ClaimTypeId, ContextConstraints, ComparatorConstraints, CompositionNode,
  ConditionConstraint, EpistemicAssertion, InterventionConstraints,
  LogicalExpressionTree, LogicalTreeNode, Measurement, NegationScope,
  OutcomeConstraints, PopulationConstraints, ProvenancedValue, QuantifierSpec,
  SourceSpan, StatisticalConstraints, StructuredClaim, TemporalConstraints,
  CLAIM_PARSER_VERSION, CLAIM_SCHEMA_VERSION,
} from './schema.js';

interface Clause { text: string; start: number; end: number }
interface ParsedClauses { clauses: Clause[]; operator: CompositionNode['operator'] | null }

function spanFor(claim: string, text: string, startAt = 0): SourceSpan | null {
  if (!text) return null;
  const start = claim.indexOf(text, Math.max(0, startAt));
  return start < 0 ? null : { start, end: start + text.length, text };
}

function trimmedRange(claim: string, start: number, end: number): Clause | null {
  let left = start;
  let right = end;
  while (left < right && /\s/u.test(claim[left] || '')) left += 1;
  while (right > left && /\s/u.test(claim[right - 1] || '')) right -= 1;
  while (right > left && /[。！？.!?]$/u.test(claim.slice(left, right))) right -= 1;
  return left < right ? { text: claim.slice(left, right), start: left, end: right } : null;
}

function splitClauses(claim: string): ParsedClauses {
  const ifThen = claim.match(/^(?:if|如果|若)\s*(.+?)\s*(?:then|则)\s*(.+)$/iu);
  if (ifThen?.[1] && ifThen[2]) {
    const conditionStart = claim.indexOf(ifThen[1]);
    const thenStart = claim.lastIndexOf(ifThen[2]);
    const condition = trimmedRange(claim, conditionStart, thenStart);
    const consequence = trimmedRange(claim, thenStart, claim.length);
    if (condition && consequence) return { clauses: [condition, consequence], operator: 'IF_THEN' };
  }
  // Parallel pathway lists are one mechanism proposition, not a boolean list.
  if (/(?:through|via|通过|经由)[\s\S]*(?:and|和)[\s\S]*(?:lower|reduce|inhibit|activate|降低|减少|抑制|激活)/iu.test(claim)) {
    const only = trimmedRange(claim, 0, claim.length);
    return { clauses: only ? [only] : [], operator: null };
  }
  const clauses: Clause[] = [];
  let start = 0;
  let operator: CompositionNode['operator'] | null = null;
  const boundary = /(?:,|，)?\s*(\b(?:but|however|and|or|while)\b|并且|而且|但是|但|以及|同时|或|或者|;|；)\s*/giu;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(claim))) {
    const conjunction = match[1].toLowerCase();
    const before = claim.slice(0, match.index);
    const after = claim.slice(match.index + match[0].length);
    if (!after.trim()) continue;
    if (/(?:than|优于|劣于|compared with|relative to|与)\s*$/iu.test(before)) continue;
    if (/(?:through|via|通过|经由)\s+[^。！？.!?]*$/iu.test(before) && !/(?:can|will|is|are|does|may|可能|能够|会|是|可|lower|reduce|降低|减少)/iu.test(after)) continue;
    const left = trimmedRange(claim, start, match.index);
    if (!left) continue;
    clauses.push(left);
    start = match.index + match[0].length;
    operator = conjunction === 'or' || conjunction === '或' || conjunction === '或者' ? 'OR' : 'AND';
  }
  const last = trimmedRange(claim, start, claim.length);
  if (last) clauses.push(last);
  if (clauses.length < 2) {
    const only = trimmedRange(claim, 0, claim.length);
    return { clauses: only ? [only] : [], operator: null };
  }
  return { clauses, operator: operator || 'AND' };
}

function languageOf(text: string): StructuredClaim['language'] {
  const zh = /[\u3400-\u9fff]/u.test(text);
  const latin = /[A-Za-z]/u.test(text);
  return zh && latin ? 'mixed' : zh ? 'zh' : latin ? 'en' : 'unknown';
}
function normalized(text: string): string { return text.replace(/[“”"'「」『』]/gu, '').replace(/\s+/gu, ' ').trim(); }
function provenance<T>(value: T | null, sourceText: string | null, claim: string, status: ProvenancedValue<T>['extraction_status'] = 'explicit', startAt = 0): ProvenancedValue<T> {
  return { value, source_text: sourceText, source_span: sourceText ? spanFor(claim, sourceText, startAt) : null, extraction_status: value === null ? 'unknown' : status };
}
function entity(value: string | null, sourceText: string | null, claim: string, normalizedValue = value, role: string | null = null, startAt = 0): ClaimEntity | null {
  if (value === null && sourceText === null) return null;
  return { value, normalized: normalizedValue, source_text: sourceText, source_span: sourceText ? spanFor(claim, sourceText, startAt) : null, extraction_status: value === null ? 'unknown' : normalizedValue !== sourceText ? 'normalized' : 'explicit', role };
}

function emptyPopulation(): PopulationConstraints { return { description: null, age: null, sex: null, disease: null, disease_stage: null, inclusion_criteria: [], exclusion_criteria: [], subgroup: null }; }
function emptyIntervention(): InterventionConstraints { return { intervention: null, dose: null, route: null, frequency: null, duration: null, exposure: null }; }
function emptyTemporal(): TemporalConstraints { return { start_time: null, observation_time: null, follow_up: null, time_window: null }; }
function emptyStatistical(): StatisticalConstraints { return { effect_measure: null, effect_value: null, confidence_interval: null, p_value: null, significance_threshold: null, non_inferiority_margin: null, equivalence_margin: null, relative_or_absolute: 'UNSPECIFIED' }; }
function emptyContext(): ContextConstraints { return { geography: null, healthcare_setting: null, research_setting: null, other: [] }; }
function emptyConstraints(scope: ClaimConstraints['scope'] = 'atomic'): ClaimConstraints {
  return { scope, population: emptyPopulation(), intervention: emptyIntervention(), comparator: null, outcome: { outcome: null, direction: 'UNSPECIFIED', effect_size: null, clinical_endpoint_type: null }, temporal: emptyTemporal(), statistical: emptyStatistical(), context: emptyContext(), conditions: [], type_specific: {} };
}

function parseAge(claim: string): AgeConstraint | null {
  const match = claim.match(/(?:age\s*(?:≥|>=|at least)\s*(\d+)|(?:age\s*)?(\d+)\s*(?:岁|years?)\s*(?:以上|及以上|或以上|or older|and older)|(?:age\s*)?(\d+)\s*(?:岁|years?)\s*(?:to|至|-|–)\s*(\d+)\s*(?:岁|years?))/iu);
  if (!match) return null;
  const minimum = Number(match[1] || match[2] || match[3]);
  const maximum = match[4] ? Number(match[4]) : null;
  return { age_min: Number.isFinite(minimum) ? minimum : null, age_max: maximum, min_inclusive: true, max_inclusive: maximum === null ? null : true, unit: 'years', source_text: match[0], source_span: spanFor(claim, match[0]) };
}

function numericValue(value: number, unit: string | null, source: string, claim: string, operator: Measurement['operator'] = '='): Measurement['numeric'] {
  return { kind: operator === '>' || operator === '>=' ? 'LOWER_BOUND' : operator === '<' || operator === '<=' ? 'UPPER_BOUND' : 'SCALAR', value, lower: null, upper: null, inclusive: operator === '>=' || operator === '<=' ? true : operator === '>' || operator === '<' ? false : null, operator, unit, unit_source_text: unit, percentage_kind: 'UNSPECIFIED', denominator: null, source_text: source, source_span: spanFor(claim, source) };
}
function percentageKind(source: string): NonNullable<Measurement['percentage_kind']> { return /(?:个)?百分点|percentage points?/iu.test(source) ? 'PERCENTAGE_POINT' : /相对|relative|relative risk|RR/iu.test(source) ? 'RATIO' : /%|％/u.test(source) ? 'PERCENTAGE' : 'UNSPECIFIED'; }
function addMeasurement(measurements: Measurement[], item: Measurement): void { if (!measurements.some((existing) => existing.metric === item.metric && existing.source_text === item.source_text)) measurements.push(item); }
function makeMeasurement(claim: string, metric: string, sourceText: string, value: number | null, unit: string | null, operator: Measurement['operator'] = '=', approximate = false, relativeOrAbsolute: Measurement['relative_or_absolute'] = 'UNSPECIFIED', semanticType = metric): Measurement {
  const kind = percentageKind(sourceText);
  const numeric = value === null ? undefined : numericValue(value, unit, sourceText, claim, operator);
  if (numeric) numeric.percentage_kind = kind;
  return { metric, value, unit, operator, approximate, relative_or_absolute: relativeOrAbsolute, source_text: sourceText, source_span: spanFor(claim, sourceText), semantic_type: semanticType, numeric, percentage_kind: kind, denominator: null, binds_to: null };
}

function parseMeasurements(claim: string, outcome: string | null): Measurement[] {
  const measurements: Measurement[] = [];
  const icer = /(?:ICER)\s*(?:为|is|=|:)\s*(?:每\s*QALY\s*(?:增加|为)|per\s*QALY\s*)?[￥$]?\s*(\d+(?:[,.]\d+)?)(?:\s*(?:USD|美元|\/QALY))?/giu;
  let icerMatch: RegExpExecArray | null;
  while ((icerMatch = icer.exec(claim))) addMeasurement(measurements, makeMeasurement(claim, 'ICER', icerMatch[0], Number(icerMatch[1].replace(/,/g, '')), 'USD/QALY'));
  const number = '(\\d+(?:[,.]\\d+)?)';
  const addNamed = (regex: RegExp, metric: string, unit: string | null = null): void => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(claim))) {
      const value = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      const source = match[0];
      const operator: Measurement['operator'] = /(?:超过|大于|above|over|>|≥|>=)/iu.test(source) ? '>' : /(?:低于|少于|below|under|<|≤|<=)/iu.test(source) ? '<' : /约|approximately|about|~|around/iu.test(source) ? 'approx' : '=';
      const actualUnit = /%|％/u.test(source) ? '%' : unit;
      const relative = /相对|relative/iu.test(source) ? 'RELATIVE' : /绝对|absolute/iu.test(source) ? 'ABSOLUTE' : 'UNSPECIFIED';
      addMeasurement(measurements, makeMeasurement(claim, metric, source, value, actualUnit, operator, operator === 'approx', relative));
    }
  };
  addNamed(new RegExp(`(?:sensitivity|敏感度|灵敏度)[^\\d<>]*?(?:为|is|=|超过|大于|above|over)?\\s*${number}\\s*(%|％)?`, 'giu'), 'sensitivity', '%');
  addNamed(new RegExp(`(?:specificity|特异度)[^\\d<>]*?(?:为|is|=|超过|大于|above|over)?\\s*${number}\\s*(%|％)?`, 'giu'), 'specificity', '%');
  addNamed(new RegExp(`(?:AUC|曲线下面积)\\s*(?:为|is|=)?\\s*${number}`, 'giu'), 'AUC');
  addNamed(new RegExp(`(?:Cronbach(?:'s)?\\s*alpha|克朗巴赫?\\s*α|内部一致性)[^\\d]*?(?:为|is|=)?\\s*${number}`, 'giu'), "Cronbach's alpha");
  addNamed(new RegExp(`(?:HR|hazard ratio|风险比)\\s*(?:为|is|=|:)\\s*${number}`, 'giu'), 'hazard_ratio');
  addNamed(new RegExp(`(?:RR|relative risk|相对风险)\\s*(?:为|is|=|:)\\s*${number}`, 'giu'), 'relative_risk');
  addNamed(new RegExp(`(?:OR|odds ratio|优势比)\\s*(?:为|is|=|:)\\s*${number}`, 'giu'), 'odds_ratio');
  addNamed(new RegExp(`(?:p(?:-value)?|p值)\\s*[=<>≤≥]?\\s*${number}`, 'giu'), 'p-value');
  addNamed(new RegExp(`(?:ICER)\\s*(?:为|is|=|:)\\s*[￥$]?\\s*${number}(?:\\s*(?:USD|美元|/QALY))?`, 'giu'), 'ICER', 'USD/QALY');
  const ci = /(?:95%\s*)?(?:CI|置信区间|confidence interval)\s*[:=]?\s*\(?\s*(\d+(?:\.\d+)?)\s*[,–-]\s*(\d+(?:\.\d+)?)\s*\)?/giu;
  let ciMatch: RegExpExecArray | null;
  while ((ciMatch = ci.exec(claim))) {
    const lower = Number(ciMatch[1]); const upper = Number(ciMatch[2]);
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) continue;
    const source = ciMatch[0];
    const item = makeMeasurement(claim, 'confidence_interval', source, null, null);
    item.numeric = { kind: 'RANGE', value: null, lower, upper, inclusive: true, operator: null, unit: null, unit_source_text: null, percentage_kind: 'UNSPECIFIED', denominator: null, source_text: source, source_span: spanFor(claim, source) };
    item.binds_to = outcome;
    addMeasurement(measurements, item);
  }
  const perCapita = new RegExp(`(?:incidence|发病率|prevalence|患病率)[^。！？.!?，,;；]*?每\\s*(\\d[\\d,]*)\\s*万人?\\s*${number}\\s*例?`, 'giu');
  let perCapitaMatch: RegExpExecArray | null;
  while ((perCapitaMatch = perCapita.exec(claim))) {
    const value = Number(perCapitaMatch[2].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const metric = /incidence|发病率/iu.test(perCapitaMatch[0]) ? 'incidence' : 'prevalence';
    const item = makeMeasurement(claim, metric, perCapitaMatch[0], value, 'per 100,000 persons', '=', false, 'UNSPECIFIED', metric);
    if (item.numeric) { item.numeric.kind = 'RATE'; item.numeric.denominator = '100000 persons'; item.numeric.percentage_kind = 'RATE'; }
    item.denominator = '100000 persons'; item.percentage_kind = 'RATE'; addMeasurement(measurements, item);
  }
  const rate = new RegExp(`(?:incidence|发病率|prevalence|患病率)[^\\d约~]*?(约|approximately|about|~)?\\s*(?:为|is|=)?\\s*${number}\\s*(%|％|per\\s+100,?000(?:\\s+persons?)?|/100,?000)?`, 'giu');
  let rateMatch: RegExpExecArray | null;
  while ((rateMatch = rate.exec(claim))) {
    const value = Number(rateMatch[2].replace(/,/g, '')); if (!Number.isFinite(value)) continue;
    if (measurements.some((item) => item.metric === 'incidence' || item.metric === 'prevalence')) continue;
    const metric = /incidence|发病率/iu.test(rateMatch[0]) ? 'incidence' : 'prevalence';
    const isRate = /per\s+100|\/100/iu.test(rateMatch[3] || '');
    const source = rateMatch[0];
    const item = makeMeasurement(claim, metric, source, value, isRate ? 'per 100,000 persons' : '%', rateMatch[1] ? 'approx' : '=', Boolean(rateMatch[1]), 'UNSPECIFIED', metric);
    if (isRate && item.numeric) { item.numeric.kind = 'RATE'; item.numeric.denominator = '100000 persons'; item.denominator = '100000 persons'; item.percentage_kind = 'RATE'; item.numeric.percentage_kind = 'RATE'; }
    addMeasurement(measurements, item);
  }
  const direction = new RegExp(`(?:降低|减少|升高|增加|improve(?:s|d)?|lower(?:s|ed)?|reduce(?:s|d)?|increase(?:s|d)?)[^。！？.!?，,;；]{0,24}?${number}\\s*((?:个)?百分点|percentage points?|%|％)`, 'giu');
  let directionMatch: RegExpExecArray | null;
  while ((directionMatch = direction.exec(claim))) {
    const source = directionMatch[0];
    const relative = /相对|relative/iu.test(source) ? 'RELATIVE' : /绝对|absolute|(?:个)?百分点|percentage points?/iu.test(source) ? 'ABSOLUTE' : 'UNSPECIFIED';
    const item = makeMeasurement(claim, outcome || 'effect', source, Number(directionMatch[1]), /(?:个)?百分点|percentage points?/iu.test(source) ? 'percentage points' : '%', '=', false, relative);
    item.percentage_kind = /(?:个)?百分点|percentage points?/iu.test(source) ? 'PERCENTAGE_POINT' : relative === 'RELATIVE' ? 'RATIO' : 'PERCENTAGE';
    if (item.numeric) item.numeric.percentage_kind = item.percentage_kind;
    addMeasurement(measurements, item);
  }
  const generic = new RegExp(`(?:为|是|is|=)\\s*${number}\\s*([A-Za-zμµ]+(?:\\/[A-Za-z0-9μµ²]+)?)`, 'giu');
  let genericMatch: RegExpExecArray | null;
  while ((genericMatch = generic.exec(claim))) addMeasurement(measurements, makeMeasurement(claim, outcome || 'measurement', genericMatch[0], Number(genericMatch[1]), genericMatch[2]));
  const genericPercent = /(?:约为|approximately|about|为|is|=)\s*(\d+(?:\.\d+)?)\s*(%|％)/giu;
  let genericPercentMatch: RegExpExecArray | null;
  while ((genericPercentMatch = genericPercent.exec(claim))) {
    const source = genericPercentMatch[0];
    addMeasurement(measurements, makeMeasurement(claim, outcome || 'percentage', source, Number(genericPercentMatch[1]), '%', /约为|approximately|about/iu.test(source) ? 'approx' : '=', /约为|approximately|about/iu.test(source)));
  }
  if (/相对|relative/iu.test(claim)) measurements.forEach((item) => { if (item.percentage_kind === 'PERCENTAGE' || item.percentage_kind === 'RATIO') item.relative_or_absolute = 'RELATIVE'; });
  if (/绝对|absolute/iu.test(claim)) measurements.forEach((item) => { if (item.percentage_kind === 'PERCENTAGE' || item.percentage_kind === 'PERCENTAGE_POINT') item.relative_or_absolute = 'ABSOLUTE'; });
  return measurements;
}

function metricName(claim: string): string | null {
  const mappings: Array<[RegExp, string]> = [
    [/mortality risk|死亡风险/iu, 'mortality'],
    [/risk(?!\s*(?:ratio|比))|风险(?!比)/iu, 'risk'],
    [/HbA1c|糖化血红蛋白/iu, 'HbA1c'], [/overall survival|总生存率|生存率|survival/iu, 'overall survival'], [/stroke risk|卒中风险/iu, 'stroke risk'], [/mortality|死亡率|death rate/iu, 'mortality'], [/hospitali[sz]ation|住院/iu, 'hospitalization'], [/quality of life|QoL|生活质量/iu, 'quality of life'], [/hepatotoxicity|肝毒性/iu, 'hepatotoxicity'], [/inflammatory(?: factor)? release|炎症因子释放/iu, 'inflammatory factor release'], [/major bleeding|严重出血/iu, 'major bleeding risk'], [/adherence|依从性/iu, 'follow-up adherence'], [/Cronbach|克朗巴赫|内部一致性/iu, "Cronbach's alpha"], [/sensitivity|敏感度|灵敏度/iu, 'sensitivity'], [/specificity|特异度/iu, 'specificity'], [/prevalence|患病率/iu, 'prevalence'], [/incidence|发病率/iu, 'incidence'], [/ICER|cost[- ]effectiveness|成本效果|成本效益/iu, 'cost-effectiveness'], [/cellular localization|定位|主要位于|locali[sz]ation/iu, 'cellular localization'], [/systolic blood pressure|收缩压/iu, 'systolic blood pressure'], [/blood pressure|血压/iu, 'blood pressure'], [/symptoms?|症状/iu, 'symptoms'], [/(?<!HR|风险比\s*)risk/iu, 'risk'],
  ];
  for (const [pattern, value] of mappings) {
    if (value === 'risk' && /major bleeding|严重出血|hepatotoxicity|肝毒性|mortality|死亡|stroke|卒中/iu.test(claim)) continue;
    if (pattern.test(claim)) return value;
  }
  if (/(?:\bHR\b|hazard ratio|风险比)/iu.test(claim) && !/(?:mortality|死亡|recurrence|复发|hospitali[sz]ation|住院|risk|风险|outcome|终点)/iu.test(claim)) return null;
  return null;
}
function directionFor(claim: string): OutcomeConstraints['direction'] {
  if (/(?:降低|减少|decrease|reduce|lower|prevent|预防)/iu.test(claim)) return 'DECREASE';
  if (/(?:升高|增加|increase|raise|higher)/iu.test(claim)) return 'INCREASE';
  if (/(?:改善|improve|better)/iu.test(claim)) return 'IMPROVEMENT';
  if (/(?:恶化|worsen)/iu.test(claim)) return 'WORSENING';
  if (/(?:预测|predict)/iu.test(claim)) return 'PREDICTION';
  if (/(?:无变化|no change|unchanged)/iu.test(claim)) return 'NO_CHANGE';
  return 'UNSPECIFIED';
}
function parseOutcome(claim: string, constraints: ClaimConstraints): string | null {
  const metric = metricName(claim); if (!metric) return null;
  const sourceText = claim.match(/(?:降低|减少|升高|增加|改善|预防|预测|相关|导致|诊断|locali[sz]ed?\s+(?:in|to)|定位|位于)[^。！？.!?，,;；]*/iu)?.[0] || claim.match(/(?:HbA1c|mortality|死亡率|生存率|blood pressure|血压|症状|symptoms?|风险|risk|患病率|发病率|prevalence|incidence|sensitivity|specificity|特异度|AUC|QoL|ICER|成本效果|成本效益|依从性|adherence|定位)[^。！？.!?，,;；]*/iu)?.[0] || metric;
  constraints.outcome.outcome = entity(metric, sourceText, claim, metric, 'outcome');
  constraints.outcome.direction = directionFor(claim);
  if (metric === 'mortality' || metric === 'overall survival' || metric === 'major bleeding risk') constraints.outcome.clinical_endpoint_type = provenance(metric, sourceText, claim, 'normalized');
  return metric;
}

function parsePopulation(claim: string, constraints: ClaimConstraints): void {
  const age = parseAge(claim); if (age) constraints.population.age = age;
  const group = claim.match(/(?:在|among|in)\s*([^，,。；;]+?)(?:中|among|patients?|adults?|participants?)(?:的|,|，|$)/iu);
  const patients = claim.match(/([^，,。；;]+?(?:患者|成年人|adults?|participants?|patients?))/iu);
  if (group || patients) {
    const source = group?.[0] || patients?.[0] || '';
    constraints.population.description = provenance(source.trim(), source, claim);
    const disease = source.match(/(?:患有|with|of)\s*([^，,。；;]+?)(?:的|患者|adults?|patients?|$)/iu);
    if (disease?.[1]) constraints.population.disease = provenance(disease[1].trim(), disease[1].trim(), claim);
  }
  const disease = claim.match(/(?:患有|with)\s*([^，,。；;]+?)(?:的|患者|adults?|patients?|中|$)/iu);
  if (disease?.[1]) constraints.population.disease = provenance(disease[1].trim(), disease[1].trim(), claim);
  const sex = claim.match(/\b(men|women|male|female)\b|男性|女性/iu); if (sex) constraints.population.sex = provenance(sex[1] || sex[0], sex[0], claim);
  const stage = claim.match(/(?:stage|分期)\s*([I1VvXx一二三四]+|[A-Za-z0-9-]+)/iu); if (stage) constraints.population.disease_stage = provenance(stage[1], stage[0], claim);
  const subgroup = claim.match(/(?:亚组|subgroup|among)\s*([^，,。；;]+?)(?:中|:|：|,|，|$)/iu); if (subgroup) constraints.population.subgroup = provenance(subgroup[1].trim(), subgroup[0], claim);
}
function parseIntervention(claim: string, constraints: ClaimConstraints): void {
  const subjectMatch = claim.match(/(?:药物|治疗|疗法|干预|模型|检测方法|方法|蛋白|通路|drug|treatment|therapy|intervention|model|method|protein|pathway)\s*[A-Za-z0-9_-]+/iu);
  if (subjectMatch) { const source = subjectMatch[0]; const role = /蛋白|protein|通路|pathway/iu.test(source) ? 'biological_entity' : 'intervention'; if (role === 'intervention') constraints.intervention.intervention = entity(source, source, claim, source, role); }
  const dose = claim.match(/(?:剂量|dose)\s*(?:为|是|=|of)?\s*([\d.]+\s*(?:mg|g|μg|mcg|毫克|克|µg)(?:\/\w+)?)?/iu); if (dose?.[1]) constraints.intervention.dose = provenance(dose[1], dose[0], claim);
  const route = claim.match(/(?:口服|静脉注射|皮下注射|oral|intravenous|IV|subcutaneous)/iu); if (route) constraints.intervention.route = provenance(route[0], route[0], claim);
  const frequency = claim.match(/(?:每日\s*\d+\s*次|每天|每周|once|twice|daily|weekly|bid|tid)/iu); if (frequency) constraints.intervention.frequency = provenance(frequency[0], frequency[0], claim);
  const duration = claim.match(/(?:持续|for|over)\s*(\d+(?:\.\d+)?)\s*(周|weeks?|个月|months?|天|days?|年|years?)/iu); if (duration) constraints.intervention.duration = provenance(duration[0], duration[0], claim);
}
function parseComparator(claim: string): ComparatorConstraints | null {
  const paired = claim.match(/(?:与|相较于|compared with|relative to|against)\s*([^，,。；;]+?)\s*相比?(?=\s*(?:，|,|。|;|；|$|具有|has|is|在|in|for))/iu) || claim.match(/(?:相较于|relative to)\s*([^，,。；;]+?)(?=\s*(?:的|the|is|was|has|具有))/iu);
  const nonInferior = claim.match(/non[- ]?inferior\s+to\s+([^，,。；;]+?)(?=\s*(?:，|,|。|;|；|$))/iu);
  const direct = nonInferior || claim.match(/(?:优于|劣于|不劣于|等效于|than|versus|vs\.?)\s*([^，,。；;]+?)(?=\s*(?:，|,|。|;|；|$|在|in|for|方面|on))/iu);
  const marker = paired || direct; if (!marker) return null;
  let text = (paired ? paired[1] : direct?.[1] || '').trim().replace(/[。.!?]+$/u, ''); text = text.split(/\s+(?:in|for|on|在|于)\s+/iu)[0].trim();
  const parts = text.split(/\s*(?:和|、|and|or|及)\s*/iu).map((part) => part.trim()).filter(Boolean);
  const comparators = parts.map((part) => entity(part, part, claim, part, 'comparator')).filter((item): item is ClaimEntity => Boolean(item)); if (comparators.length === 0) return null;
  const comparator_type = /安慰剂|placebo/iu.test(text) ? 'PLACEBO' : /标准治疗|standard care|standard treatment/iu.test(text) ? 'STANDARD_CARE' : /无干预|no intervention/iu.test(text) ? 'NO_INTERVENTION' : 'UNSPECIFIED';
  return { comparators, comparator_type, source_text: marker[0], source_span: spanFor(claim, marker[0]) };
}
function parseTemporal(claim: string, constraints: ClaimConstraints): void {
  const year = claim.match(/(?:\b(19\d{2}|20\d{2})\b年?|year\s*(19\d{2}|20\d{2}))/iu); if (year) constraints.temporal.start_time = provenance(year[1] || year[2], year[0], claim);
  const follow = claim.match(/(?:治疗|after|at|following|随访|follow[- ]?up|观察)\s*(\d+(?:\.\d+)?)\s*(周|weeks?|个月|months?|天|days?|年|years?)/iu); const anyTime = claim.match(/(\d+(?:\.\d+)?|一|两|二|三|四|五|六|七|八|九|十)\s*(周|weeks?|个月|months?|天|days?|年|years?)/iu);
  if (follow) { constraints.temporal.follow_up = provenance(follow[0], follow[0], claim); constraints.temporal.observation_time = provenance(follow[0], follow[0], claim); } else if (anyTime && /(?:时|at)/iu.test(anyTime[0])) constraints.temporal.observation_time = provenance(anyTime[0], anyTime[0], claim); else if (anyTime) constraints.temporal.time_window = provenance(anyTime[0], anyTime[0], claim);
  const future = claim.match(/(?:未来|next|within the next)\s*(\d+(?:\.\d+)?|一|两|二|三|四|五|六|七|八|九|十)\s*(周|weeks?|个月|months?|天|days?|年|years?)/iu); if (future) constraints.temporal.time_window = provenance(future[0], future[0], claim);
}
function parseContext(claim: string, constraints: ClaimConstraints): void {
  const geography = claim.match(/(?:在|in|from)\s*([^，,。；;]+?)(?:地区|region|area)(?:的|,|，|$)/iu) || claim.match(/([\u3400-\u9fffA-Za-z0-9 -]+地区)/iu); if (geography) { const value = (geography[1] || geography[0]).trim().replace(/^\s*(?:19\d{2}|20\d{2})\s*年?\s*/u, ''); constraints.context.geography = provenance(value, geography[0], claim); }
  const setting = claim.match(/(?:医院|社区|基层|primary care|hospital|community|clinical setting|laboratory|实验室)/iu); if (setting) constraints.context.healthcare_setting = provenance(setting[0], setting[0], claim);
  if (/health-system perspective|卫生系统视角/iu.test(claim)) constraints.context.research_setting = provenance('health-system perspective', claim.match(/health-system perspective|卫生系统视角/iu)?.[0] || null, claim);
}
function condition(parameter: string, source: string, claim: string, operator: ConditionConstraint['operator'], value: number | null, unit: string | null, appliesTo: string | null = null): ConditionConstraint { return { parameter, normalized_parameter: parameter.toLowerCase(), operator, value, lower: null, upper: null, unit, applies_to: appliesTo, source_text: source, source_span: spanFor(claim, source) }; }
function parseConditions(claim: string, constraints: ClaimConstraints): void {
  const age = parseAge(claim); if (age && age.age_min !== null) constraints.conditions.push(condition('age', age.source_text || String(age.age_min), claim, '>=', age.age_min, 'years', 'population'));
  const renal = claim.match(/(?:eGFR|肾小球滤过率)\s*(?:低于|少于|<|≤|<=)\s*(\d+(?:\.\d+)?)\s*(mL\/min\/1\.73m²|mL\/min\/1\.73\s*m2)?/iu); if (renal) constraints.conditions.push(condition('eGFR', renal[0], claim, '<', Number(renal[1]), renal[2] || 'mL/min/1.73m²', 'population'));
  const doseResponse = claim.match(/(?:每增加|per\s+each|for every)\s*(\d+(?:\.\d+)?)\s*(mg\s*\/\s*day|mg\/day|mg\/天|毫克\/天)[^。！？.!?]{0,80}?(\d+(?:\.\d+)?)\s*(%|％|百分点|percentage points?)/iu);
  if (doseResponse) { constraints.conditions.push(condition('dose_increment', doseResponse[0], claim, '=', Number(doseResponse[1]), 'mg/day', 'intervention')); constraints.type_specific.dose_response = { increment: Number(doseResponse[1]), unit: 'mg/day', effect: Number(doseResponse[2]), effect_unit: doseResponse[3] }; }
  if (/小样本|small sample/iu.test(claim)) constraints.conditions.push(condition('sample_size', claim.match(/小样本|small sample/iu)?.[0] || 'small sample', claim, null, null, null, 'study'));
}
function parseStatistical(claim: string, constraints: ClaimConstraints, measurements: Measurement[]): void {
  const effect = measurements.find((item) => ['AUC', 'hazard_ratio', 'relative_risk', 'odds_ratio', 'ICER'].includes(item.metric)); if (effect) constraints.statistical.effect_measure = provenance(effect.metric, effect.source_text, claim, 'normalized');
  const p = measurements.find((item) => item.metric === 'p-value'); if (p) constraints.statistical.p_value = p.value;
  if (effect?.value !== null && effect?.value !== undefined) constraints.statistical.effect_value = effect.value;
  const ci = measurements.find((item) => item.metric === 'confidence_interval')?.numeric; if (ci) constraints.statistical.confidence_interval = { lower: ci.lower, upper: ci.upper, level: /95%/iu.test(ci.source_text) ? 95 : null, source_text: ci.source_text };
  const margin = claim.match(/(?:margin|界值|界限)\s*(?:of|为|是|=)?\s*([\d.]+\s*%?)/iu); if (margin) { if (/(?:不劣|non[- ]?inferiority)/iu.test(claim)) constraints.statistical.non_inferiority_margin = Number.parseFloat(margin[1]); if (/(?:等效|equivalence)/iu.test(claim)) constraints.statistical.equivalence_margin = Number.parseFloat(margin[1]); }
  if (measurements.some((item) => item.relative_or_absolute === 'RELATIVE')) constraints.statistical.relative_or_absolute = 'RELATIVE'; else if (measurements.some((item) => item.relative_or_absolute === 'ABSOLUTE')) constraints.statistical.relative_or_absolute = 'ABSOLUTE';
}

function classify(claim: string): { primary: ClaimTypeId; secondary: ClaimTypeId[]; rationale: string; status: AtomicClaim['classification_status'] } {
  const tests: Array<{ type: ClaimTypeId; pattern: RegExp; reason: string }> = [
    { type: 'T07', pattern: /机制|通路|抑制|激活|through|via|mechanism|pathway|inhibit|activate/iu, reason: 'The claim explicitly describes a biological mechanism or pathway.' },
    { type: 'T10', pattern: /成本效果|成本效益|经济学|cost[- ]effectiveness|cost[- ]utility|ICER|QALY/iu, reason: 'The claim contains a health-economic outcome or metric.' },
    { type: 'T03', pattern: /诊断|检测方法|敏感度|特异度|sensitivity|specificity|diagnos/iu, reason: 'The claim concerns a diagnostic method or diagnostic performance.' },
    { type: 'T05', pattern: /预测|预测模型|AUC|predict|forecast|risk model/iu, reason: 'The claim describes prediction or predictive performance.' },
    { type: 'T06', pattern: /患病率|发病率|疾病负担|prevalence|incidence|epidemiolog|disease burden/iu, reason: 'The claim describes a population-level epidemiological quantity.' },
    { type: 'T08', pattern: /蛋白|基因|受体|定位|表达|结合|protein|gene|receptor|locali[sz]ed|expressed|binds?/iu, reason: 'The claim describes a biological entity or property.' },
    { type: 'T09', pattern: /生物标志物|标志物|量表|测量|Cronbach|内部一致性|biomarker|measurement|scale/iu, reason: 'The claim concerns a biomarker, measurement, or scale.' },
    { type: 'T11', pattern: /指南|依从性|实施|医疗实践|患者体验|adherence|implementation|guideline|healthcare practice|experience/iu, reason: 'The claim concerns healthcare practice, implementation, or experience.' },
    { type: 'T12', pattern: /随机对照|队列研究|病例对照|方法学|研究设计|randomi[sz]ed|cohort|case[- ]control|methodolog|study design|小样本|系统性偏差|systematic bias|average treatment effect/iu, reason: 'The claim describes a study or analytical method.' },
    { type: 'T04', pattern: /预后|生存|进展|复发|prognos|survival|progression|relapse|recurrence/iu, reason: 'The claim describes prognosis or disease course.' },
    { type: 'T02', pattern: /相关|关联|导致|引起|风险|associated?|related|correlat|cause|lead to|risk/iu, reason: 'The claim describes an association, causal statement, or risk relationship.' },
    { type: 'T01', pattern: /药物|治疗|疗法|干预|预防|drug|treatment|therapy|intervention|prevent/iu, reason: 'The claim describes an intervention, treatment effect, or safety outcome.' },
  ];
  const matches = tests.filter((item) => item.pattern.test(claim)); if (matches.length === 0) return { primary: 'UNKNOWN', secondary: [], rationale: 'The text does not contain enough explicit domain cues for a stable base semantic type.', status: 'unknown' };
  const primaryMatch = matches.find((item) => item.type === 'T07') || matches.find((item) => item.type === 'T10') || matches.find((item) => item.type === 'T03') || matches.find((item) => item.type === 'T05') || matches.find((item) => item.type === 'T06') || matches.find((item) => item.type === 'T11') || matches.find((item) => item.type === 'T12') || matches.find((item) => item.type === 'T04') || matches.find((item) => item.type === 'T08') || matches.find((item) => item.type === 'T09') || matches.find((item) => item.type === 'T01') || matches.find((item) => item.type === 'T02') || matches[0];
  return { primary: primaryMatch.type, secondary: matches.filter((item) => item.type !== primaryMatch.type).map((item) => item.type), rationale: primaryMatch.reason, status: matches.length > 1 ? 'ambiguous' : 'certain' };
}
function relationFor(claim: string): AtomicClaim['relation'] {
  if (/(?:通过|via|through|mechanism|pathway|mediates?|抑制|激活)/iu.test(claim)) return 'MECHANISM';
  if (/(?:预测|predict|forecast)/iu.test(claim)) return 'PREDICTION';
  if (/(?:属性|定位|表达|结合|locali[sz]ed|expressed|binds?)/iu.test(claim)) return 'ATTRIBUTE';
  if (/(?:相关|关联|associated?|related|correlat)/iu.test(claim) && !/(?:导致|引起|cause|lead to)/iu.test(claim)) return 'ASSOCIATION';
  if (/(?:导致|引起|造成|cause|leads? to|results? in)/iu.test(claim)) return 'CAUSATION';
  if (/(?:优于|劣于|不劣于|等效|相比|compared|versus|\bvs\.?\b|better than|worse than)/iu.test(claim)) return 'COMPARISON';
  if (/(?:约|approximately|about|超过|大于|AUC|p\s*[=<>]|敏感度|特异度|患病率|prevalence|incidence|Cronbach)/iu.test(claim)) return 'QUANTIFICATION';
  return 'EFFECT';
}
function operatorsFor(claim: string): ClaimOperator[] {
  const operators: ClaimOperator[] = []; const add = (operator: ClaimOperator, pattern: RegExp) => { if (pattern.test(claim) && !operators.includes(operator)) operators.push(operator); };
  add('SUPERIORITY', /优于|更有效|更好|better than|superior to|greater than|more cost[- ]effective/iu); add('INFERIORITY', /(?<!不)劣于|较差|worse than|inferior to/iu); add('NON_INFERIORITY', /不劣于|non[- ]?inferior/iu); add('EQUIVALENCE', /等效|等价|equivalent|equivalence/iu);
  add('NON_SIGNIFICANT_RESULT', /未观察到统计学显著|统计学不显著|not statistically significant|no statistically significant|not significant/iu);
  if (!/(?:not shown|not established|尚未证实|未证明|insufficient evidence|cannot conclude|不能断定)/iu.test(claim)) add('NULL_EFFECT', /无效应|没有效果|完全无效|no effect|no benefit|no difference/iu);
  add('THRESHOLD', /超过|大于|至少|高于|少于|低于|>|>=|<|<=|over|above|more than|less than/iu);
  if (/(?:不会|不增加|不降低|does not|doesn't|not increase|not decrease|\bnot\b|没有|无)/iu.test(claim) && !operators.includes('NON_SIGNIFICANT_RESULT')) add('NEGATION', /(?:不会|不增加|不降低|does not|doesn't|not increase|not decrease|\bnot\b|没有|无)/iu);
  add('CONDITIONAL', /在.+(?:中|内)|among|if|when|provided that|条件下/iu); add('TEMPORAL', /\d+\s*(?:周|天|个月|年|weeks?|days?|months?|years?)|after|before|during|follow[- ]?up|随访|未来|next/iu); add('DOSE_RESPONSE', /剂量反应|剂量依赖|dose[- ]response|dose[- ]dependent|每增加|per\s+each/iu); add('INTERACTION', /交互|相互作用|interaction|interacts?/iu); add('MEDIATION', /通过|介导|中介|mediates?|through|via/iu); add('SUBGROUP_DIFFERENCE', /亚组差异|亚组|subgroup|effect modification/iu);
  if (/(?:not shown|not established|尚未证实|未证明)[^.!?。！？]{0,30}(?:non[- ]?inferior|不劣)/iu.test(claim)) {
    const index = operators.indexOf('INFERIORITY');
    if (index >= 0) operators.splice(index, 1);
  }
  return operators;
}
function quantifierFor(claim: string): AtomicClaim['quantifier'] {
  if (/并非所有|不是所有|not all/iu.test(claim)) return 'NOT_ALL'; if (/没有任何|无患者|none of|neither/iu.test(claim)) return 'NONE'; if (/并非部分|not some/iu.test(claim)) return 'NOT_SOME'; if (/\b(?:all|every|each)\b|所有|每个|全部/iu.test(claim)) return 'ALL'; if (/\b(?:some|a subset)\b|一些|部分/iu.test(claim)) return 'SOME'; if (/\b(?:most|majority)\b|大多数|多数/iu.test(claim)) return 'MOST'; if (/\b(?:average|mean|population[- ]level)\b|平均|总体/iu.test(claim)) return 'AVERAGE'; if (/患病率|发病率|风险|prevalence|incidence|risk/iu.test(claim)) return 'POPULATION_LEVEL'; return 'UNSPECIFIED';
}
function quantifierSpec(claim: string, quantifier: AtomicClaim['quantifier']): QuantifierSpec {
  const match = claim.match(/并非所有|不是所有|not all|没有任何|无患者|none of|neither|并非部分|not some|\b(?:all|every|each|some|most|majority)\b|所有|每个|全部|一些|部分|大多数|多数/iu);
  return { kind: quantifier, target: quantifier === 'UNSPECIFIED' ? 'UNKNOWN' : /risk|患病率|发病率|outcome/iu.test(claim) ? 'OUTCOME' : 'POPULATION', negated: ['NOT_ALL', 'NONE', 'NOT_SOME'].includes(quantifier), source_text: match?.[0] || null, source_span: match ? spanFor(claim, match[0]) : null };
}
function modalityFor(claim: string): AtomicClaim['modality'] {
  if (/假设|假定|hypothetical|if we assume/iu.test(claim)) return 'HYPOTHETICAL'; if (/很可能|大概|highly likely|likely|probably/iu.test(claim)) return 'PROBABLE'; if (/可能|或许|may|might|possibly|could/iu.test(claim)) return 'POSSIBLE'; if (/研究报告|据报道|reported|study reports?/iu.test(claim)) return 'REPORTED'; return 'ASSERTED';
}
function epistemicStatusFor(claim: string, relation: AtomicClaim['relation']): EpistemicAssertion {
  const notEstablished = claim.match(/尚未[^。！？.!?]{0,24}(?:证实|证明)|未(?:被)?证明|没有证明|not shown|not established|insufficient evidence|lack of evidence|证据不足|尚无充分证据|不能断定|cannot conclude/iu); if (notEstablished) return { status: /insufficient evidence|证据不足|尚无充分证据/iu.test(notEstablished[0]) ? 'INSUFFICIENT_EVIDENCE' : 'NOT_ESTABLISHED', source_text: notEstablished[0], source_span: spanFor(claim, notEstablished[0]), scope: 'CLAIM' };
  const nonSignificant = claim.match(/未观察到统计学显著|统计学不显著|not statistically significant|no statistically significant|not significant/iu); if (nonSignificant) return { status: 'NON_SIGNIFICANT_RESULT', source_text: nonSignificant[0], source_span: spanFor(claim, nonSignificant[0]), scope: 'RELATION' };
  const reported = claim.match(/据报道|研究报告|reported|study reports?/iu); if (reported) return { status: 'REPORTED_FINDING', source_text: reported[0], source_span: spanFor(claim, reported[0]), scope: 'CLAIM' };
  const nullEffect = claim.match(/无效应|没有效果|完全无效|no effect|no benefit|no difference/iu); if (nullEffect) return { status: 'ASSERTED_NULL_EFFECT', source_text: nullEffect[0], source_span: spanFor(claim, nullEffect[0]), scope: 'RELATION' };
  if (relation !== 'EFFECT' || /(?:降低|减少|升高|增加|改善|预测|相关|导致|有效|effective|improv|reduce|increase)/iu.test(claim)) return { status: 'ASSERTED_EFFECT', source_text: null, source_span: null, scope: relation === 'EFFECT' ? 'CLAIM' : 'RELATION' };
  return { status: 'UNKNOWN', source_text: null, source_span: null, scope: 'UNKNOWN' };
}
function negationScopeFor(claim: string, quantifier: AtomicClaim['quantifier']): NegationScope | null {
  const quantifierNegation = claim.match(/并非所有|不是所有|not all|没有任何|无患者|none of|neither|not some/iu); if (quantifierNegation) return { target: 'QUANTIFIER', operator: quantifier === 'NOT_ALL' ? 'NOT_ALL' : quantifier === 'NOT_SOME' ? 'NOT_SOME' : 'NONE', source_text: quantifierNegation[0], source_span: spanFor(claim, quantifierNegation[0]) };
  const epistemic = claim.match(/not shown|not established|尚未[^。！？.!?]{0,24}(?:证实|证明)|不能断定|cannot conclude|没有证明/iu); if (epistemic) return { target: 'EPISTEMIC_STATUS', operator: 'NOT', source_text: epistemic[0], source_span: spanFor(claim, epistemic[0]) };
  const predicate = claim.match(/不会[^。！？.!?，,;；]*|不(?:增加|降低|影响)[^。！？.!?，,;；]*|does not[^.?!,;]*|doesn't[^.?!,;]*/iu); if (predicate) return { target: 'PREDICATE', operator: 'NOT', source_text: predicate[0], source_span: spanFor(claim, predicate[0]) };
  return null;
}
function shiftNestedSpans(value: unknown, offset: number, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return; seen.add(value as object); if (Array.isArray(value)) { value.forEach((item) => shiftNestedSpans(item, offset, seen)); return; }
  const record = value as Record<string, unknown>; if (typeof record.start === 'number' && typeof record.end === 'number' && typeof record.text === 'string') { record.start += offset; record.end += offset; } Object.values(record).forEach((item) => shiftNestedSpans(item, offset, seen));
}

function parseOne(clause: Clause): AtomicClaim {
  const claim = clause.text; const classification = classify(claim); const constraints = emptyConstraints(); parsePopulation(claim, constraints); parseIntervention(claim, constraints); const outcome = parseOutcome(claim, constraints); constraints.comparator = parseComparator(claim); parseTemporal(claim, constraints); parseContext(claim, constraints); parseConditions(claim, constraints); const measurements = parseMeasurements(claim, outcome); parseStatistical(claim, constraints, measurements);
  if (/主要|mainly|predominantly/iu.test(claim) && outcome === 'cellular localization') constraints.type_specific.localization_qualifier = 'mainly'; if (/not recommended|不推荐|不建议/iu.test(claim)) constraints.type_specific.normative_status = 'NOT_RECOMMENDED'; if (/no proof.*interaction|未证明.*interaction|未证明.*相互作用/iu.test(claim)) constraints.type_specific.interaction_status = 'NOT_ESTABLISHED';
  const operators = operatorsFor(claim); const relation = relationFor(claim); const subjectMatch = claim.match(/(?:蛋白|protein|模型|model|药物|drug|治疗|treatment)\s*[A-Za-z0-9_-]+/iu); const subject = constraints.intervention.intervention || entity(subjectMatch?.[0] || null, subjectMatch?.[0] || null, claim, null, 'subject'); const predicateText = claim.match(/(?:降低|减少|升高|增加|改善|预测|相关|导致|抑制|激活|can|may|可能)[^。！？.!?]*/iu)?.[0] || null; const predicate = entity(predicateText ? normalized(predicateText) : null, predicateText, claim, predicateText ? normalized(predicateText) : null, 'predicate'); const object = constraints.outcome.outcome || (relation === 'MECHANISM' ? entity(claim.match(/(?:通路|pathway)\s*([A-Za-z0-9_-]+)/iu)?.[1] || null, claim.match(/(?:通路|pathway)\s*[A-Za-z0-9_-]+/iu)?.[0] || null, claim, null, 'mechanism') : null);
  const quantifier = quantifierFor(claim); const epistemic_status = epistemicStatusFor(claim, relation); const unresolved_fields: string[] = []; if (classification.primary === 'UNKNOWN') unresolved_fields.push('primary_type'); if ((classification.primary === 'T01' || relation === 'COMPARISON') && !constraints.outcome.outcome && !/有效|effective/iu.test(claim)) unresolved_fields.push('outcome'); if (relation === 'COMPARISON' && !constraints.comparator) unresolved_fields.push('comparator'); if ((operators.includes('NON_INFERIORITY') || operators.includes('EQUIVALENCE')) && !constraints.comparator) unresolved_fields.push('comparator'); if (operators.includes('NON_INFERIORITY') && constraints.statistical.non_inferiority_margin === null) unresolved_fields.push('non_inferiority_margin'); if (operators.includes('EQUIVALENCE') && constraints.statistical.equivalence_margin === null) unresolved_fields.push('equivalence_margin'); if (operators.includes('NON_SIGNIFICANT_RESULT')) unresolved_fields.push('significance_definition'); if (/(?:显著|significant)/iu.test(claim) && !measurements.some((item) => item.metric === 'p-value')) unresolved_fields.push('significance_definition'); if (relation === 'QUANTIFICATION' && measurements.length === 0) unresolved_fields.push('measurement_value'); if (epistemic_status.status === 'UNKNOWN' && !constraints.outcome.outcome) unresolved_fields.push('epistemic_scope');
  const warnings: string[] = []; if (operators.includes('NON_SIGNIFICANT_RESULT')) warnings.push('NON_SIGNIFICANT_RESULT does not establish NULL_EFFECT or EQUIVALENCE.'); if (relation === 'ASSOCIATION') warnings.push('Association was preserved as ASSOCIATION; no causal direction was inferred.'); if (relation === 'CAUSATION' && /(?:相关|associated?|related|correlat)/iu.test(claim)) warnings.push('The text contains both association and causal cues; causal scope needs review.'); if (constraints.outcome.outcome && /(?:显著|significant)/iu.test(claim) && !measurements.some((item) => item.metric === 'p-value')) warnings.push('The claim uses significance language without an explicit statistical threshold or p-value.'); if (epistemic_status.status === 'NOT_ESTABLISHED' || epistemic_status.status === 'INSUFFICIENT_EVIDENCE') warnings.push('Evidence status is epistemic and does not assert the opposite scientific effect.');
  const parsed: AtomicClaim = { id: `AC-${String(clause.start + 1).padStart(4, '0')}`, original_text: claim, normalized_statement: normalized(claim), source_span: { start: 0, end: claim.length, text: claim }, primary_type: classification.primary, secondary_types: classification.secondary, classification_status: classification.status, classification_rationale: classification.rationale, subject, predicate, object, relation, operators, polarity: operators.includes('NEGATION') && epistemic_status.status !== 'NOT_ESTABLISHED' ? 'NEGATED' : 'AFFIRMED', quantifier, quantifier_spec: quantifierSpec(claim, quantifier), modality: modalityFor(claim), negation_scope: negationScopeFor(claim, quantifier), epistemic_status, inherited_fields: [], constraints, measurements, unresolved_fields, warnings };
  if (parsed.primary_type === 'T01' && parsed.constraints.outcome.outcome === null && !parsed.unresolved_fields.includes('outcome')) parsed.unresolved_fields.push('outcome');
  if (parsed.epistemic_status.status === 'NOT_ESTABLISHED') parsed.unresolved_fields = parsed.unresolved_fields.filter((field) => field !== 'non_inferiority_margin');
  shiftNestedSpans(parsed, clause.start); return parsed;
}

function atomicNode(atomic: AtomicClaim): LogicalTreeNode { return { id: `ref-${atomic.id}`, kind: 'ATOMIC_REF', operator: null, atomic_claim_id: atomic.id, child_ids: [], epistemic_scope: atomic.epistemic_status.status, source_text: atomic.original_text, source_span: atomic.source_span }; }
function buildLogicalTree(claim: string, atomics: AtomicClaim[], operator: ParsedClauses['operator']): LogicalExpressionTree {
  if (atomics.length === 0) return { root_id: null, nodes: [] }; const refs = atomics.map(atomicNode); if (atomics.length === 1) return { root_id: refs[0].id, nodes: refs };
  if ((operator === 'AND' || operator === null) && atomics.length >= 3 && /(?:或者|\bor\b)/iu.test(claim) && /(?:不能断定|cannot conclude|not conclude)/iu.test(claim)) {
    const orNode: LogicalTreeNode = { id: 'logic-or-0', kind: 'OPERATOR', operator: 'OR', atomic_claim_id: null, child_ids: [refs[0].id, refs[1].id], epistemic_scope: null, source_text: `${refs[0].source_text || ''} OR ${refs[1].source_text || ''}`, source_span: null }; const epistemicNode: LogicalTreeNode = { id: 'logic-not-0', kind: 'OPERATOR', operator: 'NOT', atomic_claim_id: null, child_ids: [refs[2].id], epistemic_scope: 'INSUFFICIENT_EVIDENCE', source_text: refs[2].source_text, source_span: refs[2].source_span }; const root: LogicalTreeNode = { id: 'logic-root', kind: 'OPERATOR', operator: 'AND', atomic_claim_id: null, child_ids: [orNode.id, epistemicNode.id], epistemic_scope: null, source_text: claim, source_span: { start: 0, end: claim.length, text: claim } }; return { root_id: root.id, nodes: [...refs, orNode, epistemicNode, root] };
  }
  const root: LogicalTreeNode = { id: 'logic-root', kind: 'OPERATOR', operator: operator || 'AND', atomic_claim_id: null, child_ids: refs.map((ref) => ref.id), epistemic_scope: null, source_text: claim, source_span: { start: 0, end: claim.length, text: claim } }; return { root_id: root.id, nodes: [...refs, root] };
}
function mergeGlobalConstraints(): ClaimConstraints { return emptyConstraints('global'); }
function buildGroups(atomics: AtomicClaim[]): Array<{ id: string; atomic_claim_ids: string[]; constraints: ClaimConstraints; inheritance_basis: string; source_span: SourceSpan | null }> {
  if (atomics.length < 2) return []; const first = atomics[0]; const sharedPopulation = first.constraints.population.description || first.constraints.population.disease; if (!sharedPopulation || atomics.slice(1).every((atomic) => atomic.constraints.population.description || atomic.constraints.population.disease)) return []; const group = emptyConstraints('group'); group.population = first.constraints.population; return [{ id: 'GROUP-1', atomic_claim_ids: atomics.map((atomic) => atomic.id), constraints: group, inheritance_basis: 'An explicit population prefix scopes the compound claim.', source_span: first.constraints.population.description?.source_span || first.constraints.population.disease?.source_span || null }];
}

export function deterministicParseClaim(claim: string, now = new Date()): StructuredClaim {
  const parsedClauses = splitClauses(claim); const atomicClaims = parsedClauses.clauses.map(parseOne);
  if (atomicClaims.length > 1) {
    const first = atomicClaims[0];
    for (const atomic of atomicClaims.slice(1)) {
      if (!atomic.subject && first.subject) {
        atomic.subject = first.subject;
        atomic.inherited_fields.push({ field: 'subject', from_atomic_claim_id: first.id, rationale: 'The compound claim omits a new subject in this clause.', source_span: first.subject.source_span });
      }
      if (!atomic.constraints.intervention.intervention && first.constraints.intervention.intervention) {
        atomic.constraints.intervention.intervention = first.constraints.intervention.intervention;
        atomic.inherited_fields.push({ field: 'constraints.intervention.intervention', from_atomic_claim_id: first.id, rationale: 'The compound claim omits a new intervention in this clause.', source_span: first.constraints.intervention.intervention.source_span });
      }
      if (!atomic.constraints.outcome.outcome && first.constraints.outcome.outcome && /(?:这一作用|this effect|不再观察到改善|no longer observed improvement|尚无充分证据支持这一效果|insufficient evidence.*effect)/iu.test(atomic.original_text)) {
        atomic.constraints.outcome.outcome = first.constraints.outcome.outcome;
        atomic.constraints.outcome.direction = /(?:不再观察到改善|no longer observed improvement)/iu.test(atomic.original_text) ? 'NO_CHANGE' : first.constraints.outcome.direction;
        atomic.inherited_fields.push({ field: 'constraints.outcome.outcome', from_atomic_claim_id: first.id, rationale: 'The clause refers anaphorically to the preceding outcome.', source_span: first.constraints.outcome.outcome.source_span });
      }
      if (atomic.primary_type === 'UNKNOWN' && first.primary_type === 'T01' && (atomic.constraints.outcome.outcome || atomic.epistemic_status.status !== 'UNKNOWN')) {
        atomic.primary_type = 'T01';
        atomic.classification_status = 'ambiguous';
        atomic.classification_rationale = 'The clause inherits the intervention context from the compound claim and adds a local epistemic or outcome statement.';
      }
      if (atomic.primary_type === 'T02' && first.primary_type === 'T01' && atomic.constraints.outcome.outcome) {
        atomic.secondary_types = Array.from(new Set([...atomic.secondary_types, 'T02']));
        atomic.primary_type = 'T01';
        atomic.classification_status = 'ambiguous';
        atomic.classification_rationale = 'The clause is an intervention outcome/safety statement sharing the intervention from the compound claim.';
      }
    }
  }
  const warnings = atomicClaims.flatMap((atomic) => atomic.warnings); const unresolved = atomicClaims.flatMap((atomic) => atomic.unresolved_fields.map((field) => `${atomic.id}.${field}`)); if (atomicClaims.length === 0) { warnings.push('The claim contains no non-whitespace text.'); unresolved.push('claim_text'); }
  const composition: CompositionNode[] = atomicClaims.length > 1 && parsedClauses.operator ? [{ operator: parsedClauses.operator, members: atomicClaims.map((atomic) => atomic.id), source_text: claim, source_span: { start: 0, end: claim.length, text: claim }, scope: parsedClauses.operator === 'OR' ? 'alternatives' : null }] : [];
  const logical_tree = buildLogicalTree(claim, atomicClaims, parsedClauses.operator); const parse_status: StructuredClaim['parse_status'] = atomicClaims.length === 0 || atomicClaims.some((atomic) => atomic.primary_type === 'UNKNOWN') ? 'needs_review' : unresolved.length > 0 ? 'needs_review' : 'success';
  return { schema_version: CLAIM_SCHEMA_VERSION, original_claim: claim, language: languageOf(claim), parse_status, atomic_claims: atomicClaims, composition, logical_tree, global_constraints: mergeGlobalConstraints(), group_constraints: buildGroups(atomicClaims), unresolved_fields: Array.from(new Set(unresolved)), warnings: Array.from(new Set(warnings)), parser_metadata: { parser_version: CLAIM_PARSER_VERSION, schema_version: CLAIM_SCHEMA_VERSION, method: 'deterministic', requested_mode: 'deterministic', actual_method: 'deterministic', fallback_used: false, fallback_reason: null, model_name: null, attempts: 0, model_error: null, validation_errors: [], created_at: now.toISOString() } };
}
