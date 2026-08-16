#!/usr/bin/env node
/**
 * Catalog keys for the register form's discount-code field and age attestation.
 *
 * These shipped as hardcoded English inside `RegisterPageClient.tsx` — a
 * Spanish or German visitor read "Discount code (optional)" and, more seriously,
 * an age attestation they were being asked to tick. Idempotent; run once.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/i18n/messages');

const PATCH = {
  en: {
    discountCodeLabel: 'Discount code',
    discountCodeSaved: 'Saved for checkout after signup.',
    ageAttestation: 'I confirm I am at least 18 years old. BuilderForce is not directed to children.',
  },
  zh: {
    discountCodeLabel: '优惠码',
    discountCodeSaved: '已保存，注册后将在结账时使用。',
    ageAttestation: '我确认本人已年满 18 周岁。BuilderForce 并非面向儿童提供。',
  },
  es: {
    discountCodeLabel: 'Código de descuento',
    discountCodeSaved: 'Guardado para el pago después del registro.',
    ageAttestation: 'Confirmo que tengo al menos 18 años. BuilderForce no está dirigido a menores.',
  },
  fr: {
    discountCodeLabel: 'Code de réduction',
    discountCodeSaved: 'Enregistré pour le paiement après l’inscription.',
    ageAttestation: 'Je confirme avoir au moins 18 ans. BuilderForce ne s’adresse pas aux enfants.',
  },
  de: {
    discountCodeLabel: 'Rabattcode',
    discountCodeSaved: 'Für die Zahlung nach der Registrierung gespeichert.',
    ageAttestation: 'Ich bestätige, dass ich mindestens 18 Jahre alt bin. BuilderForce richtet sich nicht an Kinder.',
  },
};

for (const [locale, keys] of Object.entries(PATCH)) {
  const file = resolve(messagesDir, `${locale}.json`);
  const catalog = JSON.parse(readFileSync(file, 'utf8'));
  catalog.register = { ...catalog.register, ...keys };
  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`${locale}: +${Object.keys(keys).length} register keys`);
}
