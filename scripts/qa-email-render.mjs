// QA render test for email templates
// Run with: node scripts/qa-email-render.mjs
import { render } from '@react-email/render';
import React from 'react';
import { EmailLayout } from '../emails/EmailLayout.tsx';
import { FormattedText } from '../emails/FormattedText.tsx';
import { GeneralEmail } from '../emails/GeneralEmail.tsx';
import { BeneficiaryIssueEmail } from '../emails/BeneficiaryIssueEmail.tsx';

let passed = 0, failed = 0;
function check(name, result) {
  const ok = Boolean(result);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  ok ? passed++ : failed++;
}

// ── Test 1: GeneralEmail ─────────────────────────────────────────────────────
console.log('\n=== GeneralEmail ===');
const generalHtml = await render(GeneralEmail({
  subject: 'Test: Your transfer is ready',
  message: 'Paragraph one.\n\nParagraph two with more detail.\nAnd a second line in same paragraph.',
}));

check('Logo img src present',       generalHtml.includes('TassaPay-logo-1.png'));
check('Logo link to tassapay.co.uk', generalHtml.includes('href="https://tassapay.co.uk"'));
check('Subject in heading',         generalHtml.includes('Test: Your transfer is ready'));
check('Paragraph 1',                generalHtml.includes('Paragraph one'));
check('Paragraph 2',                generalHtml.includes('Paragraph two with more detail'));
check('Line break <br> present',    generalHtml.includes('<br') || generalHtml.includes('<br/>') || generalHtml.includes('<br />'));
check('App Store link',             generalHtml.includes('apps.apple.com/us/app/tassapay/id6478577638'));
check('Google Play link',           generalHtml.includes('play.google.com/store/apps/details?id=com.org.tassapay'));
check('WhatsApp link',              generalHtml.includes('api.whatsapp.com'));
check('FCA legal disclaimer',       generalHtml.includes('Efuluus Limited'));
check('FCA reg no 916867',          generalHtml.includes('916867'));
check('Reg number 12167877',        generalHtml.includes('12167877'));
check('Address N17 9EJ',            generalHtml.includes('N17 9EJ'));
check('Copyright 2026',             generalHtml.includes('2026 TassaPay'));

// ── Test 2: BeneficiaryIssueEmail ────────────────────────────────────────────
console.log('\n=== BeneficiaryIssueEmail ===');
const benefHtml = await render(BeneficiaryIssueEmail({
  customerName: 'John Doe',
  transferId: 'TRF-12345',
  amount: '£500',
}));

check('Logo img src present',       benefHtml.includes('TassaPay-logo-1.png'));
check('Customer name',              benefHtml.includes('John Doe'));
check('Transfer ID',                benefHtml.includes('TRF-12345'));
check('Amount',                     benefHtml.includes('£500'));
check('Alert box visible',          benefHtml.includes('on hold'));
check('App Store link',             benefHtml.includes('apps.apple.com'));
check('FCA legal disclaimer',       benefHtml.includes('Efuluus Limited'));

// ── Test 3: FormattedText edge cases ─────────────────────────────────────────
console.log('\n=== FormattedText edge cases ===');

const edgeCases = [
  { input: '', expected: 0, name: 'Empty string → no paragraphs' },
  { input: 'Single line', expected: 1, name: 'Single line → 1 paragraph' },
  { input: 'A\n\nB', expected: 2, name: 'Double newline → 2 paragraphs' },
  { input: 'A\n\n\n\nB', expected: 2, name: 'Multiple blanks → still 2 paragraphs' },
];

for (const { input, expected, name } of edgeCases) {
  const paragraphs = input.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  check(name, paragraphs.length === expected);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`${passed}/${passed + failed} checks passed`);
if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll checks passed ✓');
}
