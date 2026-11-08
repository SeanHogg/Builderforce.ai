El paquete mensual para el consejo es siempre la misma presentación. Runway, burn, los tres números por los que se juzga tu vertical, una línea sobre contratación y una línea sobre la ronda. Alguien lo reconstruye igualmente. Exporta un gráfico, lo pega en diapositivas, arregla el eje que se rompió y lo envía a las 11 de la noche del último día laborable.

La plataforma ya podía hacer esta parte. Una programación de informes podía entregar un frame del lienzo como paquete para el consejo cada mes, y un cron lo enviaba. Simplemente no podías ver esa programación, ni cambiarla, ni crear una desde ninguna página del producto. Las únicas programaciones que alguien podía encontrar eran las de la ejecución de QA. Todo lo demás era una ruta de API y una fila en la base de datos.

## La pestaña Informes

Finanzas ahora tiene una cuarta pestaña, después de Runway, Flujo de caja y Panel: **Informes**.

```bf-figure
{
  "kind": "screen",
  "frame": "Finanzas ▸ Informes",
  "ratio": 1.62,
  "regions": [
    { "label": "Informes programados", "note": "Cada programación que entrega este espacio de trabajo: tipo, cadencia, destinatarios, próximo envío", "x": 4, "y": 8, "w": 58, "h": 74, "hue": "run" },
    { "label": "Compromisos de validación", "note": "Los experimentos, paneles y recolectores en los que se apoyan los números", "x": 65, "y": 8, "w": 31, "h": 74, "hue": "measure" },
    { "label": "Nueva programación", "x": 4, "y": 88, "w": 24, "h": 8, "hue": "accent" },
    { "label": "Editar · pausar · eliminar, por fila", "x": 32, "y": 88, "w": 64, "h": 8, "hue": "accent" }
  ],
  "caption": "Dos piezas que cargan cada una sus propios datos. Ninguna espera al informe de runway que comparten las pestañas Runway y Flujo de caja."
}
```

Cada fila indica qué se envía, con qué frecuencia, a qué hora y a cuántas personas. También muestra cuándo saldrá el próximo envío. **Pausar** detiene una programación sin perderla, lo cual es útil para el trimestre en que informas en persona. **Eliminar** te pide confirmación primero. **Editar** abre la programación en un panel lateral, sobre la página, para que conserves tu lugar en la lista.

## Un paquete para el consejo trata de algo

Cinco de los seis tipos de informe tratan sobre todo el espacio de trabajo: el standup, la revisión de código, el estado del proyecto, el resumen ejecutivo y la consolidación del portafolio. El paquete para el consejo es el primero que trata *de algo*, un frame de uno de tus tableros. Por eso crear uno tiene un paso que los demás no tienen.

```bf-figure
{
  "kind": "flow",
  "title": "Programar un paquete para el consejo",
  "steps": [
    { "label": "Elige el tablero", "note": "Tus tableros activos, la misma lista que muestra la galería del lienzo.", "hue": "idea" },
    { "label": "Elige el frame", "note": "Solo los frames que el servidor aceptará, cada uno con su número de mosaicos.", "hue": "make" },
    { "label": "Cadencia y personas", "note": "Diaria, semanal o mensual, a la hora que elijas, para las personas que indiques.", "hue": "run", "tag": "en Finanzas" }
  ],
  "caption": "La lista de frames sale de la misma comprobación que ejecuta el guardado. Un frame que puedes elegir es un frame que será aceptado, así que nada falla después a las 11 de la noche."
}
```

Esa última parte importa. Un paquete para el consejo sin frame saldría como "nada que enviar" cada mes, así que el servidor lo rechaza. Un frame de un tablero que este espacio de trabajo no puede leer también se rechaza. El selector lee su lista de la ruta que hace esa comprobación, de modo que no puede ofrecer un frame que el guardado rechazaría. El formulario tampoco te deja enviar un paquete para el consejo hasta que hayas elegido un frame.

**Los destinatarios son lo que pegues.** Comas, puntos y coma, uno por línea o `Ann Lee <ann@example.com>` copiado de un cliente de correo: todo funciona. Cualquier cosa que no sea una dirección se te devuelve por su nombre, para que no se descarte en silencio.

**Lo que puede cambiar tras la creación es lo que la programación realmente puede cambiar.** Puedes editar la hora, los destinatarios y si está activa. El tipo de informe, la cadencia y el frame quedan fijados una vez que existe la programación, y el formulario lo dice en lugar de ofrecer ediciones que se descartarían. Para enviar otro frame, crea una programación nueva. Lleva unos veinte segundos.

## La evidencia, en la misma página

Junto a las programaciones hay una pequeña tarjeta que hasta ahora no tenía hogar. Lista los experimentos, los paneles de validación y los recolectores de feedback que ejecuta tu espacio de trabajo. Cada uno muestra qué es y su estado actual, y los recolectores muestran cuántas respuestas han recibido.

```bf-figure
{
  "kind": "compare",
  "title": "Lo que dice un paquete para el consejo, y en qué se apoya",
  "columns": [
    { "title": "El paquete", "hue": "run", "items": ["Runway y burn", "Los mosaicos de KPI del vertical", "Contratación y la ronda", "Enviado con una cadencia, sin cambios"] },
    { "title": "La evidencia", "hue": "measure", "items": ["Qué apuestas están validadas", "Cuáles siguen en curso", "Qué recolectores están escuchando", "Cuántas personas respondieron"] }
  ],
  "caption": "Un número sin ningún experimento detrás es una conjetura con coma decimal. Poner ambos lado a lado es como ves qué números puedes defender."
}
```

## Dónde encaja en el método

Esto es Ejecutar, la etapa en la que la empresa se mantiene en marcha, y el trabajo aquí es un hábito que no depende de que alguien se acuerde de él.

```bf-figure
{
  "kind": "stack",
  "title": "Los informes, en el arco",
  "bands": [
    { "label": "Idea", "note": "El tablero donde se discutió el plan", "hue": "idea" },
    { "label": "Crear", "note": "El frame que dibujas alrededor de los mosaicos que importan", "hue": "make" },
    { "label": "Ejecutar", "note": "Finanzas ▸ Informes. El frame sale con una cadencia, a las personas que lo necesitan.", "hue": "run" },
    { "label": "Medir", "note": "Compromisos de validación: la evidencia en la que se apoya cada número", "hue": "measure" },
    { "label": "Alcanzar", "note": "El consejo, los inversores y el equipo, alcanzados de la misma manera cada mes", "hue": "reach" }
  ],
  "caption": "El paquete para el consejo se crea en el lienzo y se entrega desde Ejecutar. El frame que editas el martes es el que llega el día uno del mes."
}
```

Antes de esto, Ejecutar tenía los números (Runway, Flujo de caja, el panel del vertical) y ninguna forma de *enviarlos*. Sin una programación, informar significaba reconstruir la presentación cada mes. Con una, la construyes una vez. Editas el frame en el tablero cuando algo cambia, y la programación envía lo que muestre el frame el día en que sale.

## Lo que puedes hacer hoy

- **Programar cualquiera de los seis informes** diaria, semanal o mensualmente, a la hora que elijas (en UTC), para las personas que indiques.
- **Enviar un paquete para el consejo desde un frame del lienzo.** Elige el tablero, luego el frame, y los mosaicos que contiene salen con esa cadencia.
- **Pausar, editar o eliminar** una programación desde la misma lista, sin abrir la API ni pedírselo a un administrador.
- **Ver la evidencia junto a ella.** Los experimentos, los paneles de validación y los recolectores de feedback están en la misma página que los informes.

Crear y cambiar programaciones requiere un rol de manager. Quien no lo tenga ve los controles deshabilitados, con el rol que necesitaría indicado junto a ellos, en lugar de ocultos.

---

**Lecturas relacionadas:** [Las métricas con las que realmente funciona tu vertical, instaladas con un clic](/blog/install-your-verticals-kpi-dashboard) · [Ejecuta la aplicación que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas)

[Abre Finanzas ▸ Informes](/finance?tab=reports) y programa el paquete que de otro modo construirías a las 11 de la noche.
