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
      size: "Tamaño del laberinto",
      player: "Jugador"
    },
    actions: {
      play: "Jugar este reto",
      backToHistory: "Volver al historial",
      openPlay: "Jugar el reto de hoy"
    },
    anonymous: "Anónimo"
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
      standardUser: "Usuario"
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
      size: "Tamaño",
      facing: "Dirección"
    },
    actions: {
      ...enUSMessages.play.actions,
      resetRun: "Reiniciar partida",
      backHome: "Volver al escritorio",
      challengeArchive: "Archivo de retos",
      logIn: "Entrar",
      createAccount: "Crear cuenta",
      logOut: "Cerrar sesión"
    },
    auth: {
      ...enUSMessages.play.auth,
      heading: "Identidad",
      username: "Usuario",
      password: "Contraseña",
      signedInAs: "Sesión iniciada como",
      role: "Rol",
      signingIn: "Entrando...",
      creatingAccount: "Creando cuenta...",
      loginSuccess: "Sesión iniciada correctamente.",
      registerSuccess: "Cuenta creada e iniciada.",
      continueWithGitHub: "Continuar con GitHub"
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
      player: "Jugador",
      elapsed: "Tiempo",
      title: "Clasificación",
      anonymous: "Anónimo",
      moveSuffix: "movs."
    },
    gameplay: {
      ...enUSMessages.play.gameplay,
      controls: "W/S o Arriba/Abajo mueven · A/D o Izquierda/Derecha giran · Desliza en la vista en dispositivos táctiles",
      introStatus: "Encuentra la salida y termina la partida.",
      submittingRun: "Enviando partida a la API...",
      submissionError: "La partida terminó localmente, pero falló el envío a la API.",
      debugViewLabel: "Vista de depuración del laberinto diario",
      completionMessage: "Laberinto completado en {elapsed}.",
      submissionAccepted:
        "La API aceptó la partida a las {acceptedAt} y la dejó en cola para verificación como {status}."
    }
  },
  locale: {
    label: "Idioma",
    english: "English",
    spanish: "Español"
  }
} as const;
