Una revisión se queda atascada en «Judging». Lo ves. Puedes hacerle una captura. Y no tienes ni idea de cuál de cuatro mil archivos es el responsable.

Ese es el hueco. El síntoma vive en una pantalla y la causa vive en una base de código, y nada los une salvo quien casualmente lo recuerde. Así que la gente recurre a un grafo, y el grafo dibuja cada archivo como un punto, y los puntos no te dicen nada. Una imagen de miles de nodos no es una respuesta a «¿por dónde pasa esto?». Es la misma pared de archivos con un fondo más bonito.

## Un mapa, dibujado como una red de transporte

La vista de conocimiento ahora muestra una base de código como una ciudad muestra sus trenes: con **líneas**. Cada línea empieza en un punto de entrada, una ruta, una pantalla o un job, atraviesa las capas por las que pasa y termina en los almacenes y servicios externos que toca. Lees un recorrido en lugar de un montón.

```bf-figure
{
  "kind": "screen",
  "frame": "La vista de conocimiento, como mapa",
  "ratio": 1.62,
  "regions": [
    { "label": "Barra de consulta", "note": "Escribe una pregunta o pega una captura de pantalla", "x": 4, "y": 6, "w": 92, "h": 9, "hue": "idea" },
    { "label": "Líneas desde cada punto de entrada", "note": "Puntos de entrada, a través de las capas, hasta almacenes y servicios externos", "x": 4, "y": 19, "w": 62, "h": 60, "hue": "make" },
    { "label": "Qué muestra esto", "note": "Los hallazgos del recorrido que seleccionaste", "x": 69, "y": 19, "w": 27, "h": 60, "hue": "measure" },
    { "label": "Vistas", "note": "Map, System, Graph, Mind map, Tower 3D, Heat, List, Sequence", "x": 4, "y": 84, "w": 46, "h": 10, "hue": "accent" },
    { "label": "Superposiciones", "note": "Cualquier medida puede controlar el color, el tamaño, el anillo, el grosor de línea o el pulso", "x": 53, "y": 84, "w": 43, "h": 10, "hue": "accent" }
  ],
  "caption": "Una sola superficie. La misma base de código puede leerse como un mapa, un sistema de N capas, un grafo, un mapa mental, una torre 3D, un mapa de calor, una lista o una secuencia, sin empezar de nuevo."
}
```

Puedes hacer preguntas en lugar de elegir lentes. **¿Por dónde pasa?** **¿Qué está mal?** **¿Qué no tiene pruebas?** **¿Qué patrones hay aquí?** **¿Qué ha cambiado?** Cada pregunta configura por ti la vista y la superposición, de modo que la respuesta es lo primero que aparece en pantalla.

## Pega la captura

Esta es la parte que cambia la tarde. Suelta la captura en la barra de consulta. Un modelo de visión lee el texto visible en ella. Después toma el relevo una búsqueda simple: compara ese texto con tus catálogos de traducción y con tu código fuente, encuentra los archivos y avanza un import más. La vista se filtra hasta el código que hay detrás de lo que viste.

```bf-figure
{
  "kind": "flow",
  "title": "De una pantalla atascada a los archivos que hay detrás",
  "steps": [
    { "label": "Pegar", "note": "Una captura de la revisión atascada en Judging entra en la barra de consulta.", "hue": "idea" },
    { "label": "Leer", "note": "Un modelo de visión lee las palabras visibles. No se adivina nada más.", "hue": "idea" },
    { "label": "Emparejar", "note": "La búsqueda lleva esas palabras, a través de los catálogos de traducción y el código fuente, hasta los archivos, y un salto de import más allá.", "hue": "make" },
    { "label": "Etiquetar", "note": "Cada coincidencia indica cómo se encontró: exacta, de catálogo o de import.", "hue": "make", "tag": "puedes juzgarlo" },
    { "label": "Diagnosticar", "note": "Entrega el recorrido y sus hallazgos al agente, que trabaja con sus propias herramientas.", "hue": "run" }
  ],
  "caption": "El emparejamiento es una búsqueda determinista, no la opinión de un modelo. El modelo solo lee los píxeles, y cada coincidencia te dice por qué está en la lista."
}
```

Ese etiquetado es el punto clave. Una coincidencia **exacta** es la propia cadena encontrada en el código. Una coincidencia de **catálogo** llegó a través de los archivos de traducción, la forma habitual en que una palabra en pantalla no es una palabra del código fuente. Una coincidencia de **import** es un vecino, a un salto de distancia. Puedes distinguir una coincidencia segura de una plausible antes de dedicarle un minuto.

Luego **Diagnose with the agent** pasa el recorrido y todo lo que el mapa ya sabe sobre él. El agente no empieza desde una página en blanco y un cuadro de búsqueda.

## Ve lo que está mal, no solo lo que hay

Las superposiciones convierten una métrica en un canal visual, y cualquier métrica puede controlar cualquier canal.

```bf-figure
{
  "kind": "compare",
  "title": "Un grafo de puntos y un mapa sobre el que puedes actuar",
  "columns": [
    { "title": "Un grafo de todo", "hue": "muted", "items": ["Miles de nodos", "El color significa lo que diga la leyenda esta semana", "Te dice la forma, no el problema", "Sigues buscando los archivos a mano"] },
    { "title": "El mapa", "hue": "make", "items": ["Una línea por punto de entrada, así que lees un recorrido", "Antipatrones, complejidad, cobertura, uso, rotación, qué cambió y responsable, cada uno como color, tamaño, anillo, grosor de línea o pulso", "Preguntas que configuran la vista por ti", "Una captura que lo acota al código que hay detrás de un síntoma"] }
  ],
  "caption": "La misma base de código. La diferencia está en si la imagen responde a una pregunta o solo demuestra que la base de código es grande."
}
```

Alrededor del mapa están los paneles a los que recurrirás después:

- **Sync** muestra lo que hay en tu máquina frente a lo que tiene el servidor, y qué archivos se omitieron y por qué, de modo que un hueco en el mapa nunca sea un misterio.
- **Coverage** muestra lo que no tiene pruebas.
- **Patterns** lista los antipatrones del código y dónde se agrupan.
- **API** convierte tus rutas en un esqueleto OpenAPI o una exportación de Postman.
- **Fix queue** aplica una corrección determinista al código sin usar y, en los demás casos, escribe un prompt para el agente.
- **Simulate** hace que el agente escriba y ejecute una prueba que recorre un camino con los valores que elijas, de modo que «¿esto realmente pasa por ahí?» obtenga una respuesta real.

## Dónde encaja en el método

[Idea to Real](/blog/idea-to-real-the-operating-methodology) va de Idea a Make, Run y Measure. Esta capacidad trata de los actos que deciden si gastar, y del que gasta.

**Hace que Read funcione sobre el código que ya tienes.** [Read](/blog/read-prove-build-the-inner-loop) pregunta qué hay realmente, y está pensado para ser gratuito. En un sistema en marcha, «qué hay realmente» solía significar horas entre archivos. El mapa y la barra de preguntas lo reducen a unos minutos, sin gasto de agente hasta que tú decidas.

**Abarata Build al acotarlo.** Build es el acto que cuesta, y una build dirigida a los archivos equivocados es la más cara. Una captura que lleva al agente al recorrido correcto, con los hallazgos adjuntos, significa que el dinero va al cambio y no a la búsqueda de dónde debe hacerse.

**También ayuda a Run y Measure.** En Run, un síntoma en una pantalla en vivo se convierte en un recorrido. En Measure, las mismas superposiciones muestran qué cambió y qué no tiene pruebas, de modo que ves dónde se movió el sistema, no solo que lo hizo.

## Qué puedes hacer hoy

- **Pegar una captura de un bug** y ver los archivos que hay detrás, cada uno etiquetado según cómo se encontró.
- **Preguntar por dónde pasa una petición**, desde su punto de entrada a través de las capas hasta los almacenes y servicios del final.
- **Preguntar qué está mal, qué no tiene pruebas y qué ha cambiado**, y obtener la vista que lo responde.
- **Cambiar entre ocho vistas** de la misma base de código sin perder tu sitio.
- **Exportar tu API** como esqueleto OpenAPI o colección de Postman a partir de las rutas que ya encontró.
- **Limpiar el código sin usar** con una corrección determinista y entregar todo lo demás al agente como un prompt listo.
- **Simular un recorrido** con tus propios valores antes de fiarte de él.

---

**Lecturas relacionadas:** [Apúntalo a una carpeta y mira lo que sabe](/blog/point-it-at-a-folder-and-see-what-it-knows) · [Read, Prove, Build: el bucle interno](/blog/read-prove-build-the-inner-loop) · [Calidad, errores y correcciones con un clic](/blog/quality-error-observability-one-click-fix)

[Abre un lienzo](/create), apúntalo a una carpeta y pega la captura de pantalla que llevas rato mirando.
