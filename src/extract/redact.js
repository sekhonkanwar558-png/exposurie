// Secrets do not go into the brain.
//
// People paste keys into terminals, and the transcript keeps them. The brain is
// a folder a person may later put on a remote they configured, so a key that
// survives extraction can end up somewhere it was never meant to be — and the
// user would have no reason to suspect it, because they pasted it into a chat,
// not into their notes.
//
// Only well-known shapes are matched. A greedy "anything that looks random"
// rule would eat hashes, ids and ordinary prose, and a redactor that damages
// real content gets switched off — which is the same failure as not having one.

const PATTERNS = [
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, 'anthropic-key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/g, 'openai-key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, 'github-token'],
  [/\bgithub_pat_[A-Za-z0-9_]{50,}/g, 'github-token'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'aws-key-id'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, 'google-key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'slack-token'],
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'jwt'],
  // A secret named as one, assigned a value that is long enough to be real.
  [
    /\b((?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*)["']?([A-Za-z0-9_\-/+]{24,})["']?/gi,
    'named-secret',
  ],
];

/**
 * Returns the cleaned text and a count per kind. The count is reported in the
 * output: a redaction nobody is told about is indistinguishable from a bug that
 * ate a paragraph.
 */
export function redact(text) {
  let out = String(text);
  const found = {};
  for (const [re, kind] of PATTERNS) {
    out = out.replace(re, (match, p1) => {
      found[kind] = (found[kind] || 0) + 1;
      // A named secret keeps its name, so the sentence still reads.
      return kind === 'named-secret' ? `${p1}[redacted:${kind}]` : `[redacted:${kind}]`;
    });
  }
  return { text: out, found, count: Object.values(found).reduce((a, b) => a + b, 0) };
}
