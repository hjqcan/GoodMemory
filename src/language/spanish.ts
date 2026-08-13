import type {
  LanguageContentAnalysis,
  LanguagePack,
  LanguageQueryAnalysis,
  LanguageRenderKey,
} from "./contracts";
import { emptyQueryAnalysis, resolveSourceOfTruthDirective } from "./packHelpers";
import type { RomancePackDefinition } from "./romanceCore";
import { createRomanceLanguagePack } from "./romanceCore";

const SPANISH_INTERROGATIVE_ANCHORS = [
  "adónde",
  "adonde",
  "cuáles",
  "cuales",
  "cuál",
  "cual",
  "cuán",
  "cuan",
  "quiénes",
  "quienes",
  "quién",
  "quien",
  "dónde",
  "donde",
  "cuándo",
  "cuando",
  "por qué",
  "por que",
  "cómo",
  "como",
  "cuántos",
  "cuantos",
  "cuántas",
  "cuantas",
  "cuánto",
  "cuanto",
  "cuánta",
  "cuanta",
  "qué",
  "que",
] as const;
const STOPWORDS = new Set([
  "al",
  "antes",
  "como",
  "con",
  "de",
  "del",
  "desde",
  "después",
  "el",
  "ella",
  "ellos",
  "en",
  "es",
  "esta",
  "este",
  "estos",
  "la",
  "las",
  "lo",
  "los",
  "me",
  "mi",
  "mis",
  "nos",
  "nosotros",
  "o",
  "para",
  "pero",
  "por",
  "que",
  "se",
  "sin",
  "su",
  "sus",
  "un",
  "una",
  "y",
  "ya",
  "yo",
  ...SPANISH_INTERROGATIVE_ANCHORS,
]);

const ENTITY_STOPWORDS = new Set([
  "cómo",
  "cuál",
  "cuáles",
  "cuándo",
  "dónde",
  "el",
  "ella",
  "la",
  "las",
  "los",
  "nosotros",
  "qué",
  "quién",
  "quiénes",
  "yo",
]);

const QUERY = {
  actionDriving:
    /\b(?:continuar|reanudar|enviar|publicar|desplegar|ejecutar|decidir|modificar|eliminar|escribir|próximo paso|después|debo|debemos)\b/iu,
  after: /\b(?:después|desde|posterior|más tarde)\b/iu,
  aggregateCount: /\b(?:cuántos|cuántas|cuánto|total|suma|en total)\b/iu,
  answer: /\b(?:responder|respuesta|resumir|resumen|redactar|borrador)\b/iu,
  assistantEvidenceRecall:
    /\b(?:anterior|antes|la última vez|me dijiste|me dijo|me recomendaste|recuérdame)\b/iu,
  before: /\b(?:antes|anterior|previo|previamente)\b/iu,
  blocker: /\b(?:bloqueos?|bloqueado|bloqueada|impedimento|obstáculo|aprobación)\b/iu,
  change:
    /(?:^|[^\p{L}\p{N}])(?:cambiar|cambió|reemplazar|reemplazado|sustituir|antes usaba|ya no)(?=$|[^\p{L}\p{N}])/iu,
  confirm: /\b(?:confirmar|confirma|confirmación)\b/iu,
  continuation: /\b(?:continuar|reanudar|retomar|seguir|la última vez)\b/iu,
  current: /\b(?:actual|actuales|actualmente|ahora|último|última|vigente)\b/iu,
  directFactualLookup:
    /^(?:¿?quién|¿?qué|¿?cuál|¿?cuáles|¿?dónde|¿?cuándo|¿?cuánto|¿?cuántos|¿?puedes recordarme|¿?puede recordarme)\b/iu,
  exhaustiveList: /\b(?:todos|todas|todo|lista|completo|restantes?|pendientes?|por hacer)\b/iu,
  factConfirmationTarget:
    /\b(?:rol|función|prioridad|bloqueo|tarea pendiente|aprobación|validación)\b/iu,
  focus: /\b(?:prioridad|objetivo principal|enfoque|trabajo actualmente en)\b/iu,
  guidanceSeeking:
    /\b(?:preferencia|estilo|formato|tono|regla|instrucción|debería|debo|cómo debo|evitar)\b/iu,
  history: /\b(?:historial|historia|pasado|antes|previamente|cronología)\b/iu,
  openLoop: /\b(?:tarea pendiente|pendiente|por hacer|seguimiento|sin resolver|validación)\b/iu,
  procedural: /\b(?:procedimiento|pasos?|método|proceso|manual|cómo (?:hacer|debo))\b/iu,
  projectState:
    /\b(?:proyecto|proceso|migración|despliegue|publicación|aprobación|bloqueos?|validación|tarea pendiente)\b/iu,
  recommendationStyle:
    /\b(?:recomienda|recomendación|aconseja|consejo|sugerencia|qué debería|qué debo)\b/iu,
  reference:
    /\b(?:guía|documento|documentación|referencia|fuente de verdad|manual|procedimiento)\b/iu,
  relation: /\b(?:relacionado|relacionada|conectado|conectada|asociado|asociada|informa a|mentor)\b/iu,
  role: /\b(?:rol|función|puesto)\b/iu,
} as const;

const CONTENT = {
  assistantAck: /^(?:entendido|anotado|de acuerdo|recibido|actualizado|gracias)[.!]?$|^(?:queda anotado)[.!]?$/iu,
  assistantContinuity: /\b(?:continuar|en adelante|próximo paso|seguimiento|mantener|actualizar|confirmar)\b/iu,
  blockerFact: /\b(?:bloqueo|bloqueado|bloqueada|impedimento|obstáculo|aprobación pendiente)\b/iu,
  correctionCue: /\b(?:corrección|corregir|reemplazar|reemplazado|en lugar de|fuente de verdad)\b/iu,
  dont: /\b(?:no\b[^.!?]{0,100}|nunca|evita|evitar|prohibido|no debes)\b/iu,
  durableCue:
    /\b(?:recuerda|recuérdalo|memoriza|fuente de verdad|manual|bloqueo|prefiero|mi rol actual|mi función actual|mi zona horaria|mi idioma preferido|mi prioridad actual|proyecto actual)\b/iu,
  focusFact: /\b(?:mi prioridad actual es|mi objetivo principal es|trabajo actualmente en|me concentro en)\b/iu,
  negative: /\b(?:bloqueado|bloqueada|fallo|falla|sin resolver|abierta?|inestable|pendiente)\b/iu,
  openLoopFact: /\b(?:tarea pendiente|por hacer|todavía debo|aún debo|sin resolver|pendiente|seguimiento necesario)\b/iu,
  personalEvidence: /\b(?:yo|me|mí|mi|mis|nosotros|nosotras|nuestro|nuestra|nuestros|nuestras)\b/iu,
  positive: /\b(?:estable|resuelto|resuelta|cerrado|cerrada|corregido|corregida|terminado|terminada|completado|completada)\b/iu,
  prefer: /\b(?:prefiero|preferencia|priorizo)\b/iu,
  preferenceEvidence: /\b(?:prefiero|preferencia|gusta|quiero|quisiera|interesado|interesada|evitar|odio|dificultad|problema)\b/iu,
  projectStateFact: /\b(?:próximo paso|próximo hito|pendiente|restante|validación necesaria|revisión necesaria|fase del proyecto|estado del proyecto)\b/iu,
  roleFact: /\b(?:mi rol actual es|mi función actual es|mi puesto actual es|soy responsable de)\b/iu,
  sensitiveCredential:
    /\b(?:clave[_ -]?api|contraseña|secreto|token)\b\s*[:=：]\s*\S+/iu,
  unresolved: /\b(?:sin resolver|abierta?|bloqueado|bloqueada|pendiente|por hacer|próximo paso|seguimiento)\b/iu,
  validated: /\b(?:funcionó bien|eficaz|exitoso|exitosa|sigue así|mantén este método)\b/iu,
} as const;

const SPANISH_EVENT_TEMPORAL_PATTERN =
  /\b(?:anteayer|ayer|hoy|hace\s+\d{1,3}\s+d[ií]as?|(?:la\s+)?semana\s+pasada|este\s+mes|(?:el\s+)?mes\s+pasado|(?:el\s+)?trimestre\s+pasado|(?:el\s+)?año\s+pasado)\b|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+\d{4}\b/iu;

function spanishEventOccurrenceQueryMode(
  text: string,
): LanguageQueryAnalysis["eventOccurrenceQueryMode"] {
  const temporal = text.match(SPANISH_EVENT_TEMPORAL_PATTERN);
  if (!temporal) {
    return undefined;
  }
  const temporalIndex = temporal.index ?? -1;
  if (temporalIndex >= 0) {
    const prefix = text.slice(0, temporalIndex);
    const suffix = text.slice(temporalIndex + temporal[0].length);
    if (
      /\b(?:antes|después)\s+(?:de(?:l|\s+la|\s+los|\s+las)?)\s*$/iu.test(
        prefix,
      ) ||
      /\b(?:proyecto|película|film|canción|libro|álbum)\s*$/iu.test(prefix) ||
      /[«“"]\s*$/u.test(prefix) && /^\s*[»”"]/u.test(suffix)
    ) {
      return undefined;
    }
  }
  if (/\bqué\s+(?:pasó|ocurrió|sucedió)/iu.test(text)) {
    return "broad";
  }
  return (
    /(?:qué|cuál(?:es)?|dónde|a\s+quién|con\s+quién)(?=$|[^\p{L}\p{N}])[^?]{0,80}(?:he\s+\p{L}+|\p{L}+(?:é|í)|comí|bebí|hice|fui|tuve|estuve|vi|dije|traje|terminé|completé|entregué|publiqué|visité|conocí)(?=\s|[?.,]|$)/iu.test(
      text,
    )
  ) ? "predicate" : undefined;
}

function analyzeSpanishQuery(text: string): LanguageQueryAnalysis {
  const base = emptyQueryAnalysis();
  const role = QUERY.role.test(text);
  const focus = QUERY.focus.test(text);
  const blocker = QUERY.blocker.test(text);
  const openLoop = QUERY.openLoop.test(text);
  const before = QUERY.before.test(text);
  const eventOccurrenceQueryMode = spanishEventOccurrenceQueryMode(text);
  return {
    ...base,
    actionDriving: QUERY.actionDriving.test(text),
    after: QUERY.after.test(text),
    aggregateCount: QUERY.aggregateCount.test(text),
    answerComposition: QUERY.answer.test(text),
    assistantEvidenceRecall: QUERY.assistantEvidenceRecall.test(text),
    before,
    blocker,
    change: QUERY.change.test(text),
    continuation: QUERY.continuation.test(text),
    current: QUERY.current.test(text),
    directFactualLookup: QUERY.directFactualLookup.test(text.trim()),
    eventOccurrenceQuery: eventOccurrenceQueryMode !== undefined,
    ...(eventOccurrenceQueryMode ? { eventOccurrenceQueryMode } : {}),
    exhaustiveList: QUERY.exhaustiveList.test(text),
    factConfirmation: role || focus || blocker || openLoop ||
      (QUERY.confirm.test(text) && QUERY.factConfirmationTarget.test(text)),
    focus,
    guidanceSeeking: QUERY.guidanceSeeking.test(text),
    history: !before && QUERY.history.test(text),
    openLoop,
    procedural: QUERY.procedural.test(text),
    projectState: QUERY.projectState.test(text),
    recommendationStyle: QUERY.recommendationStyle.test(text),
    referenceSeeking: QUERY.reference.test(text),
    relation: QUERY.relation.test(text),
    role,
    userGroundedEventOrder:
      /\b(?:orden|cronológico|cronología|del primero al último)\b/iu.test(text) &&
      /(?:^|[^\p{L}\p{N}])(?:yo|nosotros|nosotras)(?=$|[^\p{L}\p{N}])[^.!?]{0,120}(?:^|[^\p{L}\p{N}])(?:dije|dijimos|mencioné|mencionamos|hablé|hablamos)(?=$|[^\p{L}\p{N}])/iu.test(text),
  };
}

function analyzeSpanishSourceOfTruthDirective(text: string) {
  const negated = (index: number, pointerLength: number): boolean => {
    const prefix = text.slice(Math.max(0, index - 120), index);
    const suffix = text.slice(index + pointerLength, index + pointerLength + 160);
    return (
      /\b(?:no uses|no utilizar|en lugar de)\s*$/iu.test(prefix) ||
      /^\s*(?:ya no es|no debe ser)\s+(?:la\s+)?fuente de verdad\b/iu.test(suffix)
    );
  };
  return resolveSourceOfTruthDirective(text, {
    affirmed(index, pointerLength) {
      if (negated(index, pointerLength)) return false;
      const prefix = text.slice(Math.max(0, index - 100), index);
      const suffix = text.slice(index + pointerLength, index + pointerLength + 160);
      return (
        /\b(?:usa|use|utiliza|toma|considera)\s*$/iu.test(prefix) &&
          /^\s+como\s+(?:la\s+)?fuente de verdad\b/iu.test(suffix) ||
        /^\s+(?:es|se convierte en)\s+(?:ahora\s+)?(?:la\s+)?fuente de verdad\b/iu.test(suffix)
      );
    },
    negated,
  });
}

function analyzeSpanishContent(text: string): LanguageContentAnalysis {
  const factPolarity = CONTENT.negative.test(text)
    ? "negative"
    : CONTENT.positive.test(text)
    ? "positive"
    : "unknown";
  const feedbackKind = CONTENT.validated.test(text)
    ? "validated_pattern"
    : CONTENT.dont.test(text)
    ? "dont"
    : CONTENT.prefer.test(text)
    ? "prefer"
    : "do";
  return {
    assistantAcknowledgement: CONTENT.assistantAck.test(text.trim()),
    assistantContinuity: CONTENT.assistantContinuity.test(text),
    blockerFact: CONTENT.blockerFact.test(text),
    correctionCue: CONTENT.correctionCue.test(text),
    durableCue: CONTENT.durableCue.test(text),
    factPolarity,
    feedbackKind,
    focusFact: CONTENT.focusFact.test(text),
    openLoopFact: CONTENT.openLoopFact.test(text),
    personalEvidence: CONTENT.personalEvidence.test(text),
    preferenceEvidence: CONTENT.preferenceEvidence.test(text),
    projectStateFact: CONTENT.projectStateFact.test(text),
    roleFact: CONTENT.roleFact.test(text),
    sensitiveCredential: CONTENT.sensitiveCredential.test(text),
    sourceOfTruthDirective: analyzeSpanishSourceOfTruthDirective(text),
    unresolved: CONTENT.unresolved.test(text),
  };
}

const SPANISH_RENDER_CATALOG = {
  active_context: "Contexto activo",
  canonical_pattern: "Patrón canónico",
  guidance: "Guía",
  instruction: "Instrucción",
  metadata: "Metadatos",
  playbook_title: "Manual: {rule}",
  procedure: "Procedimiento",
  prompt_snippet_title: "Fragmento de prompt: {rule}",
  skill_snippet_title: "Fragmento de habilidad: {rule}",
  use_when: "Cuándo usarlo",
  why: "Motivo",
  actor: "Actor",
  additional_project_state: "Contexto adicional del estado del proyecto",
  archive: "Archivo de sesión",
  archive_recap: "Resumen del archivo: {sessionId}",
  artifact_spills: "Contenido externalizado",
  behavioral_controls_available:
    "Hay controles de experiencia sin procesar relevantes para corregir de forma determinista la respuesta final.",
  behavioral_exact_surface: "Forma exacta:",
  behavioral_example: "Ejemplo {index}:",
  behavioral_observed_outcome: "Resultado observado:",
  behavioral_raw_response_control: "Control de respuesta sin procesar:",
  behavioral_relevant_prior_examples: "Ejemplos anteriores relevantes:",
  behavioral_safe_corrected_move: "Acción corregida segura:",
  behavioral_situation: "Situación:",
  behavioral_successful_move: "Acción exitosa:",
  claim: "Afirmación",
  correction: "Corrección",
  current_goal: "Objetivo actual",
  current_projects: "Proyectos actuales",
  current_state: "Estado actual",
  constraints: "Restricciones",
  deferred_follow_up: "Contexto de seguimiento diferido",
  developer_memory_notes: "Notas de memoria del desarrollador:",
  durable_memory: "Memoria duradera",
  earlier_messages_compacted: "Los mensajes anteriores se compactaron.",
  episode: "Episodios relevantes",
  episode_assistant_follow_through_captured: "Seguimiento del asistente registrado.",
  episode_assistant_follow_through_on: "Seguimiento del asistente sobre: {highlight}",
  episode_assistant_substantive_continuity_captured:
    "Continuidad sustantiva del asistente registrada.",
  episode_conversation_covered: "La conversación abarcó: {segments}",
  episode_item: "Episodio",
  evidence: "Evidencia",
  evidence_entry: "Evidencia {evidenceId} de la memoria {memoryId}.",
  evidence_note:
    "Interpreta cada entrada según su estado temporal y relación de evidencia.",
  experiences: "Experiencias",
  excerpt: "Extracto",
  fact: "Hechos",
  fact_item: "Hecho",
  feedback: "Comentarios",
  file_evidence: "Evidencia de archivo",
  file_or_function: "Archivo/Función",
  goals: "Objetivos",
  immediate_next_steps: "Próximos pasos inmediatos",
  installed_host_claude_memory_protocol:
    "GoodMemory complementa la memoria automática de Claude Code: conserva tus propias notas de trabajo de la sesión en MEMORY.md; conserva los hechos, decisiones y preferencias duraderas del proyecto en GoodMemory para que aparezcan con su procedencia en cada solicitud. No copies en MEMORY.md el contenido de GoodMemory inyectado por los hooks.",
  installed_host_context_tool_protocol:
    "Cuando el contexto inyectado falte o no sea suficiente, llama a goodmemory_get_context con una pregunta concreta, sea cual sea.",
  installed_host_injected_context_protocol:
    "Los bloques «Notas de memoria del desarrollador» inyectados por los hooks contienen la memoria recuperada para la solicitud actual. Léelos antes de planificar y dales prioridad frente a volver a deducir los hechos del proyecto; verifica en el repositorio los hechos sensibles al tiempo antes de actuar.",
  installed_host_intro:
    "Este repositorio usa GoodMemory (ruta del host {host} instalada) para una memoria duradera y gobernada.",
  installed_host_projection_protocol:
    "Trata los archivos de artefactos exportados como proyecciones, no como verdad canónica, y no copies literalmente la memoria inyectada en archivos ni mensajes de commit.",
  installed_host_protocol_heading: "Protocolo de memoria:",
  installed_host_record_tools_protocol:
    "Cuando necesites registros concretos en vez de un resumen renderizado, llama a goodmemory_search_index y después a goodmemory_get_records. Si una memoria parece incorrecta o falta de forma inesperada, llama a goodmemory_trace_recall para saber por qué se seleccionó o descartó.",
  installed_host_remember_protocol:
    "Cuando conozcas un hecho, decisión, preferencia o bloqueo duradero que merezca conservarse y la herramienta goodmemory_remember esté disponible, guárdalo con una sola declaración clara por llamada. Las escrituras están gobernadas y son auditables; el resultado explica cualquier rechazo.",
  journal: "Diario de sesión",
  key_decisions: "Decisiones clave",
  key_files: "Archivos clave",
  language_label: "Idioma",
  learning_proposals: "Propuestas de aprendizaje",
  lineage: "Linaje",
  location: "Ubicación",
  memory_index: "Índice de memoria",
  name: "Nombre",
  none: "ninguno",
  omitted_records: "registros omitidos: {count}",
  omitted_sections: "Secciones omitidas: {sections}",
  open_loops: "Asuntos pendientes",
  organization: "Organización",
  preference: "Preferencias",
  procedural_memory: "Memoria procedimental",
  profile: "Perfil",
  progressive_detail_instruction:
    "Usa los valores recordRef con la herramienta de detalle solo cuando necesites más contexto.",
  progressive_detail_instruction_compact:
    "Usa los recordRef con la herramienta de detalle cuando sea necesario.",
  progressive_recall: "Recuperación progresiva de GoodMemory",
  promotions: "Promociones",
  recent_decisions: "Decisiones recientes",
  recent_worklog: "Registro de trabajo reciente",
  record_kind: "tipo",
  record_ref: "referencia",
  reference: "Referencias",
  reference_item: "Referencia",
  referenced_artifacts: "Artefactos referenciados",
  relation_label: "Relación",
  role_label: "Rol",
  scope: "Ámbito",
  session_archive_item: "Archivo de sesión",
  session_ended_without_summary: "La sesión terminó sin un resumen sintetizado.",
  session_handoff: "Traspaso de sesión: {sessionId}",
  session_memory: "Memoria de sesión: {sessionId}",
  session_resume_query:
    "¿Qué continuidad, contexto activo y asuntos pendientes debo retomar en esta sesión de programación?",
  session_start_query:
    "¿Qué contexto activo, continuidad y asuntos pendientes debo conocer al iniciar esta sesión de programación?",
  summary: "Resumen",
  detail_tokens: "tokens de detalle",
  temporal_status: "Estado temporal",
  temporary_decision: "Decisión temporal",
  timezone: "Zona horaria",
  tool_result: "Resultado de la herramienta",
  undated: "sin fecha",
  user_memory: "Memoria del usuario",
  user_memory_context: "Contexto de memoria del usuario:",
  default_label: "predeterminado",
  verification: "Verificación",
  workflow: "Flujo de trabajo",
  working_memory: "Memoria de trabajo",
  workspace_query_anchor: "Espacio de trabajo: {workspace}.",
} as const satisfies Record<LanguageRenderKey, string>;

const SPANISH_MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const DEFINITION = {
  analyzerVersion: "11-durable-optout-boundary",
  behavioralRulePatterns: {
    firstAction: [
      /(?:primero|en\s+primer\s+lugar)\s+([A-Za-z_][A-Za-z0-9_@.-]*)/iu,
      /([A-Za-z_][A-Za-z0-9_@.-]*)\s+(?:primero|en\s+primer\s+lugar)/iu,
    ],
    format: /\b(?:inicio|apertura|final|cierre|prefijo|sufijo|firma|asunto|formato)\b/iu,
    general: /\b(?:siempre|debe|debes|deben|a partir de ahora|cada vez|obligatoriamente)\b/iu,
    hostAction: {
      destination: [
        /\b(?:a|hacia|dentro de)\s+['"`]([^'"`]+)['"`]/iu,
        /\b(?:a|hacia|dentro de)\s+((?:~\/|\/)[A-Za-z0-9._/-]+)/iu,
      ],
      verbs: [
        { pattern: /\b(?:copia|copie|copiar)\b/iu, value: "copy" },
        { pattern: /\b(?:mueve|mueva|mover)\b/iu, value: "move" },
      ],
    },
    negative: /\b(?:evita|evite|no|nunca|prohibido|en vez de|en lugar de)\b/iu,
    trigger: [
      /\bpara\s+(.+?)(?:[,.]|$)/iu,
      /\bsi\s+(.+?)(?:[,.]|$)/iu,
      /\bantes\s+de\s+(.+?)(?:[,.]|$)/iu,
      /\bcuando\s+(.+?)(?:[,.]|$)/iu,
    ],
  },
  compatibilityGroup: "es",
  defaultLocale: "es-ES",
  durableTargetAliases: {
    "codigo de proyecto": "assignment:project_code",
    "código de proyecto": "assignment:project_code",
    "idioma preferido": "profile:languagePreference",
    "proyecto actual": "profile:currentProject",
    función: "profile:role",
    organización: "profile:organization",
    nombre: "profile:name",
    puesto: "profile:role",
    preferencia: "preference",
    preferencias: "preference",
    rol: "profile:role",
    ubicación: "profile:location",
    "zona horaria": "profile:timezone",
  },
  id: "es",
  locales: ["es"],
  stopwords: STOPWORDS,
  entityStopwords: ENTITY_STOPWORDS,
  distinctivePatterns: [
    /[¿¡ñáíóú]/iu,
    /\b(?:yo|nosotros|nosotras|ustedes|cuál|cuáles|qué|cómo|dónde|cuándo|recuerda|español|española|prefiero|despliegue|bloqueado|bloqueada|actualmente)\b/iu,
    /\bfuente de verdad\b/iu,
  ],
  incompatiblePatterns: [
    /[àâçèêëîïôœæùûÿ]/iu,
    /\b(?:je|nous|vous|avec|quel(?:le|s|les)?|souviens-toi|français|française|préfère|déploiement|bloqué|bloquée|source de vérité)\b/iu,
  ],
  interrogativeAnchors: SPANISH_INTERROGATIVE_ANCHORS,
  nominalClauseAssertion:
    /^\p{L}+(?:['’-]\p{L}+)*\s+(?:(?:(?:el|la|los|las|un|una|mi|mis|nuestro|nuestra|nuestros|nuestras|este|esta|estos|estas)\s+[\p{L}\p{M}'’-]+\s+[\p{L}\p{M}'’-]+)|(?:[\p{L}\p{M}'’-]+\s+(?:el|la|los|las|un|una|mi|mis|nuestro|nuestra|nuestros|nuestras|este|esta|estos|estas)\s+[\p{L}\p{M}'’-]+)|(?:(?:esto|eso|aquello|él|ella|ellos|ellas|yo|tú|nosotros|ustedes)\s+[\p{L}\p{M}'’-]+))(?:\s+[^?]+?)?\s+(?:(?:depende(?:n)?|queda(?:n)?|es|son|era|eran|está|están)(?=$|[^\p{L}\p{N}])[^?]*|sigue(?:n)?\s+sin\s+estar\s+clar[oa]s?)[.!]?$/iu,
  decompositionBoundary: /\s+(?:y|además de|luego)\s+/iu,
  analyzeQuery: analyzeSpanishQuery,
  analyzeContent: analyzeSpanishContent,
  daysAgoPattern: /\bhace\s+(\d{1,3})\s+d[ií]as?\b/iu,
  temporalPatterns: [
    { offset: -2, pattern: /\banteayer\b/iu, unit: "day" },
    { offset: 2, pattern: /\bpasado mañana\b/iu, unit: "day" },
    { offset: -1, pattern: /\bayer\b/iu, unit: "day" },
    { offset: 0, pattern: /\bhoy\b/iu, unit: "day" },
    { offset: 1, pattern: /(?<!pasado )\bmañana\b/iu, unit: "day" },
    { offset: -1, pattern: /\b(?:la\s+)?semana pasada\b/iu, unit: "week" },
    { offset: 0, pattern: /\besta semana\b/iu, unit: "week" },
    { offset: 1, pattern: /\b(?:la\s+)?semana próxima\b/iu, unit: "week" },
    { offset: -1, pattern: /\b(?:el\s+)?mes pasado\b/iu, unit: "month" },
    { offset: 0, pattern: /\beste mes\b/iu, unit: "month" },
    { offset: 1, pattern: /\b(?:el\s+)?mes próximo\b/iu, unit: "month" },
    { offset: -1, pattern: /\b(?:el\s+)?trimestre pasado\b/iu, unit: "quarter" },
    { offset: 0, pattern: /\beste trimestre\b/iu, unit: "quarter" },
    { offset: 1, pattern: /\b(?:el\s+)?trimestre próximo\b/iu, unit: "quarter" },
    { offset: -1, pattern: /\b(?:el\s+)?año pasado\b/iu, unit: "year" },
    { offset: 0, pattern: /\beste año\b/iu, unit: "year" },
    { offset: 1, pattern: /\b(?:el\s+)?año próximo\b/iu, unit: "year" },
  ],
  wordDate: {
    monthNames: SPANISH_MONTHS,
    pattern:
      /\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})\b/iu,
  },
  candidatePatterns: {
    assignmentConfirmation:
      /\b(?:es|parece)\s+(?:correct[oa]|ciert[oa]|exact[oa])\s*$/iu,
    behavioralPreamble: /^(?:por\s+favor)$/iu,
    behavioralDirective:
      /^(?!lee\s+(?:es|está|era|fue)\b)(?:por\s+favor\s*,?\s*)?(?:no\s+(?:uses|utilices|leas|escribas|crees|publiques|verifiques|inspecciones|revises|digas|muestres|des|respondas|evites|priorices|abras|cierres|borres|muevas|copies|ejecutes|llames|corrijas|expliques|añadas|agregues|implementes)|usa|use|utiliza|utilice|lee|lea|escribe|escriba|escribas|crea|cree|publica|publique|publiques|verifica|verifique|inspecciona|inspeccione|revisa|revise|resume|resuma|dime|diga|muestra|muestre|da|dé|responde|responda|evita|evite|prioriza|priorice|abre|abra|cierra|cierre|borra|borre|mueve|mueva|copia|copie|ejecuta|ejecute|llama|llame|corrige|corrija|explica|explique|añade|añada|agrega|agregue|implementa|implemente|proporciona|proporcione|mantén|mantenga)(?=$|[^\p{L}\p{N}])/iu,
    completedEvent:
      /^(?:yo\s+)?(?:he\s+\p{L}+(?:ado|ido)|\p{L}+(?:é|í)|fui|hice|tuve|estuve|puse|vine|dije|traje|vi|di)(?=$|\s|[.,;!?])/iu,
    correctionPreamble:
      /^(?:corrección|rectificación)(?=\s|[：:,.-]|$)\s*(?:[：:,.-]\s*)?/iu,
    currentProject: /\bmi\s+proyecto\s+actual\s+es\s+([^.!?]+)/iu,
    explicitFact:
      /^\s*(?:por\s+favor\s*,?\s*)?(?:recuerda|recuérdalo|memoriza)(?:\s+(?:una?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+cosas?\s*[:：,]\s*(.+)|\s+que\s+(.+)|\s*[:：,]\s*(.+)|\s+(?!(?:que|(?:una?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+cosas?)\s*[:：,]?\s*$)(.+))$/isu,
    explicitFactPrefix:
      /^\s*(?:por\s+favor\s*,?\s*)?(?:recuerda|recuérdalo|memoriza)\b/iu,
    durableBehavioralScope:
      /^(?:a\s+partir\s+de\s+ahora\b|desde\s+ahora\b|siempre\b|nunca\b)|\b(?:siempre|nunca|cada\s+vez)\b/iu,
    futurePlan:
      /^(?:(?:mañana\s+)?(?:yo\s+)?(?:voy\s+a|iré|pienso|planeo|tengo\s+previsto)(?=\s|[.!?]|$)|(?:yo\s+)?\p{L}+(?:ré|rás|rá|remos|réis|rán)(?=\s|[.!?]|$)[^.!?]*\b(?:mañana|pasado\s+mañana|la\s+semana\s+próxima|el\s+mes\s+próximo|el\s+trimestre\s+próximo|el\s+año\s+próximo)\b)/iu,
    hasReportedDirectiveScope({ prefix }) {
      return /(?:^|[.!?]\s*)(?:(?:(?:yo|nosotros|nosotras|él|ella|ellos|ellas)\s+)?(?:no\s+)?(?:(?:he|hemos|ha|han)\s+)?(?:dije|dijo|dijimos|dijeron|dicho|pedí|pidió|pedimos|pidieron|escribí|escribió|afirmé|afirmó|cité|citó)\s*(?:que)?|(?:la\s+frase|la\s+guía|la\s+documentación))\s*[:：,]?\s*$/iu.test(
        prefix,
      );
    },
    occurrenceConfirmation: /,\s*(?:verdad|cierto|no)\s*[.!]*$/iu,
    optOut:
      /^(?:por\s+favor\s*,?\s*)?(?:no\s+(?:recuerdes?|memorices?|guardes?|almacenes?|registres?)|nunca\s+(?:recuerdes?|memorices?|guardes?|almacenes?|registres?))\b/iu,
    optOutClauseBoundary:
      /(?:,\s*|^(?:y|pero)\s+|\s+(?:y|pero)\s+)(?=(?:por\s+favor\s*,?\s*)?(?:no\s+(?:recuerdes?|memorices?|guardes?|almacenes?|registres?)|nunca\s+(?:recuerdes?|memorices?|guardes?|almacenes?|registres?))\b)/iu,
    optOutConnectorBoundary:
      /(?:^(?:y|pero)\s+|\s+(?:y|pero)\s+)(?=(?:por\s+favor\s*,?\s*)?(?:no\s+(?:recuerdes?|memorices?|guardes?|almacenes?|registres?)|nunca\s+(?:recuerdes?|memorices?|guardes?|almacenes?|registres?))\b)/iu,
    optOutGrammar:
      /(?:por\s+favor\s*,?\s*)?(?:no\s+(?:recuerdes?|memorices?|guardes?|almacenes?|registres?)|nunca\s+(?:recuerdes?|memorices?|guardes?|almacenes?|registres?))\b/iu,
    goal: /\b(?:mi objetivo actual|mi prioridad actual|mi objetivo principal)\s+es\s+([^.!?]+)/iu,
    inferredFact:
      /\b(?:proyecto|migración|despliegue|publicación|bloqueo|bloqueado|validación|próximo paso|pendiente)\b/iu,
    standaloneFact: /^\s*no\s+hay\s+bloqueos?[.!]?\s*$/iu,
    name: /\b(?:me llamo|mi nombre es)\s+([\p{L}\p{M}'’.-]+(?:\s+[\p{L}\p{M}'’.-]+){0,3})/iu,
    preference: /\b(?:prefiero|mi preferencia es)\s+([^.!?]+)/iu,
    role: /\b(?:mi rol actual es|mi función actual es|mi puesto actual es)\s+([^.!?]+)/iu,
    timezone: /\bmi\s+zona\s+horaria\s+es\s+([A-Za-z0-9_./+-]+)/iu,
    unpunctuatedQuestion:
      /(?:\b(?:es|son|era|eran)\s+(?:qué|cuál(?:es)?|quién(?:es)?|dónde|adónde|cuándo|por\s+qué|cómo|cuán|cuánto)$|^(?:qué|cuál(?:es)?|quién(?:es)?|dónde|adónde|cuándo|por\s+qué|cómo|cuán|cuánto)(?=$|[^\p{L}\p{N}]).*\b(?:es|son|debo|debe|debemos|hay)\b)/iu,
  },
  renderCatalog: SPANISH_RENDER_CATALOG,
} as const satisfies RomancePackDefinition;

export function createSpanishLanguagePack(): LanguagePack {
  return createRomanceLanguagePack(DEFINITION);
}
