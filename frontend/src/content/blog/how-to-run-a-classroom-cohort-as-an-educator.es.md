## Cohortes frente a cursos a tu ritmo

Un curso a tu ritmo es un estudiante a solas con el material. Una cohorte de aula es un *grupo* que avanza junto por el material con un calendario, con un educador que reparte tareas y vigila el progreso. Las cohortes aportan responsabilidad y ritmo, las dos cosas que más mejoran las tasas de finalización.

En Builderforce, un educador es un Creator o un empleador; un estudiante es un candidato en modo de aprendizaje. Ninguno es un rol nuevo: la capa de cohortes se apoya en las cuentas que ya tienes. Encontrarás tus aulas como una pestaña en la página Tools, en [/tools?tab=classrooms](/training), y los estudiantes ven su parte en la pestaña de aprendizaje.

## Paso 1: crea un aula

Abre [Aulas](/training) y crea una cohorte. Ponle un nombre, una descripción y el curso o la ruta de aprendizaje en torno a la que se construye. La cohorte es el contenedor: guarda a los miembros y las tareas que les asignarás.

Decide la forma desde el principio: una cohorte de inicio fijo en la que todos empiezan juntos, o una cohorte abierta a la que los estudiantes se unen a medida que se inscriben. Las cohortes de inicio fijo logran la mayor responsabilidad entre iguales; las abiertas son más fáciles de operar a escala.

## Paso 2: inscribe a los estudiantes

Añade miembros a la cohorte. La pertenencia se registra de forma explícita, y el acceso en todo el aula está controlado por la misma costura de permisos `canActFor` que usa el resto de la plataforma, así que un educador actúa sobre su propia cohorte y no puede meterse en la de otro.

Mantén las cohortes lo bastante pequeñas como para dar atención. La responsabilidad que hace funcionar a las cohortes depende de que el educador vea de verdad el progreso de cada estudiante; eso se rompe pasado cierto tamaño, así que divide una admisión grande en varias cohortes en lugar de una sola sala gigante.

## Paso 3: reparte tareas de aprendizaje

Las tareas son la palanca del educador. Asigna un módulo, una lección o una ruta completa a la cohorte con una fecha de entrega. Los estudiantes ven la tarea en su pestaña de aprendizaje; tú ves quién la ha completado.

Las tareas son el puente entre el contenido y el ritmo. Un curso a tu ritmo dice «aquí está el material». Una tarea dice «termina el módulo 2 para el viernes», y ese único cambio es lo que hace avanzar a una cohorte por el currículo en conjunto en lugar de dispersarse.

## Paso 4: vigila las analíticas

El aula muestra analíticas de cohorte en caché: tasas de finalización, quién va rezagado, dónde se atascan los estudiantes. Úsalas para intervenir pronto: un estudiante que no ha empezado en la segunda fecha de entrega necesita un empujón antes de desconectarse por completo.

Como la finalización pasa por el mismo LRS de xAPI que respalda los cursos, las analíticas se basan en registros reales, no en autoinformes. Cuando la cohorte termina, la misma maquinaria de certificados que impulsa los cursos a tu ritmo emite credenciales verificables a tus estudiantes.

## Preguntas frecuentes

### ¿Es «educador» un tipo de cuenta aparte?

No. Un educador es un Creator o un empleador, y un estudiante es un candidato en modo de aprendizaje. La capa de cohortes se apoya en las cuentas existentes: no hay ningún rol nuevo al que registrarse.

### ¿Dónde encuentro mis aulas?

Las aulas viven como una pestaña en la página Tools, en /tools?tab=classrooms, no como un elemento aparte de la barra lateral. Los estudiantes ven su aprendizaje inscrito en /tools?tab=learning.

### ¿Cómo se controla el acceso entre cohortes?

Mediante la comprobación de permisos canActFor de la plataforma. Un educador actúa solo sobre los miembros y las tareas de su propia cohorte y no puede meterse en una cohorte que no le pertenece, lo que mantiene los datos de los estudiantes acotados al aula correcta.

---

**Pruébalo:** [Aulas](/training) en Builderforce.
