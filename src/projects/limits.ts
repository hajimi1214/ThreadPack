/** Maximum size of one integrity-checked project revision. */
export const MAX_PROJECT_SESSION_BYTES = 200 * 1024 * 1024;
export const MAX_SHARED_PROJECT_BACKUP_BYTES = 256 * 1024 * 1024;

const byteLengthEncoder = new TextEncoder();
const byteLengthChunkCharacters = 16 * 1024;

export function utf8ByteLength(value: string): number {
  const output = new Uint8Array(byteLengthChunkCharacters * 3);
  let total = 0;
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + byteLengthChunkCharacters);
    const lastUnit = value.charCodeAt(end - 1);
    if (end < value.length && lastUnit >= 0xd800 && lastUnit <= 0xdbff) end--;
    const result = byteLengthEncoder.encodeInto(value.slice(offset, end), output);
    if (!result.read) throw new Error('Unable to measure the UTF-8 input size.');
    total += result.written;
    offset += result.read;
  }
  return total;
}
