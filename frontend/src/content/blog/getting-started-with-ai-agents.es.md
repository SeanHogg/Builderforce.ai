Crear un agente de IA personalizado solía requerir costosas GPU en la nube, infraestructura compleja y semanas de preparación. Builderforce cambia eso: ahora puedes entrenar un agente capaz enteramente en tu navegador con ajuste fino LoRA acelerado por WebGPU.

![Flujo de incorporación de cinco pasos, desde crear un proyecto hasta publicar un agente en el Workforce Registry](/blog/getting-started.svg)

## Qué vas a construir

Al final de esta guía tendrás:

- Un **conjunto de datos personalizado** generado a partir de un prompt de capacidades en lenguaje natural
- Un **modelo ajustado** mediante entrenamiento LoRA en el navegador
- Un **agente publicado** y listado en el Workforce Registry público

## Paso 1: Crea un proyecto

Ve a tu [Panel](/dashboard) y haz clic en **New Project**. Ponle al proyecto un nombre que describa el propósito del agente, por ejemplo *"Customer Support Bot"* o *"Code Reviewer"*.

Cada proyecto tiene su propio espacio de trabajo IDE basado en Monaco, con terminal, explorador de archivos y chat con IA.

## Paso 2: Genera un conjunto de datos de entrenamiento

En la pestaña **Training**, haz clic en **Generate Dataset**. Escribe un prompt de capacidades como:

> "An assistant that helps developers write clear, idiomatic TypeScript code, explains type errors, and suggests refactors."

Builderforce usa el modelo de OpenRouter que elijas para sintetizar pares de instrucción y respuesta. Un conjunto de datos típico de 200 muestras se genera en menos de 30 segundos.

## Paso 3: Ejecuta el entrenamiento LoRA

Cuando el conjunto de datos esté listo, haz clic en **Start Training**. Builderforce carga el modelo base en un pipeline de cómputo WebGPU y empieza a ajustar los pesos del adaptador LoRA directamente en la pestaña de tu navegador.

Parámetros clave:
- **Rank** — controla la expresividad del adaptador (4–64, por defecto 8)
- **Epochs** — pasadas de entrenamiento sobre el conjunto de datos (1–5, por defecto 2)
- **Learning rate** — tamaño del paso del descenso de gradiente (por defecto 3e-4)

Entrenar un modelo de 1.5B parámetros durante 2 épocas con 200 muestras suele tardar entre 10 y 15 minutos en una GPU moderna.

## Paso 4: Evalúa con un juez de IA

Tras el entrenamiento, ejecuta **AI Evaluation** para puntuar las salidas de tu modelo frente a una partición de prueba reservada. El juez califica cada respuesta por corrección, calidad del razonamiento y tasa de alucinación, y te da un informe de calidad estructurado.

## Paso 5: Publica en el Workforce Registry

¿Contento con los resultados? Haz clic en **Publish Agent**, completa el perfil y las habilidades del agente y pulsa **Publish**. Tu agente aparece al instante en el [Workforce Registry](/workforce) global, donde otros pueden descubrirlo y contratarlo.

## ¿Y ahora qué?

- Explora el [Skills Marketplace](/skills) para ampliar las capacidades de tu agente
- Configura [Personas](/personas) para darle a tu agente una personalidad distintiva
- Lee sobre la [orquestación multiagente](/blog/multi-agent-orchestration) con la Mesh

¡Feliz construcción! 🚀
