Esbozas una idea en el canvas, le pides a Brain un sitio de marketing y pulsas **App**.

Hasta hoy, lo que veías ahí era una vista previa. El canvas tomaba las tarjetas de código del tablero, unía la página y sus hojas de estilo en un solo documento y lo mostraba en un marco. Era útil para mirar cosas. No podía ejecutar la parte de servidor de nada, no podía instalar un paquete y no tenía base de datos. En cuanto la idea necesitaba cualquiera de eso, dejabas el canvas por Studio y empezabas de nuevo en una segunda ventana, con una segunda conversación.

Ahora la pestaña App **es** Studio. Es el mismo espacio de trabajo, dentro del canvas en el que ya estabas.

## Qué abre ahora App

```bf-figure
{
  "kind": "screen",
  "frame": "Un canvas, leído como su app",
  "ratio": 1.62,
  "regions": [
    { "label": "La app en ejecución", "note": "Archivos reales en un servidor de desarrollo real, con recarga en caliente", "x": 4, "y": 10, "w": 46, "h": 56, "hue": "make" },
    { "label": "Archivos", "note": "Ábrelos desde la barra, busca en todo el proyecto", "x": 51, "y": 10, "w": 16, "h": 56, "hue": "accent" },
    { "label": "Terminal · Salida · Problemas", "x": 4, "y": 68, "w": 63, "h": 14, "hue": "run" },
    { "label": "Brain", "note": "El Brain propio del canvas, que ahora puede editar los archivos de la app", "x": 70, "y": 10, "w": 26, "h": 72, "hue": "idea" },
    { "label": "Run · Preview · Code · Database · Publish", "x": 4, "y": 88, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "El canvas conserva su propio chrome: una barra de sesión, un Brain, un arco de etapas. El espacio de trabajo añade sus controles a la barra en lugar de dibujar una segunda barra de herramientas."
}
```

- **Un proyecto real detrás.** Tiene los archivos que escribió el agente, un runtime en el navegador que instala paquetes y ejecuta un servidor de desarrollo (y un servidor Node, si tu app lo tiene), además de una terminal, comprobaciones y una lista de problemas.
- **Un solo Brain.** El panel de Brain de la derecha es el Brain del canvas, con el que ya estabas hablando. Ahora puede listar, leer, buscar y editar los archivos de la app, así que "haz que la cabecera sea fija" cambia el código y la vista previa se actualiza.
- **Tus tarjetas de código se convierten en archivos.** Si estabas construyendo con tarjetas de código en el tablero, App las lleva al proyecto la primera vez que se abre, y de nuevo cada vez que una tarjeta cambia. No se pregunta nada y no se pierde nada.
- **Base de datos y Publish cuando los necesites.** La misma vista Database y el mismo panel Publish que tiene Studio, a un clic desde la barra de sesión.
- **Abrir en Studio** cuando quieras la pantalla completa. Es el mismo proyecto, así que no hay que copiar nada.

## Empieza sin cuenta

```bf-figure
{
  "kind": "flow",
  "title": "De un canvas de invitado a una app duradera",
  "steps": [
    { "label": "Pulsa App", "note": "Elige Website, Mobile o Web + Mobile, o simplemente pídeselo a Brain", "hue": "idea" },
    { "label": "Se ejecuta aquí", "note": "El proyecto vive en tu navegador y se ejecuta sobre el mismo runtime que Studio", "hue": "make", "tag": "sin cuenta" },
    { "label": "Conserva tu trabajo", "note": "Tu tablero se guarda en una cuenta y los archivos de la app pasan con él a un proyecto real", "hue": "run" },
    { "label": "Publica", "note": "Se activan el historial, una base de datos y una dirección en vivo", "hue": "accent" }
  ],
  "caption": "Nada se reconstruye en el traspaso. Los archivos que tenías en el navegador son los archivos con los que empieza el proyecto."
}
```

No necesitas registrarte para averiguar si la idea funciona. Un canvas sin cuenta ejecuta su app sobre archivos guardados en tu navegador, con el mismo runtime que usa Studio. Cuando merezca la pena conservarlo, pulsa **Keep your work**. El tablero pasa a tu cuenta y la app lo acompaña a un proyecto duradero con historial de versiones, una base de datos y publicación.

## Más de una app en un tablero

Un tablero puede contener varias builds: un sitio de marketing y una herramienta de administración, o una app web y su gemela para móvil. App ejecuta una a la vez, y en cuanto hay una segunda aparece un selector en la barra de sesión. Abrir cualquier tarjeta de build del tablero te lleva directamente a ella.

## Dónde encaja en el método

Make es el acto en el que una idea se convierte en algo que puedes usar. También era el acto que se dividía entre dos productos. Read y [Prove](/blog/read-prove-build-the-inner-loop) ocurrían en el canvas, y la construcción seria ocurría en un IDE aparte. La distancia entre ambos era un cambio de contexto, un copiar y pegar la idea y un Brain que empezaba de cero.

```bf-figure
{
  "kind": "compare",
  "title": "De la idea probada a la app en ejecución",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Probar la idea en el canvas", "Abrir Studio en otra ventana", "Volver a explicar la idea a un chat nuevo", "Construir allí", "Volver al canvas para medir"] },
    { "title": "Ahora", "hue": "make", "items": ["Probar la idea en el canvas", "Pulsar App", "Seguir hablando con el mismo Brain", "Ejecutarla y luego Measure en el mismo tablero"] }
  ],
  "caption": "Idea → Make → Run → Measure ahora ocurre en una sola superficie, con una conversación que recorre cada etapa."
}
```

Como la app vive en el mismo tablero que la investigación, la prueba y las métricas, **Run** y **Measure** vienen a continuación sin traspaso. Lo que mides es lo que construyó el tablero, y el Brain que lee los números es el que escribió el código.

## Qué puedes hacer con esto hoy

- **Abre App en cualquier canvas** y construye con archivos reales, paquetes y un servidor, sin salir del tablero.
- **Sigue construyendo con Brain**, que ahora edita directamente el código de tu app.
- **Convierte tarjetas de código existentes en un proyecto en ejecución** con solo abrir App.
- **Pruébalo sin cuenta**, y consérvalo cuando merezca la pena.
- **Cambia entre apps** del mismo tablero, o abre cualquiera de ellas a pantalla completa en Studio.

---

**Lecturas relacionadas:** [Builderforce Studio: describe una app, mírala ejecutarse, conserva cada versión](/blog/builderforce-studio-describe-it-run-it) · [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [Crea antes de registrarte](/blog/create-before-you-sign-up)

[Abre un canvas](/create), pulsa **App** y pide algo que tenga un backend.
