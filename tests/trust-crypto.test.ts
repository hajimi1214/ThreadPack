import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TRUST_CHAIN_ORIGIN, TRUST_EVENT_SCHEMA, assertTrustChainContainsHead, assertTrustChainNotRolledBack, canonicalTrustJson,
  createRecoveryBundle, generateSigningIdentity, keyIdForPublicKey, publicKeyFingerprint, signTrustEvent,
  unlockRecoveryBundle, verifyTrustEventChain, verifyTrustEventSignature,
} from '../src/projects/trust-crypto';
import type { LocalSigningIdentity, SignedTrustEvent, TrustEventPayload } from '../src/projects/trust-crypto';

const fingerprint = 'a'.repeat(64);

function payload(identity: LocalSigningIdentity, sequence: number, previousEventHash: string,
  eventType: TrustEventPayload['eventType'], overrides: Partial<TrustEventPayload> = {}): TrustEventPayload {
  return {
    schema: TRUST_EVENT_SCHEMA, projectId: 'project-a', id: 'event-' + sequence, sequence, previousEventHash,
    eventType, actorKeyId: identity.keyId, subjectId: 'fact-a', subjectFingerprint: fingerprint,
    subjectVersion: 1, evidenceFingerprints: [fingerprint], changedAt: sequence, ...overrides,
  };
}

async function signed(identity: LocalSigningIdentity, sequence: number, previousEventHash: string,
  eventType: TrustEventPayload['eventType'], overrides: Partial<TrustEventPayload> = {}): Promise<SignedTrustEvent> {
  return signTrustEvent(payload(identity, sequence, previousEventHash, eventType, overrides), identity);
}

test('canonical trust JSON sorts object keys while preserving array order', () => {
  assert.equal(canonicalTrustJson({ z: 1, a: { y: 2, x: 3 }, list: [2, 1] }),
    canonicalTrustJson({ list: [2, 1], a: { x: 3, y: 2 }, z: 1 }));
  assert.notEqual(canonicalTrustJson({ list: [2, 1] }), canonicalTrustJson({ list: [1, 2] }));
  assert.equal(canonicalTrustJson({ ä: 1, Z: 2, a: 3 }), "{\"Z\":2,\"a\":3,\"ä\":1}");
  assert.throws(() => canonicalTrustJson({ bad: Number.NaN }), /finite JSON numbers/);
});

test('local ECDSA identity signs a claim confirmation that verifies against its public key', async () => {
  const identity = await generateSigningIdentity();
  const event = await signed(identity, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed');
  assert.match(identity.keyId, /^p256-[a-f0-9]{32}$/);
  assert.equal(await keyIdForPublicKey(identity.publicKeyJwk), identity.keyId);
  assert.equal(await verifyTrustEventSignature(event, identity.publicKeyJwk), true);
  assert.equal(await verifyTrustEventSignature({ ...event, subjectFingerprint: 'b'.repeat(64) }, identity.publicKeyJwk), false);
});

test('confirmation events bind to a specific fact version and evidence list', async () => {
  const identity = await generateSigningIdentity();
  const event = await signed(identity, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed', {
    subjectId: 'fact-version-2', subjectVersion: 2, evidenceFingerprints: ['1'.repeat(64), '2'.repeat(64)],
  });
  assert.equal(await verifyTrustEventSignature(event, identity.publicKeyJwk), true);
  assert.notEqual(event.eventHash, (await signed(identity, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed', {
    subjectId: 'fact-version-1', subjectVersion: 1, evidenceFingerprints: ['1'.repeat(64)],
  })).eventHash);
});

test('event chain rejects replays, sequence gaps, wrong predecessors and duplicate IDs', async () => {
  const identity = await generateSigningIdentity();
  const first = await signed(identity, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed');
  const second = await signed(identity, 2, first.eventHash, 'claim.rejected', { id: 'event-2' });
  const trust = { [identity.keyId]: identity.publicKeyJwk };
  assert.equal((await verifyTrustEventChain([first, second], trust)).head.sequence, 2);
  await assert.rejects(verifyTrustEventChain([first, { ...second, sequence: 3 }], trust), /sequence/);
  await assert.rejects(verifyTrustEventChain([first, { ...second, previousEventHash: TRUST_CHAIN_ORIGIN }], trust), /sequence/);
  await assert.rejects(verifyTrustEventChain([first, { ...second, id: first.id }], trust), /replay/);
});

test('event chains reject timestamps that move backwards', async () => {
  const identity = await generateSigningIdentity();
  const first = await signed(identity, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed', { changedAt: 50 });
  const second = await signed(identity, 2, first.eventHash, 'claim.rejected', { changedAt: 49 });
  await assert.rejects(verifyTrustEventChain([first, second], { [identity.keyId]: identity.publicKeyJwk }), /timestamp/);
});

test('key rotation is signed by the prior key and leaves old key revocable', async () => {
  const firstIdentity = await generateSigningIdentity();
  const nextIdentity = await generateSigningIdentity();
  const first = await signed(firstIdentity, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed');
  const rotation = await signed(firstIdentity, 2, first.eventHash, 'identity.key-rotated', {
    id: 'rotate-1', details: { keyId: nextIdentity.keyId, publicKeyJwk: nextIdentity.publicKeyJwk },
  });
  const nextEvent = await signed(nextIdentity, 3, rotation.eventHash, 'evidence.relation-attested', { id: 'relation-1' });
  const verified = await verifyTrustEventChain([first, rotation, nextEvent], { [firstIdentity.keyId]: firstIdentity.publicKeyJwk });
  assert.deepEqual(verified.activeKeyIds, [firstIdentity.keyId, nextIdentity.keyId].sort());
  assert.equal(verified.head.eventHash, nextEvent.eventHash);
});

test('key revocation prevents a recovery key from signing later events', async () => {
  const original = await generateSigningIdentity();
  const recovery = await generateSigningIdentity();
  const next = await generateSigningIdentity();
  const first = await signed(original, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed');
  const rotation = await signed(original, 2, first.eventHash, 'identity.key-rotated', {
    id: 'rotate-1', details: { keyId: next.keyId, publicKeyJwk: next.publicKeyJwk, revokeKeyId: original.keyId },
  });
  const revocation = await signed(next, 3, rotation.eventHash, 'identity.key-revoked', {
    id: 'revoke-1', details: { keyId: recovery.keyId },
  });
  const invalidAfterRevoke = await signed(recovery, 4, revocation.eventHash, 'claim.confirmed', { id: 'replayed-device-event' });
  const roots = { [original.keyId]: original.publicKeyJwk, [recovery.keyId]: recovery.publicKeyJwk };
  await assert.rejects(verifyTrustEventChain([first, rotation, revocation, invalidAfterRevoke], roots), /revoked/);
  const valid = await verifyTrustEventChain([first, rotation, revocation], roots);
  assert.deepEqual(valid.revokedKeyIds, [original.keyId, recovery.keyId].sort());
  assert.deepEqual(valid.activeKeyIds, [next.keyId]);
});

test('self-signed unknown keys and forged replacement keys are not trusted', async () => {
  const trusted = await generateSigningIdentity();
  const attacker = await generateSigningIdentity();
  const forged = await signed(attacker, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed');
  await assert.rejects(verifyTrustEventChain([forged], { [trusted.keyId]: trusted.publicKeyJwk }), /trusted identity/);
  const badRotation = await signed(trusted, 1, TRUST_CHAIN_ORIGIN, 'identity.key-rotated', {
    details: { keyId: attacker.keyId, publicKeyJwk: trusted.publicKeyJwk, revokeKeyId: trusted.keyId },
  });
  await assert.rejects(verifyTrustEventChain([badRotation], { [trusted.keyId]: trusted.publicKeyJwk }), /replacement key/);
});

test('a known trusted history head must be an exact prefix of an imported chain', async () => {
  const identity = await generateSigningIdentity();
  const first = await signed(identity, 1, TRUST_CHAIN_ORIGIN, 'claim.confirmed');
  const second = await signed(identity, 2, first.eventHash, 'claim.rejected');
  assert.doesNotThrow(() => assertTrustChainContainsHead({ sequence: 1, eventHash: first.eventHash }, [first, second]));
  assert.throws(() => assertTrustChainContainsHead({ sequence: 1, eventHash: 'f'.repeat(64) }, [first, second]), /fork or rollback/);
  assert.throws(() => assertTrustChainContainsHead({ sequence: 3, eventHash: second.eventHash }, [first, second]), /rollback/);
});

test('rollback and same-version forks are rejected against the remembered chain head', () => {
  const head = { sequence: 7, eventHash: 'a'.repeat(64) };
  assert.doesNotThrow(() => assertTrustChainNotRolledBack(head, { sequence: 8, eventHash: 'b'.repeat(64) }));
  assert.throws(() => assertTrustChainNotRolledBack(head, { sequence: 6, eventHash: 'c'.repeat(64) }), /rollback/);
  assert.throws(() => assertTrustChainNotRolledBack(head, { sequence: 7, eventHash: 'd'.repeat(64) }), /rollback/);
});

test('recovery bundles encrypt the recovery private key and can be unlocked by passphrase', async () => {
  const rootIdentity = await generateSigningIdentity();
  const { bundle, recoveryIdentity } = await createRecoveryBundle('A sufficiently long test passphrase', rootIdentity.publicKeyJwk, 100_000);
  assert.equal(JSON.stringify(bundle).includes('"d"'), false);
  const restored = await unlockRecoveryBundle(bundle, 'A sufficiently long test passphrase');
  assert.equal(restored.keyId, recoveryIdentity.keyId);
  const event = await signed(restored, 1, TRUST_CHAIN_ORIGIN, 'identity.device-retrusted');
  assert.equal(await verifyTrustEventSignature(event, bundle.publicKeyJwk), true);
  await assert.rejects(unlockRecoveryBundle(bundle, 'wrong passphrase'), /could not be unlocked/);
});

test('recovery bundle tampering is rejected before a private key is accepted', async () => {
  const rootIdentity = await generateSigningIdentity();
  const { bundle } = await createRecoveryBundle('Another long recovery passphrase', rootIdentity.publicKeyJwk, 100_000);
  await assert.rejects(unlockRecoveryBundle({ ...bundle, publicKeyFingerprint: '0'.repeat(64) }, 'Another long recovery passphrase'), /fingerprint/);
  const attackerRoot = await generateSigningIdentity();
  const forgedRootBundle = { ...bundle, authorizedRootKeyId: attackerRoot.keyId,
    authorizedRootPublicKeyJwk: attackerRoot.publicKeyJwk,
    authorizedRootPublicKeyFingerprint: await publicKeyFingerprint(attackerRoot.publicKeyJwk) };
  await assert.rejects(unlockRecoveryBundle(forgedRootBundle, 'Another long recovery passphrase'), /could not be unlocked/);
  const bytes = bundle.ciphertext.split('');
  bytes[0] = bytes[0] === 'A' ? 'B' : 'A';
  await assert.rejects(unlockRecoveryBundle({ ...bundle, ciphertext: bytes.join('') }, 'Another long recovery passphrase'), /could not be unlocked/);
});

test('low work factors and short recovery passphrases are rejected', async () => {
  const rootIdentity = await generateSigningIdentity();
  await assert.rejects(createRecoveryBundle('short', rootIdentity.publicKeyJwk, 100_000), /at least 12/);
  await assert.rejects(createRecoveryBundle('A sufficiently long test passphrase', rootIdentity.publicKeyJwk, 1), /work factor/);
});
