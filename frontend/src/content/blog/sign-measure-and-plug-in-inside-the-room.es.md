Tres cosas del lienzo estaban terminadas y no se podía llegar a ellas.

**La puerta de aprobación.** Pídele al asistente que reequilibre un presupuesto y registra cada cifra que mueve: quién la movió, de qué valor, a cuál y por qué. Los actos que salen del edificio o en los que alguien se apoyará más adelante —enviar una campaña, emitir una factura, aprobar un presupuesto— están sujetos a puerta, y un agente no puede aprobar su propio cambio. Esa parte funcionaba. La que no: no había ningún lugar donde una persona pudiera ver qué estaba esperando y firmarlo. Así que el registro se llenaba, los actos con puerta seguían bloqueados, y "¿quién aprobó esta cifra?" tenía una respuesta honesta sobre la que nadie podía actuar.

**La capa de métricas.** Una métrica en el lienzo es una *definición* —origen, filtro, agregado, objetivo, qué dirección cuenta como buena— y no un número que alguien tecleó en un mosaico, de modo que dos mosaicos llamados "MRR" no pueden discrepar. El motor que evalúa de golpe un conjunto entero de ellas, ratios derivados incluidos, no tenía tarjeta. Todas las definiciones eran correctas y no podías ver ninguna junto a las demás.

**Widgets de terceros.** Un integrador podía registrar un widget, declarar sus permisos y colocarlo en un tablero a través de la API. Nada en el navegador lo montaba. El contrato existía en ambos lados y el rectángulo del medio estaba vacío.

Los tres viven ahora en la sala, la superficie espacial única del lienzo, junto a las personas y la sesión.

```bf-figure
{
  "kind": "screen",
  "frame": "La sala, con sus estaciones",
  "ratio": 1.62,
  "regions": [
    { "label": "Mesa de aprobaciones", "note": "Lo que espera una firma, contado en su cara", "x": 3, "y": 14, "w": 22, "h": 40, "hue": "prove" },
    { "label": "La sesión y su gente", "note": "El tablero sobre la mesa, el equipo alrededor", "x": 30, "y": 22, "w": 38, "h": 52, "hue": "idea" },
    { "label": "Tablero de métricas", "note": "Primero lo que va por debajo del objetivo, cada número con su evidencia", "x": 72, "y": 14, "w": 22, "h": 40, "hue": "measure" },
    { "label": "Widget en un soporte", "note": "Una herramienta de terceros, en vivo en su cara", "x": 72, "y": 58, "w": 22, "h": 30, "hue": "run" },
    { "label": "Lista de estaciones", "note": "Cada estación, a una pulsación de tecla", "x": 3, "y": 58, "w": 22, "h": 30, "hue": "accent" }
  ],
  "caption": "Cada estación se alza en la sala como lo hace una creación: puedes arrastrarla a cualquier parte, la sala recuerda dónde la dejaste y su leyenda abre un panel 2D completo. La misma lista está junto a la lista de participantes, así que se llega a cada estación con el teclado, con un lector de pantalla y en un dispositivo sin 3D."
}
```

## La mesa de aprobaciones

La mesa muestra cuántos cambios están esperando y a qué se refieren. Ábrela y cada objeto lista sus movimientos pendientes tal como los necesita leer un revisor: el campo, qué era, en qué se convirtió, quién lo cambió, cuándo y de dónde vino el nuevo valor. Entonces eliges.

- **Aprobar** firma en tu nombre todos los cambios en espera de ese objeto. La firma sella las mismas entradas que creó el cambio, de modo que nunca hay una aprobación sin el cambio que aprobó.
- **Aprobar y enviar** (o *emitir*, o *publicar*) aparece solo cuando tu firma es exactamente lo que la puerta necesita para ese acto. Firma y luego ejecuta el acto, en ese orden, con un clic.
- **Rechazar** deja constancia de que alguien lo miró y dijo que no. La cifra no se revierte en silencio, porque eso sería un segundo cambio sin atribución. El acto sigue bloqueado hasta que alguien haga un cambio que esté dispuesto a firmar.

```bf-figure
{
  "kind": "flow",
  "title": "El camino de una cifra, del cambio al acto",
  "steps": [
    { "label": "Movida", "note": "El asistente o un widget cambia una línea de presupuesto. El movimiento se registra con quién, desde, hasta y por qué.", "hue": "build" },
    { "label": "En espera", "note": "La puerta rechaza los actos con puerta del presupuesto. La mesa cuenta un cambio más.", "hue": "prove", "tag": "en la mesa" },
    { "label": "Firmada", "note": "Una persona que no hizo el cambio lo aprueba. No puedes aprobar tu propio trabajo, y un agente no puede aprobar en absoluto.", "hue": "prove" },
    { "label": "Ejecutada", "note": "El acto que la firma autorizó se ejecuta, y el registro muestra quién respaldó.", "hue": "run" }
  ],
  "caption": "La separación de funciones es una sola regla, leída tanto por la puerta como por la mesa. Una mesa que te dejara firmar lo que la puerta te negaría sería solo una forma de saltarse la puerta."
}
```

Este es el control que necesita un responsable de finanzas o un CMO antes de entregarle un tablero a un agente. También es la evidencia que pide un auditor: un cambio, la persona que lo aprobó y cuándo, todo en un solo registro.

## El tablero de métricas

Cuando una sesión define una métrica, aparece un tablero en la sala. Todas las métricas del tablero se evalúan juntas —los agregados simples sobre sus conjuntos de datos, y los ratios derivados como el margen bruto o la retención neta de ingresos a través de las métricas con las que están hechos—, así que los mosaicos no pueden desalinearse.

Se lee primero como una conclusión y después como mosaicos. Las métricas por debajo del objetivo van primero. Las métricas que no se pueden calcular dicen por qué y nunca muestran un cero, porque un margen calculado contra una línea de coste que falta se lee como 100 % y es la respuesta errónea más peligrosa que puede dar un panel. Cada número lleva su evidencia: de cuántas filas se calculó, o de cuántas métricas depende una cifra derivada. Las métricas con granularidad temporal llevan una línea de tendencia.

## Widgets de terceros en un soporte

Un widget registrado para tu espacio de trabajo y colocado en el tablero ahora se ejecuta por partida doble: en su tarjeta en el lienzo plano y en un soporte en la sala, con el marco en vivo en su cara. La contención es la parte que más nos importa:

```bf-figure
{
  "kind": "compare",
  "title": "Lo que un widget puede y no puede hacer",
  "columns": [
    { "title": "Puede", "hue": "run", "items": ["Leer el título del tablero y los nombres de sus objetos, si se le concede", "Crear, editar y eliminar objetos, si se le concede, por la misma vía de edición que usa una persona", "Mantener un pequeño almacén privado en su propia colocación", "Lanzar un aviso en el lienzo"] },
    { "title": "No puede", "hue": "bad", "items": ["Compartir el origen, las cookies ni el almacenamiento del lienzo: se ejecuta en un sandbox opaco", "Ver datos de un objeto más allá de un id, tipo, título y estado", "Reapuntar una colocación, cambiar un modo de aprobación ni tocar el almacén de otro widget", "Cambiar una cifra con dinero de por medio sin que ese cambio espere en la mesa de aprobaciones"] }
  ],
  "caption": "Cada mensaje se comprueba en el orden del protocolo: vino de este marco, el marco sigue en su dirección registrada, el tipo está en la lista de permitidos y el permiso se concedió en el registro. Si el marco navega fuera de su dirección registrada, el tablero deja de responderle."
}
```

Esa última línea del lado derecho es donde se encuentran las tres estaciones. Un widget con acceso de escritura es, desde el punto de vista de la puerta, un agente: sus movimientos sobre campos atribuidos se registran a nombre del widget y esperan en la mesa como cualquier otro cambio.

```bf-figure
{
  "kind": "devices",
  "title": "El panel de la mesa, en los anchos que la gente usa de verdad",
  "devices": [
    { "label": "Escritorio", "width": 1280, "hue": "prove", "note": "Junto a la sala" },
    { "label": "Tableta", "width": 834, "hue": "measure", "note": "Sobre la sala" },
    { "label": "Teléfono", "width": 390, "hue": "run", "note": "Ancho completo, objetivos de 44px" }
  ],
  "caption": "El panel 2D es el equivalente accesible de acercarse a un soporte. Funciona en un teléfono y con un puntero táctil, y sigue el tema del usuario."
}
```

## Dónde encaja en el método

El método es un arco: **Idea → Crear → Ejecutar → Medir**. Dentro de él, [Leer → Probar → Construir](/blog/read-prove-build-the-inner-loop) es cómo pasas de una idea a algo hecho. El ciclo se cierra en *Medir*, donde el número con el que te comprometiste se contrasta con lo que realmente pasó. Estas tres estaciones están en los dos extremos de ese arco, que no tenían nada en que apoyarse:

- **El tablero de métricas es Medir**: la condición de abandono a la que se comprometió una prueba, leída de las mismas definiciones que usan todos los mosaicos e informes.
- **La mesa de aprobaciones es la bisagra entre Construir y Ejecutar.** Lo que un agente construyó pasa a ser algo en lo que el negocio se apoya solo después de que una persona con nombre lo firma.
- **Los widgets traen tus propias herramientas a Ejecutar**, contenidas, para que un tablero operativo pueda usar los sistemas en los que tu equipo ya trabaja.

Las funciones didácticas de la sala —para clases y cohortes— llegan del mismo modo, como estaciones de la misma sala.

---

**Lecturas relacionadas:** [Puertas de aprobación y supervisión humana](/blog/approval-gates-and-human-oversight) · [Haz el stand-up dentro de tu tablero](/blog/stand-up-inside-your-board) · [Califica la prueba y cierra el ciclo](/blog/grade-the-proof-and-close-the-loop)

[Abre un lienzo](/create), pídele al asistente que redacte un presupuesto y luego acércate a la mesa.
