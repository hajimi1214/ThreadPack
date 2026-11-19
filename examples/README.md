# Synthetic example

`demo-session.jsonl` is the same synthetic checkout-debugging conversation used by the browser demo. It contains a deliberately fake image data URI, repetitive test output, an inert documentation credential, and an address under `example.test`.

From the project root, run:

```sh
npm run build:cli
node dist-cli/threadpack.mjs examples/demo-session.jsonl --out demo-cleaned.md
```

The example demonstrates byte reduction, image removal, clipping, exact output deduplication, and contextual credential redaction. The reduction is specific to this constructed fixture. Real conversations vary.
