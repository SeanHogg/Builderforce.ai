Cada token que envías a un modelo en la nube sale de tu equipo, y cada uno se factura. Para la mayor parte del trabajo es un intercambio justo. Para una nota privada, una reescritura rápida, una pregunta sobre código que preferirías no pegar en ningún sitio o una tarde en un tren sin cobertura, no lo es.

Ejecutar un modelo pequeño en local siempre ha sido la respuesta obvia, y siempre se ha roto en el mismo punto. Un modelo pequeño tiene una ventana de contexto pequeña. Empieza una tarea con un modelo de frontera, cambia a uno local a mitad de camino, y el modelo local recibe una transcripción varias veces mayor de lo que puede contener. La recorta, olvida la instrucción o falla sin más. En la dirección contraria, el modelo en la nube continúa sin saber qué acaba de hacer el local.

Esta versión cierra las dos mitades. Ahora puedes ejecutar un modelo en tu propio equipo, desde el selector que ya usas, y cuando una ejecución pasa de un modelo a otro, el siguiente recibe una conversación empaquetada para su propia ventana.

## Elige un modelo que funcione en este dispositivo

Abre el menú `/` en el compositor, ve a **Modelo** y elige **En este dispositivo**. La lista muestra todos los modelos que pueden ejecutarse en la GPU de tu navegador mediante WebGPU. Pulsa **Descargar** una vez; tu navegador guarda el modelo y, a partir de entonces, se carga desde el disco.

```bf-figure
{
  "kind": "screen",
  "frame": "Menú / · Modelo · En este dispositivo",
  "ratio": 1.6,
  "regions": [
    { "label": "En este dispositivo", "note": "El mismo selector que los modelos en la nube, filtrado a lo que funciona en tu GPU", "x": 3, "y": 5, "w": 94, "h": 13, "hue": "idea" },
    { "label": "Bonsai 8B", "note": "1 bit · 1,16 GB · llamadas a herramientas · motor de Builderforce", "x": 3, "y": 22, "w": 62, "h": 15, "hue": "run" },
    { "label": "Listo", "note": "Descargado una vez, se carga desde el disco, funciona sin conexión", "x": 68, "y": 22, "w": 29, "h": 15, "hue": "good" },
    { "label": "Bonsai 4B", "note": "1 bit · 0,57 GB · llamadas a herramientas", "x": 3, "y": 41, "w": 62, "h": 15, "hue": "run" },
    { "label": "62 %", "note": "Descargando, con un progreso que puedes seguir", "x": 68, "y": 41, "w": 29, "h": 15, "hue": "prove" },
    { "label": "Bonsai 1.7B", "note": "1 bit · 0,25 GB · llamadas a herramientas", "x": 3, "y": 60, "w": 62, "h": 15, "hue": "run" },
    { "label": "Descargar", "note": "Una pulsación; nunca la inicia un turno de chat", "x": 68, "y": 60, "w": 29, "h": 15, "hue": "make" },
    { "label": "Hermes 3 8B", "note": "No cabe en esta GPU, y la fila explica por qué", "x": 3, "y": 79, "w": 94, "h": 15, "style": "ghost" }
  ],
  "caption": "Descarga, progreso, listo. Un modelo que no puede ejecutarse en tu dispositivo sigue en la lista y te dice qué necesitaría."
}
```

Detrás de esa lista hay dos motores.

- **Bonsai de 1 bit 8B, 4B y 1.7B** de PrismML, Apache-2.0, con unos 1,16 GB, 0,57 GB y 0,25 GB. Se ejecutan en el motor propio de Builderforce, el mismo con el que [Synapse funciona en el escritorio](/blog/synapse-runs-models-itself), compilado para el navegador. Los tres llaman a herramientas, así que pueden hacer trabajo de agente, no solo conversar.
- **Modelos de WebLLM**: Qwen3 1.7B y 4B, Llama 3.2 3B y Hermes 3 8B, que también llama a herramientas.

El selector es el mismo en todos los sitios donde trabajas con Builderforce: la extensión de VS Code, [Rovr](/blog/rovr-your-assistant-in-the-browser) en Chrome y builderforce.ai. Antes de ofrecer un modelo, comprueba tu dispositivo. Un modelo demasiado grande para la memoria de tu GPU, o que necesita una función de GPU que la tuya no tiene, no se oculta: dice por qué no se ejecutará.

Cuando eliges uno, tus prompts de esos turnos nunca salen de tu equipo. No hay ninguna petición a un servidor que registrar, ningún token que facturar y, una vez descargado el modelo, no hace falta red en absoluto.

## Cambiar de modelo sin perder el hilo

El trabajo real rara vez se queda en un solo modelo. Redactas en privado con un modelo local y pasas la parte difícil a uno en la nube. Un modelo escribe un plan y otro lo programa. Un proveedor falla a mitad de la ejecución y Builderforce pasa al siguiente. Cada uno de esos cambios enviaba al siguiente modelo la conversación entera, con la esperanza de que cupiera.

Ahora cada cambio pasa por **builderforce-memory**, que empaqueta la conversación para el modelo que está a punto de tomar el relevo.

```bf-figure
{
  "kind": "flow",
  "title": "Un relevo de tu dispositivo a la nube",
  "steps": [
    { "label": "Modelo local", "note": "Bonsai redacta en privado en tu navegador, con una ventana de unos 14.000 tokens.", "hue": "run", "tag": "en el dispositivo" },
    { "label": "Memory empaqueta", "note": "builderforce-memory conserva el prompt de sistema, tu última instrucción al pie de la letra y el trabajo reciente, y convierte el resto en un resumen o un recuerdo.", "hue": "prove", "tag": "cabe en la siguiente ventana" },
    { "label": "Nota de relevo", "note": "El contexto empaquetado empieza con una línea que dice qué modelo pasó el relevo a cuál.", "hue": "idea" },
    { "label": "Modelo en la nube", "note": "Retoma la tarea sabiendo qué ocurrió, no solo dónde terminó la transcripción.", "hue": "make", "tag": "en la nube" }
  ],
  "caption": "El mismo empaquetado funciona en la dirección contraria, así que un modelo local pequeño nunca recibe una transcripción que no puede contener."
}
```

Las reglas son sencillas. El prompt de sistema se queda. Tu última instrucción se queda palabra por palabra. Una llamada a herramienta nunca se separa de su resultado. Los turnos más recientes se conservan literalmente mientras la ventana del siguiente modelo lo permita, y la parte intermedia más antigua se convierte en una sola nota: un resumen cuando se puede hacer, o si no, lo que la memoria recuerda sobre tu instrucción. La conversación empaquetada siempre cabe en la ventana del modelo que la recibe, con espacio para su respuesta.

El resultado es que un modelo pequeño recibe una conversación con la que realmente puede trabajar, y un modelo grande que retoma el trabajo después de uno pequeño sabe qué se hizo.

```bf-figure
{
  "kind": "compare",
  "title": "En este dispositivo o en la nube",
  "columns": [
    { "title": "En este dispositivo", "hue": "run", "items": ["Los prompts nunca salen de tu equipo", "Sin coste por token", "Funciona sin conexión una vez descargado", "Modelos Bonsai y WebLLM, hasta unos 8B", "Necesita un navegador y una GPU con WebGPU", "Ventana más pequeña y menos profundidad que los modelos de frontera"] },
    { "title": "Nube de Builderforce", "hue": "make", "items": ["Modelos de frontera y ventanas largas", "Nada que descargar", "Funciona en cualquier navegador y dispositivo", "Se factura por token", "Toma el relevo de una ejecución con una nota", "La opción adecuada para tareas grandes y difíciles"] }
  ],
  "caption": "Elige en cada turno. builderforce-memory hace que cambiar entre ellos no te cueste contexto."
}
```

## Qué esperar

Algunos límites sinceros, porque un modelo local que decepciona es peor que uno que nunca probaste.

- **Necesita WebGPU.** Las versiones actuales de Chrome y Edge lo tienen en la mayoría de los equipos de escritorio. Un navegador o una GPU sin WebGPU no puede ejecutar estos modelos, y el selector lo dice en lugar de fallar más tarde.
- **La primera descarga es grande.** Bonsai 8B ocupa unos 1,16 GB. Se descarga una vez y después se carga desde el disco; puedes quitarlo desde el mismo selector.
- **Son modelos pequeños.** Son buenos redactando, reescribiendo, con preguntas cortas y con llamadas a herramientas concretas. No son modelos de frontera, y en una tarea larga y enrevesada un modelo en la nube lo hará mejor.
- **La ventana es más pequeña que en la nube.** Bonsai 8B en el navegador admite unos 14.000 tokens de contexto en una GPU con media precisión, y unos 7.000 sin ella. Precisamente por eso existe el empaquetado del relevo, y por eso importa sobre todo en esta dirección.

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco, **Idea → Crear → Operar → Medir → Alcance**, y dentro de él el ciclo que decide qué merece la pena construir: [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop).

- **Leer** se vuelve más barato y más privado. Pensar una idea a fondo, releer tus propias notas y hacer las preguntas que nunca pegarías en una herramienta en la nube puede ocurrir en tu dispositivo, sin coste.
- **Probar** mantiene barata la parte barata. Leer y Probar son los actos que no deberían gastar nada; un modelo local permite hacer las comprobaciones pequeñas sin gastar un token, y el presupuesto queda para la prueba que necesita un modelo de frontera.
- **Construir** es donde los relevos compensan. Un plan redactado en local llega al modelo que programa empaquetado, con la instrucción intacta y una nota de lo que se decidió.
- **Operar** se vuelve más estable. Cuando un proveedor falla a mitad de la ejecución, el modelo que toma el relevo recibe una conversación que le cabe, así que el cambio continúa el trabajo en lugar de reiniciarlo.
- **Medir** obtiene el ahorro más simple que existe: un turno respondido en tu dispositivo es un turno que nadie factura.

## Lo que puedes hacer hoy

- **Redactar en privado.** Elige Bonsai o un modelo de WebLLM en **En este dispositivo** y nada de lo que escribas en esos turnos saldrá de tu equipo.
- **Trabajar sin conexión.** Descarga un modelo antes de viajar; funciona sin ninguna conexión.
- **Empezar en pequeño, terminar en grande.** Empieza con un modelo local y cambia a uno en la nube cuando la tarea crezca. El modelo en la nube recibe una conversación empaquetada y una nota de relevo.
- **Usar el mismo modelo en todas partes.** El selector es el mismo en VS Code, en Rovr y en builderforce.ai.
- **Ver por qué un modelo no funciona.** Un modelo que no cabe en tu dispositivo te dice qué falta, en lugar de fallar a mitad de la descarga.

Abre el menú `/`, elige **Modelo** y luego **En este dispositivo**, y descarga uno.

---

**Lecturas relacionadas:** [Synapse ya ejecuta los modelos por sí mismo](/blog/synapse-runs-models-itself) · [IA local con WebGPU en el navegador](/blog/local-first-ai-webgpu-in-the-browser) · [Te presentamos Rovr](/blog/rovr-your-assistant-in-the-browser) · [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop)
