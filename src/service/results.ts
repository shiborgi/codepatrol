import type { z } from "zod";
import { CodePatrolError, ERROR_CODES, zodIssues } from "../errors.js";
import {
  buildResultSchema,
  buildReviewSchema,
  documentReviewSchema,
  type Operation,
  planDocumentSchema,
  specDocumentSchema,
} from "../schemas.js";

export type ParsedResult =
  | z.infer<typeof specDocumentSchema>
  | z.infer<typeof planDocumentSchema>
  | z.infer<typeof buildResultSchema>
  | z.infer<typeof documentReviewSchema>
  | z.infer<typeof buildReviewSchema>;

export function parseResult(operation: Operation, raw: unknown): ParsedResult {
  const schema =
    operation === "spec"
      ? specDocumentSchema
      : operation === "plan"
        ? planDocumentSchema
        : operation === "build"
          ? buildResultSchema
          : operation === "build-review"
            ? buildReviewSchema
            : documentReviewSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new CodePatrolError(ERROR_CODES.INVALID_RESULT, zodIssues(parsed.error), 2);
  }
  return parsed.data;
}

export function resultAs<T extends z.ZodTypeAny>(
  value: unknown,
  schema: T,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CodePatrolError(
      ERROR_CODES.INTERNAL,
      "validated result does not match its schema",
    );
  }
  return parsed.data;
}
