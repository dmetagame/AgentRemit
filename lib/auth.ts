import {
  getAddress,
  isAddress,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";

export type SignedActionName =
  | "agent:deploy"
  | "agent:control"
  | "ens:register"
  | "ens:update_stats";

export type SignedActionRequest<TPayload> = {
  action: SignedActionName;
  payload: TPayload;
  signedAt: string;
  nonce: string;
  signature: Hex;
};

type BuildSignedActionMessageInput = {
  action: SignedActionName;
  payload: unknown;
  signedAt: string;
  nonce: string;
};

const SIGNED_ACTION_MESSAGE_PREFIX = "AgentRemit privileged action";
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const NONCE_RETENTION_MS = 10 * 60 * 1000;
const seenNonces = new Map<string, number>();

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function createSignedActionRequest<TPayload>(
  action: SignedActionName,
  payload: TPayload,
  signature: Hex,
  options?: { signedAt?: string; nonce?: string },
): SignedActionRequest<TPayload> {
  return {
    action,
    payload,
    signedAt: options?.signedAt ?? new Date().toISOString(),
    nonce: options?.nonce ?? createNonce(),
    signature,
  };
}

export function buildSignedActionMessage({
  action,
  payload,
  signedAt,
  nonce,
}: BuildSignedActionMessageInput): string {
  return [
    SIGNED_ACTION_MESSAGE_PREFIX,
    `Action: ${action}`,
    `Signed At: ${signedAt}`,
    `Nonce: ${nonce}`,
    "Payload:",
    canonicalStringify(payload),
  ].join("\n");
}

export async function verifySignedAction<TPayload>(
  request: unknown,
  expectedAction: SignedActionName,
): Promise<{ payload: TPayload; signerAddress: Address }> {
  if (!isSignedActionRequest(request)) {
    throw new AuthError("Signed wallet authorization is required.");
  }

  if (request.action !== expectedAction) {
    throw new AuthError(`Expected signed action ${expectedAction}.`, 400);
  }

  assertFreshSignature(request.signedAt);

  const message = buildSignedActionMessage({
    action: request.action,
    payload: request.payload,
    signedAt: request.signedAt,
    nonce: request.nonce,
  });
  let signerAddress: Address;

  try {
    signerAddress = await recoverMessageAddress({
      message,
      signature: request.signature,
    });
  } catch {
    throw new AuthError("Invalid wallet signature.", 401);
  }

  assertNonceUnused(signerAddress, request.action, request.nonce);

  return {
    payload: request.payload as TPayload,
    signerAddress,
  };
}

export function addressesEqual(left: string, right: string): boolean {
  if (!isAddress(left) || !isAddress(right)) {
    return false;
  }

  return getAddress(left) === getAddress(right);
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  throw error;
}

function assertFreshSignature(signedAt: string): void {
  const timestamp = Date.parse(signedAt);

  if (!Number.isFinite(timestamp)) {
    throw new AuthError("Signed action has an invalid timestamp.", 400);
  }

  const now = Date.now();

  if (timestamp > now + MAX_CLOCK_SKEW_MS) {
    throw new AuthError("Signed action timestamp is in the future.", 401);
  }

  if (now - timestamp > MAX_SIGNATURE_AGE_MS) {
    throw new AuthError("Signed action has expired.", 401);
  }
}

function assertNonceUnused(
  signerAddress: Address,
  action: SignedActionName,
  nonce: string,
): void {
  pruneExpiredNonces();

  const key = `${getAddress(signerAddress)}:${action}:${nonce}`;

  if (seenNonces.has(key)) {
    throw new AuthError("Signed action nonce has already been used.", 409);
  }

  seenNonces.set(key, Date.now() + NONCE_RETENTION_MS);
}

function pruneExpiredNonces(): void {
  const now = Date.now();

  Array.from(seenNonces.entries()).forEach(([key, expiresAt]) => {
    if (expiresAt <= now) {
      seenNonces.delete(key);
    }
  });
}

function isSignedActionRequest(
  value: unknown,
): value is SignedActionRequest<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<SignedActionRequest<unknown>>;

  return (
    isSignedActionName(candidate.action) &&
    typeof candidate.signedAt === "string" &&
    typeof candidate.nonce === "string" &&
    candidate.nonce.length >= 16 &&
    typeof candidate.signature === "string" &&
    candidate.signature.startsWith("0x") &&
    "payload" in candidate
  );
}

function isSignedActionName(value: unknown): value is SignedActionName {
  return (
    value === "agent:deploy" ||
    value === "agent:control" ||
    value === "ens:register" ||
    value === "ens:update_stats"
  );
}

function createNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalStringify(entryValue)}`)
    .join(",")}}`;
}
