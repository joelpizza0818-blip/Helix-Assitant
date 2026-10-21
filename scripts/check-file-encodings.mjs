import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const TARGET_EXTS = new Set(['.json', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.yml', '.yaml', '.toml', '.rs', '.md', '.spec']);

let files = [];
try {
  files = execSync('git ls-files', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
} catch {
  files = [];
}

const issues = [];
const mojibakeIssues = [];
// Detect typical double-encoded UTF-8 (UTF-8 bytes misinterpreted as latin1/windows-1252) using escape codes
const MOJIBAKE_REGEX = /(\u00C3[\u00A0-\u00BF]|\u00C2[\u00A0-\u00BF]|\u00E2[\u20AC-\u20BD])/;

for (const relPath of files) {
  if (path.basename(relPath) === 'check-file-encodings.mjs') {
    continue;
  }
  const ext = path.extname(relPath);
  if (TARGET_EXTS.has(ext)) {
    try {
      const fd = fs.openSync(relPath, 'r');
      const buf = Buffer.alloc(4);
      const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);

      let isUtf16 = false;
      if (bytesRead >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        issues.push({ path: relPath, type: 'UTF-8 BOM' });
      } else if (bytesRead >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
        issues.push({ path: relPath, type: 'UTF-16 LE/BE' });
        isUtf16 = true;
      }

      const fullBuf = fs.readFileSync(relPath);
      const text = isUtf16 ? fullBuf.toString('utf16le') : fullBuf.toString('utf8');
      const match = text.match(MOJIBAKE_REGEX);
      if (match) {
        mojibakeIssues.push({ path: relPath, sample: match[0] });
      }
    } catch {}
  }
}

if (issues.length > 0 || mojibakeIssues.length > 0) {
  if (issues.length > 0) {
    console.error('\x1b[31m[ERROR] Detected files with prohibited BOM or UTF-16 encoding:\x1b[0m');
    for (const p of issues) {
      console.error(`  - ${p.path} (${p.type})`);
    }
  }
  if (mojibakeIssues.length > 0) {
    console.error('\x1b[31m[ERROR] Detected files with mojibake / corrupted UTF-8:\x1b[0m');
    for (const m of mojibakeIssues) {
      console.error(`  - ${m.path} (matched: ${m.sample})`);
    }
  }
  process.exit(1);
} else {
  console.log('\x1b[32m[PASS] All tracked files have clean UTF-8 encoding (no BOM / UTF-16 / Mojibake).\x1b[0m');
}