import { ClaimParser, parseClaim, validateStructuredClaim, StructuredClaim } from '../src/index.js';

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function run(): Promise<void> {
  const notAll = parseClaim('并非所有接受药物A治疗的患者都获益。');
  assertTrue(notAll.atomic_claims[0]?.quantifier === 'NOT_ALL', 'NOT ALL is represented as a quantifier');
  assertTrue(notAll.atomic_claims[0]?.negation_scope?.target === 'QUANTIFIER', 'NOT ALL negation scope targets the quantifier');

  const nested = parseClaim('药物A或者药物B有效，但不能断定二者都有效。');
  assertTrue(nested.logical_tree.nodes.some((node) => node.operator === 'OR'), 'nested OR is present');
  assertTrue(nested.logical_tree.nodes.some((node) => node.operator === 'NOT' && node.epistemic_scope === 'INSUFFICIENT_EVIDENCE'), 'epistemic NOT is scoped separately');

  const scoped = parseClaim('在65岁以上的患者中，药物A能够降低卒中风险。');
  assertTrue(scoped.global_constraints.population.description === null, 'local population does not leak to global constraints');
  assertTrue(scoped.atomic_claims[0]?.constraints.conditions.some((item) => item.parameter === 'age' && item.value === 65) === true, 'age condition is explicit');
  assertTrue(scoped.atomic_claims[0]?.constraints.context.geography === null, 'age subgroup is not geography');

  const valid = parseClaim('药物A可能降低死亡率。');
  const dangling = JSON.parse(JSON.stringify(valid)) as StructuredClaim;
  dangling.logical_tree.nodes[0].child_ids = ['missing-node'];
  assertTrue(!validateStructuredClaim(dangling).valid, 'dangling logical-tree references are rejected');
  const invalidP = JSON.parse(JSON.stringify(valid)) as StructuredClaim;
  invalidP.atomic_claims[0].constraints.statistical.p_value = 1.2;
  assertTrue(!validateStructuredClaim(invalidP).valid, 'p-values outside [0, 1] are rejected');
  const invalidSpan = JSON.parse(JSON.stringify(valid)) as StructuredClaim;
  invalidSpan.atomic_claims[0].source_span.text = 'not the source';
  assertTrue(!validateStructuredClaim(invalidSpan).valid, 'source span mismatches are rejected');

  const fallback = await new ClaimParser({ mode: 'model-assisted', now: () => new Date('2026-01-01T00:00:00.000Z') }).parseClaimAsync('药物A可能降低死亡率。');
  assertTrue(fallback.parser_metadata.requested_mode === 'model-assisted', 'requested parser mode is recorded');
  assertTrue(fallback.parser_metadata.actual_method === 'deterministic-fallback' && fallback.parser_metadata.fallback_used, 'missing provider is an explicit fallback');
  assertTrue(fallback.parse_status === 'needs_review', 'model fallback is reviewable');

  console.log('✔ Claim Structured Parser v2 tests passed');
}

run().catch((error) => { console.error('✖ Claim Structured Parser v2 tests failed:', error); process.exit(1); });
