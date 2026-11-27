export const TRUST_EVENT_SCHEMA = 'threadpack.trust-event.v1' as const;
export const TRUST_CHAIN_ORIGIN = '0'.repeat(64);
export const TRUST_KEY_ALGORITHM = 'ECDSA-P256-SHA256' as const;

export type TrustEventType =
  | 'claim.confirmed' | 'claim.rejected' | 'claim.revoked' | 'claim.expired' | 'claim.superseded' | 'claim.confirmation-revoked'
  | 'evidence.relation-attested' | 'evidence.relation-revoked'
  | 'identity.key-rotated' | 'identity.key-revoked' | 'identity.device-retrusted';

export interface LocalSigningIdentity {
  keyId: string; publicKeyJwk: JsonWebKey; privateKey: CryptoKey;
  authorizedRootKeyId?: string; authorizedRootPublicKeyFingerprint?: string;
}

export interface TrustEventPayload {
  schema: typeof TRUST_EVENT_SCHEMA;
  projectId: string;
  id: string;
  sequence: number;
  previousEventHash: string;
  eventType: TrustEventType;
  actorKeyId: string;
  subjectId: string;
  subjectFingerprint: string;
  subjectVersion: number;
  evidenceFingerprints: string[];
  changedAt: number;
  details?: Record<string, unknown>;
}

export interface SignedTrustEvent extends TrustEventPayload { eventHash: string; signature: string; }

export interface RecoveryBundle {
  schema: 'threadpack.recovery.v1';
  algorithm: typeof TRUST_KEY_ALGORITHM;
  keyId: string;
  publicKeyJwk: JsonWebKey;
  publicKeyFingerprint: string;
  authorizedRootKeyId: string;
  authorizedRootPublicKeyJwk: JsonWebKey;
  authorizedRootPublicKeyFingerprint: string;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface TrustChainHead { sequence: number; eventHash: string; }
export interface TrustChainVerification {
  valid: true;
  head: TrustChainHead;
  activeKeyIds: string[];
  revokedKeyIds: string[];
  verifiedEventIds: string[];
}

const encoder = new TextEncoder();
const keyAlgorithm: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const signatureAlgorithm: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Trust event values must be finite JSON numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0);
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  throw new Error('Trust event contains a non-JSON value.');
}

export function canonicalTrustJson(value: unknown): string { return JSON.stringify(canonicalValue(value)); }

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Recovery bundle contains invalid base64url data.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

function bytesFromHex(value: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error('A trust event contains an invalid fingerprint.');
  return Uint8Array.from(value.match(/.{2}/g)!, pair => Number.parseInt(pair, 16));
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const input = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function isPublicSigningKeyJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const key = value as JsonWebKey;
  return key.kty === 'EC' && key.crv === 'P-256' && typeof key.x === 'string' && typeof key.y === 'string'
    && !('d' in key);
}

export async function publicKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string> {
  if (!isPublicSigningKeyJwk(publicKeyJwk)) throw new Error('Expected a public P-256 signing key.');
  return sha256(canonicalTrustJson(publicKeyJwk));
}

export async function keyIdForPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
  return 'p256-' + (await publicKeyFingerprint(publicKeyJwk)).slice(0, 32);
}

export async function generateSigningIdentity(extractable = false): Promise<LocalSigningIdentity> {
  const pair = await crypto.subtle.generateKey(keyAlgorithm, extractable, ['sign', 'verify']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { keyId: await keyIdForPublicKey(publicKeyJwk), publicKeyJwk, privateKey: pair.privateKey };
}

export async function signTrustEvent(payload: TrustEventPayload, identity: LocalSigningIdentity): Promise<SignedTrustEvent> {
  if (payload.schema !== TRUST_EVENT_SCHEMA || payload.actorKeyId !== identity.keyId
    || !payload.projectId || !payload.id || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1
    || !/^(?:[a-f0-9]{64})$/i.test(payload.previousEventHash)
    || !payload.subjectId || !/^(?:[a-f0-9]{64})$/i.test(payload.subjectFingerprint)
    || !Number.isSafeInteger(payload.subjectVersion) || payload.subjectVersion < 1
    || !Array.isArray(payload.evidenceFingerprints) || payload.evidenceFingerprints.some(value => !/^(?:[a-f0-9]{64})$/i.test(value))
    || !Number.isSafeInteger(payload.changedAt) || payload.changedAt < 0) {
    throw new Error('Trust event payload is incomplete or does not match the signing identity.');
  }
  const eventHash = await sha256(canonicalTrustJson(payload));
  const signature = await crypto.subtle.sign(signatureAlgorithm, identity.privateKey, bytesFromHex(eventHash));
  return { ...payload, eventHash, signature: toBase64Url(new Uint8Array(signature)) };
}

export async function verifyTrustEventSignature(event: SignedTrustEvent, publicKeyJwk: JsonWebKey): Promise<boolean> {
  const { eventHash, signature, ...payload } = event;
  if (await keyIdForPublicKey(publicKeyJwk) !== event.actorKeyId || await sha256(canonicalTrustJson(payload)) !== eventHash) return false;
  try {
    const publicKey = await crypto.subtle.importKey('jwk', publicKeyJwk, keyAlgorithm, true, ['verify']);
    return await crypto.subtle.verify(signatureAlgorithm, publicKey, fromBase64Url(signature), bytesFromHex(eventHash));
  } catch { return false; }
}

function isTrustEventType(value: unknown): value is TrustEventType {
  return ['claim.confirmed', 'claim.rejected', 'claim.revoked', 'claim.expired', 'claim.superseded', 'claim.confirmation-revoked', 'evidence.relation-attested',
    'evidence.relation-revoked', 'identity.key-rotated', 'identity.key-revoked', 'identity.device-retrusted'].includes(value as string);
}

export async function verifyTrustEventChain(
  events: SignedTrustEvent[], trustedPublicKeys: Record<string, JsonWebKey>,
): Promise<TrustChainVerification> {
  const activeKeys = new Map(Object.entries(trustedPublicKeys));
  for (const [keyId, publicKeyJwk] of activeKeys) {
    if (!isPublicSigningKeyJwk(publicKeyJwk) || await keyIdForPublicKey(publicKeyJwk) !== keyId) {
      throw new Error('A trust anchor is not a valid public P-256 key.');
    }
  }
  const revokedKeys = new Set<string>();
  const eventIds = new Set<string>();
  let expectedSequence = 1;
  let chainProjectId = '';
  let previousEventHash = TRUST_CHAIN_ORIGIN;
  let previousTimestamp = -1;
  for (const event of events) {
    const { eventHash } = event;
    if (revokedKeys.has(event.actorKeyId)) throw new Error('Trust event signer key was revoked before this event.');
    if (event.schema !== TRUST_EVENT_SCHEMA || !isTrustEventType(event.eventType) || typeof event.projectId !== 'string' || !event.projectId
      || chainProjectId && event.projectId !== chainProjectId
      || typeof event.actorKeyId !== 'string' || !event.actorKeyId || typeof event.subjectId !== 'string' || !event.subjectId
      || !/^[a-f0-9]{64}$/i.test(event.subjectFingerprint) || !Number.isSafeInteger(event.subjectVersion) || event.subjectVersion < 1
      || !Array.isArray(event.evidenceFingerprints) || event.evidenceFingerprints.some(value => !/^[a-f0-9]{64}$/i.test(value))
      || typeof event.id !== 'string' || !event.id || eventIds.has(event.id)
      || event.sequence !== expectedSequence || event.previousEventHash !== previousEventHash
      || !Number.isSafeInteger(event.changedAt) || event.changedAt < previousTimestamp) {
      throw new Error('Trust event chain sequence, timestamp, identity, or replay validation failed.');
    }
    const actorKey = activeKeys.get(event.actorKeyId);
    if (!actorKey || !await verifyTrustEventSignature(event, actorKey)) {
      throw new Error('Trust event signature or trusted identity validation failed.');
    }
    if (event.eventType === 'identity.device-retrusted') {
      const revokeKeyId = event.details?.revokeKeyId;
      if (revokeKeyId !== undefined) {
        if (typeof revokeKeyId !== 'string' || !activeKeys.has(revokeKeyId) || revokeKeyId === event.actorKeyId) {
          throw new Error('Trust event contains an invalid re-trust revocation.');
        }
        activeKeys.delete(revokeKeyId);
        revokedKeys.add(revokeKeyId);
      }
    }
    if (event.eventType === 'identity.key-rotated' || event.eventType === 'identity.device-retrusted') {
      const publicKeyJwk = event.details?.publicKeyJwk;
      const keyId = event.details?.keyId;
      if (!isPublicSigningKeyJwk(publicKeyJwk) || typeof keyId !== 'string'
        || await keyIdForPublicKey(publicKeyJwk as JsonWebKey) !== keyId || activeKeys.has(keyId) || revokedKeys.has(keyId)) {
        throw new Error('Trust event contains an invalid or reused replacement key.');
      }
      activeKeys.set(keyId, publicKeyJwk as JsonWebKey);
      if (event.eventType === 'identity.key-rotated' && event.details?.revokeKeyId !== undefined) {
        if (event.details.revokeKeyId !== event.actorKeyId) throw new Error('Key rotation may revoke only its signing key.');
        activeKeys.delete(event.actorKeyId);
        revokedKeys.add(event.actorKeyId);
      }
    }
    if (event.eventType === 'identity.key-revoked') {
      const keyId = event.details?.keyId;
      if (typeof keyId !== 'string' || !activeKeys.has(keyId) || keyId === event.actorKeyId) {
        throw new Error('Trust event contains an invalid key revocation.');
      }
      activeKeys.delete(keyId);
      revokedKeys.add(keyId);
    }
    if (!chainProjectId) chainProjectId = event.projectId;
    previousEventHash = eventHash;
    previousTimestamp = event.changedAt;
    expectedSequence++;
    eventIds.add(event.id);
  }
  return { valid: true, head: { sequence: expectedSequence - 1, eventHash: previousEventHash },
    activeKeyIds: [...activeKeys.keys()].sort(), revokedKeyIds: [...revokedKeys].sort(), verifiedEventIds: [...eventIds] };
}

export function assertTrustChainNotRolledBack(localHead: TrustChainHead, incomingHead: TrustChainHead): void {
  if (!Number.isSafeInteger(localHead.sequence) || !Number.isSafeInteger(incomingHead.sequence)
    || incomingHead.sequence < localHead.sequence
    || incomingHead.sequence === localHead.sequence && incomingHead.eventHash !== localHead.eventHash) {
    throw new Error('Project trust history rollback or same-version fork detected.');
  }
}

export function assertTrustChainContainsHead(localHead: TrustChainHead, incomingEvents: SignedTrustEvent[]): void {
  if (!Number.isSafeInteger(localHead.sequence) || localHead.sequence < 0 || incomingEvents.length < localHead.sequence) {
    throw new Error('Project trust history rollback detected.');
  }
  if (localHead.sequence === 0) return;
  const matchingVersion = incomingEvents[localHead.sequence - 1];
  if (!matchingVersion || matchingVersion.sequence !== localHead.sequence || matchingVersion.eventHash !== localHead.eventHash) {
    throw new Error('Project trust history fork or rollback detected.');
  }
}

export async function createRecoveryBundle(
  passphrase: string, rootPublicKeyJwk: JsonWebKey, iterations = 310_000,
): Promise<{ bundle: RecoveryBundle; recoveryIdentity: LocalSigningIdentity }> {
  if (!isPublicSigningKeyJwk(rootPublicKeyJwk)) throw new Error('Recovery kit requires the project root public key.');
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('Recovery passphrase must contain at least 12 characters.');
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) throw new Error('Recovery key-derivation work factor is outside the supported range.');
  const identity = await generateSigningIdentity(true);
  const privateJwk = await crypto.subtle.exportKey('jwk', identity.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const passphraseKey = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const encryptionKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, passphraseKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const authorizedRootKeyId = await keyIdForPublicKey(rootPublicKeyJwk);
  const authorizedRootPublicKeyFingerprint = await publicKeyFingerprint(rootPublicKeyJwk);
  const encryptedRecovery = { privateJwk, authorizedRootKeyId, authorizedRootPublicKeyFingerprint };
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, encoder.encode(canonicalTrustJson(encryptedRecovery)));
  return { bundle: { schema: 'threadpack.recovery.v1', algorithm: TRUST_KEY_ALGORITHM, keyId: identity.keyId,
    publicKeyJwk: identity.publicKeyJwk, publicKeyFingerprint: await publicKeyFingerprint(identity.publicKeyJwk),
    authorizedRootKeyId, authorizedRootPublicKeyJwk: rootPublicKeyJwk, authorizedRootPublicKeyFingerprint,
    kdf: 'PBKDF2-SHA-256', iterations, salt: toBase64Url(salt), iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(ciphertext)) },
    recoveryIdentity: identity };
}

function bundleAuthorizedRootPublicKey(bundle: RecoveryBundle): JsonWebKey { return bundle.authorizedRootPublicKeyJwk; }

export async function unlockRecoveryBundle(bundle: RecoveryBundle, passphrase: string): Promise<LocalSigningIdentity> {
  if (!bundle || bundle.schema !== 'threadpack.recovery.v1' || bundle.algorithm !== TRUST_KEY_ALGORITHM
    || bundle.kdf !== 'PBKDF2-SHA-256' || !Number.isSafeInteger(bundle.iterations)
    || bundle.iterations < 100_000 || bundle.iterations > 1_000_000
    || !isPublicSigningKeyJwk(bundle.publicKeyJwk)
    || !isPublicSigningKeyJwk(bundleAuthorizedRootPublicKey(bundle))
    || await keyIdForPublicKey(bundle.publicKeyJwk) !== bundle.keyId
    || await publicKeyFingerprint(bundle.publicKeyJwk) !== bundle.publicKeyFingerprint
    || await keyIdForPublicKey(bundleAuthorizedRootPublicKey(bundle)) !== bundle.authorizedRootKeyId
    || await publicKeyFingerprint(bundleAuthorizedRootPublicKey(bundle)) !== bundle.authorizedRootPublicKeyFingerprint) {
    throw new Error('Recovery bundle metadata or public-key fingerprint is invalid.');
  }
  const salt = fromBase64Url(bundle.salt);
  const iv = fromBase64Url(bundle.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Recovery bundle salt or nonce has an invalid size.');
  try {
    const passphraseKey = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const encryptionKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: bundle.iterations },
      passphraseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, fromBase64Url(bundle.ciphertext));
    const recoveryPayload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as {
      privateJwk?: JsonWebKey; authorizedRootKeyId?: string; authorizedRootPublicKeyFingerprint?: string;
    };
    if (!recoveryPayload.privateJwk || recoveryPayload.authorizedRootKeyId !== bundle.authorizedRootKeyId
      || recoveryPayload.authorizedRootPublicKeyFingerprint !== bundle.authorizedRootPublicKeyFingerprint) {
      throw new Error('Recovery kit root authorization does not match its encrypted payload.');
    }
    const privateKey = await crypto.subtle.importKey('jwk', recoveryPayload.privateJwk, keyAlgorithm, false, ['sign']);
    const challenge = await sha256('threadpack-recovery-check:' + bundle.keyId);
    const signature = await crypto.subtle.sign(signatureAlgorithm, privateKey, bytesFromHex(challenge));
    const publicKey = await crypto.subtle.importKey('jwk', bundle.publicKeyJwk, keyAlgorithm, true, ['verify']);
    if (!await crypto.subtle.verify(signatureAlgorithm, publicKey, signature, bytesFromHex(challenge))) throw new Error('Recovery private key does not match its public key.');
    return { keyId: bundle.keyId, publicKeyJwk: bundle.publicKeyJwk, privateKey,
      authorizedRootKeyId: recoveryPayload.authorizedRootKeyId,
      authorizedRootPublicKeyFingerprint: recoveryPayload.authorizedRootPublicKeyFingerprint };
  } catch (error) {
    if (error instanceof Error && error.message === 'Recovery private key does not match its public key.') throw error;
    throw new Error('Recovery bundle could not be unlocked. Check the passphrase and file integrity.');
  }
}
