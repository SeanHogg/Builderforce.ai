Tres cosas que una empresa necesita en su primer año y que no son el producto: cobrar, saber quién es dueño de qué y tener los documentos que dan sentido a las dos primeras.

Normalmente son tres herramientas, tres exportaciones y una hoja de cálculo en la que ya nadie confía. Esto es lo que cambió cuando se convirtieron en objetos del mismo tablero que el trabajo.

## 1 · El dinero que entra

La sección de finanzas era unidireccional por diseño. El dinero podía salir —pagos, facturas de proveedores, nóminas— y nada podía hacerlo entrar. Las acciones de facturación se anunciaban, se protegían, se aprobaban… y no tenían nada detrás.

```bf-figure
{
  "kind": "flow",
  "title": "Una factura, de principio a fin",
  "steps": [
    { "label": "Emitir", "note": "A una cuenta de cliente real, no a un nombre que coincide por cómo se escribe.", "hue": "run" },
    { "label": "Antigüedad", "note": "Días de retraso calculados a partir de la fecha de vencimiento. Nunca tecleados, porque una antigüedad desactualizada es peor que ninguna.", "hue": "run", "tag": "calculado" },
    { "label": "Reclamar", "note": "Un peldaño de una escalera de cobro, registrado una vez por paso, para que nunca se reclame dos veces lo mismo al mismo cliente.", "hue": "reach" },
    { "label": "Registrar el pago", "note": "Lo que llegó de verdad, frente a lo que se debía.", "hue": "measure" }
  ],
  "caption": "Un trabajo de cobro sin registro es un trabajo de cobro que se hace dos veces o ninguna. Por eso mismo, la escalera es única por factura y paso."
}
```

El cambio en las contrapartes es el más discreto. `invoice.customer`, `bill.vendor`, `contract.counterparty` y `placement.client` eran texto libre con la instrucción de «emparejarlo con una empresa del tablero por su nombre». Tres instrucciones casi idénticas, tres oportunidades para que un «S.L.» al final generase una segunda Acme. Ahora se resuelven mediante una única búsqueda de cuentas compartida —una unión en vivo, no un id copiado—, así que renombrar una cuenta no deja cuatro copias obsoletas de su nombre anterior repartidas por tus facturas.

## 2 · Una tabla de capitalización que sobrevive a su segundo evento

Esta es la forma que tiene casi toda hoja de cálculo de fundadores, y por qué siempre se rompe.

```bf-figure
{
  "kind": "compare",
  "title": "Dos maneras de registrar la propiedad",
  "columns": [
    { "title": "Una tabla de titulares", "hue": "bad", "items": ["Titular, instrumento, acciones, porcentaje", "Cada evento obliga a VOLVER A TECLEAR toda la tabla", "Una ampliación del pool la rompe", "Una salida la rompe", "Una recompra la rompe", "Porcentajes que no suman 100, con una nota que explica por qué"] },
    { "title": "Autorizado, concedido y eventos", "hue": "good", "items": ["Clases de acciones = lo que autorizó el consejo", "Concesiones = los TÉRMINOS de una adjudicación", "SAFE y notas convertibles como instrumentos separados: solo uno de ellos devenga intereses", "Un historial de solo anexado de emisiones, transferencias, ejercicios y cancelaciones", "Los porcentajes son aritmética sobre ese historial"] }
  ],
  "caption": "El pool de opciones es una CLASE, no un indicador: «lo que queda sin asignar» es lo autorizado menos lo concedido DENTRO de ella, algo que un booleano no puede expresar."
}
```

Una ronda de financiación es un registro de lo que se está *negociando*: el instrumento, el importe buscado, la valoración pedida, el inversor principal, la fecha prevista de cierre. Lo que realmente se ha cerrado se deriva de las asignaciones, así que la cabecera de la ronda y el dinero que contiene nunca pueden contradecirse. Una columna almacenada de «importe captado» sería un total que las filas de debajo pueden contradecir, y el día que lo hagan, nadie sabrá cuál es el verdadero.

## 3 · El papeleo antes del resto del papeleo

Dos fundadores pueden encontrarse, ponerse de acuerdo, darse la mano… y no tener dónde dejarlo por escrito. Por eso los documentos fundacionales son plantillas que se rellenan y se envían para firmar:

- **Pacto de fundadores**
- **Cesión de propiedad intelectual de los fundadores**
- **Calendario de vesting de los fundadores**
- **Acuerdo de confidencialidad mutuo**

Un campo obligatorio vacío se rechaza *por su nombre*, con la lista de lo que falta. Parece puntilloso hasta que piensas en la alternativa: imprimir una raya en un pacto de fundadores y dejar que alguien lo firme. Un error tiene arreglo; un documento firmado con un hueco en la cláusula de propiedad, no.

Además de esos cuatro, cualquier documento legal puede guardarse cifrado, compartirse por enlace y firmarse, con el texto congelado exactamente como estaba en el momento de la firma. Y una sala de datos puede contener los archivos reales que pide una due diligence, no solo la lista de verificación que los nombra, que era su estado hasta hace poco y la carencia más discretamente vergonzosa de esta lista.

## Por qué esto está en el mismo tablero que el producto

Porque la alternativa es lo que hace todo el mundo: una herramienta financiera que no sabe qué estás construyendo, una herramienta de capitalización que no sabe quién trabaja en ello y una herramienta de firma que tampoco lo sabe.

```bf-figure
{
  "kind": "stack",
  "title": "Un tablero, cuatro distancias al trabajo",
  "bands": [
    { "label": "El trabajo", "note": "Tarjetas, código, tickets, lo que se está construyendo.", "hue": "make" },
    { "label": "El trato", "note": "Presupuestos, pruebas, planes de acción mutuos: lo que se vende, conectado con lo que se entrega.", "hue": "reach" },
    { "label": "El dinero", "note": "Facturas emitidas y recibidas, cobros, nóminas: calculados a partir de las filas, no tecleados en una tarjeta.", "hue": "run" },
    { "label": "La empresa", "note": "La propiedad, los instrumentos, los documentos fundacionales que todo lo demás da por existentes.", "hue": "measure" }
  ],
  "caption": "Operar es una etapa entera del arco —«opéralo como una empresa»— y es la etapa en la que la mayoría de las herramientas de construcción te devuelven a una hoja de cálculo."
}
```

---

**Lecturas relacionadas:** [Cierra el trato en el tablero en el que lo construiste](/blog/close-the-deal-on-the-board-you-built-it-on) · [Hitos de precio fijo y depósito en garantía](/blog/fixed-price-milestones-and-escrow) · [Idea to Real: la metodología operativa](/blog/idea-to-real-the-operating-methodology)

[Abre un lienzo](/create) y pon la factura junto al trabajo al que corresponde.
