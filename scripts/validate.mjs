#!/usr/bin/env node
// SanBiao repository guard.
//
// This repository ships JSON only (no compiler, no runtime), so every invariant
// that TheStandard (法仪) enforces at load time has to be re-checked here before
// a commit can reach `main`. The validator is dependency-free ESM and exits
// non-zero on any violation.
//
// Usage:  node scripts/validate.mjs [repository-root]
//         (root defaults to the parent of this script's directory; the optional
//         argument exists so a mutated copy can be validated in CI tests.)
//
// ── Canonical JSON digest, mirrored from the consumer ────────────────────────
// Source: /Volumes/DA/Dli.li/E/TheStandard/crates/the-standard/src/repository.rs
//   * canonical_json_digest()        lines 315-329  (SHA-256 over the bytes)
//   * write_canonical_json()         lines 336-369  (the canonical form itself)
// Mirrored rules (repository.rs:336-369):
//   1. Object keys are emitted in ascending order of their UTF-8 bytes
//      (`keys.sort_unstable()` on `String` = byte-wise Ord), recursively.
//      In JS this is NOT the default `Array#sort` order (UTF-16 code units), so
//      keys are compared with Buffer.compare over their UTF-8 encoding.
//   2. Arrays keep their original order (repository.rs:352-361).
//   3. Strings are written with serde_json's escaper (repository.rs:346/366):
//      `"`, `\`, and the \b \f \n \r \t short forms; other C0 controls as
//      lowercase \u00xx; everything else (including non-ASCII) as raw UTF-8.
//   4. Numbers use serde_json's shortest round-trip form and then have a
//      trailing ".0" stripped (repository.rs:362-365: `strip_suffix(".0")`).
//      ryu (serde_json) and JS `Number#toString` agree on the digit string for
//      every value whose JS text has no exponent, so those are mirrored exactly;
//      exponent forms differ ("1e21" in ryu vs "1e+21" in JS) and are therefore
//      rejected loudly instead of being digested wrongly. Integer literals must
//      stay inside the safe-integer range for the same reason.
//   5. Literals: `true`, `false`, `null` (repository.rs:366).
//
// ── Supported JSON-Schema keywords ───────────────────────────────────────────
// The subset actually used by schemas/*.json is implemented. Anything else is
// reported as a hard failure so the guard can never silently skip a constraint.
//
// ── Engine coupling (deliberate, documented asymmetry) ───────────────────────
// This repository must not import the engine, so PROBE_STRATEGY_NAMES (copied
// from crates/the-standard/src/probe/mod.rs:32-52) and the activation enums are
// duplicated here. When the engine adds a strategy, this list must be updated in
// the same release cycle; the failure message says exactly that.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(SCRIPT_DIR, '..'));

const MAX_MANIFEST_BYTES = 256 * 1024; // README 安全契约: Manifest ≤ 256 KiB
const MAX_DOCUMENT_BYTES = 1024 * 1024; // README 安全契约: single document ≤ 1 MiB

// Copied from TheStandard crates/the-standard/src/probe/mod.rs:32-52.
// UPDATE THIS LIST when the engine registers a new strategy; the engine rejects
// a rule document whose sections do not claim every registered strategy
// (rules.rs:185-191) and this guard fails first with a pointed message.
const PROBE_STRATEGY_NAMES = [
  'identity',
  'behavior_scenarios',
  'reasoning_attestation',
  'reasoning_budget_fingerprint',
  'knowledge_challenges',
  'document_understanding',
  'tool_contract',
  'context',
  'consistency',
  'response_integrity',
  'relay_payload_integrity',
  'protocol',
  'identifiers',
  'cache_reuse',
  'injection_overhead',
  'knowledge_cutoff',
  'web_search',
  'reasoning_iq',
  'thinking_chain',
];

// ProbeMode / Protocol enums: the-standard-contracts/src/lib.rs:115-128.
const ALLOWED_MODES = ['quick', 'standard', 'full'];
const ALLOWED_PROTOCOLS = ['anthropic', 'openai', 'gemini'];

// ProbeActivationRules fields (rules.rs:383-399, deny_unknown_fields at :382).
const ACTIVATION_KEYS = [
  'behaviorScenarios',
  'knowledgeChallenges',
  'documentUnderstanding',
  'toolContract',
  'toolStrict',
  'responseIntegrity',
  'relayAudit',
  'longOutput',
  'cache',
  'injection',
  'knowledgeCutoff',
  'webSearch',
  'reasoningIQ',
  'thinkingChain',
];

const SUPPORTED_KEYWORDS = [
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'title',
  'description',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'const',
  'enum',
  'pattern',
  'format',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'minimum',
  'maximum',
  'allOf',
  'anyOf',
];

// Annotation-only keywords that carry no assertion and are skipped.
const ANNOTATION_KEYWORDS = ['$schema', '$id', 'title', 'description'];
const SUPPORTED_FORMATS = ['date-time'];

const failures = [];
let checks = 0;

function ok(label, detail) {
  checks += 1;
  console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  checks += 1;
  failures.push(`${label}: ${detail}`);
  console.log(`  FAIL  ${label} — ${detail}`);
}

function section(title) {
  console.log(`\n${title}`);
}

// ── canonical JSON (mirrors TheStandard repository.rs:336-369) ───────────────

function writeJsonString(value) {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case '\\':
        out += '\\\\';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\f':
        out += '\\f';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : ch;
    }
  }
  return `${out}"`;
}

function writeCanonicalNumber(value) {
  if (!Number.isFinite(value)) {
    throw new Error('non-finite number cannot be canonicalized');
  }
  const text = String(value);
  if (text.includes('e') || text.includes('E')) {
    throw new Error(
      `number ${text} needs an exponent form that serde_json/ryu writes differently; rewrite the rule value as a plain decimal`,
    );
  }
  // repository.rs:364 — serde_json/ryu prints integral floats as "N.0".
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function writeCanonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return writeCanonicalNumber(value);
  if (typeof value === 'string') return writeJsonString(value);
  if (Array.isArray(value)) {
    return `[${value.map(writeCanonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    // repository.rs:340-341 — keys sorted by UTF-8 byte order.
    const keys = Object.keys(value).sort((a, b) =>
      Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')),
    );
    const body = keys
      .map((key) => `${writeJsonString(key)}:${writeCanonicalJson(value[key])}`)
      .join(',');
    return `{${body}}`;
  }
  throw new Error(`cannot canonicalize value of type ${typeof value}`);
}

function canonicalDigest(value) {
  const bytes = Buffer.from(writeCanonicalJson(value), 'utf8');
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// Reject source numbers whose JS value cannot reproduce serde_json's shortest
// representation (exponent form, redundant trailing zeros, leading `+`, `-0`).
function assertCanonicalizableNumbers(raw, label) {
  let inString = false;
  let escaped = false;
  let index = 0;
  const problems = [];
  while (index < raw.length) {
    const ch = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      index += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let end = index + 1;
      while (end < raw.length && /[0-9eE+\-.]/.test(raw[end])) end += 1;
      const token = raw.slice(index, end);
      index = end;
      const value = Number(token);
      if (token.includes('e') || token.includes('E')) {
        // ryu writes 1e21 where JS writes 1e+21; the digest would differ.
        problems.push(`${token} uses exponent form, which serde_json writes differently`);
      } else if (!Number.isFinite(value)) {
        problems.push(`${token} is not a finite JSON number`);
      } else if (String(value).includes('e')) {
        problems.push(`${token} canonicalizes to JS ${String(value)}, whose exponent form serde_json writes differently`);
      } else if (!token.includes('.') && !Number.isSafeInteger(value)) {
        problems.push(`${token} exceeds Number.MAX_SAFE_INTEGER, so the digest cannot be reproduced exactly`);
      } else if (value === 0 && token.startsWith('-')) {
        problems.push(`${token} is a negative zero; serde_json digests it as "-0", JS as "0"`);
      }
    } else {
      index += 1;
    }
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join('; ');
    const more = problems.length > 5 ? ` (+${problems.length - 5} more)` : '';
    fail(`canonical numbers in ${label}`, `${shown}${more}`);
  } else {
    ok(`canonical numbers in ${label}`, 'every number digests identically in serde_json and JS');
  }
}

// ── minimal JSON-Schema subset ───────────────────────────────────────────────

class UnsupportedKeyword extends Error {}

function typeMatches(type, value) {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      throw new UnsupportedKeyword(`type "${type}"`);
  }
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((item, i) => deepEqual(item, right[i]));
  }
  if (typeof left === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
    );
  }
  return false;
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function checkFormat(format, value) {
  if (format === 'date-time') {
    if (!DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) {
      return 'is not an RFC 3339 date-time';
    }
    return null;
  }
  throw new UnsupportedKeyword(`format "${format}"`);
}

function resolveRef(ref, root) {
  const match = /^#\/\$defs\/(.+)$/.exec(ref);
  if (!match) throw new UnsupportedKeyword(`$ref "${ref}" (only #/$defs/<name>)`);
  const target = root.$defs?.[match[1]];
  if (target === undefined) throw new Error(`unresolvable $ref "${ref}"`);
  return target;
}

function validateNode(schema, value, pointer, root, problems) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    problems.push(`${pointer}: schema is false`);
    return;
  }
  if (schema.$ref !== undefined) {
    validateNode(resolveRef(schema.$ref, root), value, pointer, root, problems);
  }
  if (schema.allOf !== undefined) {
    for (const sub of schema.allOf) validateNode(sub, value, pointer, root, problems);
  }
  if (schema.anyOf !== undefined) {
    const matched = schema.anyOf.some((sub) => {
      const branch = [];
      validateNode(sub, value, pointer, root, branch);
      return branch.length === 0;
    });
    if (!matched) problems.push(`${pointer}: matches none of the anyOf branches`);
  }
  if (schema.type !== undefined && !typeMatches(schema.type, value)) {
    problems.push(`${pointer}: expected type ${schema.type}, found ${describeValue(value)}`);
    return;
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    problems.push(`${pointer}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((allowed) => deepEqual(allowed, value))) {
    problems.push(`${pointer}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      problems.push(`${pointer}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      problems.push(`${pointer}: longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      problems.push(`${pointer}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
    }
    if (schema.format !== undefined) {
      const problem = checkFormat(schema.format, value);
      if (problem) problems.push(`${pointer}: ${problem}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      problems.push(`${pointer}: ${value} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      problems.push(`${pointer}: ${value} is above maximum ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${pointer}: has ${value.length} items, minItems is ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problems.push(`${pointer}: has ${value.length} items, maxItems is ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < value.length; i += 1) {
        for (let j = i + 1; j < value.length; j += 1) {
          if (deepEqual(value[i], value[j])) {
            problems.push(`${pointer}[${i}] and ${pointer}[${j}] are duplicate items (uniqueItems)`);
          }
        }
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => validateNode(schema.items, item, `${pointer}[${i}]`, root, problems));
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) problems.push(`${pointer}: missing required property "${key}"`);
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      problems.push(`${pointer}: has fewer than minProperties ${schema.minProperties}`);
    }
    for (const key of Object.keys(value)) {
      const child = Object.hasOwn(properties, key) ? properties[key] : undefined;
      const where = pointer === '' ? key : `${pointer}.${key}`;
      if (child !== undefined) {
        validateNode(child, value[key], where, root, problems);
      } else if (schema.additionalProperties === false) {
        problems.push(`${pointer || '(root)'}: unknown property "${key}" (additionalProperties: false)`);
      } else if (typeof schema.additionalProperties === 'object') {
        validateNode(schema.additionalProperties, value[key], where, root, problems);
      }
    }
  }
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// Walk the schema itself: every keyword must be supported, otherwise the guard
// would silently skip a constraint. Unsupported keywords are hard failures.
function auditSchemaKeywords(node, pointer, file, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => auditSchemaKeywords(item, `${pointer}/${i}`, file, out));
    return;
  }
  for (const [keyword, child] of Object.entries(node)) {
    const where = `${pointer}/${keyword}`;
    if (!SUPPORTED_KEYWORDS.includes(keyword)) {
      out.push(`${file}${where}: unsupported JSON-Schema keyword "${keyword}" — extend scripts/validate.mjs or remove it from the schema`);
      continue;
    }
    if (ANNOTATION_KEYWORDS.includes(keyword)) continue;
    if (keyword === 'properties' || keyword === '$defs') {
      for (const [name, sub] of Object.entries(child)) {
        auditSchemaKeywords(sub, `${where}/${name}`, file, out);
      }
      continue;
    }
    if (keyword === 'items' || keyword === 'additionalProperties' || keyword === 'allOf' || keyword === 'anyOf') {
      auditSchemaKeywords(child, where, file, out);
      continue;
    }
    if (keyword === 'required' || keyword === 'enum' || keyword === 'const' || keyword === 'type') continue;
    if (keyword === 'format') {
      if (!SUPPORTED_FORMATS.includes(child)) {
        out.push(`${file}${where}: unsupported format "${child}" — only ${SUPPORTED_FORMATS.join(', ')} is asserted`);
      }
      continue;
    }
    if (keyword === '$ref') {
      if (!/^#\/\$defs\/.+$/.test(child)) {
        out.push(`${file}${where}: unsupported $ref "${child}" — only #/$defs/<name> is supported`);
      }
      continue;
    }
    // Scalar assertions (pattern, min/max*, uniqueItems) need no walking.
  }
}

function validateAgainstSchema(schema, value, label, schemaFile) {
  const problems = [];
  try {
    validateNode(schema, value, '', schema, problems);
  } catch (error) {
    if (error instanceof UnsupportedKeyword) {
      fail(`${label} vs ${schemaFile}`, `unsupported keyword encountered: ${error.message}`);
      return;
    }
    throw error;
  }
  if (problems.length === 0) {
    ok(`${label} vs ${schemaFile}`, 'schema satisfied');
    return;
  }
  for (const problem of problems) fail(`${label} vs ${schemaFile}`, problem);
}

// ── file helpers ─────────────────────────────────────────────────────────────

function readText(repoRelative) {
  const absolute = join(ROOT, repoRelative);
  return { absolute, raw: readFileSync(absolute, 'utf8'), size: statSync(absolute).size };
}

function loadJson(repoRelative) {
  const { raw, size } = readText(repoRelative);
  assertCanonicalizableNumbers(raw, repoRelative);
  return { value: JSON.parse(raw), size };
}

// ── path invariants (mirrors repository.rs:423-441 validate_path) ────────────

function pathProblem(path) {
  if (typeof path !== 'string' || path.length === 0) return 'path must be a non-empty string';
  if (path.length > 240) return 'path is longer than 240 characters';
  if (path.startsWith('/')) return 'path must be repository-relative (no leading /)';
  if (path.includes('\\')) return 'path must use / separators';
  if (path.includes('//')) return 'path must not contain empty segments';
  if (path.includes('..')) return 'path must not contain directory traversal (..)';
  if (path.includes('?')) return 'path must not contain a query string';
  if (path.includes('#')) return 'path must not contain a fragment';
  if (path.includes('@') || path.includes(':')) return 'path must not contain credentials';
  if (!path.endsWith('.json')) return 'path must end with .json';
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'path must not contain empty, "." or ".." segments';
  }
  if (!/^[A-Za-z0-9._/+-]+$/.test(path)) {
    return 'path may only contain A-Za-z0-9 . _ / + -';
  }
  const absolute = resolve(ROOT, path);
  if (absolute !== ROOT && !absolute.startsWith(ROOT + sep)) {
    return 'path escapes the repository root';
  }
  return null;
}

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  console.log(`SanBiao repository validation — root ${ROOT}`);
  console.log(`supported JSON-Schema keywords: ${SUPPORTED_KEYWORDS.join(', ')}`);
  console.log('unsupported keywords/formats/$ref targets are hard failures (never silently skipped)');

  section('schemas');
  const schemaFiles = [
    'schemas/repository.schema.json',
    'schemas/core-rule.schema.json',
    'schemas/knowledge-pack.schema.json',
  ];
  const keywordsAudited = [];
  const schemas = new Map();
  for (const file of schemaFiles) {
    let parsed;
    try {
      parsed = loadJson(file);
    } catch (error) {
      fail(`parse ${file}`, error.message);
      continue;
    }
    schemas.set(file, parsed.value);
    ok(`parse ${file}`, `${parsed.size} B`);
    const problems = [];
    auditSchemaKeywords(parsed.value, '', file, problems);
    if (problems.length === 0) {
      ok(`schema keywords in ${file}`, 'every keyword is supported');
    } else {
      for (const problem of problems) fail(`schema keywords in ${file}`, problem);
      keywordsAudited.push(...problems);
    }
  }
  if (keywordsAudited.length > 0 || schemas.size !== schemaFiles.length) {
    console.log('');
    console.log('unsupported/unreadable schema detected — the guard would not enforce it; failing.');
    report();
    process.exit(1);
  }

  const repositorySchema = schemas.get(schemaFiles[0]);
  const coreRuleSchema = schemas.get(schemaFiles[1]);
  const knowledgePackSchema = schemas.get(schemaFiles[2]);

  section('manifest');
  let manifest;
  let manifestSize;
  try {
    const loaded = loadJson('manifest.json');
    manifest = loaded.value;
    manifestSize = loaded.size;
  } catch (error) {
    fail('parse manifest.json', error.message);
    report();
    return;
  }
  if (manifestSize <= MAX_MANIFEST_BYTES) {
    ok('manifest size', `${manifestSize} B ≤ ${MAX_MANIFEST_BYTES} B (256 KiB)`);
  } else {
    fail('manifest size', `${manifestSize} B exceeds ${MAX_MANIFEST_BYTES} B (256 KiB)`);
  }
  validateAgainstSchema(repositorySchema, manifest, 'manifest.json', schemaFiles[0]);

  section('release');
  if (manifest.release === manifest.coreRules?.version) {
    ok('release == coreRules.version', String(manifest.release));
  } else {
    fail(
      'release == coreRules.version',
      `release ${JSON.stringify(manifest.release)} != coreRules.version ${JSON.stringify(manifest.coreRules?.version)}`,
    );
  }

  section('paths');
  const documents = [{ kind: 'coreRules', entry: manifest.coreRules }];
  for (const [index, pack] of (manifest.knowledgePacks ?? []).entries()) {
    documents.push({ kind: `knowledgePacks[${index}]`, entry: pack });
  }
  const seenPaths = new Set();
  const seenIdentities = new Set();
  for (const { kind, entry } of documents) {
    if (entry === undefined || entry === null) {
      fail(`path ${kind}`, 'missing document entry');
      continue;
    }
    const problem = pathProblem(entry.path);
    if (problem) {
      fail(`path ${kind}`, `${JSON.stringify(entry.path)}: ${problem}`);
    } else {
      ok(`path ${kind}`, entry.path);
    }
    const identity = `${entry.id}:${entry.version}:${entry.channel}`;
    if (seenIdentities.has(identity)) fail(`identity ${kind}`, `duplicate document identity ${identity}`);
    seenIdentities.add(identity);
    if (seenPaths.has(entry.path)) fail(`path ${kind}`, `duplicate document path ${entry.path}`);
    seenPaths.add(entry.path);
  }
  section('digests');
  let coreRuleDocument = null;
  for (const { kind, entry } of documents) {
    if (!entry || typeof entry.path !== 'string' || pathProblem(entry.path)) continue;
    let loaded;
    try {
      loaded = loadJson(entry.path);
    } catch (error) {
      fail(`digest ${kind}`, `cannot read ${entry.path}: ${error.message}`);
      continue;
    }
    if (loaded.size > MAX_DOCUMENT_BYTES) {
      fail(`size ${kind}`, `${entry.path} is ${loaded.size} B, limit is ${MAX_DOCUMENT_BYTES} B (1 MiB)`);
    } else {
      ok(`size ${kind}`, `${entry.path} ${loaded.size} B ≤ ${MAX_DOCUMENT_BYTES} B (1 MiB)`);
    }
    let digest;
    try {
      digest = canonicalDigest(loaded.value);
    } catch (error) {
      fail(`digest ${kind}`, `canonicalization failed: ${error.message}`);
      continue;
    }
    if (digest === entry.digest) {
      ok(`digest ${kind}`, `${digest} (${entry.path})`);
    } else {
      fail(
        `digest ${kind}`,
        `${entry.path} canonical SHA-256 is ${digest} but manifest declares ${JSON.stringify(entry.digest)} — recompute with \`node scripts/validate.mjs\` output`,
      );
    }
    // Typed document schema, chosen by which manifest slot referenced it.
    if (kind === 'coreRules') {
      validateAgainstSchema(coreRuleSchema, loaded.value, entry.path, schemaFiles[1]);
    } else {
      validateAgainstSchema(knowledgePackSchema, loaded.value, entry.path, schemaFiles[2]);
    }
    if (kind === 'coreRules') coreRuleDocument = loaded.value;
  }

  if (coreRuleDocument === null) {
    fail('sections', 'the core rule document could not be read, so section invariants were not checked');
  } else {
    checkSections(coreRuleDocument);
  }

  report();
}

function checkSections(document) {
  section('sections');
  const payload = document.payload;
  if (payload === undefined) {
    fail('sections', 'core rule document has no payload');
    return;
  }
  const items = payload.sections?.items ?? [];
  const ids = new Set();
  const claimedBy = new Map();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.id)) fail('section ids', `duplicate section id ${JSON.stringify(item.id)} (items[${index}])`);
    ids.add(item.id);
    for (const strategy of item.strategies ?? []) {
      const previous = claimedBy.get(strategy);
      if (previous !== undefined) {
        fail(
          'strategy ownership',
          `strategy ${JSON.stringify(strategy)} is claimed by both ${JSON.stringify(previous)} and ${JSON.stringify(item.id)} (engine rejects this at rules.rs:178-182)`,
        );
      } else {
        claimedBy.set(strategy, item.id);
      }
    }
  }
  if (ids.size > 0) ok('section ids', `${ids.size} unique ids`);

  const engine = new Set(PROBE_STRATEGY_NAMES);
  const missing = PROBE_STRATEGY_NAMES.filter((name) => !claimedBy.has(name));
  const unknown = [...claimedBy.keys()].filter((name) => !engine.has(name));
  if (missing.length > 0) {
    fail(
      'strategy coverage',
      `no section claims ${missing.join(', ')} — the engine registers every name in PROBE_STRATEGY_NAMES (TheStandard crates/the-standard/src/probe/mod.rs:32) and rejects the bundle. Add each name to exactly one section; if the engine added a strategy, update PROBE_STRATEGY_NAMES in scripts/validate.mjs in the same commit.`,
    );
  }
  if (unknown.length > 0) {
    fail(
      'strategy coverage',
      `unknown strategy ${unknown.join(', ')} — not in the engine's PROBE_STRATEGY_NAMES (TheStandard crates/the-standard/src/probe/mod.rs:32). Either the name is misspelled or scripts/validate.mjs is stale: update the list together with the engine release.`,
    );
  }
  if (missing.length === 0 && unknown.length === 0) {
    ok('strategy coverage', `sections claim all ${PROBE_STRATEGY_NAMES.length} engine strategies exactly once`);
  }

  const defaultEnabled = payload.sections?.defaultEnabled ?? [];
  const unknownDefaults = defaultEnabled.filter((id) => !ids.has(id));
  const duplicates = defaultEnabled.filter((id, i) => defaultEnabled.indexOf(id) !== i);
  if (unknownDefaults.length > 0) {
    fail('defaultEnabled', `unknown section id(s) ${unknownDefaults.join(', ')} (must be a subset of items[].id)`);
  } else if (duplicates.length > 0) {
    fail('defaultEnabled', `duplicate id(s) ${[...new Set(duplicates)].join(', ')}`);
  } else {
    ok('defaultEnabled', `${defaultEnabled.length} ids ⊆ ${ids.size} declared section ids`);
  }

  section('activation');
  const failuresBeforeActivation = failures.length;
  const activation = payload.probes?.activation;
  if (activation === undefined) {
    fail('activation', 'payload.probes.activation is missing');
    return;
  }
  const present = Object.keys(activation);
  const unknownKeys = present.filter((key) => !ACTIVATION_KEYS.includes(key));
  const missingKeys = ACTIVATION_KEYS.filter((key) => !present.includes(key));
  if (unknownKeys.length > 0) {
    fail('activation keys', `unknown activation key(s) ${unknownKeys.join(', ')} — the engine denies unknown fields (rules.rs:382) and knows: ${ACTIVATION_KEYS.join(', ')}`);
  }
  if (missingKeys.length > 0) {
    fail('activation keys', `missing activation key(s) ${missingKeys.join(', ')} — the engine requires every ProbeActivationRules field (rules.rs:383-399)`);
  }
  if (unknownKeys.length === 0 && missingKeys.length === 0) {
    ok('activation keys', `${present.length} keys match ProbeActivationRules`);
  }
  for (const [key, block] of Object.entries(activation)) {
    for (const field of ['modes', 'protocols']) {
      const values = block?.[field];
      if (!Array.isArray(values) || values.length === 0 || values.length > 3) {
        fail(`activation ${key}.${field}`, 'must be an array of 1 to 3 values');
        continue;
      }
      if (new Set(values).size !== values.length) {
        fail(`activation ${key}.${field}`, `duplicate value(s) in ${JSON.stringify(values)}`);
      }
      const allowed = field === 'modes' ? ALLOWED_MODES : ALLOWED_PROTOCOLS;
      const bad = values.filter((value) => !allowed.includes(value));
      if (bad.length > 0) {
        fail(
          `activation ${key}.${field}`,
          `${bad.map((value) => JSON.stringify(value)).join(', ')} not in the allowed enum ${JSON.stringify(allowed)} (the-standard-contracts/src/lib.rs:115-128)`,
        );
      }
    }
  }
  if (failures.length === failuresBeforeActivation) {
    ok('activation enums', `modes ⊆ ${JSON.stringify(ALLOWED_MODES)}, protocols ⊆ ${JSON.stringify(ALLOWED_PROTOCOLS)}`);
  }
}

function report() {
  console.log('');
  if (failures.length === 0) {
    console.log(`validate: ${checks} checks passed, 0 failed`);
    process.exitCode = 0;
    return;
  }
  console.log(`validate: ${checks} checks, ${failures.length} failed`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}

main();
