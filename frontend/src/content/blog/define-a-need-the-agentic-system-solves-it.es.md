Hay una sola frase debajo de todo lo que construye Builderforce.ai:

> **Cualquier persona define una necesidad, y el sistema agéntico la resuelve.**

Esa frase parece sencilla hasta que te fijas en cuántas formas adopta una «necesidad». Un responsable de equipo quiere que se revisen sus SOP y que se proponga un flujo de procesos más ágil. Un desarrollador quiere entrenar un agente con los datos propios de la empresa y montar un agente personalizado que atienda las llamadas de soporte. Una ingeniera quiere que ese mismo agente se ejecute en el IDE, en el escritorio o en la nube, a su elección y no a la de la plataforma. Una directora quiere dibujar un flujo de trabajo, un conjunto de diagramas de procesos, e integrar esos pasos en un agente que los ejecute.

Cuatro personas distintas, cuatro necesidades distintas, cuatro *modalidades* distintas: texto, un conjunto de datos, un diagrama de procesos, una persona. Y aun así el verbo es idéntico cada vez: **convierte esta necesidad en un agente que se ejecute en la superficie adecuada.**

Ese verbo compartido es todo el producto. Lo llamamos la **primitiva de compilación**, y desde esta versión ya no es un diagrama colgado en la pared. Es un pipeline en funcionamiento al que puedes llamar.

![La primitiva de compilación: una necesidad en cualquier modalidad se compila en un único AgentSpec y se despliega en cualquier superficie](/blog/compile-primitive-spine.svg)

## La forma de una necesidad

Mira con atención los cuatro ejemplos y verás que lo único que cambia de verdad es la *modalidad de entrada* y la *superficie de salida*:

| La persona dice… | Modalidad | Se convierte en… | Superficie |
|---|---|---|---|
| «Revisa nuestros SOP y propón un flujo más ágil.» | Hallazgo de diagnóstico | Un proceso de mejora ejecutable | Flujo de trabajo |
| «Apréndete nuestros documentos y atiende las llamadas de soporte.» | Conjunto de datos / datos propios | Un agente personalizado con base documental | Nube / escritorio |
| «Ejecuta mi agente aquí mismo, en mi editor.» | (agente existente) | El mismo agente, reubicado | IDE |
| «Aquí está el diagrama de procesos: ejecuta estos pasos.» | Diagrama de procesos | Un agente que ejecuta los pasos | Nube / on-premise |

Todo lo que hay en medio —la identidad del agente, el modelo que usa, la persona que da forma a su comportamiento, el conocimiento que recuerda, la política que lo gobierna, los pasos que sigue— es *el mismo tipo de cosa cada vez*. Es la especificación de un agente. Así que la plataforma tiene exactamente una de esas: un **AgentSpec**.

## La primitiva de compilación

Dos funciones puras, una cosa canónica entre ambas:

```
   NEED  ──▶  compile(need, modality)  ──▶  AgentSpec  ──▶  deploy(AgentSpec, surface)  ──▶  running agent
```

- **`compile`** es un registro de *compiladores de modalidad*: uno para texto en lenguaje natural, otro para un conjunto de datos (más tus documentos propios), otro para un diagrama de procesos, y otros para una persona, los hallazgos de un diagnóstico y un paquete de políticas. Cada uno reduce su propio tipo de necesidad al mismo `AgentSpec`. Es el único lugar de la plataforma que tiene que distinguir el texto de los diagramas y de los conjuntos de datos.
- **`deploy`** es un registro de *superficies*: IDE, escritorio, nube duradera, contenedor en la nube y paso de flujo de trabajo. Toma un `AgentSpec` terminado, resuelve el motor adecuado mediante un único registro DI compartido y el transporte adecuado para la superficie y —a través de `deployAndDispatch`— arranca de verdad la ejecución sobre la maquinaria que ya existe.

Entre ambas está el `AgentSpec`: identidad, modelo, persona compilada, memoria recordada, puntos de control de políticas y (cuando la necesidad es un proceso) los pasos ordenados. Compila muchas formas *de entrada*; despliega en muchas superficies *de salida*; una sola especificación en medio. Ambas funciones son código real: `compile()` y `deploy()` viven en la API, el `AgentSpec` y su única reducción canónica viven en el paquete compartido `agent-tools`, y una fina puerta de entrada HTTP (`POST /api/compile`, `POST /api/compile/run`) expone todo el pipeline.

La potencia de la primitiva está en que las cuatro necesidades dejan de ser cuatro productos.

![Cuatro puertas de entrada existentes reconvertidas en adaptadores de compile() que se fusionan en un único AgentSpec](/blog/compile-four-doors.svg)

«Apréndete nuestros datos» y «dibuja un diagrama de procesos» son dos adaptadores de **compile** que se fusionan en la misma especificación, así que puedes tener un diagrama de procesos *con* un modelo entrenado *con* una persona *con* una política de gobernanza, y sigue siendo un solo agente. La fusión es literal: cada adaptador emite la parte de la especificación que conoce y la plataforma las combina en una. «Ejecútalo en mi IDE» y «ejecútalo en la nube» son dos destinos de **deploy**, así que el agente que entrenaste es el mismo que se ejecuta en tu editor, sin una segunda compilación.

## La puerta de entrada en lenguaje natural

La modalidad que le faltaba a la plataforma es la más humana: **el lenguaje natural.** «Un agente que clasifica los tickets de facturación y responde preguntas sobre reembolsos a partir de los documentos de nuestro centro de ayuda» antes no tenía adónde ir. Ahora tiene una puerta de entrada en [`/compile`](/compile): escribes la necesidad en texto, un extractor la reduce a un `AgentSpec` (identidad, habilidades, un modelo enrutado automáticamente), `deploy()` resuelve dónde se ejecutará y —si pulsas *Compilar y ejecutar*— la plataforma lanza un primer turno real a través del gateway con el prompt de sistema compilado. Define una necesidad; mira cómo responde el agente.

Cuando la necesidad trae *pasos* en lugar de una conversación —un diagrama de procesos, o el flujo de mejora que propuso un diagnóstico—, `compile & run` no chatea. Instancia un flujo de trabajo real: los pasos compilados se convierten en `workflow_tasks` que ejecuta la maquinaria existente de asignación y relevo. La misma llamada `POST /api/compile/run` está disponible para cualquier cliente, así que esta puerta de entrada es un endpoint, no solo una página.

## Por qué importa una sola columna vertebral

Cuando la persona, la memoria y la política viven *en la especificación* y no dentro de una puerta de entrada concreta, llegan a todas las superficies sin coste adicional.

![La persona, la memoria y la política viven en el AgentSpec y llegan a todas las superficies por igual](/blog/compile-governance-everywhere.svg)

La temperatura de una persona cambia el comportamiento del agente tanto si se ejecuta como paso de un flujo de trabajo como si lo hace como agente en la nube. Los documentos propios con los que lo entrenaste se recuperan en la inferencia sin importar dónde se ejecute el agente, incluso en una llamada estándar al SDK de OpenAI que se dirige al agente por su id de modelo.

Y un punto de control de gobernanza se *aplica*, no se queda en una sugerencia. El mismo punto de control compilado se evalúa en la costura de herramientas de cada motor —el bucle duradero en la nube, el ejecutor on-premise y el bucle del IDE dentro del editor— mediante una única decisión compartida, `evaluatePolicyGate`. `block` rechaza la herramienta y le dice al agente que tome otro camino; `require-approval` pausa la ejecución, pregunta a una persona y se reanuda en cuanto responde. Define `block` sobre la herramienta `shell` una vez y detendrá la shell en tu editor exactamente igual que la detiene en un ciclo en la nube, porque el punto de control viaja con el agente, no con el lugar donde se ejecuta. Esa es precisamente la razón de poner la política en la especificación y no dentro de una puerta de entrada: no puede ocurrir que una regla se cumpla en una superficie y no en otra, porque solo hay una regla y un lugar donde se comprueba.

Esa es la diferencia entre una plataforma y un montón de funcionalidades. Un montón de funcionalidades tiene una herramienta de entrenamiento, un constructor de flujos de trabajo, un editor de personas y un runtime, cada uno con su propia idea privada de lo que es un agente. Una plataforma tiene una sola idea de lo que es un agente, y te deja llegar a ella desde cualquier dirección y salir hacia cualquier superficie.

## Qué puedes hacer hoy

Esto no es una visión partiendo de cero, y ya tampoco es una visión a medias: la columna vertebral está conectada de principio a fin:

- **Define una necesidad en lenguaje natural** y obtén un agente en funcionamiento: `/compile` y `POST /api/compile/run`.
- **Compila cualquier modalidad en un único `AgentSpec`** —texto, un conjunto de datos con tus documentos propios ingeridos, un diagrama de procesos dibujado a mano, una persona compilada, los hallazgos de un diagnóstico o un paquete de políticas— y **apílalas** en un solo agente.
- **Despliega *y lanza* esa única especificación.** `deploy()` resuelve el motor, el transporte y la entrada de ejecución para cualquier superficie; `deployAndDispatch()` la *arranca* después: una especificación con pasos se convierte en un flujo de trabajo en vivo, y una especificación para la nube, en un agente en la nube en ejecución con sus puntos de control de gobernanza ya incluidos en la carga útil.
- **Convierte un diagnóstico en acción**: un hallazgo de madurez se compila en un proceso de mejora ordenado y ejecutable en lugar de en un informe estático.
- **Dale base documental a una llamada estándar de OpenAI**: dirígete a un agente entrenado por su id `builderforce/workforce-<id>` en el endpoint estándar `/v1/chat/completions` y recuperará tus documentos ingeridos para esa consulta, la misma base documental que obtiene la vía de chat dedicada.
- **Gobierna desde la especificación**: un punto de control `block` o `require-approval` definido una vez se aplica en la costura de herramientas de los ejecutores en la nube, on-premise y del IDE por igual: la herramienta se rechaza o queda supeditada a una persona, no solo se indica.

La primitiva de compilación es la columna vertebral, y lo que ya existía ahora se apoya en ella. «Define una necesidad y el sistema agéntico la resuelve» ya no son cuatro puertas separadas: es una sola puerta que se adapta a la forma en que llegó tu necesidad y se abre a la superficie donde vive tu trabajo.

Describes el resultado, en el lenguaje que te resulte más natural, y una fuerza de trabajo de agentes —gobernada, con base documental y en la superficie que elijas— va y lo consigue. Eso es lo que hace ahora la plataforma.
