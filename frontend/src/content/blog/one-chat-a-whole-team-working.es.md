Dale a un agente una especificación con ocho líneas de trabajo y mira lo que pasa: las hace de una en una. La migración, luego las rutas de la API, luego el planificador, luego la interfaz, luego las pruebas. Cada paso espera al anterior, aunque no tengan nada que ver entre sí. Una tarde de trabajo se lleva la tarde entera.

Las personas no trabajan así. Quien lidera reparte el trabajo, entrega cada parte a alguien que se hace cargo, vigila a todos y al final lo junta. Hasta ahora, un agente solo podía *aparentar* que hacía eso. Podía iniciar un ayudante, pero después se quedaba esperando a que terminara. El ayudante tenía un límite de pasos. No podías verlo ni hablarle. Y en algunos entornos de la nube ni siquiera existía.

Esa es la brecha: **un chat solo podía hacer una cosa a la vez, y el trabajo que podía ir en paralelo esperaba en la cola.**

## Delega y sigue adelante

Ahora el agente de tu chat puede entregar partes del trabajo a **subagentes**, que empiezan al instante y trabajan en paralelo. El agente que los inició no se detiene. Sigue planificando, sigue programando la parte que se quedó o inicia más subagentes.

```bf-figure
{
  "kind": "flow",
  "title": "De una petición a trabajo en paralelo",
  "steps": [
    { "label": "Dividir", "note": "El agente lee la especificación y la divide en partes. Cada parte tiene sus propios archivos, así que dos subagentes nunca editan lo mismo.", "hue": "idea" },
    { "label": "Delegar", "note": "Cada parte arranca como un subagente con su propio nombre, o como un compañero de tu espacio de trabajo. Todas empiezan a la vez.", "hue": "make", "tag": "en paralelo" },
    { "label": "Trabajar", "note": "Los subagentes trabajan en paralelo sin límite de pasos. Sus mensajes aparecen en el chat con su propio nombre.", "hue": "make" },
    { "label": "Juntar", "note": "Cada subagente informa cuando termina. Quien lidera compila y prueba el cambio conjunto, arregla lo que las partes rompieron entre sí y hace commit.", "hue": "run" }
  ],
  "caption": "Un subagente es una ejecución de agente como cualquier otra, con una diferencia: sabe para quién trabaja y le informa a él."
}
```

Un subagente puede ser anónimo («porta el middleware de autenticación») o uno de los agentes de tu espacio de trabajo («Ada, encárgate del esquema»). Si nadie encaja con una parte de programación, el chat incorpora un Developer para ella, le asigna el ticket y ejecuta la parte como ese Developer. El tablero muestra quién se encarga de qué.

## Ves a todos y puedes hablar con cualquiera

Un equipo que no ves no es un equipo que puedas dirigir. Cada subagente activo aparece en la lista **Agentes** del chat junto a los agentes invitados, con su identificador y quién lo inició. Una franja en vivo bajo la conversación muestra qué está haciendo cada uno en este momento.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — chat",
  "ratio": 1.5,
  "regions": [
    { "label": "Agentes (4)", "note": "Agentes invitados y subagentes activos juntos: «Verificar frontend · a3 — subagente de BuilderForce»", "x": 4, "y": 6, "w": 92, "h": 16, "hue": "accent" },
    { "label": "Sus mensajes, con su nombre", "note": "«QA TESTER — subagente de Verificar frontend · a4»", "x": 4, "y": 26, "w": 92, "h": 36, "hue": "make" },
    { "label": "Subagentes", "note": "Qué hace cada uno ahora · Redirigir · Detener · Detener todos", "x": 4, "y": 66, "w": 92, "h": 28, "hue": "run" }
  ],
  "caption": "Un subagente puede iniciar sus propios subagentes para parte de su tarea, hasta tres niveles de profundidad. El chat muestra quién trabaja para quién."
}
```

Para redirigir a uno, simplemente háblale. `@Ada haz solo la mitad de la API` llega al siguiente paso de ese subagente. Mencionar un ticket en el que está trabajando (`#2826 las tarjetas de borrador necesitan un estado vacío`) también le llega. **Detener** para a uno y **Detener todos** para a todos los subagentes a la vez.

Y el agente con el que hablas sigue siendo tuyo. Si está esperando a sus subagentes y le envías un mensaje, deja de esperar y te responde. Los subagentes siguen trabajando y sus informes le siguen llegando.

## El mismo equipo en el editor y en la nube

La mayoría de las herramientas que hacen esto lo hacen en un solo sitio. Aquí es una única forma de trabajar, se ejecute donde se ejecute el trabajo.

```bf-figure
{
  "kind": "compare",
  "title": "Dónde puede ejecutarse un subagente",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Quien lideraba se detenía hasta que el ayudante terminaba", "Los ayudantes chocaban con un límite de 8 pasos", "Los ayudantes no tenían nombre en el chat", "Algunos entornos de la nube no podían iniciar uno"] },
    { "title": "Ahora", "hue": "make", "items": ["Quien lidera sigue trabajando mientras trabajan los subagentes", "Sin límite de pasos: un subagente termina cuando acaba su parte", "Cada subagente tiene nombre, aparece en la lista y se le puede hablar", "El mismo comportamiento en VS Code y en cada entorno de la nube"] }
  ],
  "caption": "En la nube, cada subagente es su propia ejecución con su propio registro, y sus tokens cuentan para la ejecución que lo inició."
}
```

Cuando algo falla, ves dónde. **Copiar diagnóstico** ahora incluye cada subagente que inició el chat, también los que ya terminaron. Para cada uno indica quién lo inició, qué modelos usó, qué pasos fallaron, qué archivos cambió y qué informó.

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco — **Idea → Hacer → Operar → Medir** — y cada acto recorre el mismo bucle interno: [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop).

Los subagentes son una función de **Hacer**, y sobre todo cambian el paso **Construir**. Construir es donde ocurre el trabajo caro, y es donde más duele una sola línea de trabajo: cada parte espera a la anterior. Al dividirlo, Construir cuesta lo que la parte más larga, no la suma de todas.

También mantienen honesto el paso **Probar**. Los subagentes no tienen shell ni git. Cambian sus propios archivos e informan. La prueba queda en manos de quien lidera: compilar el cambio conjunto, ejecutar las pruebas, arreglar lo que las partes rompieron entre sí y solo entonces hacer commit. Trabajo en paralelo, un solo veredicto.

## Lo que puedes hacer hoy

- **Entregar una especificación de varias partes a un solo chat** y que sus líneas de trabajo avancen en paralelo.
- **Delegar en tus propios agentes por su nombre**, o dejar que el chat incorpore un Developer para una parte que no encaja con nadie.
- **Ver y dirigir a cada subagente**: redirigirlo con `@nombre` o un `#ticket`, detener uno o detenerlos todos.
- **Trabajar igual en la nube**, donde cada subagente es su propia ejecución con su propio registro.

Actualiza la extensión de BuilderForce en VS Code a la versión 2026.10.22 o posterior para tener todo esto.

---

**Lecturas relacionadas:** [Leer, Probar, Construir: el bucle interno](/blog/read-prove-build-the-inner-loop) · [Enséñalo una vez y lo repetirá](/blog/teach-it-once-and-it-does-it-again)
