import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from '../scheduling-api.js';

/** A successful result. The model reads the JSON text. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** A failed result. The message is a plain sentence the model can act on. */
export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * Turns any error from the API into a result for the model.
 * Expected errors pass their sentence through. Unexpected errors are logged
 * to stderr for you, and the model gets a short sentence with no internals.
 */
export function toErrorResult(error: unknown): CallToolResult {
  if (error instanceof ApiError) {
    return errorResult(error.message);
  }

  console.error('Unexpected error in a tool call:', error);
  return errorResult(
    'The scheduling service failed unexpectedly. Try once more. If it fails again, tell the user that the tool is not available right now.',
  );
}

export function shorten(text: string, maxLength = 140) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
