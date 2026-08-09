(() => {
  const copy = {
    en: ["You’re offline", "Builderforce can’t reach the network right now. Your browser-held work remains on this device. Reconnect, then try again.", "Try again"],
    zh: ["您已离线", "Builderforce 目前无法连接网络。浏览器中保存的工作仍保留在此设备上。请重新连接后重试。", "重试"],
    es: ["Estás sin conexión", "Builderforce no puede conectarse a la red ahora mismo. El trabajo guardado en el navegador permanece en este dispositivo. Vuelve a conectarte e inténtalo de nuevo.", "Intentar de nuevo"],
    fr: ["Vous êtes hors ligne", "Builderforce ne peut pas accéder au réseau pour le moment. Votre travail enregistré dans le navigateur reste sur cet appareil. Reconnectez-vous, puis réessayez.", "Réessayer"],
    de: ["Du bist offline", "Builderforce kann das Netzwerk gerade nicht erreichen. Deine im Browser gespeicherte Arbeit bleibt auf diesem Gerät. Stelle die Verbindung wieder her und versuche es erneut.", "Erneut versuchen"],
  };
  const locale = (document.cookie.match(/(?:^|; )NEXT_LOCALE=([^;]+)/)?.[1] || navigator.language || 'en').slice(0, 2);
  const [title, message, retry] = copy[locale] || copy.en;
  document.documentElement.lang = locale in copy ? locale : 'en';
  document.title = `Builderforce.ai — ${title}`;
  document.getElementById('title').textContent = title;
  document.getElementById('message').textContent = message;
  document.getElementById('retry').textContent = retry;
  document.getElementById('retry').addEventListener('click', () => location.reload());
})();
