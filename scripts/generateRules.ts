import fs from 'fs';
import path from 'path';

export function generateFirestoreRules(superAdminEmail?: string): string {
  const templatePath = path.resolve(process.cwd(), 'firestore.rules.template');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found at ${templatePath}`);
  }

  const rawTemplate = fs.readFileSync(templatePath, 'utf8');
  const email = (superAdminEmail || process.env.SUPER_ADMIN_EMAIL || 'idarstore24@gmail.com').toLowerCase().trim();

  // Strict email format sanity check
  if (!email || !email.includes('@')) {
    throw new Error(`Invalid SUPER_ADMIN_EMAIL provided for firestore rules generation: "${email}"`);
  }

  const generated = rawTemplate.replace(/\{\{SUPER_ADMIN_EMAIL\}\}/g, email);
  return generated;
}

// Script execution
const isMain = process.argv[1] && process.argv[1].endsWith('generateRules.ts');
if (isMain) {
  const email = process.env.SUPER_ADMIN_EMAIL || 'idarstore24@gmail.com';
  const outputPath = path.resolve(process.cwd(), 'firestore.rules');
  const rules = generateFirestoreRules(email);
  fs.writeFileSync(outputPath, rules, 'utf8');
  console.log(`[Firestore Rules Generator] Successfully generated firestore.rules with super admin: ${email}`);
}
