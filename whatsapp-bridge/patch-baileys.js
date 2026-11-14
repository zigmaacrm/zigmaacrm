// Post-install patch for Baileys:
// 1. Always include a fresh pre-key bundle in the first retry receipt.
// 2. Prevent QR ref timeout (408) from terminating the socket while waiting for phone pairing code.
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

const socketFile = path.join(here, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'socket.js');
if (fs.existsSync(socketFile)) {
  let sockContent = fs.readFileSync(socketFile, 'utf8');
  if (sockContent.includes('const genPairQR = () => {') && !sockContent.includes('if (creds.pairingCode) return;')) {
    sockContent = sockContent.replace(
      'const genPairQR = () => {',
      'const genPairQR = () => {\n            if (creds.pairingCode) return;'
    );
    fs.writeFileSync(socketFile, sockContent, 'utf8');
    console.log('[patch-baileys] socket genPairQR patched to respect pairingCode.');
  }
}

