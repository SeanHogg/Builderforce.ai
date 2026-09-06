// Keys for the 2026-09-06 dead-code pass: the "set a password" panel that gives the
// existing add-password endpoint its first consumer (OAuth-only accounts).
// Apply: node scripts/i18n-merge.mjs scripts/i18n-patch-set-password.mjs
export const PATCHES = {
  en: {
    security: {
      setPassword: {
        title: 'Set a password',
        subtitle: 'You signed up with a provider. Add a password so you can also sign in with your email.',
        password: 'New password',
        confirm: 'Confirm password',
        save: 'Set password',
        saving: 'Saving…',
        done: 'Password set. You can now sign in with your email.',
        failed: 'The password could not be set.',
        tooShort: 'Use at least {min} characters.',
        mismatch: 'The two passwords do not match.',
      },
    },
  },
  zh: {
    security: {
      setPassword: {
        title: '设置密码',
        subtitle: '您是通过第三方账户注册的。添加密码后，也可以使用邮箱登录。',
        password: '新密码',
        confirm: '确认密码',
        save: '设置密码',
        saving: '保存中…',
        done: '密码已设置。现在可以使用邮箱登录。',
        failed: '无法设置密码。',
        tooShort: '至少使用 {min} 个字符。',
        mismatch: '两次输入的密码不一致。',
      },
    },
  },
  es: {
    security: {
      setPassword: {
        title: 'Establecer una contraseña',
        subtitle: 'Te registraste con un proveedor. Añade una contraseña para poder iniciar sesión también con tu correo.',
        password: 'Nueva contraseña',
        confirm: 'Confirmar contraseña',
        save: 'Establecer contraseña',
        saving: 'Guardando…',
        done: 'Contraseña establecida. Ya puedes iniciar sesión con tu correo.',
        failed: 'No se pudo establecer la contraseña.',
        tooShort: 'Usa al menos {min} caracteres.',
        mismatch: 'Las dos contraseñas no coinciden.',
      },
    },
  },
  fr: {
    security: {
      setPassword: {
        title: 'Définir un mot de passe',
        subtitle: 'Vous vous êtes inscrit via un fournisseur. Ajoutez un mot de passe pour pouvoir aussi vous connecter avec votre e-mail.',
        password: 'Nouveau mot de passe',
        confirm: 'Confirmer le mot de passe',
        save: 'Définir le mot de passe',
        saving: 'Enregistrement…',
        done: 'Mot de passe défini. Vous pouvez maintenant vous connecter avec votre e-mail.',
        failed: 'Le mot de passe n’a pas pu être défini.',
        tooShort: 'Utilisez au moins {min} caractères.',
        mismatch: 'Les deux mots de passe ne correspondent pas.',
      },
    },
  },
  de: {
    security: {
      setPassword: {
        title: 'Passwort festlegen',
        subtitle: 'Sie haben sich über einen Anbieter registriert. Legen Sie ein Passwort fest, um sich auch mit Ihrer E-Mail anmelden zu können.',
        password: 'Neues Passwort',
        confirm: 'Passwort bestätigen',
        save: 'Passwort festlegen',
        saving: 'Wird gespeichert…',
        done: 'Passwort festgelegt. Sie können sich jetzt mit Ihrer E-Mail anmelden.',
        failed: 'Das Passwort konnte nicht festgelegt werden.',
        tooShort: 'Verwenden Sie mindestens {min} Zeichen.',
        mismatch: 'Die beiden Passwörter stimmen nicht überein.',
      },
    },
  },
};
