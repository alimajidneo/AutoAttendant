export class ProviderWriteRejectedError extends Error {
  constructor() { super("Provider rejected the calendar write"); this.name = "ProviderWriteRejectedError"; }
}

const DEFINITE_REJECTION_STATUSES = new Set([400, 401, 403, 404, 405, 410, 422]);

/** A 5xx/timeout-like response may follow a write that actually succeeded. */
export function providerWriteError(status: number): Error {
  return DEFINITE_REJECTION_STATUSES.has(status)
    ? new ProviderWriteRejectedError()
    : new Error("Provider calendar write outcome is unknown");
}
