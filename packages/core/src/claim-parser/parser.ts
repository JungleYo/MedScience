import { ModelProvider } from '../client/ModelProvider.js';
import { ModelRequest } from '../types/model.js';
import { deterministicParseClaim } from './deterministic.js';
import {
  CLAIM_PARSER_VERSION,
  CLAIM_SCHEMA_VERSION,
  CLAIM_STRUCTURED_OUTPUT_SCHEMA,
  ClaimParserOptions,
  ParserMetadata,
  StructuredClaim,
} from './schema.js';
import { buildClaimParserRepairPrompt, CLAIM_PARSER_SYSTEM_PROMPT } from './prompt.js';
import { extractJsonObject, validateStructuredClaim } from './validation.js';

const MODEL_TOOL_NAME = 'parse_structured_claim';

export const CLAIM_STRUCTURED_OUTPUT_TOOL = {
  name: MODEL_TOOL_NAME,
  description: 'Parse a biomedical claim into MedScience Claim Structured Parser schema without verifying it.',
  parameters: CLAIM_STRUCTURED_OUTPUT_SCHEMA,
  strict: true,
};

function assertClaimInput(claim: string): void {
  if (typeof claim !== 'string') throw new TypeError('Claim must be a string.');
}

function setMetadata(result: StructuredClaim, metadata: Partial<ParserMetadata>): StructuredClaim {
  return {
    ...result,
    parser_metadata: { ...result.parser_metadata, ...metadata },
  };
}

function semanticValidation(result: StructuredClaim): string[] {
  const errors: string[] = [];
  const ids = new Set(result.atomic_claims.map((claim) => claim.id));
  for (const [index, composition] of result.composition.entries()) {
    for (const member of composition.members) if (!ids.has(member)) errors.push(`composition[${index}] references unknown atomic claim ${member}`);
  }
  for (const [index, atomic] of result.atomic_claims.entries()) {
    if (atomic.operators.includes('NON_SIGNIFICANT_RESULT') && atomic.operators.includes('NULL_EFFECT')) {
      errors.push(`atomic_claims[${index}] confuses NON_SIGNIFICANT_RESULT with NULL_EFFECT`);
    }
    if (atomic.modality === 'POSSIBLE' && atomic.polarity === 'AFFIRMED' && /(?:proven|confirmed|已证实|证实)/iu.test(atomic.original_text)) {
      errors.push(`atomic_claims[${index}] has conflicting possible/confirmed wording`);
    }
  }
  return errors;
}

function extractModelObject(response: { content: string; toolCalls?: Array<{ name: string; arguments: Record<string, any> }> }): { value?: unknown; raw: string } {
  const toolCall = response.toolCalls?.find((call) => call.name === MODEL_TOOL_NAME);
  if (toolCall) {
    const value = typeof toolCall.arguments === 'string' ? extractJsonObject(toolCall.arguments) : toolCall.arguments;
    return { value, raw: typeof toolCall.arguments === 'string' ? toolCall.arguments : JSON.stringify(toolCall.arguments) };
  }
  const raw = response.content || '';
  return { value: extractJsonObject(raw), raw };
}

function failedResult(claim: string, errors: string[], now: Date, modelName: string | null, attempts: number): StructuredClaim {
  const result = deterministicParseClaim(claim, now);
  return {
    ...result,
    parse_status: 'failed',
    warnings: Array.from(new Set([...result.warnings, 'Structured model parsing failed; no model output was accepted.'])),
    unresolved_fields: Array.from(new Set([...result.unresolved_fields, 'structured_parse'])),
    parser_metadata: {
      ...result.parser_metadata,
      method: 'model',
      model_name: modelName,
      attempts,
      model_error: errors.join('; '),
      validation_errors: errors,
    },
  };
}

export class ClaimParser {
  private readonly options: ClaimParserOptions;

  public constructor(options: ClaimParserOptions = {}) {
    this.options = { fallbackToDeterministic: true, maxModelAttempts: 2, ...options };
  }

  /** Synchronous, API-free parse used for local workflows and unit tests. */
  public parseClaim(claim: string): StructuredClaim {
    assertClaimInput(claim);
    return deterministicParseClaim(claim, this.options.now?.() || new Date());
  }

  /** Alias for callers that prefer a short method name. */
  public parse(claim: string): StructuredClaim {
    return this.parseClaim(claim);
  }

  /**
   * Optional model-assisted parse. The provider is the same ModelProvider used
   * by the rest of MedScience; no second client or credential path is created.
   */
  public async parseClaimAsync(claim: string): Promise<StructuredClaim> {
    assertClaimInput(claim);
    const now = this.options.now?.() || new Date();
    if (!claim.trim()) {
      return this.options.fallbackToDeterministic === false
        ? failedResult(claim, ['Claim text is empty.'], now, null, 0)
        : deterministicParseClaim(claim, now);
    }
    const provider = this.options.modelProvider;
    if (!provider) return deterministicParseClaim(claim, now);

    let modelName = this.options.model || provider.name || 'claim-parser';
    try {
      if (!this.options.model) {
        const models = await provider.listModels();
        if (models[0]) modelName = models[0];
      }
    } catch {
      // A provider may not implement model discovery reliably. The provider's
      // stable name still gives the request a useful model field.
    }

    const maxAttempts = Math.max(1, Math.min(3, this.options.maxModelAttempts || 2));
    const errors: string[] = [];
    let previousRaw = '';
    let repairErrors: string[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const request: ModelRequest = {
        model: modelName,
        messages: attempt === 1
          ? [
              { role: 'system', content: CLAIM_PARSER_SYSTEM_PROMPT },
              { role: 'user', content: claim },
            ]
          : [
              { role: 'system', content: CLAIM_PARSER_SYSTEM_PROMPT },
              { role: 'user', content: buildClaimParserRepairPrompt(claim, repairErrors, previousRaw) },
            ],
        tools: [CLAIM_STRUCTURED_OUTPUT_TOOL],
        toolChoice: { name: MODEL_TOOL_NAME },
        temperature: 0,
        maxTokens: 12000,
      };
      try {
        const response = await provider.generate(request);
        const extracted = extractModelObject(response);
        previousRaw = extracted.raw;
        if (extracted.value === undefined) {
          repairErrors = ['Model output did not contain a valid JSON object.'];
          errors.push(`attempt ${attempt}: ${repairErrors[0]}`);
          continue;
        }
        const validation = validateStructuredClaim(extracted.value);
        if (!validation.valid || !validation.value) {
          repairErrors = validation.errors;
          errors.push(...validation.errors.map((error) => `attempt ${attempt}: ${error}`));
          continue;
        }
        if (validation.value.original_claim !== claim) {
          repairErrors = ['original_claim must equal the input claim exactly.'];
          errors.push(`attempt ${attempt}: ${repairErrors[0]}`);
          continue;
        }
        const semanticErrors = semanticValidation(validation.value);
        if (semanticErrors.length > 0) {
          repairErrors = semanticErrors;
          errors.push(...semanticErrors.map((error) => `attempt ${attempt}: ${error}`));
          continue;
        }
        return setMetadata(validation.value, {
          schema_version: CLAIM_SCHEMA_VERSION,
          parser_version: CLAIM_PARSER_VERSION,
          method: 'model',
          model_name: modelName,
          attempts: attempt,
          model_error: null,
          validation_errors: [],
          created_at: now.toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        repairErrors = [`Model service unavailable: ${message}`];
        errors.push(`attempt ${attempt}: ${repairErrors[0]}`);
      }
    }

    if (this.options.fallbackToDeterministic !== false) {
      const fallback = deterministicParseClaim(claim, now);
      return {
        ...fallback,
        parse_status: fallback.parse_status === 'failed' ? 'failed' : 'needs_review',
        warnings: Array.from(new Set([...fallback.warnings, 'Model-assisted parsing was not accepted; deterministic parsing was used as a reviewable fallback.'])),
        parser_metadata: {
          ...fallback.parser_metadata,
          method: 'model_with_deterministic_fallback',
          model_name: modelName,
          attempts: maxAttempts,
          model_error: errors.join('; '),
          validation_errors: errors,
        },
      };
    }
    return failedResult(claim, errors, now, modelName, maxAttempts);
  }

  public async parseAsync(claim: string): Promise<StructuredClaim> {
    return this.parseClaimAsync(claim);
  }
}

export function parseClaim(claim: string, options: ClaimParserOptions = {}): StructuredClaim {
  return new ClaimParser(options).parseClaim(claim);
}

export function parse_claim(claim: string, options: ClaimParserOptions = {}): StructuredClaim {
  return parseClaim(claim, options);
}

export async function parseClaimAsync(claim: string, options: ClaimParserOptions = {}): Promise<StructuredClaim> {
  return new ClaimParser(options).parseClaimAsync(claim);
}

export async function parse_claim_async(claim: string, options: ClaimParserOptions = {}): Promise<StructuredClaim> {
  return parseClaimAsync(claim, options);
}
