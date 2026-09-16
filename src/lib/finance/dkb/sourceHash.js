// The identity of the file, without the file.
//
// 0008 created `finance_imports.source_hash` with a unique index over
// (user_id, source_hash) and the note that "the same file twice is the most
// likely import accident there is". This computes what goes in it.
//
// WHAT LEAVES THE DEVICE. A SHA-256 over the bytes and nothing else: 64 hex
// characters that say "this is the same file as last time" and from which no
// booking, no name and no amount can be recovered. The PDF itself never goes
// anywhere — it is read into memory, parsed, and dropped.
//
// RETURNS NULL RATHER THAN THROWING when the platform has no WebCrypto (an
// insecure origin, a stripped runtime). The column is nullable and its index is
// partial, so an import without a hash is a perfectly valid import that simply
// does not get the duplicate-file shortcut. Failing the whole import over a
// convenience guard would be the wrong trade — the guards that matter are in
// the parser and in the database, and they are unaffected.

/**
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{subtle?: SubtleCrypto}} [deps] injection point for tests
 * @returns {Promise<string|null>} 64 lowercase hex characters, or null
 */
export async function sourceHash(bytes, deps = {}) {
  // `in` rather than `??`: a test that injects `subtle: null` is saying "this
  // platform has none", and `??` would helpfully hand it the real one back.
  const subtle = 'subtle' in deps ? deps.subtle : globalThis.crypto?.subtle
  if (!subtle || typeof subtle.digest !== 'function') return null
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view.byteLength === 0) return null
  try {
    const digest = await subtle.digest('SHA-256', view)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}
