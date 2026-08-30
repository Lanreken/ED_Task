import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthContext = {
  userId: string;
  subject?: string;
  roles: string[];
};

export type ServiceSignatureInput = {
  method: string;
  path: string;
  timestamp: string;
  userId?: string;
  traceId?: string;
  idempotencyKey?: string;
};

function canonicalField(value?: string | null) {
  if (!value) {
    return '-';
  }
  return value.trim() || '-';
}

export function buildServiceSignaturePayload(input: ServiceSignatureInput) {
  return [
    canonicalField(input.method.toUpperCase()),
    canonicalField(input.path),
    canonicalField(input.timestamp),
    canonicalField(input.userId),
    canonicalField(input.traceId),
    canonicalField(input.idempotencyKey),
  ].join('\n');
}

export function signServiceRequest(secret: string, input: ServiceSignatureInput) {
  return createHmac('sha256', secret)
    .update(buildServiceSignaturePayload(input))
    .digest('hex');
}

export function verifyServiceRequestSignature(secret: string, input: ServiceSignatureInput, signature: string) {
  const expected = signServiceRequest(secret, input);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(signature, 'hex');

  if (expectedBuffer.length === 0 || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function isFreshTimestamp(timestamp: string, maxSkewMs: number) {
  const ms = Number(timestamp);
  if (Number.isNaN(ms)) {
    return false;
  }
  return Math.abs(Date.now() - ms) <= maxSkewMs;
}
