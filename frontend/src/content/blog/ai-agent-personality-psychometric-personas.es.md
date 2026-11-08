«Haz que el agente sea más cuidadoso» es un deseo. Una **personalidad** es una especificación. Builderforce.ai te permite dar a un agente un temperamento real y medible —evaluado con los mismos marcos psicométricos que se usan con las personas— y luego lo compila en la forma en que el agente realmente genera prompts y se ejecuta. El resultado: un «revisor cauteloso» y un «prototipador rápido» no solo tienen nombres distintos, sino que se comportan de forma distinta, y lo hacen de manera consistente.

> En Builderforce.ai, una persona psicométrica es un vector de rasgos (cada dimensión de 0 a 100) definido mediante un cuestionario breve o con deslizadores en marcos como HEXACO, Eneagrama y MBTI. Ese vector se compila en directivas de prompt y parámetros de ejecución concretos, de modo que la personalidad de un agente impulsa un comportamiento real y repetible en lugar de ser una etiqueta.

![A la izquierda, deslizadores de rasgos para cautela, rigor, asertividad, tolerancia al riesgo y calidez; una flecha etiquetada «compilado» apunta a directivas de prompt y parámetros de ejecución a la derecha](/blog/persona-trait-to-behavior.svg)

## De un test a un vector de rasgos

No escribes el comportamiento a mano. Haces un breve **test de personalidad** —o mueves directamente los deslizadores— y la plataforma registra un **vector de rasgos**: cada dimensión puntuada de 0 a 100, con 50 como neutral. Puedes evaluar a través del marco en el que confíes; todos alimentan el mismo vector subyacente.

![Seis marcos de evaluación —HEXACO, Eneagrama, MBTI, enfoque regulatorio, estilo de conflicto y valores de Schwartz— convergiendo en un único vector de rasgos que luego impulsa una persona o un agente](/blog/persona-frameworks.svg)

| Marco | Qué captura |
| --- | --- |
| **HEXACO** | Dimensiones amplias de la personalidad (honestidad-humildad, emocionalidad, extraversión y más) |
| **Eneagrama** | La motivación central: el *porqué* detrás del comportamiento (Reformador, Triunfador, Investigador, …) |
| **MBTI** | Preferencias de tipo de estilo cognitivo |
| **Enfoque regulatorio** | Orientación a la promoción (ganancias) frente a la prevención (evitar errores) |
| **Estilo de conflicto (Thomas-Kilmann)** | Cómo gestiona el desacuerdo: competir, colaborar, evitar, … |
| **Valores de Schwartz / Fundamentos morales** | Qué prioriza y qué no está dispuesto a sacrificar |

## De un vector a un comportamiento

Un vector de rasgos por sí solo es inerte. Builderforce lo **compila** en dos cosas concretas en tiempo de ejecución:

- **Directivas de prompt**: instrucciones en lenguaje llano que recibe el modelo. Una cautela alta se convierte en «revisa dos veces los casos límite antes de dar algo por terminado»; una asertividad baja se convierte en «explicita tus suposiciones y pregunta antes de acciones irreversibles».
- **Parámetros de ejecución**: los mandos que rodean al modelo: temperatura, verbosidad, paciencia ante reintentos, con qué afán busca aprobación y con qué facilidad escala a una persona.

Así que la personalidad no es cosmética. Cambia *lo que se le dice al agente que haga* y *cómo le permite actuar el entorno de ejecución*.

## La personalidad es el punto de consigna; el sistema límbico es la dinámica

Una personalidad estática sería una caricatura. Builderforce empareja la persona con una **capa límbica** entrenable: un modelo afectivo que aporta la dinámica de cada momento. La personalidad fija los **puntos de consigna** (quién es fundamentalmente el agente); la capa límbica gobierna la **dinámica** (cómo responde en el momento) y se apoya en el mismo modelo que se actualiza solo, [Evermind](/blog/evermind-self-updating-model), que acumula el resto del aprendizaje de tu proyecto. El resultado es un agente que se mantiene *en su personaje* entre sesiones en lugar de desviarse.

## Dónde viven las personas

Una persona es reutilizable. Constrúyela una vez y:

- Adjúntala a una **persona** que reutilizas entre proyectos, o directamente a un **agente** que la lleva a cada ejecución en la nube.
- Asigna personas distintas a roles distintos: un revisor meticuloso en el carril de QA, un prototipador audaz en el carril de exploración.

Las personas psicométricas son una capacidad **Pro**; la plataforma anuncia exactamente qué plan las desbloquea y nunca se degrada en silencio.

## Por qué importa

Los equipos ya saben que el temperamento condiciona los resultados: se dota de personal una migración delicada de forma distinta a una exploración desde cero. Los equipos agénticos deberían tener la misma palanca. Al evaluar la personalidad con marcos reales y compilarla en directivas y parámetros de ejecución, Builderforce convierte «sé más cuidadoso» de un prompt esperanzado en un rasgo duradero y medible del agente.

## Preguntas frecuentes

**¿Cómo defino la personalidad de un agente?** Haz un breve cuestionario psicométrico o mueve los deslizadores de las dimensiones de rasgos. En ambos casos produces un vector de rasgos (0–100 por dimensión) que la plataforma guarda en la persona o el agente.

**¿Qué marcos de personalidad se admiten?** Varios, entre ellos HEXACO, Eneagrama, MBTI, enfoque regulatorio, cognición de doble proceso, estilo de decisión, estilo de conflicto de Thomas-Kilmann, valores de Schwartz y fundamentos morales. Todos alimentan un único vector de rasgos subyacente.

**¿La personalidad cambia realmente el comportamiento, o es solo una etiqueta?** Cambia el comportamiento. El vector de rasgos se compila en directivas de prompt (lo que se instruye al agente que haga) y parámetros de ejecución (temperatura, verbosidad, búsqueda de aprobación, escalado), de modo que personas distintas actúan de forma distinta.

**¿El agente se mantendrá en su personaje entre sesiones?** Sí. La personalidad aporta puntos de consigna estables y una capa límbica entrenable aporta una dinámica consistente, ambas apoyadas en el modelo Evermind del proyecto, así que el comportamiento es repetible en lugar de desviarse de una ejecución a otra.

**¿Está disponible en el plan gratuito?** Las personas psicométricas son una función Pro. La plataforma muestra el plan necesario en la propuesta de mejora y aplica la puerta de funciones de pago de forma coherente.
