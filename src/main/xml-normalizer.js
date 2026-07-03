/**
 * xml-normalizer.js
 *
 * Instead of trying to strip known volatile metadata elements (fragile, whack-a-mole),
 * we take the opposite approach: extract ONLY the logic-bearing content from each
 * SimaticML block XML and discard everything else.
 *
 * Logic content = Interface (parameters/variables) + NetworkSource (actual code)
 * Everything else (ExportSetting, InstalledProducts, timestamps, UI comments,
 * network titles, cross-reference data, etc.) is intentionally ignored.
 */

'use strict';

/**
 * Extract only the logic content from a SimaticML block XML for diffing.
 *
 * For SCL blocks: returns the plain SCL source text (most readable).
 * For all others: returns Interface + each NetworkSource, UID-stripped.
 *
 * @param {string} xml  Full SimaticML XML string
 * @returns {string}    Canonical logic-only string, ready for line diffing
 */
function extractBlockLogic(xml) {
  if (!xml) return '';

  // SCL: extract the plain source text — best possible diff quality
  const scl = extractSclSource(xml);
  if (scl !== null) return scl;

  const parts = [];

  // Interface: parameter and variable definitions (relevant for all block types)
  const ifaceMatch = xml.match(/<Interface>([\s\S]*?)<\/Interface>/);
  if (ifaceMatch) {
    const cleaned = stripVolatileAttrs(ifaceMatch[1]).trim();
    if (cleaned) {
      parts.push('[Interface]');
      parts.push(cleaned);
    }
  }

  // Networks: extract logic from each CompileUnit's NetworkSource
  const netRe = /<NetworkSource>([\s\S]*?)<\/NetworkSource>/g;
  let m;
  let netIdx = 0;
  while ((m = netRe.exec(xml)) !== null) {
    netIdx++;
    const cleaned = stripVolatileAttrs(m[1]).trim();
    if (cleaned) {
      parts.push(`[Network ${netIdx}]`);
      parts.push(cleaned);
    }
  }

  // If nothing was found (e.g. empty DB), fall back to stripping the whole doc
  if (parts.length === 0) {
    return stripVolatileAttrs(xml);
  }

  return parts.join('\n');
}

/**
 * Strip volatile UId/IId/RefId attributes that change on every export
 * without affecting block logic.
 */
function stripVolatileAttrs(fragment) {
  return fragment
    .replace(/\s+UId="[^"]*"/g, '')
    .replace(/\s+IId="[^"]*"/g, '')
    .replace(/\s+RefId="[^"]*"/g, '');
}

/**
 * For SCL blocks: extract the plain source text from StructuredText token sequences.
 * Returns the SCL source as a plain string, or null if the block is not SCL.
 */
function extractSclSource(xml) {
  if (!xml) return null;

  if (!/<ProgrammingLanguage>SCL<\/ProgrammingLanguage>/.test(xml)) return null;

  const structuredTextMatch = xml.match(/<StructuredText>([\s\S]*?)<\/StructuredText>/);
  if (!structuredTextMatch) return null;

  const inner = structuredTextMatch[1];
  const lines  = [];
  let   line   = '';

  const tokenRe = /<(\w+)(?:[^>]*)>([\s\S]*?)<\/\1>|<(\w+)(?:[^>]*?)\/>/g;
  let m;

  while ((m = tokenRe.exec(inner)) !== null) {
    const elemName = m[1] || m[3];
    const elemText = m[2] || '';

    switch (elemName) {
      case 'Token':
      case 'Attribute':
      case 'Access':
        line += elemText;
        break;
      case 'Blank': {
        const cntMatch = m[0].match(/Cnt="(\d+)"/);
        const cnt = cntMatch ? parseInt(cntMatch[1], 10) : 1;
        line += ' '.repeat(cnt);
        break;
      }
      case 'NewLine':
        lines.push(line);
        line = '';
        break;
      case 'LineComment':
        line += '//' + elemText;
        break;
      default:
        break;
    }
  }

  if (line) lines.push(line);
  return lines.join('\n');
}

module.exports = { extractBlockLogic, extractSclSource, stripVolatileAttrs };
