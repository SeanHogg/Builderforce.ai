Un espacio de trabajo visual se vuelve frágil cuando cada tarjeta es un componente a medida y cada integración inventa un comportamiento nuevo. Creation Canvas usa en su lugar un contrato basado en un registro: **48 tipos de objeto**, cada uno con un grupo conocido, un renderizador, un inspector, acciones, campos mutables, conexiones, contexto seguro para Brain y un adaptador de vista previa.

![Vista de producto de la paleta de Creation Object con diez grupos, tarjetas de objetos vivos representativas en el lienzo, insignias de capacidades y los seis tipos de conexión semántica](/blog/creation-object-registry-workspace.svg)

## Diez grupos cubren el trabajo sin aplanarlo

La paleta organiza los objetos en Build, Data, Knowledge, Insights, Work, People, Agents, Models, Collaborate e Integrations.

Build incluye Workflow, Website, Chat, Dataset, WYSIWYG Prototype, Code, Browser preview, artefactos de repositorio y de editor, servicios locales y Video. Data incluye Table, Spreadsheet, Chart y KPI. Knowledge incluye Documents, Slides, archivos, URL y elementos de conocimiento. Insights incluye Dashboards, Reports, Evaluations, comparaciones, Roadmaps y Notes.

Work, People, Agents, Models y Collaborate reúnen los artefactos de planificación, de plantilla, de modelos y multijugador que rodean la entrega. Integrations expone por ahora las herramientas MCP como objetos nativos, en lugar de una configuración de chat invisible.

## Cada objeto declara qué puede hacer Brain

El registro aporta datos por defecto, acciones nativas y una lista de campos mutables permitidos. Un Website puede editarse, previsualizarse y publicarse. Un Dataset puede importarse, perfilarse y visualizarse. Un Project puede expandirse y compararse. Un Agent puede inspeccionarse, configurarse y asignarse. Evermind puede enseñar, entrenar, evaluar y publicar. Un objeto MCP puede autenticarse y ejecutarse.

Brain lee las mismas declaraciones que alimentan el inspector. No puede inventarse un campo o una acción no admitidos y esperar que el lienzo los acepte en silencio.

![Cada uno de los 48 tipos de objeto pasa por un único contrato de registro para datos por defecto, renderizado, inspección, acciones nativas, campos mutables, contexto seguro para la IA, vista previa, política de capacidades y seis relaciones semánticas permitidas: datos, control, referencia, presentación, entrega y pertenencia](/blog/creation-object-registry-contract.svg)

## Seis aristas convierten la disposición en un grafo

Creation Canvas define seis tipos de conexión semántica:

- **data** — un objeto suministra valores a otro;
- **control** — un objeto dirige o configura a otro;
- **reference** — un artefacto cita a otro o depende de él;
- **presentation** — un artefacto presenta a otro;
- **delivery** — un artefacto aprobado avanza hacia la ejecución;
- **membership** — una persona, un agente o un elemento pertenece a un grupo o a un ritual.

La proximidad espacial sigue siendo solo visual. El significado vive en la arista explícita.

## Las puertas de capacidad preservan la política del tenant

Algunos tipos —Evermind, MCP, Agent, LLM, Voice y Video— declaran capacidades de la plataforma. La paleta los filtra según el conjunto de capacidades disponible. Una plantilla solo puede referirse a tipos registrados, pero instalarla nunca esquiva el acceso ni la autenticación del tenant.

## Un contrato neutral respecto al transporte abarca todas las superficies

Los tipos de objeto, los tipos de conexión y los tipos de comando con revisión viven en un contrato compartido que usan el lienzo web y la superficie de VS Code. Así, ambos pueden hablar de la misma identidad de objeto y de la misma operación sobre el grafo sin serializar una interfaz dentro de la otra.

El vocabulario de comandos cubre el reemplazo del grafo; añadir, actualizar, mover y eliminar objetos; añadir y eliminar conexiones; y los cambios de viewport. Las revisiones del servidor aportan el orden y el límite de conflicto alrededor de esos comandos.

## La extensibilidad sigue siendo inspeccionable

El registro es más que una lista de paleta. Es el lugar donde un objeto declara qué puede exponer, aceptar, previsualizar y hacer. Eso hace que los nuevos tipos de objeto se puedan componer con Brain, la colaboración, las plantillas y ambas superficies de cliente desde el primer momento.

El lienzo puede crecer sin convertirse en un montón de tarjetas sin tipos.

[Explora la paleta de Creation Object →](/create/new)
