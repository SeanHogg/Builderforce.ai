Cada semana hay una tarea que no vale la pena automatizar ni hacer.

Copiar el total de la factura del proveedor en la aplicación de contabilidad. Sacar la cifra del mes de un programa y teclearla en otro. Rellenar los mismos seis campos de un formulario sin API, sin exportación y sin integración: solo una ventana por la que hay que ir haciendo clic. Son diez minutos, siempre los mismos diez minutos, y la única forma de hacerlos es que una persona se siente a hacerlos.

Las herramientas de IA prometen hacerlo por ti. La mayoría necesita una API, una extensión del navegador o un modelo que adivine píxeles cada vez. Ninguna conserva lo que aprendió sobre cómo lo haces *tú*.

Esa es la brecha: **el trabajo que vive dentro de los programas de escritorio no se podía enseñar, y nada de lo que lo aprendía guardaba la lección.**

## Enséñalo una vez

Activa los agentes autónomos en Synapse —están desactivados hasta que lo hagas— y elige un programa. Synapse lo abre y observa solo ese programa mientras haces la tarea una vez, como siempre.

```bf-figure
{
  "kind": "flow",
  "title": "De una demostración a una habilidad",
  "steps": [
    { "label": "Grabar", "note": "Synapse abre el programa y graba los controles que usas y los valores que pones, no un registro de teclas. Los campos de contraseña nunca se capturan.", "hue": "idea" },
    { "label": "Revisar", "note": "Cada paso con su captura. Quita clics sobrantes, elige qué valores pide en cada ejecución y dónde debe consultarte antes.", "hue": "idea" },
    { "label": "Train Once", "note": "La demostración se convierte en habilidad: lo tecleado pasa a ser valores con nombre, los secretos entradas del almacén, y enviar o eliminar, puntos de aprobación.", "hue": "make", "tag": "una demostración" },
    { "label": "Ejecutar", "note": "Cuando lo pidas con valores nuevos, o como rutina mientras Synapse está en la bandeja. Esc te devuelve el ratón en cualquier momento.", "hue": "run" }
  ],
  "caption": "Nada se convierte en habilidad sin que lo revises. La grabación cubre un programa y solo mientras grabas."
}
```

Lo que se graba es *significado*, no pulsaciones: «poner Importe en 250,00 en Facturas», «hacer clic en Enviar factura». Por eso la habilidad vuelve a funcionar el mes siguiente, cuando la ventana está en otro sitio y el importe es otro.

## Pregunta antes de lo que no se puede deshacer

Una habilidad que pulsa **Enviar**, **Pagar**, **Eliminar** o **Presentar** se detiene en ese paso y pregunta. La ventana pasa al frente, dice exactamente lo que va a hacer y espera. Si nadie responde en quince minutos, la ejecución se detiene.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Ejecuciones",
  "ratio": 1.5,
  "regions": [
    { "label": "«Factura mensual» necesita tu visto bueno", "note": "El siguiente paso no se puede deshacer: hacer clic en «Enviar factura» en «Facturas»", "x": 20, "y": 14, "w": 60, "h": 34, "hue": "accent" },
    { "label": "Registro de auditoría", "note": "Cada paso de cada ejecución: hecho, hecho por posición, aprobado, rechazado, fallido", "x": 4, "y": 54, "w": 92, "h": 40, "hue": "run" }
  ],
  "caption": "Train Once fija los puntos de aprobación según lo que dice el botón, en los cinco idiomas del producto, y puedes añadir o quitar uno al revisar."
}
```

Cada ejecución guarda su registro —cada paso, cómo se hizo, qué decidiste—, así que «¿la rutina lo archivó de verdad?» tiene una respuesta que puedes leer.

## Tu Evermind aprende el procedimiento

Esto no lo hace ninguna otra herramienta. Cada habilidad que guardas también se escribe como el procedimiento que anotaría una persona —la tarea y luego pasos numerados, con los valores como marcadores— y tu **Evermind privado** aprende de él, una vez, en tu equipo.

```bf-figure
{
  "kind": "compare",
  "title": "Qué pasa con lo que enseñaste",
  "columns": [
    { "title": "Herramientas de automatización", "hue": "muted", "items": ["Un script que repite clics", "No sabe nada del porqué", "Vive en los ajustes de una app", "Desaparece al cambiar de herramienta"] },
    { "title": "Synapse", "hue": "make", "items": ["Una habilidad que pide valores nuevos", "Un procedimiento que aprendió tu propio modelo", "Guardado con tus recuerdos y compartido por cada herramienta de IA que conectes", "Olvida cualquier parte, o todo, cuando quieras"] }
  ],
  "caption": "Demostraciones, habilidades, ejecuciones y datos viven en el mismo almacén local de Evermind que ya usan tus agentes de código. Los secretos se quedan en el Administrador de credenciales de Windows."
}
```

Es el mismo almacén donde tus agentes de código ya recuerdan datos, así que todo lo que enseñas queda junto a todo lo que ellos aprendieron: en tu ordenador, en archivos que puedes ver, con un botón de Olvidar en cada uno.

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco —**Idea → Hacer → Operar → Medir**— y cada acto recorre el mismo bucle interno: [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop).

Los agentes autónomos son una función de **Operar**. Ahí es donde el trabajo recurrente o sucede con fiabilidad o deja de suceder sin que nadie lo note, y el trabajo dentro de los programas de escritorio no tenía forma de entrar. Enseñar una tarea una vez lo pone en el arco.

Dentro del bucle, la revisión es **Probar**: antes del acto caro —dejar que un programa maneje tu ratón y tu teclado por su cuenta— ves cada paso, qué pedirá y dónde se detendrá. Construir llega después, y el punto de aprobación mantiene la prueba justo en el paso donde equivocarse no tiene vuelta atrás. **Medir** es el registro: cada ejecución, cada paso, cada decisión, por escrito.

## Qué puedes hacer hoy

- **Enseñar una tarea repetitiva en cualquier programa de Windows** haciéndola una vez, y repetirla con valores nuevos.
- **Ponerla en una rutina** —cada pocos minutos o cada día a las nueve— y dejar que Synapse la haga desde la bandeja.
- **Quedarte con los pasos irreversibles**: envíos, pagos y eliminaciones esperan tu aprobación.
- **Enseñar a tu propio modelo** los procedimientos que le mostraste, en tu equipo, y olvidar cualquier parte cuando quieras.

La grabación y la reproducción llegan primero a Windows; macOS y Linux vendrán después. [Descarga Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) y activa los agentes autónomos desde la página Enseñar.

---

**Lecturas relacionadas:** [Un índice local para cada herramienta de IA de tu equipo](/blog/one-local-index-for-every-ai-tool) · [Leer, Probar, Construir: el bucle interno](/blog/read-prove-build-the-inner-loop)
