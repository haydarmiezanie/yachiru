/**
 * Generates a cryptographically secure 32-byte hexadecimal API key
 * for securing Yachiru programmatic endpoints (YACHIRU_API_KEY).
 */
const crypto = require('crypto');

const apiKey = crypto.randomBytes(32).toString('hex');
console.log('\nGenerated Yachiru API Key (32 bytes / 64 hex characters):');
console.log('---------------------------------------------------------');
console.log(apiKey);
console.log('---------------------------------------------------------');
console.log('To enable programmatic API protection, add to your environment or .env:');
console.log(`YACHIRU_API_KEY="${apiKey}"\n`);
