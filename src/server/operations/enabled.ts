import "server-only";
import { HttpError } from "../errors";
export const operationsEnabled = () => process.env.ENABLE_OPERATIONS === "true";
export function requireOperations() {
  if (!operationsEnabled())
    throw new HttpError(
      503,
      "Operations are awaiting the approved inventory migration. Existing catalogue management remains available.",
    );
}
