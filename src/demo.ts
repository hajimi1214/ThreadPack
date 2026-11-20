// Deliberately synthetic content. No working credential or user data is bundled.
export function createDemo(): string {
  const toolOutput = [
    '$ npm run test:integration',
    ...Array.from({ length: 160 }, (_, i) => `  PASS checkout / cart reconciliation / fixture ${String(i + 1).padStart(3, '0')} · 42ms`),
    'Tests: 160 passed. Suites: 12 passed. Duration: 6.72s.',
    'Remaining: verify the idempotency-key collision case before release.',
  ].join('\n');
  const image = `data:image/png;base64,${'RkFLRUlNQUdF'.repeat(18000)}`;
  const records = [
    { role: 'user', content: 'We are fixing duplicate charges in the checkout service. Keep the public API unchanged. The fix must be safe to retry and ship with a regression test.' },
    { role: 'assistant', content: 'The payment handler retries after a timeout without checking the idempotency key. I will move the lookup before the charge request and add a unique database constraint.' },
    { role: 'tool', content: 'src/payments/checkout.ts\n\n```typescript\nexport async function checkout(request: CheckoutRequest) {\n  const existing = await findByIdempotencyKey(request.idempotencyKey);\n  if (existing) return existing;\n  return createCharge(request);\n}\n```\n\nMigration: add UNIQUE (idempotency_key) to payment_attempts.' },
    { role: 'user', content: `Here is the failing checkout screenshot.\n${image}` },
    { role: 'assistant', content: 'The duplicate appears when two requests arrive together. The database constraint handles the race; the handler must also catch the unique-key conflict and return the existing payment.' },
    { role: 'tool', content: toolOutput },
    { role: 'tool', content: toolOutput },
    { role: 'user', content: 'Staging settings from the issue report:\nAPI_KEY="demo_value_for_documentation_only_12345678"\nCONTACT=developer@example.test\nPlease remove credentials before sharing this conversation.' },
    { role: 'assistant', content: 'Implemented: lookup before charge, a unique constraint, and conflict recovery. Existing retry tests pass. The final concurrency regression still needs a separate test with two simultaneous requests.' },
    { role: 'user', content: 'Next, add that concurrency test. Use a mocked payment provider, assert exactly one external charge, and keep the migration backwards compatible. Do not deploy yet.' },
  ];
  return records.map((m, i) => JSON.stringify({ id: `demo-${i + 1}`, timestamp: `2026-11-19T09:${String(i * 2).padStart(2, '0')}:00Z`, ...m })).join('\n');
}
