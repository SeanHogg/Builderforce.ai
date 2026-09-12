Suelta un currículum en PDF de cinco páginas en un tablero. Recibe a cambio un icono de archivo que dice **«Texto no extraíble»** y un asistente que te pide amablemente que copies y pegues el texto del documento que él mismo tiene delante.

Ese fue un informe real, y merece una explicación en condiciones, porque «la herramienta no pudo leer mi PDF» es una de esas quejas que suenan a descuido y casi siempre esconden algo muy concreto.

## Por qué un PDF que tú puedes leer es un PDF que un programa no puede

Un PDF no almacena un párrafo. Almacena instrucciones para dibujar formas en unas coordenadas. Cuando esas formas son letras, el archivo suele llevar una fuente incrustada y, para que ocupe poco, la mayoría de los exportadores modernos crean un **subconjunto**: incluyen solo los glifos que se usan, renumerados.

Así que la cadena del archivo ya no es `Hello`. Es una lista de índices de glifos que apuntan a una tabla privada, normalmente escrita en hexadecimal, y que solo significa «Hello» en presencia de ese subconjunto de fuente concreto.

```bf-figure
{
  "kind": "compare",
  "title": "Qué son en realidad los bytes de una cadena dibujada",
  "columns": [
    { "title": "Un PDF de hacia 2005", "hue": "muted", "items": ["Texto dibujado a partir de caracteres literales", "La extracción ingenua funciona", "Es lo que dan por hecho la mayoría de los lectores sencillos"] },
    { "title": "Un PDF de Google Docs, Word o Pages", "hue": "make", "items": ["Subconjunto de fuente, índices de glifos", "Escrito en hexadecimal, no como letras", "Leído literalmente, se decodifica como mojibake", "Una comprobación de legibilidad se niega, con razón, a mostrarlo"] }
  ],
  "caption": "El lector no estaba roto. Estaba leyendo un sistema de numeración como si fuera el alfabeto."
}
```

La tabla de traducción estuvo en el archivo todo el tiempo: cada fuente de ese tipo lleva un mapa de caracteres que indica qué índice de glifo corresponde a qué carácter. Leerlo es la solución, y es la razón por la que las exportaciones de los tres procesadores de texto que la gente usa de verdad llegan ahora como texto y no como ruido.

## La mitad que no tiene texto en absoluto

```bf-figure
{
  "kind": "flow",
  "title": "Qué pasa con un archivo que sueltas en un tablero",
  "steps": [
    { "label": "Leer la capa de texto", "note": "Los índices de glifos se resuelven mediante el propio mapa de caracteres de la fuente, que es lo que hace que una exportación moderna sea legible y no mojibake.", "hue": "read" },
    { "label": "Comprobar que es legible", "note": "Una página que se decodifica como ruido se RECHAZA en lugar de mostrarse. Una transcripción errónea pero segura de sí misma es peor que un hueco honesto.", "hue": "prove" },
    { "label": "Escalar lo que falló", "note": "Sin capa de texto, o con un archivo cifrado: la imagen de la página va a un modelo que lee documentos y vuelve transcrita.", "hue": "build" },
    { "label": "Conservar el original", "note": "Con sesión iniciada, va al almacenamiento; sin sesión, viaja con el tablero, así que la escalada sigue siendo posible más adelante.", "hue": "measure" }
  ],
  "caption": "La puerta de escalada estuvo abierta todo el tiempo y nada pasaba por ella: los archivos ilegibles se conservaban y nunca se volvían a intentar."
}
```

Luego está el otro tipo: una página que no contiene texto porque nunca lo tuvo. Un contrato fotografiado. El escaneo de un acuerdo firmado. Un currículum que alguien imprimió, firmó y volvió a escanear. Un archivo cifrado que se niega directamente a la extracción.

Ahí no ayuda ningún mapa de caracteres, y un lector que promete intentarlo producirá encantado una respuesta errónea con total seguridad. Así que el camino honesto es escalar: reconocer que la página no tiene capa de texto, entregar la imagen real a un modelo capaz de leer imágenes de documentos y transcribirla.

Hay tres decisiones en esa escalada que vale la pena explicar, porque es justo donde este tipo de función suele fallar:

- **Transcribe; no resume.** Quien la invoca convierte el resultado en un documento que alguien va a editar. Un resumen colado en lugar de una transcripción es un documento que ha perdido en silencio la cláusula que necesitabas.
- **Marca lo que no puede leer.** Una palabra ilegible vuelve marcada como ilegible, no adivinada. Una suposición en un contrato es peor que un hueco.
- **Conserva el original.** Con sesión iniciada, el archivo va al almacenamiento y el tablero guarda una clave. Sin sesión —un tablero que aún no tiene cuenta—, los bytes viajan con el propio tablero. En ambos casos la escalada es posible más adelante, algo que no ocurría cuando los archivos ilegibles se descartaban.

## Qué cambia con esto

```bf-figure
{
  "kind": "stack",
  "title": "Cosas que ahora se completan en lugar de atascarse",
  "bands": [
    { "label": "Un currículum", "note": "Soltado como PDF o archivo de Word, leído directamente y rediseñado con el motor de plantillas: sin cuenta en un analizador de terceros, sin volver a teclear.", "hue": "reach" },
    { "label": "Un contrato firmado", "note": "Escaneado, transcrito y colocado en el tablero junto al trato al que pertenece.", "hue": "run" },
    { "label": "Un extracto o una factura", "note": "Leído como cifras que puedes poner junto al resto de tu dinero, en lugar de un adjunto que nadie abre.", "hue": "run" },
    { "label": "Un documento de políticas antiguo", "note": "Solo imagen, con décadas de antigüedad, y ahora texto con el que puedes buscar y citar en una respuesta.", "hue": "measure" }
  ],
  "caption": "La misma ruta sirve para los cuatro, porque lo que los diferencia es qué lector se ejecutó, no qué producto tuviste que abrir."
}
```

Aquí hay una reflexión más amplia sobre los productos que guardan tus documentos. En cuanto un archivo aterriza en algún sitio de forma ilegible, todo lo que viene después es manual: el resumen, la extracción, la comparación, la búsqueda. Los equipos no suelen percibirlo como un problema de documentos. Lo perciben como «al final esa parte la hicimos a mano».

Leer es el primer acto de [Idea to Real](/blog/idea-to-real-the-operating-methodology) por una razón. Un brief, un RFP, un contrato, una página escaneada con notas de un taller: el método empieza por entender lo que dijiste de verdad, y no puede ni empezar ante un archivo que llegó como un icono.

---

**Lecturas relacionadas:** [Convierte un currículum en PDF en JSON estructurado](/blog/parse-resume-pdf-to-structured-json) · [Cómo puntuar tu currículum para los ATS](/blog/how-to-score-your-resume-for-ats) · [Todos los formatos de diagrama que lee el lienzo](/blog/every-diagram-format-the-canvas-reads)

[Abre un lienzo](/create) y suelta el archivo que nunca funcionó en ningún otro sitio.
