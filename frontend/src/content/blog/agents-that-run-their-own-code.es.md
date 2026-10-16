Hay una diferencia silenciosa entre un agente que escribe código y un agente que lo entrega. El primero te pasa archivos. El segundo te pasa archivos que compilan, cuyas pruebas pasan y cuyas dependencias realmente se instalan.

Hasta hoy, el Brain del lienzo y del espacio de trabajo de Studio era del primer tipo. Podía escribir un backend, una página y un archivo de pruebas, y los escribía bien, pero no tenía forma de ejecutar ninguno. Así que la comprobación te tocaba a ti. Abrías la vista previa, encontrabas el error de tipos, lo pegabas de vuelta en el chat, esperabas una corrección y volvías a empezar. El agente estaba seguro; la prueba era cosa tuya.

Esa es la brecha que se cierra hoy. El Brain ahora ejecuta su propio código.

## Lo que el Brain puede hacer ahora

Pide un cambio en una compilación y el Brain puede ejecutar comandos reales sobre ella: `npm install` para añadir un paquete, `npm test` para ejecutar las pruebas, `npm run build` para empaquetarla, `tsc` para comprobar los tipos. Son los mismos comandos que escribirías en una terminal. Cuando uno falla, lee la salida, corrige el código que acaba de escribir y vuelve a ejecutar el comando. Cuando te dice que el cambio está hecho, el cambio ya ha pasado.

```bf-figure
{
  "kind": "screen",
  "frame": "Una compilación en el lienzo, con el Brain comprobando su propio cambio",
  "ratio": 1.6,
  "regions": [
    { "label": "Archivos", "note": "El Brain los edita y luego demuestra la edición", "x": 3, "y": 8, "w": 30, "h": 86, "hue": "make" },
    { "label": "Salida", "note": "npm install · npm test · npm run build · tsc", "x": 36, "y": 8, "w": 30, "h": 54, "hue": "prove" },
    { "label": "Vista previa", "note": "La app en marcha se queda aquí, a anchos reales", "x": 69, "y": 8, "w": 28, "h": 86, "hue": "run" },
    { "label": "Brain", "note": "«Añadí el selector de fecha. Pasan 14 pruebas, la compilación está limpia.»", "x": 36, "y": 66, "w": 30, "h": 28, "hue": "idea" }
  ],
  "caption": "El cambio, la prueba y la app en marcha en un mismo tablero. Lees un resultado, no una suposición."
}
```

Todo se ejecuta en tu navegador. Builderforce tiene su propio entorno de ejecución en el navegador, [BuilderForce WebContainers](/blog/builderforce-webcontainers-open-source), que ya impulsa la vista previa en vivo. Los comandos del Brain se ejecutan en ese mismo entorno, sobre los mismos archivos, en la misma pestaña. No se envía nada a un servidor de compilación y no hay ninguna máquina que aprovisionar. Los archivos que cambia un comando, como un `package.json` actualizado o un archivo de código generado, se guardan de vuelta en tu proyecto; los paquetes instalados y la salida de compilación se quedan donde deben, fuera de tu código fuente.

Como se ejecuta en tu propio navegador, funciona antes de que tengas una cuenta. Empieza un tablero de invitado, pide una app y el Brain también demuestra su trabajo ahí.

```bf-figure
{
  "kind": "flow",
  "title": "Cómo termina el Brain un cambio",
  "steps": [
    { "label": "Escribir", "note": "El Brain edita los archivos de la compilación según lo que pediste.", "hue": "make" },
    { "label": "Ejecutar", "note": "Instala, prueba, compila y comprueba tipos en tu navegador.", "hue": "prove", "tag": "en tu pestaña" },
    { "label": "Corregir", "note": "Un fallo vuelve como salida real; corrige la causa y vuelve a ejecutar.", "hue": "build" },
    { "label": "Contártelo", "note": "Te enteras del cambio cuando ya ha pasado, con lo que ejecutó.", "hue": "measure", "tag": "verificado" }
  ],
  "caption": "El ciclo que una ingeniera cuidadosa recorre antes de pedir una revisión, recorrido por el Brain antes de responderte."
}
```

Conviene conocer dos límites desde el principio. Los paquetes que necesitan complementos nativos o binarios del sistema no se ejecutan en un navegador, y el Brain te dirá cuándo uno de ellos es el problema en lugar de fingir. Y la app en sí sigue ejecutándose en la vista previa en vivo, no como un comando: un servidor de desarrollo nunca termina, así que el Brain demuestra con comandos que sí terminan y deja la ejecución a la vista previa, donde puedes verla.

## Respuestas rápidas en tu propio equipo

La misma versión hace que las preguntas sencillas sean más rápidas y más privadas. Si el modelo integrado de Chrome ya está en tu ordenador, un turno de chat simple, uno en el que el Brain conversa en lugar de usar herramientas, se responde ahí mismo, en tu dispositivo. Si ese modelo no está disponible o no puede responder, el turno pasa a los modelos en la nube de Builderforce sin que notes nada.

```bf-figure
{
  "kind": "compare",
  "title": "Dónde se responde un turno del Brain",
  "columns": [
    { "title": "En tu dispositivo", "hue": "run", "items": ["Conversación simple, sin herramientas", "Solo cuando el modelo integrado de Chrome ya está descargado", "Privado y gratuito", "El mismo nivel responde en Rovr, el asistente de Builderforce para Chrome"] },
    { "title": "Nube de Builderforce", "hue": "make", "items": ["Todo turno que usa herramientas: editar archivos, ejecutar comandos", "Cualquier turno en el que elegiste un modelo concreto", "Siempre que el modelo del dispositivo falte o no pueda responder", "Tomado sin que lo notes, antes de que veas una palabra"] }
  ],
  "caption": "Tu elección de modelo siempre manda. El modelo del dispositivo solo responde turnos que nunca pidieron uno."
}
```

Nunca se usa cuando has elegido un modelo tú mismo, ni para un turno que necesite herramientas, así que el Brain que escribe, ejecuta y corrige tu código es siempre el modelo que esperas.

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco, **Idea → Hacer → Operar → Medir**, y cada acto tiene el mismo ciclo interno: [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop). Esta versión pone ese ciclo en manos del propio Brain, justo donde **Hacer** se convierte en **Operar**.

- **Leer** es donde empieza. Antes de cambiar una compilación, el Brain lee sus archivos y, ahora, la salida real de sus comandos, así que trabaja con lo que el código hace y no con lo que esperaba que hiciera.
- **Probar** es lo nuevo. Un cambio no está terminado cuando está escrito; está terminado cuando se instala, compila, pasa la comprobación de tipos y supera sus pruebas. Es la prueba más pequeña que existe, con el mismo instinto que una **prueba de concepto**: aislar la parte arriesgada y comprobarla contra un listón antes de construir sobre ella.
- **Construir** ocurre sobre esa prueba. El siguiente cambio parte de una compilación que se sabe que funciona, así que una sesión de diez cambios no termina con diez incógnitas.
- **Operar** se queda donde puedes verlo: la vista previa en vivo ejecuta la app que el Brain acaba de demostrar, a anchos reales de dispositivo.
- **Medir** recibe mejores datos. Cada cambio que llega ahí ya ha pasado sus propias comprobaciones, así que lo que mides es la idea, no una errata.

## Lo que puedes hacer hoy

- **Pedir una función y recibir una que compila.** El Brain ejecuta la compilación y la comprobación de tipos antes de decirte que ha terminado.
- **Pedirle que añada pruebas, y que pasen.** Escribe las pruebas, las ejecuta y corrige el código hasta que pasan.
- **Añadir un paquete por su nombre.** El Brain ejecuta la instalación y actualiza `package.json` por ti, en el navegador.
- **Probarlo sin cuenta.** Los tableros de invitado tienen el mismo entorno, porque se ejecuta en tu navegador y en ningún otro sitio.
- **Obtener respuestas rápidas en local.** Si el modelo integrado de Chrome está en tu equipo, el chat sencillo se responde ahí, en privado.

Abre un tablero, describe la app que quieres y mira cómo el Brain demuestra su propio trabajo antes de entregártelo.

---

**Lecturas relacionadas:** [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers es de código abierto](/blog/builderforce-webcontainers-open-source) · [Te presentamos Rovr](/blog/rovr-your-assistant-in-the-browser) · [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop)
