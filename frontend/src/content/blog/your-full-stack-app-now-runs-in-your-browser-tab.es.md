# Tu app full-stack ahora se ejecuta en la pestaña del navegador donde la creaste

Describes una app: una página, una API detrás y una base de datos debajo. Los archivos están bien. El blueprint está bien. Y entonces esperas —a que un contenedor se programe, arranque, se instale y se conecte— antes de saber si todo funciona junto.

Esa espera no es un detalle. Es la brecha entre *he hecho algo* y *sé que funciona*, y cada minuto de ella es un minuto en que la idea podría haberse probado en lugar de ponerse en cola.

Esa brecha ha desaparecido. **Run ahora inicia toda tu app dentro de la pestaña del navegador.**

## Qué arranca al pulsar Run

El blueprint de la app de tu proyecto enumera sus servicios. Los servicios Node, Python y PHP —Express o Next.js, FastAPI, Flask, Django, Laravel, Slim— se ejecutan en la pestaña, y la base de datos es un Postgres real que se ejecuta en la página. Están conectados entre sí, y la vista previa en vivo se abre junto al tablero.

```bf-figure
{
  "kind": "flow",
  "title": "Una app full-stack, entera dentro de una pestaña",
  "steps": [
    { "label": "Frontend", "note": "Tu página arranca en su propio entorno y sirve la vista previa en vivo por la que haces clic.", "hue": "make", "tag": "en la pestaña" },
    { "label": "API", "note": "Un servicio Node, Python o PHP responde a las peticiones de la página mediante una conexión virtual con el frontend.", "hue": "run", "tag": "en la pestaña" },
    { "label": "Postgres", "note": "Una base de datos Postgres real, alojada en la página, de modo que consultas, esquema y datos semilla se comportan como lo harán en producción.", "hue": "measure", "tag": "en la pestaña" }
  ],
  "caption": "Tres servicios, dos conexiones, una pestaña del navegador. El código, los datos y las peticiones de la app se quedan en tu pestaña; solo los paquetes se descargan, desde sus registros."
}
```

No hay contenedor que arrancar ni aprovisionar, y la ejecución no consume cómputo en la nube. Las instalaciones siguen ocurriendo —npm, pip y composer se ejecutan en la pestaña antes de la primera página— y el primer Run arranca el entorno de ejecución dentro de la pestaña.

## Ejecución en contenedor frente a ejecución en el navegador

```bf-figure
{
  "kind": "compare",
  "title": "Dos formas de ver la misma app en marcha",
  "columns": [
    { "title": "Ejecutar en un contenedor", "hue": "muted", "items": ["Esperar a que se programe una máquina", "Esperar a que arranque e instale", "Una máquina nueva antes de cada primer vistazo", "Consume cómputo en la nube en cada vistazo", "Adecuado para ejecuciones y despliegues"] },
    { "title": "Ejecutar en el navegador", "hue": "run", "items": ["Sin contenedor que arrancar ni aprovisionar", "Frontend, API y base de datos en una pestaña", "Las instalaciones (npm, pip, composer) se ejecutan en la pestaña", "No cuesta cómputo en la nube", "Adecuado para saber si funciona"] }
  ],
  "caption": "El contenedor sigue ahí, y sigue siendo el lugar para ejecuciones y despliegues. Solo ha dejado de ser el precio de un primer vistazo."
}
```

## El Brain trabaja igual en ambos casos

Ejecutar en otro sitio no serviría de mucho si el asistente no pudiera ver el interior. Puede. Las mismas herramientas de ejecución —leer los logs, reiniciar un servicio, capturar la vista previa— funcionan tanto si la app corre en tu pestaña como en un contenedor. Pregunta al Brain por qué la página de pago devuelve un error y leerá los logs de la API, cambiará el manejador, reiniciará el servicio y capturará la página de nuevo. No necesita saber dónde vive la app.

Importa porque una ejecución rápida es solo la mitad de un ciclo rápido. La otra mitad es un asistente que pueda mirar el resultado y actuar sobre él.

## Dónde encaja en el método

Idea to Real es un arco —**Idea → Make → Run → Measure**— y un ciclo dentro de él: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Leer y probar no cuestan nada, así que la decisión de construir es una decisión. Construir es donde empieza el coste.

Run es la etapa en la que lo que hiciste tiene que sobrevivir al contacto consigo mismo: ¿la página llega a la API, la API llega a los datos, todo el camino hace lo que describiste? Una prueba en el método vale lo que tarda su respuesta. Una prueba de humo, una prueba de concepto, un piloto: cada uno es una pregunta, y conviene hacerla mientras la idea aún está caliente.

```bf-figure
{
  "kind": "stack",
  "title": "El arco, con la etapa Run en la pestaña",
  "bands": [
    { "label": "Idea", "note": "¿Y si...? Léela y elige la prueba más barata que valga la pena pagar.", "hue": "idea" },
    { "label": "Make", "note": "Construye lo único que pidió la prueba: blueprint, servicios, datos.", "hue": "make" },
    { "label": "Run", "note": "Velo funcionar de principio a fin, justo donde lo hiciste, sin esperar a ningún contenedor.", "hue": "run", "tag": "ahora en la pestaña" },
    { "label": "Measure", "note": "Evalúalo frente a la condición de abandono y devuelve el resultado a Idea.", "hue": "measure" }
  ],
  "caption": "Ejecutar solía ser un lugar al que viajabas. Ahora es un estado del tablero en el que ya estás."
}
```

## Qué puedes hacer hoy

- **Pulsar Run y ver tu app full-stack funcionar en la pestaña** —frontend, API y base de datos juntos, sin contenedor que arrancar ni aprovisionar.
- **Probar una idea mientras aún está caliente.** La ejecución arranca en la pestaña en la que ya estás, así que no hay cola entre la pregunta y la respuesta.
- **Probar cambios con libertad.** Una ejecución no cuesta cómputo en la nube, así que reiniciar diez veces para cazar un fallo cuesta lo mismo que reiniciar una.
- **Dejar el ciclo en manos del Brain.** Lee logs, reinicia servicios y captura la vista previa exactamente como haría con un contenedor.
- **Reservar los contenedores para lo que hacen bien** —ejecuciones y despliegues— cuando la app esté lista para salir de la pestaña.

---

**Lecturas relacionadas:** [La app de tu canvas ahora es un proyecto real](/blog/your-canvas-app-is-a-real-project) · [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [Read, Prove, Build: el ciclo interior](/blog/read-prove-build-the-inner-loop)

[Abre un canvas](/create), describe una app con base de datos y pulsa Run.
