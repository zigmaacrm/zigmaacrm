const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'messages-recv.js');

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');
  if (content.includes('sendRetryRequest(node, !encNode)')) {
    content = content.replace('sendRetryRequest(node, !encNode)', 'sendRetryRequest(node, true)');
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('[Patch Baileys] Successfully patched sendRetryRequest to force key bundle in retry receipts.');
  } else {
    console.log('[Patch Baileys] Target line already patched or not found.');
  }
} else {
  console.log('[Patch Baileys] Target file does not exist yet.');
}
