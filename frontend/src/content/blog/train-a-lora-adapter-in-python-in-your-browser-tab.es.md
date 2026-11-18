# Entrena un adaptador LoRA en Python, en la pestaña del navegador donde lo creaste

Tienes la corazonada de que un modelo pequeño funcionaría mejor con tus datos. Comprobarlo empezaba con un rodeo: alquilar una máquina con GPU, instalar PyTorch, copiar los datos, ejecutar el script, copiar los pesos de vuelta y luego averiguar cómo cargarlos en algún sitio donde pudieras probarlos de verdad.

Para cuando llegaba la respuesta, la pregunta ya se había enfriado.

Ese rodeo ahora es opcional. **Un script de entrenamiento en Python de tu proyecto se ejecuta en la pestaña del navegador donde lo creaste, y el adaptador que guarda se convierte en un modelo que puedes publicar y llamar.**

## Qué pasa al pulsar Run

Declara el script como un servicio `training` en el `builderforce.json` de tu proyecto: `python train.py`, sin puerto. Pulsa Run y el script arranca en la pestaña junto al resto de tu app.

Dentro, `import torch` e `import peft` funcionan. Se ejecutan en tu GPU mediante WebGPU, con el mismo motor que el entrenador del navegador. El script registra su pérdida con `bfwc.training.log(step, loss)`. Cuando termina, guarda su adaptador con `save_pretrained` de peft en `bfwc.training.artifact_dir()`. Si lo detienes antes, el entorno de ejecución le pide que guarde un checkpoint: un script que comprueba `bfwc.training.checkpoint_requested()` guarda y termina limpiamente.

```bf-figure
{
  "kind": "flow",
  "title": "De un script de entrenamiento a un modelo que puedes llamar",
  "steps": [
    { "label": "Entrenar", "note": "Tu train.py se ejecuta en la pestaña: import torch y peft, en tu GPU mediante WebGPU.", "hue": "make", "tag": "en la pestaña" },
    { "label": "Guardar", "note": "El script guarda su adaptador LoRA, al final o cuando lo detienes. El guardado se queda en tu navegador.", "hue": "run", "tag": "en la pestaña" },
    { "label": "Publicar", "note": "El panel de entrenamiento carga el guardado como un paquete de modelo ejecutable que puedes publicar, llamar y evaluar.", "hue": "measure" }
  ],
  "caption": "Un script, un adaptador guardado, un modelo que puedes llamar. Los datos de entrenamiento y los pesos no salen de tu pestaña hasta que publicas."
}
```

Abre el panel de entrenamiento, elige el servicio en **Adaptador de un servicio de entrenamiento en Python** y carga su adaptador guardado. A partir de ahí es el mismo artefacto que produce una ejecución de entrenamiento en el panel. Publícalo, prueba un prompt con él y evalúalo con texto reservado, exactamente igual que con un adaptador entrenado en el panel.

## Para qué está hecho y para qué no

Es una herramienta para experimentos pequeños y rápidos, y los límites son reales:

- **WebGPU es necesario para la velocidad de GPU.** Sin él, el mismo script se ejecuta en la CPU, que es mucho más lenta.
- **Solo modelos pequeños.** El navegador mantiene el modelo base y el adaptador en la memoria de tu pestaña.
- **Solo adaptadores LoRA.** El adaptador apunta al embedding de tokens de los modelos Evermind del navegador, el módulo en el que los modelos del navegador cargan adaptadores. En tu script eso significa un `nn.Linear` llamado `embed_tokens` que contiene el embedding de tokens de una base Evermind; todavía no se incluye un modelo Evermind listo para Python. Los ajustes finos completos y otros módulos de destino quedan fuera del alcance.
- **La base viene con el adaptador.** Un guardado puede llevar su propia base (`base_model.safetensors` y `tokenizer.json`); si no, eliges en el panel el checkpoint base y el tokenizador con los que se entrenó.

Los modelos grandes siguen correspondiendo al entrenamiento en la nube. Esto es para el paso anterior: averiguar si los datos cambian algo en absoluto.

```bf-figure
{
  "kind": "compare",
  "title": "Dos formas de probar una idea de ajuste fino",
  "columns": [
    { "title": "Alquilar una máquina con GPU", "hue": "muted", "items": ["Aprovisionar una máquina e instalar PyTorch", "Subir los datos y bajar los pesos", "Averiguar cómo cargar el resultado", "Pagar cada hora que pasa parada", "Adecuado para modelos grandes"] },
    { "title": "Entrenar en la pestaña", "hue": "run", "items": ["Pulsar Run en tu script de entrenamiento", "Los datos se quedan en tu navegador", "El guardado se carga directamente en el panel", "Sin cómputo en la nube para entrenar", "Adecuado para modelos pequeños y LoRA"] }
  ],
  "caption": "La máquina con GPU sigue siendo la herramienta adecuada para ejecuciones grandes. Solo ha dejado de ser el precio de una primera respuesta."
}
```

## Dónde encaja en el método

Idea to Real es un arco —**Idea → Make → Run → Measure**— con un ciclo dentro: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Una idea de ajuste fino es una prueba como cualquier otra. La forma más barata de probarla es un adaptador pequeño sobre un modelo pequeño, ejecutado donde ya estás y evaluado con texto que el modelo nunca ha visto.

Entrenar en la pestaña sitúa esa prueba dentro de la etapa Run. La evaluación del panel es la etapa Measure: perplejidad y precisión sobre texto reservado, para que decidas con un número y no con una sensación.

## Qué puedes hacer hoy

- **Ejecutar un script de entrenamiento en Python en la pestaña** con `import torch` e `import peft`, en tu GPU mediante WebGPU.
- **Detenerlo sin perder el trabajo.** Un script que comprueba si se ha pedido un checkpoint guarda antes de terminar.
- **Convertir el guardado en un modelo** que puedes publicar, llamar y evaluar, desde el panel de entrenamiento.
- **Mantener los datos en local.** Los datos de entrenamiento y el adaptador guardado se quedan en tu navegador hasta que decidas publicar.
- **Pasar al entrenamiento en la nube** cuando la idea se haya ganado un modelo más grande.

---

**Lecturas relacionadas:** [Tu app full-stack ahora se ejecuta en la pestaña del navegador donde la creaste](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [IA local con WebGPU en el navegador](/blog/local-first-ai-webgpu-in-the-browser) · [Read, Prove, Build: el ciclo interior](/blog/read-prove-build-the-inner-loop)

[Abre un proyecto](/create), añade un servicio de entrenamiento a su `builderforce.json` y pulsa Run.
