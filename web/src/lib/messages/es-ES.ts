import { enUSMessages } from "./en-US";

export const esESMessages = {
  ...enUSMessages,
  home: {
    ...enUSMessages.home,
    title: "inicio de daily3dmaze",
    description:
      "Inicia el reto diario del laberinto, explora el archivo o abre herramientas internas según el rol de tu cuenta.",
    actions: {
      launchChallenge: "Iniciar reto",
      openArchive: "Abrir archivo",
      reviewQueue: "Cola de revisión",
      userManager: "Usuarios"
    }
  },
  history: {
    ...enUSMessages.history,
    eyebrow: "Historial",
    title: "Archivo de retos diarios",
    intro:
      "Explora laberintos diarios recientes, revisa cuántas partidas recibió cada día e inspecciona el mejor resultado actual de cada reto.",
    loading: "Cargando historial de retos...",
    error: "No se pudo cargar el historial de retos.",
    sectionTitle: "Retos diarios recientes",
    listLabel: "Historial de retos diarios",
    empty: "Todavía no hay retos archivados.",
    labels: {
      ...enUSMessages.history.labels,
      size: "Tamaño del laberinto",
      bestRun: "Mejor partida"
    },
    actions: {
      openPlay: "Jugar el reto de hoy",
      backHome: "Volver al escritorio"
    },
    defaultChallengeTitle: "Laberinto diario",
    submissionCount: {
      one: "{count} partida",
      other: "{count} partidas"
    },
    bestRunSummary: "{player} en {elapsed} con {moves} movimientos",
    anonymous: "Anónimo",
    bestRunNoSubmissions: "Sin envíos todavía"
  },
  historyDay: {
    ...enUSMessages.historyDay,
    eyebrow: "Día archivado",
    fallbackTitle: "Detalle del reto diario",
    loading: "Cargando reto archivado...",
    error: "No se pudo cargar ese reto archivado.",
    detailsTitle: "Detalles del reto",
    leaderboardTitle: "Clasificación",
    leaderboardEmpty: "Todavía no hay envíos para este reto.",
    leaderboardLabel: "Clasificación diaria archivada",
    labels: {
      ...enUSMessages.historyDay.labels,
      date: "Fecha",
      title: "Título",
      size: "Tamaño del laberinto",
      start: "Inicio",
      exit: "Salida",
      rank: "Puesto",
      player: "Jugador"
      ,
      time: "Tiempo",
      moves: "Movimientos"
    },
    actions: {
      play: "Jugar este reto",
      backToHistory: "Volver al historial",
      openPlay: "Jugar el reto de hoy"
    },
    defaultChallengeTitle: "Laberinto diario",
    anonymous: "Anónimo"
  },
  adminReviews: {
    ...enUSMessages.adminReviews,
    eyebrow: "Herramientas internas",
    title: "Revisión de partidas sospechosas",
    intro:
      "Revisa envíos recientes con su puntuación heurística de repetición y las reglas exactas que se activaron. Esta página es intencionalmente de solo lectura para inspeccionar la calidad de la señal antes de ampliar la moderación.",
    loading: "Cargando revisiones de partidas...",
    authRequiredTitle: "Inicio de sesión requerido",
    authRequiredBody:
      "Las páginas internas de revisión requieren una sesión autenticada. Inicia sesión desde la página del reto y vuelve aquí.",
    forbiddenTitle: "Acceso de moderador requerido",
    forbiddenBodyPrefix: "Tu rol actual es",
    forbiddenBodySuffix:
      "Solo las cuentas de moderador y administrador pueden acceder a las revisiones internas de partidas.",
    sections: {
      recentSubmissions: "Envíos recientes",
      filters: "Filtros y orden"
    },
    actions: {
      returnToChallenge: "Volver al reto",
      challengeArchive: "Archivo de retos",
      manageUsers: "Gestionar usuarios",
      recomputeVerification: "Recalcular verificación",
      recomputing: "Recalculando...",
      goToSignIn: "Ir al inicio de sesión",
      inspectRun: "Inspeccionar partida"
    },
    summary: {
      queueHealthLabel: "Estado de la cola de verificación",
      pending: "Pendientes",
      verified: "Verificadas",
      suspicious: "Sospechosas",
      invalid: "Inválidas",
      stalePending: "Pendientes atascadas"
    },
    filters: {
      verificationState: "Estado de verificación",
      search: "Buscar",
      searchPlaceholder: "Usuario, fecha o semilla",
      moderatorStatus: "Estado de moderación",
      sortBy: "Ordenar por",
      staleOnly: "Mostrar solo pendientes atascadas",
      legend: "Controles de filtros y orden de revisión",
      allStates: "Todos los estados",
      allReviewStates: "Todos los estados de revisión",
      pending: "Pendiente",
      verified: "Verificada",
      suspicious: "Sospechosa",
      invalid: "Inválida",
      unreviewed: "Sin revisar",
      reviewedClean: "Marcada como limpia",
      confirmedSuspicious: "Confirmada como sospechosa",
      highestRisk: "Mayor riesgo",
      newestFirst: "Más recientes primero",
      oldestPendingFirst: "Pendientes más antiguas primero"
    },
    table: {
      verification: "Verificación",
      score: "Puntuación",
      player: "Jugador",
      challenge: "Reto",
      time: "Tiempo",
      moves: "Movimientos",
      review: "Moderación",
      reasons: "Motivos",
      accepted: "Aceptada"
    },
    resultsShown: "Se muestran {count} revisiones de partidas.",
    noMatches: "Ninguna revisión de partida coincide con los filtros actuales.",
    signedInAs: "Sesión iniciada como",
    sortHint: "Las puntuaciones más altas de riesgo de verificación y sospecha se muestran primero.",
    stalePending: "pendiente atascada",
    anonymous: "Anónimo",
    none: "Ninguno",
    notRecorded: "Sin registro",
    reviewer: "Revisor",
    reviewed: "Revisada",
    started: "Iniciada",
    finished: "Finalizada",
    attemptsLabel: "Intentos",
    recomputeMessage: "Se recalcularon {updated} partidas y se omitieron {skipped}.",
    recomputeError: "No se pudieron recalcular las revisiones de partidas.",
    statuses: {
      verification: {
        pending: "Pendiente",
        verified: "Verificada",
        suspicious: "Sospechosa",
        invalid: "Inválida"
      },
      review: {
        unreviewed: "Sin revisar",
        reviewedClean: "Marcada como limpia",
        confirmedSuspicious: "Confirmada como sospechosa"
      },
      reasons: {
        replayLengthMismatch: "La longitud de la repetición no coincide",
        timestampDrift: "Desfase de marcas de tiempo",
        highActionDensity: "Densidad de acciones demasiado alta",
        rapidRepeatedTurns: "Giros repetidos demasiado rápidos",
        blockedMoveAttempts: "Intentos de movimiento bloqueados",
        replayDoesNotReachExit: "La repetición no llega a la salida",
        actionsAfterExit: "Acciones después de la salida"
      },
      notes: {
        simulationNeverReachedExit: "La simulación nunca alcanzó la salida",
        simulationDetectedBlockedMoves: "La simulación detectó movimientos bloqueados",
        simulationDetectedActionsAfterExit:
          "La simulación detectó acciones después de la salida",
        simulationMatchesExpectedOutcome: "La simulación coincide con el resultado esperado"
      }
    }
  },
  profile: {
    ...enUSMessages.profile,
    eyebrow: "Perfil",
    fallbackTitle: "Perfil del jugador",
    loading: "Cargando perfil...",
    error: "No se pudo cargar ese perfil.",
    titleSuffix: " · partidas",
    overviewTitle: "Resumen",
    recentRunsTitle: "Partidas recientes",
    noRuns: "Todavía no hay partidas atribuidas.",
    actions: {
      backToPlay: "Volver al reto"
    },
    labels: {
      ...enUSMessages.profile.labels,
      joined: "Registro",
      totalRuns: "Partidas totales",
      daysPlayed: "Días jugados",
      bestTime: "Mejor tiempo",
      averageTime: "Tiempo promedio",
      lastPlayed: "Última partida",
      currentStreak: "Racha actual",
      bestStreak: "Mejor racha",
      recentRunsLabel: "Partidas recientes del jugador"
    },
    emptyStats: "Todavía no hay partidas completadas"
  },
  adminUsers: {
    ...enUSMessages.adminUsers,
    title: "Gestión de usuarios",
    intro: "Los administradores pueden conceder o revocar acceso de moderador y bloquear o desbloquear cuentas.",
    loading: "Cargando usuarios...",
    error: "No se pudieron cargar los usuarios.",
    authRequiredTitle: "Inicio de sesión requerido",
    authRequiredBody: "La gestión de usuarios requiere una sesión autenticada.",
    forbiddenTitle: "Acceso de administrador requerido",
    forbiddenBodyPrefix: "Tu rol actual es",
    forbiddenBodySuffix: "Solo los administradores pueden gestionar roles y bloqueos.",
    usersTitle: "Cuentas",
    searchLabel: "Buscar usuarios",
    searchPlaceholder: "Buscar por usuario, rol o estado",
    listLabel: "Usuarios gestionados",
    resultsShown: "{count} usuarios mostrados",
    signedInAs: "Sesión iniciada como",
    actions: {
      reviewQueue: "Cola de revisión",
      backToPlay: "Volver al reto",
      saveRole: "Guardar rol",
      ban: "Bloquear",
      unban: "Desbloquear"
    },
    labels: {
      ...enUSMessages.adminUsers.labels,
      user: "Usuario",
      role: "Rol",
      status: "Estado",
      created: "Creado",
      actions: "Acciones",
      active: "activo",
      banned: "bloqueado",
      admin: "Administrador",
      moderator: "Moderador",
      standardUser: "Usuario"
    },
    selectorLabels: {
      roleForUser: "Rol para {username}"
    },
    rowMessages: {
      roleUpdated: "Rol actualizado a {role}.",
      roleError: "No se pudo actualizar el rol.",
      userBanned: "Usuario bloqueado y sesiones activas cerradas.",
      userUnbanned: "Usuario desbloqueado.",
      banError: "No se pudo actualizar el bloqueo."
    },
    timestamps: {
      since: "Desde",
      notRecorded: "Sin registro"
    }
  },
  play: {
    ...enUSMessages.play,
    title: "Laberinto 3D diario",
    loadingMaze: "Cargando laberinto diario...",
    loadingLeaderboard: "Cargando clasificación...",
    leaderboardError: "No se pudo cargar la clasificación ahora mismo.",
    mazeError:
      "No se pudieron cargar los datos del laberinto diario. Asegúrate de que la API esté ejecutándose.",
    archiveViewing: "Viendo reto archivado",
    archiveStatusToday: "Hoy",
    archiveStatusPrefix: "Archivo",
    archivePanelTitle: "Navegación del archivo",
    archiveTitle: "Navegador del archivo",
    archiveBody: "Muévete por retos diarios archivados sin salir del visor del laberinto.",
    archiveActions: {
      previousDay: "Día anterior",
      nextDay: "Día siguiente",
      jumpToToday: "Ir a hoy"
    },
    labels: {
      ...enUSMessages.play.labels,
      moves: "Movimientos",
      time: "Tiempo",
      controls: "Controles",
      size: "Tamaño",
      facing: "Dirección"
    },
    directions: {
      north: "Norte",
      east: "Este",
      south: "Sur",
      west: "Oeste"
    },
    actions: {
      ...enUSMessages.play.actions,
      resetRun: "Reiniciar partida",
      backHome: "Volver al escritorio",
      challengeArchive: "Archivo de retos",
      fullscreen: "Pantalla completa",
      exitFullscreen: "Salir de pantalla completa",
      logIn: "Entrar",
      createAccount: "Crear cuenta",
      logOut: "Cerrar sesión"
    },
    auth: {
      ...enUSMessages.play.auth,
      heading: "Identidad",
      modeLegend: "Modo de autenticación",
      username: "Usuario",
      password: "Contraseña",
      signedInAs: "Sesión iniciada como",
      role: "Rol",
      roles: {
        user: "Usuario",
        moderator: "Moderador",
        admin: "Administrador"
      },
      signingIn: "Entrando...",
      creatingAccount: "Creando cuenta...",
      loginSuccess: "Sesión iniciada correctamente.",
      registerSuccess: "Cuenta creada e iniciada.",
      continueWithGitHub: "Continuar con GitHub",
      continueWithGoogle: "Continuar con Google"
    },
    authHelper:
      "Los nombres de usuario admiten letras, números, guiones bajos y guiones. Las contraseñas deben tener al menos 10 caracteres.",
    authErrors: {
      authenticationFailed: "La autenticación falló",
      logoutFailed: "No se pudo cerrar la sesión"
    },
    authLinks: {
      internalReviews: "Revisiones internas",
      manageUsers: "Gestionar usuarios",
      playerPanel: "Panel del jugador",
      signInPanel: "Iniciar sesión"
    },
    leaderboard: {
      ...enUSMessages.play.leaderboard,
      heading: "Clasificación",
      empty: "Todavía no hay partidas enviadas para este día.",
      ariaLabel: "Clasificación diaria",
      scopeLegend: "Ámbito de la clasificación",
      allRuns: "Todas las partidas",
      firstRuns: "Primera partida",
      rank: "Puesto",
      player: "Jugador",
      elapsed: "Tiempo",
      moves: "Movimientos",
      title: "Clasificación",
      anonymous: "Anónimo",
      moveSuffix: "movs."
    },
    gameplay: {
      ...enUSMessages.play.gameplay,
      controls: "W/S o Arriba/Abajo mueven · A/D o Izquierda/Derecha giran · Desliza en la vista en dispositivos táctiles",
      introStatus: "Encuentra la salida y termina la partida.",
      winTitle: "Reto completado",
      submittingRun: "Guardando tu resultado...",
      submissionError: "No se pudo guardar tu resultado en línea.",
      debugViewLabel: "Vista de depuración del laberinto diario",
      currentRunStatus: "Estado actual de la partida",
      statusBar: "Barra de estado de la aplicación",
      completionMessage: "Laberinto completado en {elapsed}.",
      submissionAccepted:
        "Resultado guardado a las {acceptedAt}. Estado de verificación: {status}."
    },
    verification: {
      pending: "pendiente",
      verified: "verificada",
      suspicious: "sospechosa",
      invalid: "inválida"
    }
  },
  adminReviewDetail: {
    ...enUSMessages.adminReviewDetail,
    eyebrow: "Herramientas internas",
    title: "Detalle de revisión de partida",
    intro:
      "Inspecciona un envío concreto, incluida su traza de repetición, sin modificar ningún estado de revisión.",
    loading: "Cargando detalle de revisión de partida...",
    error: "No se pudo cargar esta revisión de partida.",
    authRequiredTitle: "Inicio de sesión requerido",
    authRequiredBody: "Las páginas de detalle de revisión interna requieren una sesión autenticada.",
    forbiddenTitle: "Acceso de moderador requerido",
    forbiddenBodyPrefix: "Tu rol actual es",
    forbiddenBodySuffix:
      "Solo las cuentas de moderador y administrador pueden inspeccionar revisiones individuales de partidas.",
    roleLabels: {
      user: "Usuario",
      moderator: "Moderador",
      admin: "Administrador"
    },
    sections: {
      ...enUSMessages.adminReviewDetail.sections,
      submissionOverview: "Resumen del envío",
      moderatorReview: "Revisión del moderador",
      simulation: "Simulación del servidor",
      replayComparison: "Comparación de reconstrucción",
      replayViewer: "Visualizador de repetición",
      replayTimeline: "Traza de repetición"
    },
    actions: {
      ...enUSMessages.adminReviewDetail.actions,
      backToReviews: "Volver a revisiones",
      returnToChallenge: "Volver al reto",
      requeueVerification: "Reencolar verificación",
      requeueing: "Reencolando...",
      saveReview: "Guardar revisión",
      saving: "Guardando...",
      first: "Primero",
      previous: "Anterior",
      next: "Siguiente",
      last: "Último"
    },
    metadata: {
      ...enUSMessages.adminReviewDetail.metadata,
      verification: "Verificación",
      player: "Jugador",
      challenge: "Reto",
      seed: "Semilla",
      time: "Tiempo",
      moves: "Movimientos",
      accepted: "Aceptada",
      verificationStarted: "Verificación iniciada",
      verifiedAt: "Verificada el",
      attempts: "Intentos",
      reasons: "Motivos",
      verificationNotes: "Notas de verificación",
      workerError: "Error del worker",
      reviewStatus: "Estado de revisión",
      reviewedAt: "Revisada el",
      reviewedBy: "Revisada por"
    },
    moderation: {
      ...enUSMessages.adminReviewDetail.moderation,
      intro: "Registra una decisión humana y cualquier nota o seguimiento para esta partida.",
      fieldsetLegend: "Controles de revisión del moderador",
      statusLabel: "Estado de revisión",
      notesLabel: "Notas de revisión",
      notesPlaceholder: "Añade cualquier nota humana de revisión o contexto de seguimiento.",
      unreviewed: "Sin revisar",
      reviewedClean: "Marcada como limpia",
      confirmedSuspicious: "Confirmada como sospechosa"
    },
    statuses: {
      verification: {
        pending: "Pendiente",
        verified: "Verificada",
        suspicious: "Sospechosa",
        invalid: "Inválida"
      },
      review: {
        unreviewed: "Sin revisar",
        reviewedClean: "Marcada como limpia",
        confirmedSuspicious: "Confirmada como sospechosa"
      },
      reasons: {
        replayLengthMismatch: "La longitud de la repetición no coincide",
        timestampDrift: "Desfase de marcas de tiempo",
        highActionDensity: "Densidad de acciones demasiado alta",
        rapidRepeatedTurns: "Giros repetidos demasiado rápidos",
        blockedMoveAttempts: "Intentos de movimiento bloqueados",
        replayDoesNotReachExit: "La repetición no llega a la salida",
        actionsAfterExit: "Acciones después de la salida"
      },
      notes: {
        simulationNeverReachedExit: "La simulación nunca alcanzó la salida",
        simulationDetectedBlockedMoves: "La simulación detectó movimientos bloqueados",
        simulationDetectedActionsAfterExit:
          "La simulación detectó acciones después de la salida",
        simulationMatchesExpectedOutcome: "La simulación coincide con el resultado esperado"
      }
    },
    comparison: {
      ...enUSMessages.adminReviewDetail.comparison,
      intro: "Compara la reconstrucción del frontend con el resultado de la simulación del backend.",
      ariaLabel: "Comparación de la repetición",
      check: "Comprobación",
      frontendReconstruction: "Reconstrucción del frontend",
      backendSimulation: "Simulación del backend",
      status: "Estado",
      finalPosition: "Posición final",
      finalFacing: "Dirección final",
      exitReached: "Salida alcanzada",
      yes: "Sí",
      no: "No",
      match: "Coincide",
      mismatch: "No coincide",
      unavailable: "Simulación no disponible"
    },
    simulation: {
      ...enUSMessages.adminReviewDetail.simulation,
      intro: "Repetición determinista del backend de la traza enviada contra el laberinto canónico de este día.",
      reachedExit: "Salida alcanzada",
      didNotFinish: "Sin terminar",
      unavailable: "Simulación no disponible",
      unavailableBody:
        "Esta partida todavía no tiene una simulación del servidor. Puede ocurrir con revisiones antiguas almacenadas o mientras los servicios locales están desincronizados.",
      blockedMoves: "Movimientos bloqueados",
      actionsAfterExit: "Acciones después de la salida",
      firstExitStep: "Primer paso en la salida",
      finalPosition: "Posición final",
      finalFacing: "Dirección final",
      unknown: "Desconocida",
      never: "Nunca"
    },
    replay: {
      ...enUSMessages.adminReviewDetail.replay,
      anonymous: "Anónimo",
      none: "Ninguno",
      notRecorded: "Sin registro",
      notAvailable: "No disponible",
      viewingRunAs: "Revisando la partida",
      asUser: "como",
      visualizerIntro: "Recorre la traza almacenada sobre el diseño original del laberinto.",
      frameProgress: "Fotograma {current} de {total}",
      stepLabel: "Paso",
      elapsedLabel: "Tiempo transcurrido",
      selectedStep: "Paso seleccionado",
      action: "Acción",
      position: "Posición",
      facing: "Dirección",
      exitReached: "Salida alcanzada",
      snapshotAriaLabel: "Instantánea de la repetición en la cuadrícula del laberinto",
      traceEmpty: "No hay una traza de repetición guardada para esta partida.",
      traceAriaLabel: "Eventos de la traza de repetición",
      requeueMessage:
        "La partida {id} se reencoló como {status}. Los intentos permanecen en {attempts}.",
      requeueError: "No se pudo reencolar esta partida.",
      reviewSaved: "Revisión guardada como {status}{reviewedAt}.",
      reviewSavedAt: " el {value}",
      reviewSaveError: "No se pudo guardar esta revisión.",
      actions: {
        moveForward: "Avanzar",
        moveBackward: "Retroceder",
        turnLeft: "Girar a la izquierda",
        turnRight: "Girar a la derecha"
      }
    }
  },
  locale: {
    label: "Idioma",
    english: "English",
    spanish: "Español"
  }
} as const;
