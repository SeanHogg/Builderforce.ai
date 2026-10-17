# Tu app ahora te responde: su consola, conexiones en vivo y una copia que puedes llevarte

Una app que se ejecuta delante de ti pero no puede decirte qué está haciendo es una captura de pantalla que se mueve.

Eso se acercaba a la verdad más de lo que nos gustaba. Una app de Builderforce se ejecutaba en tu navegador, pero en cuanto hacía algo interesante —registrar una advertencia, abrir una conexión en vivo, guardar una cookie de inicio de sesión— la vista previa se quedaba en silencio. El Brain veía los fallos y nada más. Una app de chat hecha con WebSockets no se conectaba a nada. Un inicio de sesión funcionaba una vez y te olvidaba al siguiente clic. Y cada vez que volvías, el proyecto empezaba con un `npm install` completo, como si nunca te hubiera visto.

Esta versión cierra esas brechas. Todas están en el mismo sitio: el ciclo entre hacer un cambio y ver qué ha provocado.

## Lo que la app te cuenta ahora

```bf-figure
{
  "kind": "screen",
  "frame": "El espacio de trabajo de Studio, con la pestaña Consola abierta",
  "ratio": 1.62,
  "regions": [
    { "label": "Tu app en ejecución", "note": "La vista previa, con el ancho que elegiste", "x": 4, "y": 6, "w": 58, "h": 56, "hue": "make" },
    { "label": "Brain", "note": "Lee la misma consola que tú", "x": 66, "y": 6, "w": 30, "h": 56, "hue": "idea" },
    { "label": "Consola", "note": "Cada registro, advertencia y error que escribe la app, filtrado por nivel y con las repeticiones contadas", "x": 4, "y": 66, "w": 92, "h": 28, "hue": "run", "tag": "nuevo" }
  ],
  "caption": "La pestaña Consola está junto a Terminal, Salida y Problemas. Lo que escribe la app aparece aquí mientras se ejecuta, desde cada página que sirve."
}
```

- **Una pestaña Consola.** Todo lo que tu app escribe con `console.log`, `warn` o `error` aparece junto a la terminal, en el momento en que ocurre. Puedes filtrar por nivel, las líneas repetidas se cuentan en lugar de amontonarse y cada ejecución empieza con la consola limpia.
- **El Brain también la lee.** Pregunta «¿por qué está vacío el carrito?» y el Brain puede mirar lo que la app ha registrado de verdad, no solo si ha fallado. Después de una corrección, puede volver a leer la consola para comprobar si la advertencia ha desaparecido.
- **Todas las páginas, no solo la primera.** Los errores y registros llegan de las páginas del servidor de desarrollo y también de las que devuelve un servidor Node. Una app Express con cinco rutas informa desde las cinco.

## Apps que siguen conectadas

Mucho de lo que la gente construye funciona en vivo: chats, paneles que se actualizan, tableros multijugador, barras de progreso para tareas largas. Todo eso depende de tres cosas que una vista previa en el navegador normalmente no puede hacer, y ahora las tres funcionan.

```bf-figure
{
  "kind": "compare",
  "title": "Dentro de la vista previa",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Las respuestas llegaban de golpe, cuando el servidor terminaba", "Los WebSockets no tenían adónde conectarse", "La cookie de inicio de sesión se perdía en la siguiente petición", "Los scripts de shell con if, for o while fallaban"] },
    { "title": "Ahora", "hue": "run", "items": ["Los Server-Sent Events y el progreso llegan a medida que se escriben", "Los WebSockets se conectan al propio servidor de la app y traen de vuelta sus envíos", "Las sesiones se mantienen: las cookies que fija el servidor vuelven en cada petición", "Los scripts de shell con if, for, while, case y funciones se ejecutan tal como están escritos"] }
  ],
  "caption": "Todo se ejecuta en la pestaña de tu navegador, sin ningún servidor nuestro de por medio y sin cabeceras especiales en tu sitio."
}
```

Lo mismo vale para los comandos del README de un proyecto. `pnpm install`, `yarn dev` y `pnpm dlx` funcionan tal como están escritos, junto a npm.

## Vuelve a donde lo dejaste

```bf-figure
{
  "kind": "flow",
  "title": "Tu segunda visita",
  "steps": [
    { "label": "Abre el proyecto", "note": "El mismo package.json que la última vez", "hue": "make" },
    { "label": "Restaurar", "note": "Los paquetes instalados en tu última visita vuelven desde el almacenamiento de este navegador", "hue": "run", "tag": "segundos, no minutos" },
    { "label": "Ejecutar", "note": "El servidor de desarrollo arranca enseguida. Si el package.json ha cambiado, se instala como siempre", "hue": "run" }
  ],
  "caption": "Los paquetes instalados se guardan en tu dispositivo, para tus proyectos más recientes. Cambia una dependencia y la siguiente ejecución instala desde cero y conserva esa versión."
}
```

La primera ejecución de un proyecto instala sus paquetes como siempre. A partir de ahí, se guardan en tu navegador. En tu próxima visita se restauran y se pasa directamente a ejecutar, y las instalaciones que hace el propio Brain usan el mismo almacenamiento.

## Llévatela contigo

**Descargar proyecto** está en el menú Más de Studio y en la barra de paneles de la app del lienzo. Obtienes un zip con el código fuente de tu app, sin `node_modules` ni salida de compilación, listo para abrir en cualquier editor, subir a cualquier hosting o pasárselo a quien quieras. Lo que construyes en Builderforce siempre ha sido tuyo. Ahora, además, está a un clic.

## Dónde encaja en el método

Construir es el tercer acto de [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop), y el más caro. Una vez dentro, toda la experiencia se reduce a lo corto que sea el camino entre *cambiar algo* y *saber qué ha provocado*.

Cada una de las brechas anteriores era un punto donde ese camino se rompía. O la app hacía algo que no podías ver, o no podía hacer lo que haría la app real, o volver te costaba los primeros minutos. Cerrarlas mantiene honesto el acto de Construir: lo que ves en la vista previa es lo que hará la app. Y después, el botón de descarga lleva tu trabajo de Hacer a Operar, en la plataforma que elijas para ejecutarlo.

## Lo que puedes hacer hoy

- **Abre la pestaña Consola** mientras se ejecuta tu app, o pregúntale al Brain qué está registrando la app.
- **Construye algo en vivo:** un chat, un panel que se actualiza, una subida con barra de progreso. Y úsalo en la vista previa.
- **Inicia sesión en tu propia app** y sigue con la sesión iniciada.
- **Vuelve mañana** y sáltate la reinstalación.
- **Descarga el proyecto** y llévatelo a donde quieras.

---

**Lecturas relacionadas:** [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers es de código abierto](/blog/builderforce-webcontainers-open-source)

[Abre un lienzo](/create) y construye algo que necesite seguir conectado.
