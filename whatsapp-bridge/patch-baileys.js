// Post-install patch for Baileys: always include a fresh pre-key bundle in the
// first retry receipt, so a contact whose signal session with us is broken can
// re-establish it on the first attempt instead of the second.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const targetFile = path.join(here, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'messages-recv.js');

if (fs.existsSync(targetFile)) {
  const content = fs.readFileSync(targetFile, 'utf8');
  if (content.includes('sendRetryRequest(node, !encNode)')) {
    fs.writeFileSync(targetFile, content.replace('sendRetryRequest(node, !encNode)', 'sendRetryRequest(node, true)'), 'utf8');
    console.log('[patch-baileys] retry receipts now always carry a key bundle.');
  } else {
    console.log('[patch-baileys] already patched or target line not found; nothing to do.');
  }
} else {
  console.log('[patch-baileys] Baileys is not installed yet; nothing to do.');
}
