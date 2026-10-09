import {
  AgeConstraint,
  AtomicClaim,
  ClaimConstraints,
  ClaimEntity,
  ClaimOperator,
  ClaimTypeId,
  ContextConstraints,
  ComparatorConstraints,
  CompositionNode,
  InterventionConstraints,
  Measurement,
  OutcomeConstraints,
  PopulationConstraints,
  ProvenancedValue,
  SourceSpan,
  StatisticalConstraints,
  StructuredClaim,
  TemporalConstraints,
  CLAIM_PARSER_VERSION,
  CLAIM_SCHEMA_VERSION,
} from './schema.js';

interface Clause {
  text: string;
  start: number;
  end: number;
}

interface ParsedClauses {
  clauses: Clause[];
  operator: CompositionNode['operator'] | null;
}

function spanFor(claim: string, text: string, startAt = 0): SourceSpan | null {
  if (!text) return null;
  const start = claim.indexOf(text, Math.max(0, startAt));
  return start >= 0 ? { start, end: start + text.length, text } : null;
}

function trimmedRange(claim: string, start: number, end: number): Clause | null {
  let left = start;
  let right = end;
  while (left < right && /\s/.test(claim[left] || '')) left += 1;
  while (right > left && /\s/.test(claim[right - 1] || '')) right -= 1;
  while (right > left && /[。！？.!?]$/u.test(claim.slice(left, right))) right -= 1;
  if (left >= right) return null;
  return { text: claim.slice(left, right), start: left, end: right };
}

function splitClauses(claim: string): ParsedClauses {
  const ifThen = claim.match(/^(?:if|if\s+|如果|若)\s*(.+?)\s*(?:then|则)\s*(.+)$/iu);
  if (ifThen?.[1] && ifThen[2]) {
    const thenAt = claim.toLowerCase().lastIndexOf(ifThen[2].toLowerCase());
    const conditionAt = claim.indexOf(ifThen[1]);
    const condition = trimmedRange(claim, conditionAt, thenAt);
    const consequence = trimmedRange(claim, thenAt, claim.length);
    if (condition && consequence) return { clauses: [condition, consequence], operator: 'IF_THEN' };
  }

  const clauses: Clause[] = [];
  let start = 0;
  let operator: CompositionNode['operator'] | null = null;
  const boundary = /(?:,|，)?\s*(but|however|and|or|while|并且|而且|但是|但|以及|同时|或|或者)\s*/giu;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(claim))) {
    const conjunction = match[1].toLowerCase();
    const before = claim.slice(0, match.index);
    const after = claim.slice(match.index + match[0].length);
    if (!after.trim()) continue;
    // "through A and B" and comparator lists are one proposition, not two.
    if (/(?:through|via|通过|经由)\s+[^。！？.!?]*$/iu.test(before) && !/\b(?:can|will|is|are|does|may|可能|能够|会|是|可)\b/iu.test(after)) continue;
    if (/(?:than|优于|劣于|compared with|与)\s*$/iu.test(before)) continue;
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
  const hasZh = /[\u3400-\u9fff]/u.test(text);
  const hasLatin = /[A-Za-z]/u.test(text);
  if (hasZh && hasLatin) return 'mixed';
  if (hasZh) return 'zh';
  if (hasLatin) return 'en';
  return 'unknown';
}

function normalized(text: string): string {
  return text.replace(/[“”"'「」『』]/gu, '').replace(/\s+/gu, ' ').trim();
}

function provenance<T>(value: T | null, sourceText: string | null, claim: string, status: ProvenancedValue<T>['extraction_status'] = 'explicit', startAt = 0): ProvenancedValue<T> {
  return {
    value,
    source_text: sourceText,
    source_span: sourceText ? spanFor(claim, sourceText, startAt) : null,
    extraction_status: value === null ? 'unknown' : status,
  };
}

function entity(value: string | null, sourceText: string | null, claim: string, normalizedValue: string | null = value, role: string | null = null, startAt = 0): ClaimEntity | null {
  if (value === null && sourceText === null) return null;
  return {
    value,
    normalized: normalizedValue,
    source_text: sourceText,
    source_span: sourceText ? spanFor(claim, sourceText, startAt) : null,
    extraction_status: value === null ? 'unknown' : normalizedValue !== sourceText ? 'normalized' : 'explicit',
    role,
  };
}

function emptyPopulation(): PopulationConstraints {
  return {
    description: null,
    age: null,
    sex: null,
    disease: null,
    disease_stage: null,
    inclusion_criteria: [],
    exclusion_criteria: [],
    subgroup: null,
  };
}

function emptyIntervention(): InterventionConstraints {
  return { intervention: null, dose: null, route: null, frequency: null, duration: null, exposure: null };
}

function emptyTemporal(): TemporalConstraints {
  return { start_time: null, observation_time: null, follow_up: null, time_window: null };
}

function emptyStatistical(): StatisticalConstraints {
  return {
    effect_measure: null,
    effect_value: null,
    confidence_interval: null,
    p_value: null,
    significance_threshold: null,
    non_inferiority_margin: null,
    equivalence_margin: null,
    relative_or_absolute: 'UNSPECIFIED',
  };
}

function emptyContext(): ContextConstraints {
  return { geography: null, healthcare_setting: null, research_setting: null, other: [] };
}

function emptyConstraints(): ClaimConstraints {
  return {
    population: emptyPopulation(),
    intervention: emptyIntervention(),
    comparator: null,
    outcome: { outcome: null, direction: 'UNSPECIFIED', effect_size: null, clinical_endpoint_type: null },
    temporal: emptyTemporal(),
    statistical: emptyStatistical(),
    context: emptyContext(),
    type_specific: {},
  };
}

function sourceValue(claim: string, match: RegExpMatchArray | null, value: string | null = match?.[1] || null): ProvenancedValue<string> | null {
  if (!match || !value) return null;
  return provenance(value.trim(), match[0], claim);
}

function parseAge(claim: string): AgeConstraint | null {
  const match = claim.match(/(?:(\d+)\s*(?:岁|years?)(?:以上|及以上|或以上|\s*or\s*older|\s*and\s*older)|(?:age\s*)?(\d+)\s*(?:岁|years?)\s*(?:to|至|-|–)\s*(\d+)\s*(?:岁|years?))/iu);
  if (!match) return null;
  if (match[1]) {
    return { age_min: Number(match[1]), age_max: null, min_inclusive: true, max_inclusive: null, unit: /岁/u.test(match[0]) ? 'years' : 'years', source_text: match[0], source_span: spanFor(claim, match[0]) };
  }
  return { age_min: Number(match[2]), age_max: Number(match[3]), min_inclusive: true, max_inclusive: true, unit: /岁/u.test(match[0]) ? 'years' : 'years', source_text: match[0], source_span: spanFor(claim, match[0]) };
}

function parseMeasurements(claim: string, outcome: string | null): Measurement[] {
  const measurements: Measurement[] = [];
  const patterns = [
    { regex: /(?:AUC\s*(?:为|is|=)?\s*)(\d+(?:\.\d+)?)/giu, metric: 'AUC', unit: null },
    { regex: /(?:sensitivity|敏感度|灵敏度)[^\d<>]*?(>|大于|超过|above|over|≥|>=)?\s*(\d+(?:\.\d+)?)\s*(%|％)?/giu, metric: 'sensitivity', unit: '%' },
    { regex: /(?:prevalence|患病率|incidence|发病率)[^\d约为~]*(约|approximately|about|~)?\s*(?:为|is|=)?\s*(\d+(?:\.\d+)?)\s*(%|％)?/giu, metric: outcome || 'rate', unit: '%' },
    { regex: /(?:p\s*[=<>]|p-value\s*[=<>])\s*(\d*\.\d+|\d+)/giu, metric: 'p-value', unit: null },
    { regex: /(?:ICER)\s*(?:=|为|is)?\s*([\d,.]+(?:\.\d+)?)/giu, metric: 'ICER', unit: null },
    { regex: /(?:降低|减少|increase(?:d)?|decrease(?:d)?|reduced?)[^\d]*(\d+(?:\.\d+)?)\s*(%|％)/giu, metric: outcome || 'effect', unit: '%' },
    { regex: /(?:为|is|=)\s*(\d+(?:\.\d+)?)\s*([A-Za-zμµ]+(?:\/[A-Za-z0-9μµ]+)?)/giu, metric: outcome || 'measurement', unit: null },
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(claim))) {
      const isRatePattern = pattern.regex.source.includes('prevalence|患病率|incidence|发病率');
      const numeric = pattern.metric === 'sensitivity' || isRatePattern ? match[2] : match[1];
      const value = numeric ? Number(numeric.replace(/,/g, '')) : null;
      if (value === null || !Number.isFinite(value)) continue;
      const operatorRaw = pattern.metric === 'sensitivity' ? match[1] : null;
      const approximate = isRatePattern && Boolean(match[1]);
      const unit = pattern.metric === 'sensitivity' || isRatePattern ? (match[3] || pattern.unit) : pattern.metric === outcome || pattern.metric === 'measurement' ? (match[2] || pattern.unit) : pattern.unit;
      const operator: Measurement['operator'] = approximate ? 'approx' : operatorRaw && /(?:>|大于|超过|above|over|≥|>=)/iu.test(operatorRaw) ? '>' : '=';
      measurements.push({
        metric: pattern.metric,
        value,
        unit,
        operator,
        approximate,
        relative_or_absolute: pattern.metric === 'effect' ? 'UNSPECIFIED' : 'UNSPECIFIED',
        source_text: match[0],
        source_span: spanFor(claim, match[0]),
      });
    }
  }
  return measurements;
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

function metricName(claim: string): string | null {
  const mappings: Array<[RegExp, string]> = [
    [/死亡率|mortality|death rate/iu, 'mortality'],
    [/收缩压|systolic blood pressure/iu, 'systolic blood pressure'],
    [/血压|blood pressure/iu, 'blood pressure'],
    [/严重出血|major bleeding|serious bleeding/iu, 'major bleeding risk'],
    [/疾病复发|复发|recurrence|relapse/iu, 'disease recurrence'],
    [/心肌梗死|myocardial infarction|heart attack/iu, 'myocardial infarction'],
    [/症状|symptoms?/iu, 'symptoms'],
    [/风险|risk/iu, 'risk'],
    [/患病率|prevalence/iu, 'prevalence'],
    [/发病率|incidence/iu, 'incidence'],
    [/成本效果|cost[- ]effectiveness/iu, 'cost-effectiveness'],
    [/敏感度|灵敏度|sensitivity/iu, 'sensitivity'],
    [/特异度|specificity/iu, 'specificity'],
    [/定位|locali[sz]ation/iu, 'cellular localization'],
  ];
  for (const [pattern, value] of mappings) if (pattern.test(claim)) return value;
  return null;
}

function parseOutcome(claim: string, constraints: ClaimConstraints): string | null {
  const metric = metricName(claim);
  if (!metric) return null;
  const sourceMatch = claim.match(/(?:降低|减少|升高|增加|改善|预防|预测|相关|导致|诊断|locali[sz]ed?\s+(?:in|to)|定位)[^。！？.!?，,;；]*/iu);
  const sourceText = sourceMatch?.[0] || claim.match(/(?:死亡率|血压|症状|风险|患病率|发病率|prevalence|incidence|sensitivity|specificity|敏感度|特异度|AUC|成本效果|cost[- ]effectiveness)[^。！？.!?，,;；]*/iu)?.[0] || metric;
  constraints.outcome.outcome = entity(metric, sourceText, claim, metric, 'outcome');
  constraints.outcome.direction = directionFor(claim);
  constraints.outcome.clinical_endpoint_type = metric === 'mortality' || metric === 'myocardial infarction' ? provenance(metric, sourceText, claim, 'normalized') : null;
  return metric;
}

function parsePopulation(claim: string, constraints: ClaimConstraints): void {
  const age = parseAge(claim);
  if (age) constraints.population.age = age;
  const patientMatch = claim.match(/([^，,。；;]+?)(?:患者|成年人|participants?|adults?|patients?)/iu);
  const populationLabel = claim.match(/成年人|成人|adults?|participants?|患者|patients?/iu);
  if (populationLabel) constraints.population.description = provenance(populationLabel[0], populationLabel[0], claim);
  const prevalenceDisease = claim.match(/([\u3400-\u9fffA-Za-z][^，,。；;]*?)(?=患病率|发病率|prevalence|incidence)/iu);
  const diseaseMatch = prevalenceDisease || claim.match(/(?:患者|成年人|participants?|patients?\s+with|with)\s*(?:患有|疾病)?([\u3400-\u9fffA-Za-z][^，,。；;]*)/iu);
  if (diseaseMatch) {
    const diseaseSource = (prevalenceDisease ? diseaseMatch[1] : diseaseMatch[1]).trim();
    if (diseaseSource) constraints.population.disease = provenance(diseaseSource, diseaseSource, claim, 'explicit');
  }
  const sex = claim.match(/\b(men|women|male|female|男女|男性|女性)\b/iu);
  if (sex) constraints.population.sex = provenance(sex[1], sex[0], claim);
  const stage = claim.match(/(?:stage|分期)\s*([I1VvXx一二三四]+|[A-Za-z0-9-]+)/iu);
  if (stage) constraints.population.disease_stage = provenance(stage[1], stage[0], claim);
  const subgroup = claim.match(/(?:亚组|subgroup|among|在)\s*([^，,。；;]+?)(?:中|里|among|:|：)/iu);
  if (subgroup) constraints.population.subgroup = provenance(subgroup[1].trim(), subgroup[0], claim);
}

function parseIntervention(claim: string, constraints: ClaimConstraints): void {
  const subjectClaim = claim.replace(/^与[^，,。；;]+(?:相比|compared with|relative to)\s*[，,]?\s*/iu, '');
  const subjectMatch = subjectClaim.match(/^(?:在[^，,]+[，,]\s*)?(.+?)(?=\s*(?:可以|能够|能|will|can|may|might|在|通过|相比|优于|不劣于|is|was|were|has|had|改善|降低|减少|增加|显著|可能|主要|具有|has))/iu);
  const interventionSource = subjectMatch?.[1]?.trim().replace(/^(?:if|如果|若)\s+/iu, '') || null;
  if (interventionSource && /(?:药物|治疗|疗法|干预|drug|treatment|therapy|intervention|model|检测方法|test)/iu.test(interventionSource)) {
    constraints.intervention.intervention = entity(interventionSource, interventionSource, claim, interventionSource, 'intervention');
  }
  const dose = claim.match(/(?:剂量|dose)\s*(?:为|是|=|of)?\s*([\d.]+\s*(?:mg|g|μg|mcg|毫克|克|µg)(?:\/\w+)?)?/iu);
  if (dose?.[0] && dose[1]) constraints.intervention.dose = provenance(dose[1], dose[0], claim);
  const route = claim.match(/(?:口服|静脉注射|皮下注射|oral|intravenous|IV|subcutaneous)/iu);
  if (route) constraints.intervention.route = provenance(route[0], route[0], claim);
  const frequency = claim.match(/(?:每日\s*\d+\s*次|每天|每周|once|twice|daily|weekly|bid|tid)/iu);
  if (frequency) constraints.intervention.frequency = provenance(frequency[0], frequency[0], claim);
  const duration = claim.match(/(?:持续|for|over)\s*(\d+(?:\.\d+)?)\s*(周|weeks?|个月|months?|天|days?|年|years?)/iu);
  if (duration) constraints.intervention.duration = provenance(duration[0], duration[0], claim);
}

function parseComparator(claim: string): ComparatorConstraints | null {
  const paired = claim.match(/(?:与|compared with|relative to|against)\s*([^，,。；;]+?)\s*相比?(?=\s*(?:，|,|。|;|；|$|具有|has|is|在|in|for))/iu);
  const direct = claim.match(/(?:优于|劣于|不劣于|等效于|than|versus|vs\.?)\s*([^，,。；;]+?)(?=\s*(?:，|,|。|;|；|$|在|in|for|方面|on))/iu);
  const marker = paired || direct;
  if (!marker) return null;
  let text = (paired ? paired[1] : direct?.[1] || '').trim().replace(/[。.!?]+$/u, '');
  // In "A is better than B in lowering blood pressure", retain B only.
  text = text.split(/\s+(?:in|for|on|在|于)\s+/iu)[0].trim();
  const parts = text.split(/\s*(?:和|、|and|or|及)\s*/iu).map((part) => part.trim()).filter(Boolean);
  const comparators = parts.map((part) => entity(part, part, claim, part, 'comparator')).filter((item): item is ClaimEntity => Boolean(item));
  if (comparators.length === 0) return null;
  const comparator_type = /安慰剂|placebo/iu.test(text)
    ? 'PLACEBO'
    : /标准治疗|standard care|standard treatment/iu.test(text)
      ? 'STANDARD_CARE'
      : /无干预|no intervention/iu.test(text)
        ? 'NO_INTERVENTION'
        : 'UNSPECIFIED';
  return { comparators, comparator_type, source_text: marker[0], source_span: spanFor(claim, marker[0]) };
}

function parseTemporal(claim: string, constraints: ClaimConstraints): void {
  const year = claim.match(/(?:\b(19\d{2}|20\d{2})\b年?|year\s*(19\d{2}|20\d{2}))/iu);
  if (year) {
    const value = year[1] || year[2];
    constraints.temporal.start_time = provenance(value, year[0], claim);
  }
  const follow = claim.match(/(?:治疗|after|at|following|随访|follow[- ]?up|观察)\s*(\d+(?:\.\d+)?)\s*(周|weeks?|个月|months?|天|days?|年|years?)/iu);
  if (follow) {
    constraints.temporal.follow_up = provenance(follow[0], follow[0], claim);
    constraints.temporal.observation_time = provenance(follow[0], follow[0], claim);
  }
  const timeWindow = claim.match(/(?:within|during|在|over|for)\s*(\d+(?:\.\d+)?)\s*(周|weeks?|个月|months?|天|days?|年|years?)/iu);
  if (timeWindow && !constraints.temporal.follow_up) constraints.temporal.time_window = provenance(timeWindow[0], timeWindow[0], claim);
  const future = claim.match(/(?:未来|next|within the next)\s*(\d+(?:\.\d+)?|一|两|二|三|四|五|六|七|八|九|十)\s*(周|weeks?|个月|months?|天|days?|年|years?)/iu);
  if (future) constraints.temporal.time_window = provenance(future[0], future[0], claim);
}

function parseContext(claim: string, constraints: ClaimConstraints): void {
  const geography = claim.match(/(?:在|in|from)\s*([^，,。；;]+?)(?:地区|region|area|among|中|的成年人|adult|$)/iu) || claim.match(/([\u3400-\u9fffA-Za-z0-9 -]+地区)/iu);
  if (geography?.[1]) {
    const value = geography[1].trim().replace(/^[\d\s年月]+/u, '');
    constraints.context.geography = provenance(value, geography[0], claim);
  }
  const setting = claim.match(/(?:医院|社区|基层|hospital|community|primary care|clinical setting|laboratory|实验室)/iu);
  if (setting) constraints.context.healthcare_setting = provenance(setting[0], setting[0], claim);
}

function parseStatistical(claim: string, constraints: ClaimConstraints, measurements: Measurement[]): void {
  const p = measurements.find((item) => item.metric === 'p-value');
  if (p) constraints.statistical.p_value = p.value;
  const auc = measurements.find((item) => item.metric === 'AUC');
  if (auc) constraints.statistical.effect_measure = provenance('AUC', auc.source_text, claim, 'normalized');
  const ci = claim.match(/(?:95%\s*)?(?:CI|置信区间|confidence interval)\s*[:=]?\s*\(?\s*([\d.]+)\s*[,–-]\s*([\d.]+)\s*\)?/iu);
  if (ci) constraints.statistical.confidence_interval = { lower: Number(ci[1]), upper: Number(ci[2]), level: /95/iu.test(ci[0]) ? 95 : null, source_text: ci[0] };
  const margin = claim.match(/(?:margin|界值|界限)\s*(?:of|为|是|=)?\s*([\d.]+\s*%?)/iu);
  if (margin) {
    if (/(?:不劣|non[- ]?inferiority)/iu.test(claim)) constraints.statistical.non_inferiority_margin = Number.parseFloat(margin[1]);
    if (/(?:等效|equivalence)/iu.test(claim)) constraints.statistical.equivalence_margin = Number.parseFloat(margin[1]);
  }
}

function classify(claim: string): { primary: ClaimTypeId; secondary: ClaimTypeId[]; rationale: string; status: AtomicClaim['classification_status'] } {
  const tests: Array<{ type: ClaimTypeId; pattern: RegExp; reason: string }> = [
    { type: 'T07', pattern: /通过|机制|通路|抑制|激活|mediates?|mechanism|pathway|inhibit|activate|via/iu, reason: 'The claim explicitly describes a biological mechanism or pathway.' },
    { type: 'T10', pattern: /成本效果|成本效益|经济学|cost[- ]effectiveness|cost[- ]utility|ICER|QALY/iu, reason: 'The claim contains a health-economic outcome or metric.' },
    { type: 'T03', pattern: /诊断|检测方法|敏感度|特异度|sensitivity|specificity|diagnos/iu, reason: 'The claim concerns a diagnostic method or diagnostic performance.' },
    { type: 'T05', pattern: /预测|预测模型|AUC|predict|forecast|risk model/iu, reason: 'The claim describes prediction or predictive performance.' },
    { type: 'T06', pattern: /患病率|发病率|疾病负担|prevalence|incidence|epidemiolog|disease burden/iu, reason: 'The claim describes a population-level epidemiological quantity.' },
    { type: 'T08', pattern: /蛋白|基因|受体|定位|表达|结合|protein|gene|receptor|locali[sz]ed|expressed|binds?/iu, reason: 'The claim describes a biological entity or property.' },
    { type: 'T09', pattern: /生物标志物|标志物|量表|测量|biomarker|measurement|scale/iu, reason: 'The claim concerns a biomarker, measurement, or scale.' },
    { type: 'T11', pattern: /指南|依从性|实施|医疗实践|患者体验|adherence|implementation|guideline|healthcare practice|experience/iu, reason: 'The claim concerns healthcare practice, implementation, or experience.' },
    { type: 'T12', pattern: /随机对照|队列研究|病例对照|方法学|研究设计|randomi[sz]ed|cohort|case[- ]control|methodolog|study design/iu, reason: 'The claim describes a study or analytical method.' },
    { type: 'T02', pattern: /相关|关联|导致|引起|风险|associated?|related|correlat|cause|lead to|risk/iu, reason: 'The claim describes an association, causal statement, or risk relationship.' },
    { type: 'T01', pattern: /药物|治疗|疗法|干预|预防|drug|treatment|therapy|intervention|prevent/iu, reason: 'The claim describes an intervention, treatment effect, or safety outcome.' },
    { type: 'T04', pattern: /预后|生存|进展|复发|prognos|survival|progression|relapse|recurrence/iu, reason: 'The claim describes prognosis or disease course.' },
  ];
  const matches = tests.filter((item) => item.pattern.test(claim));
  if (matches.length === 0) return { primary: 'UNKNOWN', secondary: [], rationale: 'The text does not contain enough explicit domain cues for a stable base semantic type.', status: 'unknown' };
  // Intervention wins when the claim explicitly names a treatment, except for
  // an explicitly mechanistic sentence where mechanism is the requested fact.
  const primaryMatch = matches.find((item) => item.type === 'T07')
    || matches.find((item) => item.type === 'T10')
    || matches.find((item) => item.type === 'T03')
    || matches.find((item) => item.type === 'T05')
    || matches.find((item) => item.type === 'T06')
    || matches.find((item) => item.type === 'T11')
    || matches.find((item) => item.type === 'T12')
    || matches.find((item) => item.type === 'T04')
    || matches.find((item) => item.type === 'T08')
    || matches.find((item) => item.type === 'T09')
    || matches.find((item) => item.type === 'T01')
    || matches.find((item) => item.type === 'T02')
    || matches[0];
  const secondary = matches.filter((item) => item.type !== primaryMatch.type).map((item) => item.type);
  return { primary: primaryMatch.type, secondary, rationale: primaryMatch.reason, status: matches.length > 1 ? 'ambiguous' : 'certain' };
}

function relationFor(claim: string): AtomicClaim['relation'] {
  if (/(?:通过|via|through|mechanism|pathway|mediates?|抑制|激活)/iu.test(claim)) return 'MECHANISM';
  if (/(?:预测|predict|forecast)/iu.test(claim)) return 'PREDICTION';
  if (/(?:属性|定位|表达|结合|locali[sz]ed|expressed|binds?)/iu.test(claim)) return 'ATTRIBUTE';
  if (/(?:相关|关联|associated?|related|correlat)/iu.test(claim) && !/(?:导致|引起|cause|lead to)/iu.test(claim)) return 'ASSOCIATION';
  if (/(?:导致|引起|造成|cause|leads? to|results? in)/iu.test(claim)) return 'CAUSATION';
  if (/(?:优于|劣于|不劣于|等效|相比|compared|versus|\bvs\.?\b|better than|worse than)/iu.test(claim)) return 'COMPARISON';
  if (/(?:约|approximately|about|超过|大于|more than|less than|AUC|p\s*[=<>]|敏感度|患病率|prevalence|incidence)/iu.test(claim)) return 'QUANTIFICATION';
  return 'EFFECT';
}

function operatorsFor(claim: string): ClaimOperator[] {
  const operators: ClaimOperator[] = [];
  const add = (operator: ClaimOperator, pattern: RegExp) => { if (pattern.test(claim) && !operators.includes(operator)) operators.push(operator); };
  add('SUPERIORITY', /优于|更有效|更好|better than|superior to|greater than|more cost[- ]effective/iu);
  add('INFERIORITY', /(?<!不)劣于|较差|worse than|inferior to/iu);
  add('NON_INFERIORITY', /不劣于|non[- ]?inferior/iu);
  add('EQUIVALENCE', /等效|等价|equivalent|equivalence/iu);
  add('NON_SIGNIFICANT_RESULT', /未观察到统计学显著|统计学不显著|not statistically significant|no statistically significant/iu);
  add('NULL_EFFECT', /无效应|没有效果|完全无效|no effect|no benefit|no difference/iu);
  add('THRESHOLD', /超过|大于|至少|高于|少于|低于|>|>=|<|<=|over|above|more than|less than/iu);
  add('NEGATION', /\bnot\b|\bno\b|未(?:观察到|见|发现|能|曾|达到|提供)|不会|没有|无(?:效应|效果|获益|变化)/iu);
  add('CONDITIONAL', /在.+(?:中|内)|among|if|when|provided that|条件下/iu);
  add('TEMPORAL', /\d+\s*(?:周|天|个月|年|weeks?|days?|months?|years?)|after|before|during|follow[- ]?up|随访|未来|next/iu);
  add('DOSE_RESPONSE', /剂量反应|剂量依赖|dose[- ]response|dose[- ]dependent/iu);
  add('INTERACTION', /交互|相互作用|interaction|interacts?/iu);
  add('MEDIATION', /通过|介导|中介|mediates?|through|via/iu);
  add('SUBGROUP_DIFFERENCE', /亚组差异|亚组|subgroup|effect modification/iu);
  // A non-significant report is not a null-effect claim. Remove a broad
  // negation hit caused only by "未观察到" so the distinction is explicit.
  if (operators.includes('NON_SIGNIFICANT_RESULT') && /未观察到统计学显著|not statistically significant/iu.test(claim)) {
    const hasIndependentNegation = /(?:不会|不增加|不降低|does not|doesn't|no effect|no benefit)/iu.test(claim);
    if (!hasIndependentNegation) operators.splice(operators.indexOf('NEGATION'), 1);
  }
  return operators;
}

function polarityFor(claim: string, operators: ClaimOperator[]): AtomicClaim['polarity'] {
  if (/(?:不会|不增加|不降低|does not|doesn't|not increase|not decrease|no effect)/iu.test(claim)) return 'NEGATED';
  if (operators.includes('NEGATION') && !operators.includes('NON_SIGNIFICANT_RESULT')) return 'NEGATED';
  return 'AFFIRMED';
}

function quantifierFor(claim: string): AtomicClaim['quantifier'] {
  if (/\b(?:all|every|each)\b|所有|每个|全部/iu.test(claim)) return 'ALL';
  if (/\b(?:some|a subset)\b|一些|部分/iu.test(claim)) return 'SOME';
  if (/\b(?:most|majority)\b|大多数|多数/iu.test(claim)) return 'MOST';
  if (/\b(?:average|mean|population[- ]level)\b|平均|总体/iu.test(claim)) return 'AVERAGE';
  if (/患病率|发病率|风险|prevalence|incidence|risk/iu.test(claim)) return 'POPULATION_LEVEL';
  return 'UNSPECIFIED';
}

function modalityFor(claim: string): AtomicClaim['modality'] {
  if (/可能|或许|may|might|possibly|could/iu.test(claim)) return 'POSSIBLE';
  if (/很可能|大概|likely|probably/iu.test(claim)) return 'PROBABLE';
  if (/假设|假定|hypothetical|if we assume/iu.test(claim)) return 'HYPOTHETICAL';
  if (/研究报告|据报道|reported|study reports?/iu.test(claim)) return 'REPORTED';
  return 'ASSERTED';
}

function shiftNestedSpans(value: unknown, offset: number, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.forEach((item) => shiftNestedSpans(item, offset, seen));
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.start === 'number' && typeof record.end === 'number' && typeof record.text === 'string') {
    record.start += offset;
    record.end += offset;
  }
  Object.values(record).forEach((item) => shiftNestedSpans(item, offset, seen));
}

function parseOne(clause: Clause, originalClaim: string): AtomicClaim {
  const claim = clause.text;
  const classification = classify(claim);
  const constraints = emptyConstraints();
  parsePopulation(claim, constraints);
  parseIntervention(claim, constraints);
  const outcome = parseOutcome(claim, constraints);
  constraints.comparator = parseComparator(claim);
  parseTemporal(claim, constraints);
  parseContext(claim, constraints);
  const measurements = parseMeasurements(claim, outcome);
  parseStatistical(claim, constraints, measurements);

  const operators = operatorsFor(claim);
  const relation = relationFor(claim);
  const subjectText = constraints.intervention.intervention?.source_text || claim.match(/^(?:在[^，,]+[，,]\s*)?([^，,]+?)(?=\s*(?:可以|能够|能|will|can|may|通过|与|相比|优于|不劣于|相关|导致|位于|定位|主要|可能))/iu)?.[1]?.trim() || null;
  const subject = constraints.intervention.intervention || entity(subjectText, subjectText, claim, subjectText, 'subject');
  const predicateText = relation === 'ATTRIBUTE' ? claim.match(/(?:定位于|位于|表达于|locali[sz]ed?\s+(?:in|to)|expressed)\s*([^。！？.!?]+)$/iu)?.[0] || null : claim.match(/(?:降低|减少|升高|增加|改善|预测|相关|导致|抑制|激活|can|may|可能)\s*([^。！？.!?]+)$/iu)?.[0] || null;
  const predicate = entity(predicateText ? normalized(predicateText) : null, predicateText, claim, predicateText ? normalized(predicateText) : null, 'predicate');
  const object = constraints.outcome.outcome || (relation === 'MECHANISM' ? entity(claim.match(/(?:通路|pathway)\s*([A-Za-z0-9_-]+)/iu)?.[1] || null, claim.match(/(?:通路|pathway)\s*([A-Za-z0-9_-]+)/iu)?.[0] || null, claim, null, 'mechanism') : null);
  const unresolved_fields: string[] = [];
  if (classification.primary === 'UNKNOWN') unresolved_fields.push('primary_type');
  if ((classification.primary === 'T01' || relation === 'COMPARISON') && !constraints.outcome.outcome) unresolved_fields.push('outcome');
  if (relation === 'COMPARISON' && !constraints.comparator) unresolved_fields.push('comparator');
  if ((operators.includes('NON_INFERIORITY') || operators.includes('EQUIVALENCE')) && !constraints.comparator) unresolved_fields.push('comparator');
  if (operators.includes('NON_INFERIORITY') && constraints.statistical.non_inferiority_margin === null) unresolved_fields.push('non_inferiority_margin');
  if (operators.includes('EQUIVALENCE') && constraints.statistical.equivalence_margin === null) unresolved_fields.push('equivalence_margin');
  if (operators.includes('NON_SIGNIFICANT_RESULT')) unresolved_fields.push('significance_definition');
  if (/(?:显著|significant)/iu.test(claim) && !measurements.some((item) => item.metric === 'p-value')) unresolved_fields.push('significance_definition');
  if (relation === 'QUANTIFICATION' && measurements.length === 0) unresolved_fields.push('measurement_value');

  const warnings: string[] = [];
  if (operators.includes('NON_SIGNIFICANT_RESULT')) warnings.push('NON_SIGNIFICANT_RESULT does not establish NULL_EFFECT or EQUIVALENCE.');
  if (relation === 'ASSOCIATION') warnings.push('Association was preserved as ASSOCIATION; no causal direction was inferred.');
  if (relation === 'CAUSATION' && /(?:相关|associated?|related|correlat)/iu.test(claim)) warnings.push('The text contains both association and causal cues; causal scope needs review.');
  if (operators.includes('NEGATION') && operators.includes('NON_SIGNIFICANT_RESULT')) warnings.push('Negation scope was limited to the statistical-significance report, not the existence of an effect.');
  if (constraints.outcome.outcome && /(?:显著|significant)/iu.test(claim) && !measurements.some((item) => item.metric === 'p-value')) warnings.push('The claim uses significance language without an explicit statistical threshold or p-value.');

  const parsed: AtomicClaim = {
    id: `AC-${String(clause.start + 1).padStart(4, '0')}`,
    original_text: claim,
    normalized_statement: normalized(claim),
    source_span: { start: 0, end: claim.length, text: claim },
    primary_type: classification.primary,
    secondary_types: classification.secondary,
    classification_status: classification.status,
    classification_rationale: classification.rationale,
    subject,
    predicate,
    object,
    relation,
    operators,
    polarity: polarityFor(claim, operators),
    quantifier: quantifierFor(claim),
    modality: modalityFor(claim),
    constraints,
    measurements,
    unresolved_fields,
    warnings,
  };
  shiftNestedSpans(parsed, clause.start);
  return parsed;
}

function mergeGlobalConstraints(atomicClaims: AtomicClaim[]): ClaimConstraints {
  const global = emptyConstraints();
  if (atomicClaims.length === 0) return global;
  const first = atomicClaims[0].constraints;
  // Only copy constraints that are explicit in every atomic claim. This
  // prevents a condition attached to one clause from leaking to its sibling.
  global.population = first.population;
  global.temporal = first.temporal;
  global.context = first.context;
  return global;
}

export function deterministicParseClaim(claim: string, now = new Date()): StructuredClaim {
  const parsedClauses = splitClauses(claim);
  const atomicClaims = parsedClauses.clauses.map((clause) => parseOne(clause, claim));
  if (atomicClaims.length > 1 && atomicClaims[0].primary_type === 'T01') {
    const sharedSubject = atomicClaims[0].subject;
    const sharedIntervention = atomicClaims[0].constraints.intervention.intervention;
    for (const atomic of atomicClaims.slice(1)) {
      if (atomic.primary_type === 'T02' && !atomic.secondary_types.includes('T02')) atomic.secondary_types.push('T02');
      if (atomic.primary_type === 'T02') {
        atomic.primary_type = 'T01';
        atomic.classification_status = 'ambiguous';
        atomic.classification_rationale = 'The clause is an intervention outcome/safety statement sharing the intervention from the compound claim.';
      }
      if (!atomic.subject && sharedSubject) atomic.subject = sharedSubject;
      if (!atomic.constraints.intervention.intervention && sharedIntervention) atomic.constraints.intervention.intervention = sharedIntervention;
    }
  }
  const warnings: string[] = [];
  const unresolved_fields: string[] = [];
  if (atomicClaims.length === 0) {
    warnings.push('The claim contains no non-whitespace text.');
    unresolved_fields.push('claim_text');
  }
  for (const atomic of atomicClaims) {
    warnings.push(...atomic.warnings);
    unresolved_fields.push(...atomic.unresolved_fields.map((field) => `${atomic.id}.${field}`));
  }
  const composition: CompositionNode[] = atomicClaims.length > 1 && parsedClauses.operator
    ? [{ operator: parsedClauses.operator, members: atomicClaims.map((atomic) => atomic.id), source_text: claim, source_span: { start: 0, end: claim.length, text: claim }, scope: null }]
    : [];
  const parseStatus: StructuredClaim['parse_status'] = atomicClaims.length === 0 || atomicClaims.some((atomic) => atomic.primary_type === 'UNKNOWN') ? 'needs_review' : unresolved_fields.length > 0 ? 'needs_review' : 'success';
  return {
    schema_version: CLAIM_SCHEMA_VERSION,
    original_claim: claim,
    language: languageOf(claim),
    parse_status: parseStatus,
    atomic_claims: atomicClaims,
    composition,
    global_constraints: mergeGlobalConstraints(atomicClaims),
    unresolved_fields: Array.from(new Set(unresolved_fields)),
    warnings: Array.from(new Set(warnings)),
    parser_metadata: {
      parser_version: CLAIM_PARSER_VERSION,
      schema_version: CLAIM_SCHEMA_VERSION,
      method: 'deterministic',
      model_name: null,
      attempts: 0,
      model_error: null,
      validation_errors: [],
      created_at: now.toISOString(),
    },
  };
}
