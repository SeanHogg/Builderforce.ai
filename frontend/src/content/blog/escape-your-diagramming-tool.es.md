Las herramientas de diagramas son especialmente hábiles tomando rehenes. El trabajo es valioso, el archivo es propietario y las opciones de exportación están pensadas para que la única sin pérdidas sea justo la que no puedes abrir en ningún otro sitio. Los equipos acaban pagando una licencia que nadie usa con el único fin de reabrir de vez en cuando una imagen dibujada hace cuatro años.

Esta es una guía práctica para sacar ese trabajo: qué conserva realmente cada ruta, cuál tomar y qué hacer cuando lo único que tienes es un PNG.

[Abre un Lienzo de Creación →](/create/new)

## La jerarquía de las exportaciones

No todas las exportaciones son iguales, y la diferencia está en si sobrevive la **estructura** o solo la **apariencia**.

```bf-figure
{
  "kind": "stack",
  "title": "Lo que recuperas, de mejor a peor",
  "bands": [
    { "label": "Formato nativo", "note": ".vsdx, .excalidraw, .drawio: formas, etiquetas, conexiones y qué forma une cada flecha. Todo sobrevive.", "hue": "good", "tag": "sin pérdidas" },
    { "label": "SVG", "note": "Formas, etiquetas y líneas, pero las conexiones se convierten en geometría: el archivo ya no dice qué dos cajas une una flecha. Recuperable.", "hue": "prove", "tag": "estructural" },
    { "label": "PDF", "note": "Vectorial, pero las formas se dibujan como trazados sin identidad. Un rectángulo son cuatro segmentos de línea.", "hue": "measure", "tag": "marginal" },
    { "label": "PNG / JPG", "note": "Píxeles. No hay nada que recuperar. Se puede incrustar, anotar y redibujar al lado, pero no editar.", "hue": "bad", "tag": "sin retorno" }
  ],
  "caption": "Elige siempre la opción más alta que ofrezca tu herramienta. La distancia entre SVG y PNG es la distancia entre un diagrama y una fotografía de un diagrama."
}
```

## Visio → el lienzo

**Qué exportar:** el propio `.vsdx`. Suéltalo en un tablero.

Visio es el formato de entrada más habitual y el que la gente suele dar por perdido. No lo es: un `.vsdx` es un ZIP OPC, el mismo tipo de contenedor que un `.docx`, con las formas en `visio/pages/page1.xml`.

Lo que se conserva: la posición y el tamaño de cada forma, su texto, el maestro a partir del cual se dibujó (así es como un maestro *Decision* se convierte en un rombo y un *Terminator* en una elipse) y sus conectores, incluidas las formas que une cada uno, que se extraen del bloque `<Connects>`, el único lugar del archivo donde se indica.

En la importación se producen dos conversiones, y son justo las dos cosas en las que falla cualquier lector ingenuo de Visio: las coordenadas están en **pulgadas desde la esquina inferior izquierda de la página**, y una forma se posiciona por su **centro**, no por su esquina. Si se te escapa cualquiera de las dos, el dibujo llega boca abajo y con media forma fuera de sitio.

**Para volver:** convierte a Draw.io. Visio importa archivos `.drawio`, así que ese es el viaje de ida y vuelta. Escribir `.vsdx` directamente no se ofrece, y es deliberado: un paquete de Visio válido necesita tipos de contenido correctos, tres partes de relaciones, una parte de documento y una parte de maestros, y Visio no se degrada con elegancia ante un archivo sutilmente incorrecto. Directamente se niega a abrirlo.

**Dibujos de varias páginas:** se lee la primera página. Un objeto del lienzo es un diagrama, y apilar cinco páginas una encima de otra sería peor que leer la página con la que se abre el archivo.

## Lucidchart → el lienzo

**Qué exportar:** `File → Export → Visio (.vsdx)` si tu plan lo incluye. Si no, `SVG`.

La exportación `.vsdx` de Lucidchart es buena y sigue la ruta de Visio descrita arriba. Si tu plan no la incluye —o la cuenta ya ha caducado, que suele ser la razón por la que estás leyendo esto—, exporta a SVG y suelta el archivo.

Un SVG soltado en el tablero sigue siendo una **Imagen**, a propósito: un SVG de un logotipo es una imagen, y convertirlo en «un diagrama con un rectángulo misterioso» sería el error contrario. Selecciónalo, elige **Convertir en diagrama** y las formas vuelven:

- `<rect>` se convierte en una caja, redondeada si tiene `rx`
- `<circle>` y `<ellipse>` se convierten en elipses
- `<polygon>` se lee por sus vértices: tres puntos son un triángulo, cuatro situados en los puntos medios de los bordes de la caja son un rombo de decisión, seis son un hexágono
- `<line>`, `<polyline>` y los trazos rectos de `<path>` se convierten en conectores
- el `<text>` cuyo ancla cae dentro de una forma se convierte en la etiqueta de esa forma; el texto que no pertenece a nada se convierte en una etiqueta independiente en lugar de tirarse

Lo único que un SVG no puede decirte es qué dos formas une una flecha: solo tiene coordenadas. Eso se recupera geométricamente: una flecha cuyos extremos caen dentro de dos cajas *es* una relación entre ellas. Sin ese paso, todos los conectores desaparecerían en cuanto convirtieras el resultado a Mermaid.

## Miro → el lienzo

**Qué exportar:** la exportación del tablero en PDF o imagen como referencia, y reconstruir las partes que importan.

Esta es la respuesta honesta. La exportación de Miro es una imagen, y dentro de una imagen no hay estructura que recuperar. Lo que te ofrece el lienzo es un ciclo de reconstrucción mejor, no una importación mágica:

1. Suelta la exportación en el tablero: llega como Imagen.
2. Coloca un objeto Diagrama al lado y pídele a Brain que la redibuje en Mermaid, usando la imagen como referencia.
3. Corrige el resultado en texto, lo que lleva minutos en lugar de las horas de volver a arrastrar cajas.

La imagen se queda en el tablero junto al diagrama, así que tienes el original a la vista mientras revisas la copia.

## Excalidraw → el lienzo

**Qué exportar:** el archivo `.excalidraw`.

La importación más completa de todas, porque el formato de Excalidraw es JSON honesto con geometría real y vínculos reales: `startBinding` y `endBinding` dicen exactamente qué elementos conecta una flecha. Los rectángulos, rombos y elipses se traducen directamente a formas, el texto vinculado se convierte en etiquetas y los elementos eliminados se descartan.

Una trampa que conviene señalar: Excalidraw también exporta como `.excalidraw.json` y a veces como un simple `.json`. Antes, esa extensión enviaba la escena al importador de datos, y un boceto de taller acababa convertido en una hoja de cálculo con una sola fila cuyas celdas eran fragmentos de JSON. Ahora se reconoce por su declaración `type: "excalidraw"` y no por el nombre del archivo, así que llega como el dibujo que es, se llame como se llame.

**Para volver:** Excalidraw es un destino de conversión completo. Las exportaciones son deterministas: el mismo diagrama produce una salida idéntica byte a byte cada vez, en lugar de un archivo distinto en cada exportación, así que se puede comparar con diff.

## draw.io / diagrams.net → el lienzo

**Qué exportar:** el archivo `.drawio`, o `.xml`.

Nativo en ambos sentidos. Los archivos comprimidos también funcionan: draw.io escribe XML de mxGraph plano o una carga comprimida con deflate y codificada como URI, y ambos llegan correctamente. Los archivos que se *exportan* van siempre sin comprimir, a propósito: un archivo plano se puede comparar en un pull request, un agente puede editarlo como texto y puede volver a leerse sin un paso de descompresión.

## Confluence / Sphinx / wikis internas → el lienzo

**Qué exportar:** el código fuente `.puml`, que normalmente ya está en la macro de la página o en el repositorio.

El vocabulario de componentes de PlantUML —`rectangle`, `card`, `usecase`, `database`, `node`, `hexagon`, `file`— se lee directamente, junto con los atajos `[Component]` y `(Use case)`. La sintaxis de secuencia y de actividad deliberadamente no se convierte: no son grafos de cajas, y aplanarlos produciría algo que se renderiza y engaña.

## Grafos generados → el lienzo

**Qué exportar:** el `.dot` o `.gv` que tus herramientas ya generan.

Los grafos de dependencias, los grafos de llamadas y los DAG de compilación suelen salir de sus herramientas como DOT. Las etiquetas, las formas, los rellenos y los atributos de las aristas se leen tal cual, incluida la sentencia de atributos por defecto (`node [shape=box]`), que importa porque el valor por defecto de Graphviz es una elipse: un archivo que lo sobrescribe lo hace a propósito.

## Herramientas de procesos → el lienzo

**Qué exportar:** el archivo `.bpmn`.

El BPMN de Camunda, Flowable, Zeebe o bpmn.io se lee con sus coordenadas reales cuando el archivo incluye el intercambio de diagramas. Cuando no lo incluye —algo habitual en el BPMN generado por código—, el proceso se dispone a partir de sus flujos de secuencia en lugar de rechazarse. Un proceso sin dibujo sigue siendo un proceso, y ese es precisamente el caso en el que más importa verlo.

## Cuando el destino no puede transportarlo todo

Las conversiones entre notaciones de geometría y de texto no siempre son completas, y el lienzo te lo dice en lugar de dejar que lo descubras más tarde.

```bf-figure
{
  "kind": "compare",
  "title": "Dos cosas que se pueden perder, y qué pasa",
  "columns": [
    {
      "title": "Se avisa en el momento de la conversión",
      "hue": "good",
      "items": [
        "Conexiones que una notación de texto no puede expresar, contadas en el aviso del resultado",
        "El diseño, al convertir de geometría → texto (el motor de diseño recoloca todo)",
        "El estilo exacto más allá del relleno, el trazo y el discontinuo"
      ]
    },
    {
      "title": "Nunca se descarta en silencio",
      "hue": "prove",
      "items": [
        "Una flecha cuyos extremos eran solo geometría: se recupera antes de escribir",
        "Texto que no pertenece a ninguna forma: se conserva como etiqueta independiente",
        "Una forma sin equivalente exacto: se asigna a la más cercana, nunca se descarta"
      ]
    }
  ],
  "caption": "Una notación de texto solo puede decir «A se conecta con B». Una flecha que no une nada se notifica como descartada, con un recuento, en lugar de desaparecer sin avisar."
}
```

Los tres formatos de solo lectura —Visio, ArchiMate y SVG— nunca se ofrecen como *destino*, así que el menú de conversión no puede fallar después de hacer clic. Muestra exactamente las notaciones que funcionarán con el objeto que has seleccionado; para una fotografía, eso es solo Draw.io, donde se incrusta en lugar de fingir que son formas.

## Una migración que puedes hacer esta misma tarde

```bf-figure
{
  "kind": "flow",
  "title": "Cómo liberar los diagramas de un equipo de una licencia",
  "steps": [
    { "label": "Exporta en formato nativo", "note": "Usa .vsdx / .excalidraw / .drawio siempre que la herramienta lo ofrezca; SVG cuando no", "hue": "read" },
    { "label": "Suéltalos en un tablero", "note": "Cada uno se convierte en un objeto de diagrama editable, con sus formas y conexiones intactas", "hue": "prove" },
    { "label": "Convierte lo que se va a mantener", "note": "Todo lo que cambia con el código pasa a Mermaid: texto, en el repositorio, revisable en un pull request", "hue": "build" },
    { "label": "Deja el resto en draw.io", "note": "Los diagramas que se envían en lugar de mantenerse conservan su diseño exacto, en un formato que todo el mundo puede abrir", "hue": "reach" },
    { "label": "Cancela la licencia", "note": "Nada de lo que queda en el tablero necesita la herramienta original para abrirse", "hue": "expand" }
  ]
}
```

La división entre los pasos tres y cuatro es la que importa. Los diagramas que describen un sistema en movimiento deberían ser texto, porque la imagen de una arquitectura queda obsoleta al día siguiente de dibujarse y nadie se da cuenta. Los diagramas que se van a entregar a alguien deberían estar en draw.io, porque el diseño es el mensaje y lo esencial es que cualquiera pueda abrirlos.

Lecturas relacionadas: [Todos los formatos de diagrama que el lienzo lee y escribe](/blog/every-diagram-format-the-canvas-reads) para la referencia completa de notaciones, y [¿Qué diagrama deberías dibujar?](/blog/which-diagram-should-you-draw) para elegir el tipo antes que la herramienta.

[Abre un lienzo y suelta un archivo →](/create/new)
