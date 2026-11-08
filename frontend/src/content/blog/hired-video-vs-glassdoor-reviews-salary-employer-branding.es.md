## Para qué sirve Glassdoor

El foso defendible de Glassdoor son más de 20 años de reseñas escritas por empleados y una base de datos salarial con una profundidad histórica considerable. Los candidatos la usan para investigar empresas antes de postularse. Los empleadores la usan como superficie de marca empleadora: reclaman su perfil, responden a las reseñas, publican beneficios y promocionan su cultura.

En 2026 las ofertas de empleo de Glassdoor fluyen principalmente a través de Indeed (la misma empresa matriz). Hoy el producto se entiende mejor como un destino de marca, reseñas y salarios que como una bolsa de empleo principal.

## Lo que Builderforce añade

La superficie de reseñas de empresas de Builderforce incluye **seis valoraciones por subeje** (cultura, liderazgo, conciliación, remuneración, crecimiento profesional, diversidad) por empresa, calculadas y almacenadas en caché en la fila de la empresa (`review_count`, `review_avg_overall`). La puntuación global única de Glassdoor se calcula a partir de los mismos datos, pero se presenta como un solo número.

Las **guías salariales** de Builderforce están modeladas y son inspeccionables: un ancla por disciplina ajustada por antigüedad, región y modalidad de trabajo, con cada multiplicador visible en la página. La cuadrícula `/salary/:role/:city` te da páginas de ciudad × puesto al estilo de Glassdoor, además de los enlaces cruzados entre ciudades por los que Glassdoor cobra niveles premium, y, a diferencia de un promedio autodeclarado, puedes ver exactamente cómo se construyó el número.

Y Builderforce incluye el **flujo de trabajo de reclutamiento** completo en el mismo producto: el AI Recruiter Agent v2, las Live Screening Sessions, el ATS y las publicaciones de empleo. Glassdoor se queda en marca e investigación.

## Dónde gana Glassdoor

**Profundidad histórica.** Más de 20 años de reseñas de empleados. Para una empresa Fortune 500 con más de 5.000 reseñas desde 2010, esa profundidad importa de verdad: puedes ver líneas de tendencia, cambios de liderazgo y variaciones tras una adquisición.

**Reconocimiento de marca.** Los candidatos buscan «Acme Corp Glassdoor» por reflejo. La marca es el foso.

**Tamaño de muestra para empresas consolidadas.** Una empresa de 2 años tiene 3 reseñas en Glassdoor y 1 en Builderforce. Para investigar a actores consolidados, el volumen de Glassdoor suele superar al de Builderforce.

**Historial salarial.** Los datos salariales de Glassdoor se remontan años atrás, con cadencia trimestral. Los datos salariales de Builderforce son solo de las ofertas vigentes: precisos para *ahora*, pero todavía sin serie temporal.

## Dónde gana Builderforce

**Valoraciones multieje, no una sola puntuación.** Un 4,0 formado por (5, 5, 2, 5, 5, 2) es muy distinto de (4, 4, 4, 4, 4, 4), y solo la vista multieje te dice cuál es cuál. Builderforce muestra por defecto tanto el agregado como el desglose por eje.

**Datos salariales que puedes comprobar.** Un promedio autodeclarado oculta su método; este lo publica. Cada rango nombra el ancla y cada multiplicador aplicado, así que puedes discrepar de un supuesto en lugar de discrepar de un número.

**La misma superficie para investigar y postularse.** Un candidato que investiga una empresa en Glassdoor tiene que salir para postularse (vía Indeed). En Builderforce el perfil de la empresa, las reseñas, la guía salarial y las ofertas de empleo son una sola superficie: de investigar a postularse hay un clic.

**Flujo de reclutamiento incluido.** Glassdoor for Employers es un producto solo de marca. Builderforce Pro incluye el AI Recruiter Agent, Live Screening, el ATS y las publicaciones de empleo en la misma tarifa mensual plana.

**Infraestructura de reseñas verificadas.** El sistema de reseñas de Builderforce almacena `is_verified` + `verification_method` (coincidencia de dominio de correo o haber sido comprador). Glassdoor modera, pero no expone el estado de verificación a los candidatos.

## Cuándo elegir cada una

**Usa Glassdoor cuando:** investigues una empresa Fortune 500 o una empresa pública consolidada con más de 100 reseñas de profundidad histórica; quieras la vista de serie temporal de cómo ha cambiado una empresa; necesites reconocimiento de marca ante los ejecutivos de tu equipo.

**Usa Builderforce cuando:** quieras una vista multieje de cómo rinde realmente una empresa en cultura / sueldo / liderazgo / conciliación / crecimiento / diversidad; quieras datos salariales prospectivos basados en lo que los empleadores pagan ahora mismo; quieras investigar una empresa Y postularte Y recibir coincidencias sin salir de la superficie; seas un empleador que busca una superficie de marca que integre el flujo de reclutamiento en una sola suscripción plana en lugar de más de 400 $/mes por Glassdoor Enhanced.

**Usa ambas:** lee las dos series de reseñas y contrástalas. Cuando coinciden, la señal es alta. Cuando discrepan, las reseñas recientes de Builderforce suelen ser la imagen más actual.

## Preguntas frecuentes

### ¿Pueden los empleadores responder a las reseñas en Builderforce?

Sí. Las empresas pueden publicar respuestas en hilo bajo cualquier reseña mediante la tabla `review_comments`; las respuestas del propietario verificado de la empresa se marcan con `is_subject_owner=true` para que los candidatos vean de un vistazo qué comentarios son respuestas oficiales de la empresa.

### ¿Cómo evita Builderforce las reseñas falsas?

Las reseñas están vinculadas a cuentas de usuario autenticadas (una reseña por usuario y empresa, garantizada por un índice único). El estado de empleado verificado se concede cuando el dominio del correo del autor coincide con el dominio verificado de la empresa. Las reseñas del propietario de la empresa quedan bloqueadas por la elegibilidad del descriptor (`owner_blocked`). Se almacena un `submitter_ip_hash` para el análisis posterior de fraude.

### ¿Tiene Builderforce datos salariales para puestos internacionales?

Por ahora las guías salariales se centran en EE. UU. (la dimensión de ciudad se extrae de ubicaciones de ofertas en texto libre como 'San Francisco, CA'). La expansión internacional está en la hoja de ruta como parte de la iniciativa de internacionalización más amplia; el esquema subyacente (`content_locations`) ya reconoce países y está listo.

---

**Pruébalo:** [Reseñas de empresas + Guías salariales](/companies) en Builderforce.
