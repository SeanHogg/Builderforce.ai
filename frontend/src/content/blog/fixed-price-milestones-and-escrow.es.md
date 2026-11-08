El trabajo a precio fijo falla en dos direcciones, y todo el que ha estado en cualquiera de los dos lados conoce ambas.

El cliente paga por adelantado y el trabajo se desvía. O el contratista entrega y la factura envejece convertida en una conversación sobre si de verdad estaba terminado. La facturación por horas existe en parte para sortear esto, y lo resuelve haciendo que nadie responda de un resultado.

El escrow es la respuesta clásica: dinero comprometido, retenido y liberado contra entregables acordados. Funciona, y suele fallar por el software y no por la idea, porque las dos partes miran pantallas distintas que discrepan sobre lo que ha pasado.

## Un calendario, tres superficies, sin segunda copia

```bf-figure
{
  "kind": "flow",
  "title": "La vida de un hito",
  "steps": [
    { "label": "Financiar", "note": "El cliente compromete el importe. Hasta que esto ocurre, el hito no puede iniciarse: ese es el sentido de todo el acuerdo.", "hue": "reach", "tag": "cliente" },
    { "label": "Entregar", "note": "El contratista lo marca como entregado con lo que fuera el entregable.", "hue": "make", "tag": "contratista" },
    { "label": "Aceptar o pedir cambios", "note": "El cliente acepta, o solicita cambios con un motivo. Ambas cosas quedan registradas; ninguna es un silencio.", "hue": "run", "tag": "cliente" },
    { "label": "Liberar", "note": "El importe retenido se mueve. El saldo, los cinco totales consolidados y el historial salen todos de la misma lectura.", "hue": "measure" }
  ],
  "caption": "La cancelación también es un paso de primera clase, y se comporta de forma distinta antes y después de la financiación, porque son situaciones genuinamente distintas, no una misma situación con un indicador."
}
```

El panel que ve un cliente dentro de su contratación, el panel que ve un empleador en una oferta y la pestaña de hitos del propio contratista son **un único componente**. No tres implementaciones de un diseño compartido: una sola, renderizada en tres lugares.

No es orden por el orden. Es lo que evita el clásico error del escrow, en el que la pantalla del cliente ofrece *Liberar* mientras el servidor ya ha movido el hito a un estado en el que la liberación se rechaza, y quien hace clic recibe un error que parece un fallo del sistema y se siente como una estafa.

## Los botones son decisión del servidor

Esta es la decisión de diseño que vale la pena copiar, sea lo que sea que estés construyendo.

Cada fila de hito llega del servidor con la lista de **acciones disponibles para esta parte en este estado**. El panel renderiza los movimientos que se le entregaron. No puede ofrecer uno que fuera a ser rechazado, porque no sabe cómo calcularlo.

```bf-figure
{
  "kind": "compare",
  "title": "Dos formas de decidir qué ofrece un botón",
  "columns": [
    { "title": "El navegador lo calcula", "hue": "bad", "items": ["La regla vive en dos sitios", "Aparece una tercera copia en la app móvil", "Se desvían en el primer caso límite", "El usuario se topa con la desviación como un error"] },
    { "title": "El servidor lo proyecta", "hue": "good", "items": ["Una máquina decide, una máquina juzga", "Un estado nuevo es un cambio en el servidor sin tocar la UI", "El panel no puede ofrecer un movimiento imposible", "Todas las superficies coinciden por construcción"] }
  ],
  "caption": "La misma razón por la que un componente compartido decide su propia visibilidad en lugar de recibir una prop `canRelease` de quien lo renderizó."
}
```

## Una oferta puede proponer su propio calendario

Un precio fijo sin forma es solo un número sobre el que discutir. Ahora una oferta puede llevar el calendario que propone —los hitos, qué entrega cada uno, cuánto vale cada uno—, de modo que la negociación trata del plan y no del total. Aceptar la oferta acepta con ella el calendario.

Eso también mejora la primera conversación. «12.000 £» invita a regatear. «12.000 £, en cuatro partes, la primera de las cuales es una importación funcional que puedes ejecutar con tus propios datos en la segunda semana» invita a una decisión.

## Dónde encaja

El mercado —vender, comprar, contratar, ser encontrado— es la etapa posterior a que la cosa funcione. El escrow es uno de los mecanismos que hace posible comprar entre partes que aún no tienen motivos para confiar entre sí, que es la condición normal de un marketplace. Se sitúa junto al [vocabulario comercial](/blog/close-the-deal-on-the-board-you-built-it-on) en el tablero y las [facturas y cobros](/blog/the-founder-back-office-money-ownership-and-paperwork) en el back office: el mismo dinero, a tres distancias distintas del trabajo.

---

**Lecturas relacionadas:** [Cierra el trato en el tablero en el que lo construiste](/blog/close-the-deal-on-the-board-you-built-it-on) · [Contrata, asigna y paga el trabajo en un solo lugar](/blog/hire-assign-and-pay-for-work-in-one-place) · [El back office del fundador](/blog/the-founder-back-office-money-ownership-and-paperwork)

Explora el [marketplace freelance](/freelancer) o [abre un lienzo](/create) y define primero el alcance del trabajo.
