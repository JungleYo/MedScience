import { CLAIM_STRUCTURED_OUTPUT_SCHEMA, CLAIM_SCHEMA_VERSION } from './schema.js';

/** Prompt text is kept separate from orchestration so it can evolve without
 * changing the parser's validation or deterministic fallback. */
export const CLAIM_PARSER_SYSTEM_PROMPT = `You are MedScience's biomedical claim parser.

Parse the user's text only. Do not verify truth, add medical facts, search for evidence, infer missing comparators/doses/times, or turn association into causation. Preserve uncertainty and the scope of negation. Split independent conclusions into atomic_claims, but keep mechanism chains, comparisons, and conditionals semantically connected.

Return exactly one structured object using the parse_structured_claim tool. Every extracted value must retain source_text and an exact source_span into original_claim. Use null plus unresolved_fields when the source does not specify a value. NON_SIGNIFICANT_RESULT is not NULL_EFFECT or EQUIVALENCE. The parser is not a verifier and does not generate counter-evidence.

The output schema version is ${CLAIM_SCHEMA_VERSION}.
Tool schema:
${JSON.stringify(CLAIM_STRUCTURED_OUTPUT_SCHEMA)}`;

export function buildClaimParserRepairPrompt(originalClaim: string, errors: string[], rawOutput: string): string {
  return `Repair the structured parse for the exact original claim below. Return only a fresh parse_structured_claim tool call. Do not invent missing scientific details.

Original claim:
${originalClaim}

Validation errors:
${errors.map((error) => `- ${error}`).join('\n')}

Previous output (untrusted; do not copy invalid enum values blindly):
${rawOutput.slice(0, 12000)}`;
}
