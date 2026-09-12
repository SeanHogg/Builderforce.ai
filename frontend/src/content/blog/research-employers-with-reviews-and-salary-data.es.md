## Abre la herramienta y haz una auditoría previa a la oferta en 10 minutos

Abre la [herramienta de investigación de empleadores](/tools/employer-research) y verás tres campos: **Empresa**, **Puesto** y **Ciudad**. Rellena cualquier combinación y pulsa Investigar: la herramienta consulta en paralelo las reseñas de la empresa y los salarios por puesto × ciudad, y muestra ambos paneles uno junto al otro.

La mayoría de los candidatos se saltan este paso y descubren los aspectos negativos de la empresa en la tercera semana. La herramienta existe para que no tengas que ir saltando entre tres pestañas para hacer esa misma auditoría.

**Minutos 1–3: reseñas.** Escribe el nombre de la empresa. El panel de empresas devuelve hasta 6 coincidencias con su valoración global y su número de reseñas. Haz clic en *Reseñas* en cualquier coincidencia para ir a la página completa de reseñas (`/companies/{slug}/reviews`) y leer las seis valoraciones por eje: cultura, liderazgo, conciliación, compensación, desarrollo profesional y diversidad. Si algún eje está más de 1,0 puntos por debajo de la media global, ahí es donde deberías plantear preguntas en tu última ronda.

**Minutos 4–6: salario por puesto × ciudad.** Escribe el puesto y la ciudad que te interesan. El panel de salarios muestra la banda baja, la mediana y el cuartil superior, modelada a partir del puesto, su nivel de experiencia, la región y la modalidad de trabajo, con todos los multiplicadores a la vista, de modo que el número es algo que puedes discutir y no algo en lo que simplemente tienes que confiar. Haz clic en *Abrir la guía salarial completa* para ver ese mismo puesto en todas las demás ciudades en `/salary/{role}/{city}`.

**Minutos 7–10: contraste.** En la página completa de reseñas, busca en las reseñas escritas las palabras *compensación* o *salario*. Una valoración alta en compensación unida a una oferta alineada con el mercado según el panel de salarios es luz verde. Una valoración baja en compensación unida a una oferta por debajo del mercado es una señal clara para negociar o retirarte.

## Qué significan realmente las seis valoraciones por eje

Glassdoor usa una única puntuación global. Builderforce divide la valoración en seis ejes porque los empleados rara vez dan una respuesta uniforme:

- **Cultura**: dinámica diaria del equipo, seguridad psicológica, ambiente social
- **Liderazgo**: competencia y coherencia de mandos intermedios y directivos
- **Conciliación**: horas que realmente se esperan, costumbres en fines de semana y guardias
- **Compensación**: salario y estructura de bonus en relación con el mercado
- **Desarrollo profesional**: ritmo de ascensos, mentoría, movilidad interna
- **Diversidad e inclusión**: representación y equidad en la práctica

Con un 4,0 global, la *forma* importa más que el número. Un 4,0 compuesto por (5, 5, 2, 5, 5, 2) es muy distinto de (4, 4, 4, 4, 4, 4). El primero es una cultura excelente con horarios brutales y un equipo homogéneo; el segundo, un empleador estable y equilibrado.

Cuando leas reseñas, ordénalas por las más recientes: las empresas cambian más rápido de lo que reflejan las medias anuales.

## Guías salariales: por qué las cifras son distintas de las de Glassdoor

Las guías salariales de Builderforce se basan en **ofertas de empleo activas** en la plataforma, no en autoinformes anónimos. Esto tiene tres implicaciones prácticas:

1. **El modelo se puede inspeccionar.** Una media extraída de la web te da un número, pero no cómo se llegó a él. Aquí, cada banda muestra el valor de referencia y cada multiplicador aplicado, así que puedes comprobar si la suposición sobre tu región o tu nivel de experiencia es la que tú habrías hecho.

2. **El método es transparente.** Cada página de salarios muestra el valor de referencia y los multiplicadores detrás de la banda. Un modelo que puedes inspeccionar se puede rebatir de una forma en que una media opaca no: si el multiplicador regional no se corresponde con tu mercado, puedes decirlo con una objeción concreta.

3. **La dimensión de la ciudad importa.** `/salary/product-manager/austin` da una cifra completamente distinta de `/salary/product-manager/san-francisco`, incluso para empresas del mismo nivel, y la referencia salarial con la que deberías negociar es la de la ciudad, no la media nacional.

Usa los enlaces a ciudades y puestos relacionados al pie de cada página de salarios para cambiar de enfoque rápidamente: «¿Cuánto se paga este mismo puesto en Seattle?» o «¿Cuánto gana un Staff Engineer en esta ciudad frente a un Principal?».

## Tres jugadas de negociación que puedes usar hoy mismo

Una vez que la herramienta ha rellenado ambos paneles, tienes suficiente para usar cualquiera de estas:

**Jugada 1: la cita del mercado.** Cuando el panel de salarios muestre que tu oferta está por debajo de la media de la ciudad para tu puesto, responde con: «Gracias por la oferta. Según las ofertas activas para este puesto en {city}, la media es de {fmt(avg)}. Me gustaría centrar la conversación en torno a esa cifra». Cita la URL `/salary/{role}/{city}` del botón *Abrir la guía salarial completa*. Así pasas de «por qué quiero más» a «por qué tu oferta está por debajo del mercado».

**Jugada 2: el giro de las reseñas.** Cuando el eje de compensación en la página de reseñas de la empresa esté por debajo de 3,5, asume que la compensación no es su punto fuerte y negocia con firmeza lo que *sí* lo es. Si el eje de desarrollo profesional está en 4,7, pide claridad sobre el plan de ascenso y una revisión a los 6 meses con una subida definida. Si la conciliación está en 4,5, pide una garantía explícita de teletrabajo.

**Jugada 3: la actualización de una oferta antigua.** Si tu oferta tiene más de 2 semanas y el panel de salarios muestra ahora una tarifa de mercado más alta, escribe: «Desde nuestra última conversación he revisado las bandas salariales actuales para puestos similares en {city}. Me gustaría revisar la oferta para alinearla con el percentil {percentile}». Es más eficaz en ciudades donde las guías salariales se han actualizado mientras la oferta estaba pendiente.

Las tres jugadas funcionan mejor cuando la empresa sabe que has hecho los deberes. Pegar una URL de Builderforce sacada de la herramienta indica que usas una referencia pública, no una cifra aspiracional.

## Cuándo fiarte de las reseñas y cuándo restarles peso

Fíate más de la señal cuando:
- El número de reseñas es de **10 o más** y la media publicada se mantiene estable en las reseñas recientes
- Las valoraciones por eje son **coherentes** con los pros, contras y consejos escritos
- Las reseñas proceden de **varios puestos** de la empresa, no solo de un equipo

Réstale peso a la señal cuando:
- Hay **menos de 5** reseñas (una sola reseña negativa distorsiona la media)
- La misma queja se repite **con exactamente las mismas palabras** (a menudo, una avalancha coordinada tras unos despidos)
- Todas las reseñas son de **un mismo puesto** (probablemente la mala experiencia de un equipo, no de toda la empresa)

Cuando las reseñas y los datos salariales no coinciden —buenas reseñas pero salario por debajo del mercado—, la explicación más habitual es una empresa que paga en acciones. Pregunta explícitamente en la entrevista por el tamaño de la concesión de acciones y el periodo de consolidación (cliff).

## Preguntas frecuentes

### ¿Están verificadas las reseñas de empresas de Builderforce?

Las reseñas están vinculadas a cuentas de usuario autenticadas (una reseña por usuario y empresa), y los autores pueden obtener una insignia de empleado verificado si su dominio de correo corporativo coincide en el momento de escribir la reseña. Las valoraciones por eje se guardan como columnas numéricas para que la plataforma pueda auditar la deriva agregada y señalar picos sospechosos.

### ¿De dónde salen los datos salariales?

Se modelan, no se extraen de la web. Un valor de referencia base por disciplina se ajusta según el nivel de experiencia, la región y la modalidad de trabajo, y cada página muestra los multiplicadores que aplicó. Eso hace que la banda sea reproducible y comprobable —las mismas entradas producen siempre la misma cifra— y significa que deberías tratarla como un punto de partida bien argumentado, no como una medición de un empleador concreto.

### ¿Qué diferencia hay entre /salary/:role y /salary/:role/:city?

`/salary/:role` agrega todas las ciudades de EE. UU. y sirve como referencia nacional. `/salary/:role/:city` filtra por una sola ciudad: la cifra con la que realmente deberías negociar, porque la compensación varía entre un 20 y un 40 % entre los principales polos tecnológicos.

---

**Pruébala:** [Investigación de empleadores](/tools/employer-research) en Builderforce.
