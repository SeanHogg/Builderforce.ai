/**
 * One-shot catalog patch: adds the BYO auth-alert notice (`providerKeys.authAlert.*`)
 * and the inherited-Evermind hint (`projectEvermind.inheritedHint`) to all five
 * locales, with real translations per locale (never English copies).
 *
 * Idempotent — re-running overwrites the same keys with the same values, so it is
 * safe to run after a merge that already carried them. Mirrors the shape of
 * `i18n-patch-observability.mjs` (one locale block per language).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const MESSAGES = join(here, '..', 'src', 'i18n', 'messages');

const PATCH = {
  en: {
    providerKeys: {
      authAlert: {
        title: 'Not being used',
        notEntitled:
          'This account signed in successfully, but the provider refused the request ({status}) because the plan does not cover it. Reconnect an account whose plan includes it, or upgrade the plan.',
        rejected:
          'The provider rejected this credential ({status}). It has probably expired, been revoked, or been rotated elsewhere — reconnect the account.',
      },
    },
    projectEvermind: {
      inheritedHint:
        'This build shares its parent project’s Evermind, so everything it has learned is available here. Training and settings live on the parent project.',
    },
  },
  zh: {
    providerKeys: {
      authAlert: {
        title: '未被使用',
        notEntitled:
          '该账户已成功登录，但服务商拒绝了请求（{status}），因为当前套餐不包含此功能。请改用套餐包含该功能的账户重新连接，或升级套餐。',
        rejected:
          '服务商拒绝了此凭据（{status}）。它可能已过期、被吊销，或已在别处轮换——请重新连接该账户。',
      },
    },
    projectEvermind: {
      inheritedHint:
        '此构建共享其父项目的 Evermind，因此父项目学到的一切在这里都可用。训练和设置请在父项目中进行。',
    },
  },
  es: {
    providerKeys: {
      authAlert: {
        title: 'No se está usando',
        notEntitled:
          'Esta cuenta inició sesión correctamente, pero el proveedor rechazó la solicitud ({status}) porque el plan no la cubre. Vuelve a conectar una cuenta cuyo plan la incluya, o mejora el plan.',
        rejected:
          'El proveedor rechazó esta credencial ({status}). Es probable que haya caducado, se haya revocado o se haya rotado en otro lugar: vuelve a conectar la cuenta.',
      },
    },
    projectEvermind: {
      inheritedHint:
        'Esta compilación comparte el Evermind de su proyecto principal, así que todo lo que ha aprendido está disponible aquí. El entrenamiento y los ajustes se gestionan en el proyecto principal.',
    },
  },
  fr: {
    providerKeys: {
      authAlert: {
        title: 'Non utilisé',
        notEntitled:
          'Ce compte s’est bien connecté, mais le fournisseur a refusé la requête ({status}) car l’offre ne la couvre pas. Reconnectez un compte dont l’offre l’inclut, ou passez à une offre supérieure.',
        rejected:
          'Le fournisseur a rejeté cet identifiant ({status}). Il a probablement expiré, été révoqué ou renouvelé ailleurs — reconnectez le compte.',
      },
    },
    projectEvermind: {
      inheritedHint:
        'Cette build partage l’Evermind de son projet parent : tout ce qu’il a appris est donc disponible ici. L’entraînement et les réglages se gèrent sur le projet parent.',
    },
  },
  de: {
    providerKeys: {
      authAlert: {
        title: 'Wird nicht verwendet',
        notEntitled:
          'Dieses Konto hat sich erfolgreich angemeldet, aber der Anbieter hat die Anfrage abgelehnt ({status}), weil der Tarif sie nicht abdeckt. Verbinden Sie ein Konto, dessen Tarif sie enthält, oder führen Sie ein Upgrade durch.',
        rejected:
          'Der Anbieter hat diese Zugangsdaten abgelehnt ({status}). Sie sind vermutlich abgelaufen, widerrufen oder anderswo rotiert worden — verbinden Sie das Konto erneut.',
      },
    },
    projectEvermind: {
      inheritedHint:
        'Dieser Build teilt sich das Evermind seines übergeordneten Projekts, daher ist hier alles verfügbar, was es gelernt hat. Training und Einstellungen werden im übergeordneten Projekt verwaltet.',
    },
  },
};

/** Deep-merge `patch` into `target`, creating missing namespaces. */
function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      merge(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

for (const [locale, patch] of Object.entries(PATCH)) {
  const file = join(MESSAGES, `${locale}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  merge(json, patch);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(`patched ${locale}.json`);
}
