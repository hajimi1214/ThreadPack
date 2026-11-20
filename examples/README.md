# Synthetic example

`demo-session.jsonl` is the same synthetic checkout-debugging conversation used by the browser demo. It contains a deliberately fake image data URI, repetitive test output, an inert documentation credential, and an address under `example.test`.

From the project root, run:

```sh
npm run build:cli
node dist-cli/threadpack.mjs examples/demo-session.jsonl --out demo-cleaned.md
```

The example demonstrates byte reduction, image removal, clipping, exact output deduplication, and contextual credential redaction. The reduction is specific to this constructed fixture. Real conversations vary.

`code-snippets.md` contains short TypeScript and Python blocks. Import it in the browser and open **Code snippets** to copy or download each block. The browser demo also includes a fenced TypeScript example.
