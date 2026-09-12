Una revisión del Lienzo de Creación con ojos de vendedor sacó a la luz nueve carencias, y todas tenían algo en común: cada una estaba en la mitad comercial. Más de ochenta tipos de objeto cubrían el *construir* de principio a fin. Una demo que no se podía entregar. Un precio que no se podía aceptar. Un seguimiento que no se podía ejecutar. Una llamada que no podía aterrizar en el tablero.

La capacidad ya estaba casi toda ahí: enlaces compartidos con token, un registro de auditoría, salas anónimas, un registro de evidencias de seguridad, la posibilidad de enviar correo de verdad y publicar en redes. Lo que faltaba era **vocabulario**. La mitad comercial no tenía objetos, así que nada de ella podía ponerse en un tablero, conectarse con el trabajo que vendía ni ser razonado por el asistente que ya razona sobre todo lo demás.

## Seis tipos, y por qué ninguno es uno que ya existía

```bf-figure
{
  "kind": "stack",
  "title": "El vocabulario comercial",
  "bands": [
    { "label": "Presupuesto", "note": "No es una lista de precios: es el trato con precio de un comprador concreto, con su descuento, su plazo, su caducidad y un botón de aceptar.", "hue": "reach" },
    { "label": "Secuencia", "note": "No es un envío masivo de campaña: es un seguimiento ordenado entre canales que se detiene en cuanto alguien responde.", "hue": "reach" },
    { "label": "Llamada", "note": "No es una reunión programada: es una conversación que ocurrió, registrada por lo que salió de ella.", "hue": "reach" },
    { "label": "Prueba", "note": "No es un entorno: es un espacio de trabajo para el cliente potencial, con límite de tiempo y criterios de activación acordados de antemano.", "hue": "reach" },
    { "label": "Paquete de confianza", "note": "No es una sala de datos para inversores: es el cuestionario de seguridad del comprador y la evidencia en la que se apoya cada respuesta.", "hue": "reach" },
    { "label": "Plan de acción mutuo", "note": "No es una hoja de ruta: cada hito nombra a un responsable del lado del COMPRADOR, y ese es todo el mecanismo.", "hue": "reach" }
  ],
  "caption": "Cada tipo se gana su sitio por el campo que lo distingue. Un tipo que solo se diferencia de otro en su etiqueta es un filtro, no un tipo."
}
```

Este último merece un párrafo. Un plan de acción mutuo funciona porque es de propiedad compartida: fechas que el comprador aceptó, pasos con nombres de personas del propio comprador, una vista común de lo que va con retraso. Una hoja de ruta con los mismos hitos y sin responsables del lado del comprador es una lista de deseos que envías por correo a la gente. La diferencia es un campo, y es la diferencia entre un plan y una esperanza.

## Entrega una demo a alguien sin cuenta

El fallo más habitual en un modelo de construir y luego vender es que lo que has construido vive detrás de tu inicio de sesión. Así, la demo se convierte en una pantalla compartida, la pantalla compartida en una grabación y la grabación en un enlace que nadie ve.

```bf-figure
{
  "kind": "screen",
  "frame": "builderforce.ai/deal/<token> — lo que abre el cliente potencial",
  "ratio": 1.7,
  "regions": [
    { "label": "Tu marca", "x": 4, "y": 6, "w": 92, "h": 12, "hue": "reach" },
    { "label": "El tablero real, solo lectura", "note": "Lo que construiste de verdad, no una grabación", "x": 4, "y": 22, "w": 62, "h": 60, "hue": "make" },
    { "label": "Solicitar control", "note": "Concedido en directo por una persona que está mirando", "x": 69, "y": 22, "w": 27, "h": 28, "hue": "accent" },
    { "label": "Interacción", "note": "Aperturas · atención · puntos calientes", "x": 69, "y": 54, "w": 27, "h": 28, "hue": "measure" },
    { "label": "Sin necesidad de cuenta", "x": 4, "y": 86, "w": 92, "h": 9, "hue": "idea" }
  ],
  "caption": "Compartir con un cliente potencial no es una primitiva nueva: es un enlace compartido, el mismo que usa un currículum compartido, así que hereda caducidad, revocación y auditoría en lugar de reimplementarlas mal."
}
```

El control lo concede en directo la persona que está mirando, nunca el token: un enlace que puede ampliar sus propios permisos es un enlace que los amplía cuando la reunión ya ha terminado.

## Sabe qué hicieron con ella

La interacción tampoco es un séptimo objeto. Es actividad, registrada bajo un actor «cliente potencial» y leída como un resumen: aperturas, atención total y puntos calientes por tarjeta, es decir, las partes a las que no dejaban de volver.

La medición es deliberadamente honesta. La atención se cuenta con la pestaña delante del lector, y el reloj se detiene cuando la pestaña pasa a segundo plano. Una cifra de permanencia que sigue contando tras una pestaña en segundo plano es la forma más rápida de volver inútiles todos los informes de interacción de una empresa, porque todo el mundo aprende que los números son ficción y deja de abrirlos.

```bf-figure
{
  "kind": "compare",
  "title": "Dónde suele vivir la venta",
  "columns": [
    { "title": "Un CRM aparte", "hue": "muted", "items": ["El trato es un registro SOBRE el trabajo", "Alguien sincroniza ambos a mano", "La demo es la grabación de algo", "Las respuestas de seguridad se reescriben en cada trato", "El seguimiento se ejecuta hayan respondido o no"] },
    { "title": "El mismo tablero", "hue": "reach", "items": ["El presupuesto está conectado con lo que tasa", "La prueba apunta al espacio de trabajo real", "La demo ES la cosa, en solo lectura", "La evidencia va adjunta a la respuesta que respalda", "La secuencia se detiene ante una respuesta"] }
  ],
  "caption": "No es un argumento contra los CRM. Es un argumento contra que el trato y el trabajo sean dos documentos que se contradicen."
}
```

## Dónde encaja esto en el método

En el arco de [Idea to Real](/blog/idea-to-real-the-operating-methodology), el mercado llega después de Operar: vender, comprar, contratar, que te encuentren. Deliberadamente no es lo primero que se construye, porque montar un motor comercial delante de algo que no funciona es la manera en que las empresas de software pierden un año. Pero es justo donde una prueba deja de ser un experimento y empieza a ser un negocio, y un tablero que no puede llevar un presupuesto es un tablero que tienes que abandonar en ese preciso momento.

La maquinaria de fondo llegó con ello: [hitos de precio fijo retenidos en depósito](/blog/fixed-price-milestones-and-escrow), [facturas que se pueden emitir, cobrar y reclamar](/blog/the-founder-back-office-money-ownership-and-paperwork) y publicaciones en el mercado que se comprueban ejecutándolas de verdad antes de poner nada a la venta.

---

**Lecturas relacionadas:** [Hitos de precio fijo y depósito en garantía](/blog/fixed-price-milestones-and-escrow) · [El back office del fundador](/blog/the-founder-back-office-money-ownership-and-paperwork) · [El Lienzo de Creación no es una ventana de chat](/blog/creation-canvas-beyond-chat)

[Abre un lienzo](/create) y pon el trato junto al trabajo que está vendiendo.
