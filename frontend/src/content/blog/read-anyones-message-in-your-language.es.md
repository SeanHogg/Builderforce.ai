Un equipo que no comparte un idioma pierde contexto en cada traspaso. La decisión tomada en un hilo que solo pudiste leer a medias. El comentario en una tarjeta que te saltaste porque el rodeo no valía la pena. El documento importado que nadie abrió.

La solución habitual es pegar el texto en un traductor. Eso envía tus conversaciones, tus planes y los nombres de tus clientes a un servicio en la nube, mensaje a mensaje, y con volumen real cuesta dinero real.

## Un clic, en tu idioma

Los mensajes y comentarios escritos en otro idioma se traducen automáticamente al aparecer en pantalla, justo donde los estás leyendo. «Mostrar original» está a un clic. Un documento importado recibe una oferta de traducción, y un clic crea una copia traducida a su lado. Sin copiar y pegar, sin una segunda pestaña.

```bf-figure
{
  "kind": "screen",
  "frame": "Un mensaje de una compañera",
  "ratio": 1.62,
  "regions": [
    { "label": "Traducido del español · Mostrar original", "note": "Siempre etiquetado, siempre reversible", "x": 4, "y": 6, "w": 92, "h": 12, "hue": "accent" },
    { "label": "El mensaje, en tu idioma", "note": "Léelo, cítalo, respóndelo", "x": 4, "y": 22, "w": 92, "h": 46, "hue": "make" },
    { "label": "Responder", "note": "Escribes en el tuyo; ella lee en el suyo", "x": 4, "y": 74, "w": 92, "h": 20, "hue": "idea" }
  ],
  "caption": "La traducción dice qué es y de dónde viene. El original está a un clic detrás de la etiqueta, así que nadie tiene que fiarse de una traducción a ciegas."
}
```

## Primero tu dispositivo, después una alternativa gratuita

Chrome incluye un traductor dentro del navegador. Builderforce lo usa primero: el texto se traduce en tu propio dispositivo, así que no viaja a ningún sitio para ser entendido. Si tu navegador no tiene uno, como Edge hoy, entra una traducción en la nube, gratuita dentro de los límites diarios. La función nunca falta, solo es menos privada.

Los resúmenes y las reescrituras siguen el mismo orden. Cuando el navegador puede, se ejecutan primero en el dispositivo (Gemini Nano en Chrome, Phi-4-mini en Edge) y solo pasan a los modelos en la nube cuando no puede.

```bf-figure
{
  "kind": "devices",
  "title": "La misma traducción, trabajes donde trabajes",
  "devices": [
    { "label": "Web", "width": 1280, "hue": "make", "note": "Traduce un mensaje o un comentario de tarjeta en su sitio" },
    { "label": "Rovr", "width": 834, "hue": "run", "note": "Lee una página o un hilo en tu idioma desde el panel lateral del navegador" },
    { "label": "VS Code", "width": 390, "hue": "measure", "note": "Lee la nota de una compañera junto al código al que se refiere" }
  ],
  "caption": "Un solo comportamiento en cada superficie: primero el dispositivo, después un traductor en la nube, gratuito dentro de los límites diarios, y el original siempre a un clic."
}
```

```bf-figure
{
  "kind": "compare",
  "title": "En tu dispositivo o en la nube",
  "columns": [
    { "title": "Traductor en la nube", "hue": "muted", "items": ["Tu texto se envía a un tercero", "De pago por carácter con volumen", "Necesita conexión cada vez", "Otra pestaña y un paso de pegado"] },
    { "title": "Primero en tu dispositivo", "hue": "make", "items": ["El texto se queda en tu ordenador", "Gratis en el dispositivo, leas lo que leas", "Funciona sin conexión una vez instalado el idioma", "Traducido en su sitio, original a un clic"] }
  ],
  "caption": "La alternativa en la nube existe para que nadie se quede sin traducción. Es la segunda opción, no la predeterminada."
}
```

## Dónde encaja en el método

Builderforce funciona como un arco: [Idea, Hacer, Ejecutar, Medir, Alcance](/blog/read-prove-build-the-inner-loop), con Leer, Probar y Construir como el bucle interno que te lleva de la Idea a Hacer. La traducción vive en el primer acto del bucle, **Leer**, dentro de Idea, y lo abre a todo el equipo.

Leer es el acto barato que decide si se construye algo, y solo funciona si puedes leer lo que dice la evidencia. Una entrevista con un cliente en portugués, una especificación de un contratista en Berlín, un comentario de una compañera en Madrid: hasta ahora cada una se saltaba o se enviaba a un servicio. Ahora se puede leer al instante, y la decisión de Hacer se toma con todo lo que sabe el equipo, no solo con la parte escrita en tu idioma.

## Lo que puedes hacer hoy

- **Leer el mensaje de una compañera en tu idioma** al aparecer en pantalla y responder en el tuyo.
- **Traducir un documento importado** en otro idioma a un documento nuevo a su lado, sin salir de la página.
- **Mantener tus conversaciones en tu ordenador** cuando tu navegador tiene traductor (hoy, el traductor integrado de Chrome).
- **Comprobar la fuente** en cualquier momento: cada traducción muestra de dónde viene y deja el original a un clic.

---

**Lecturas relacionadas:** [IA local: WebGPU en el navegador](/blog/local-first-ai-webgpu-in-the-browser) · [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas)

[Abre un lienzo](/create) e invita a alguien que escriba en otro idioma.
