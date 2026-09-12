Dentro de Builderforce hay una decisión de diseño que parece un pequeño detalle de cortesía en la interfaz y que, en realidad, es la que sostiene todo lo demás: **leer una idea y elegir una prueba son pasos separados de crear, y ninguno de los dos cuesta nada.**

Dos botones, no uno. Un plan que puedes revisar antes de que ocurra nada. Es la diferencia entre una herramienta que te ayuda a decidir y una herramienta que decide por ti mientras aparenta ayudarte.

```bf-figure
{
  "kind": "flow",
  "title": "Tres actos, dos de ellos gratis",
  "steps": [
    { "label": "Leer", "note": "Entra texto, sale una especificación. Sin escribir en el lienzo, sin tickets, sin agentes, sin presupuesto de ejecución.", "hue": "read", "tag": "gratis" },
    { "label": "Demostrar", "note": "Ocho pruebas ordenadas frente a esa especificación, cada una encabezada por la pregunta que responde.", "hue": "prove", "tag": "gratis" },
    { "label": "Crear", "note": "La prueba elegida, materializada. Es el único acto que gasta algo.", "hue": "build", "tag": "gasta" }
  ],
  "caption": "Si los actos que deciden si merece la pena hacer el caro tuvieran precio, la gente se los saltaría. Por eso no lo tienen."
}
```

## Primer acto: leer no escribe nada

Pégalo todo. El correo, las bases del concurso, la sección del RFP, el párrafo que escribiste a medianoche. No hace falta ordenar nada antes: ordenarlo es trabajo, y el trabajo previo al primer resultado es justo lo que hace que la gente no llegue a probar.

Lo que recibes es una especificación: qué tiene que hacer la cosa, qué capacidades nombra el texto y qué restricciones fijó el propio briefing. La lectura hace primero una pasada heurística y le suma encima la lectura de un modelo, así que un briefing pegado nunca vuelve vacío: una especificación en blanco sería indistinguible de una función rota, y ambas te harían marcharte.

Tres propiedades del paso de lectura que merece la pena mencionar porque son poco habituales:

- **Es idempotente y no tiene precio.** Lee, cambia dos frases, vuelve a leer. Cuatro veces. No se acumula nada.
- **Te muestra su lectura antes de actuar sobre ella.** Puedes discrepar de la especificación, algo que solo es posible porque puedes verla.
- **Volver a leer un texto editado descarta la lectura anterior.** Las palabras que ves en pantalla son la fuente. Planificar en silencio sobre la interpretación de ayer de un briefing ya editado es un bug casi imposible de detectar.

```bf-figure
{
  "kind": "compare",
  "title": "Qué pasa entre el botón y el resultado",
  "columns": [
    {
      "title": "Herramientas de un solo botón",
      "hue": "bad",
      "items": [
        "Lo describes y empieza la construcción.",
        "Nunca ves la interpretación, solo su resultado.",
        "Qué construir lo decidió un valor por defecto.",
        "Parar significa deshacer.",
        "El primer control honesto llega después de gastar el dinero."
      ]
    },
    {
      "title": "Leer, luego Demostrar, luego Crear",
      "hue": "good",
      "items": [
        "Lo describes y recibes una lectura con la que puedes discutir.",
        "Ocho opciones, cada una con la pregunta que responde y su coste.",
        "La elección es tuya y es explícita.",
        "Parar significa cerrar la pestaña.",
        "El control llega antes de gastar nada."
      ]
    }
  ]
}
```

## Segundo acto: el selector es el producto

La pantalla intermedia es la que la mayoría de las herramientas no tienen, y es deliberadamente el centro de la superficie, no un desplegable de paso hacia la construcción.

Cada tarjeta empieza por **la pregunta que responde su prueba**, no por lo que produce. Ese orden es todo el argumento: elegir una prueba es elegir qué pregunta estás dispuesto a pagar por responder, y una tarjeta que empieza con «una landing page y un formulario» te invita a comparar entregables. Una tarjeta que empieza con *«¿De verdad alguien quiere esto?»* te invita a comparar dudas, que es la comparación que deberías estar haciendo.

Debajo de cada una hay dos indicadores: fidelidad y esfuerzo, sobre cinco. Cinco puntos se leen más rápido que un párrafo, y esos dos ejes son, de verdad, todo lo que importa en la decisión una vez que sabes qué pregunta te estás haciendo.

La recomendación favorece la prueba más barata que encaja y la marca con «empieza aquí». Nunca arranca con el sistema completo en producción. Es el único punto en el que el producto se permite tener opinión a costa de parecer menos capaz, y conviene explicar por qué. Un recomendador que se lanzara a por la construcción completa porque un briefing menciona tres integraciones solo estaría dándote la razón en lo que ya habías decidido. Eso no es un consejo; es una máquina para sentirse validado.

## Tercer acto: qué produce realmente una construcción

Entonces pulsas el segundo botón, y este sí gasta.

```bf-figure
{
  "kind": "stack",
  "title": "Una construcción, cinco resultados",
  "bands": [
    { "label": "Archivos en el lienzo", "note": "Páginas, scripts, consolas y actas de proyecto: objetos reales en tu proyecto, editables, no una vista previa.", "hue": "make" },
    { "label": "Endpoints en marcha", "note": "Handlers que responden en tu dirección de entrada en cuanto se guardan. Sin desfase entre lo desplegado y lo visible.", "hue": "make" },
    { "label": "Tickets en el tablero", "note": "Sembrados de forma idempotente, divididos entre configuración humana y construcción por agentes. Los tickets de construcción se ofrecen al control del carril autónomo.", "hue": "run" },
    { "label": "Un sitio publicado", "note": "El lienzo completo, no solo esta pasada: un proyecto acumula pruebas, y al publicar se reemplaza el sitio.", "hue": "run" },
    { "label": "Una dirección", "note": "Algo que puedes enviarle a alguien. Esto es lo que significa \"real\" en la práctica.", "hue": "measure", "tag": "lo importante" }
  ],
  "caption": "Además de una lista de preparación: lo que aún falta para que funcione, separado en bloqueante y opcional, con el enlace a la consola de cada cosa."
}
```

Algunos de estos puntos encierran lecciones que costó aprender.

**La publicación ocurre antes de crear las colecciones, y ese orden es clave.** La fila del sitio no existe hasta la primera publicación, y la colección de un formulario necesita un id de sitio. Si te saltas el paso de la colección, el endpoint del formulario devuelve un 404, que es idéntico byte a byte a una colección *cerrada*. El resultado es una landing page que informa de cero demanda para una idea que la gente sí quería. Es el peor fallo posible de esta función, y es un bug de orden, no de lógica.

**Los webhooks sin verificar no tienen valor por defecto.** Un endpoint público que no verifica a quien lo llama permite que cualquiera falsifique un mensaje de cliente y gaste el saldo de tu cuenta. Por eso la verificación es obligatoria en lugar de venir por defecto, y si falta el secreto, falla de forma cerrada con un 403: es un sistema que funciona rechazando una petición no autenticada, no una caída.

**Un paso que falla sigue devolviendo una respuesta bien formada.** Un 500 a un proveedor de telefonía corta la llamada. Con un proveedor de comercio, diecinueve fallos seguidos eliminan la suscripción por completo. Así que un paso que falla se resuelve vacío y el handler responde igualmente, degradado y honesto, en lugar de tumbar la integración para avisar de que algo ha ido mal.

## La consecuencia en el precio

Esta forma tiene una consecuencia en el precio que conviene decir en voz alta en lugar de enterrarla en una tabla: **Leer y Demostrar son gratis en todos los planes.** Solo Crear gasta presupuesto de ejecución.

No es generosidad. Es el único precio coherente con el método. Si decidir costara dinero, la gente decidiría menos, y decidir menos es precisamente el fallo que todo esto existe para evitar.

## Dónde se cierra el bucle

Crear no es el final. Cada prueba llevó a la construcción una condición de parada —un umbral, una tasa de aciertos, una tasa de finalización, una fecha de salida— y ese número se evalúa en Medir. Después, la respuesta vuelve a Idea, y lees la siguiente versión del briefing sabiendo algo que antes no sabías.

Tres actos, ejecutados una y otra vez: eso es el método. Una sola pasada por ellos es solo un proyecto.

---

*Pruébalo con algo real: [abre un lienzo](/create/new) y describe la idea; con la sesión iniciada, `/realize` la lee y te muestra la clasificación. Relacionado: [Ocho formas de hacer real una idea](/blog/eight-ways-to-make-an-idea-real) y [De la idea a lo real, la metodología operativa](/blog/idea-to-real-the-operating-methodology).*
