type DeepWidenLiterals<T> =
  T extends string
    ? string
    : T extends number
      ? number
      : T extends boolean
        ? boolean
        : T extends readonly (infer U)[]
          ? ReadonlyArray<DeepWidenLiterals<U>>
          : T extends object
            ? { [K in keyof T]: DeepWidenLiterals<T[K]> }
            : T;

export const enUSMessages = {
  home: {
    eyebrow: "daily3dmaze.exe",
    title: "daily3dmaze home",
    description:
      "Launch the daily maze challenge, browse the archive, or open internal tools depending on your account role.",
    actions: {
      launchChallenge: "Launch challenge",
      openArchive: "Open archive",
      reviewQueue: "Review queue",
      userManager: "User manager"
    }
  },
  history: {
    eyebrow: "History",
    title: "Daily challenge archive",
    intro:
      "Browse recent daily mazes, see how many runs each day received, and inspect the current best result for each challenge.",
    loading: "Loading challenge history...",
    error: "Unable to load the challenge history right now.",
    sectionTitle: "Recent daily challenges",
    listLabel: "Daily challenge history",
    empty: "No archived challenges are available yet.",
    labels: {
      seed: "Seed",
      size: "Maze size",
      bestRun: "Best run"
    },
    actions: {
      openPlay: "Play today's challenge",
      backHome: "Return to desktop"
    },
    defaultChallengeTitle: "Daily Maze",
    submissionCount: {
      one: "{count} run",
      other: "{count} runs"
    },
    bestRunSummary: "{player} in {elapsed} with {moves} moves",
    anonymous: "Anonymous",
    bestRunNoSubmissions: "No submissions yet"
  },
  historyDay: {
    eyebrow: "Archive Day",
    fallbackTitle: "Daily challenge detail",
    loading: "Loading archived challenge...",
    error: "Unable to load that archived challenge right now.",
    detailsTitle: "Challenge details",
    leaderboardTitle: "Leaderboard",
    leaderboardEmpty: "No submissions for this challenge yet.",
    leaderboardLabel: "Archived daily leaderboard",
    labels: {
      date: "Date",
      title: "Title",
      seed: "Seed",
      size: "Maze size",
      start: "Start",
      exit: "Exit",
      rank: "Rank",
      player: "Player",
      time: "Time",
      moves: "Moves"
    },
    actions: {
      play: "Play this challenge",
      backToHistory: "Back to history",
      openPlay: "Play today's challenge"
    },
    defaultChallengeTitle: "Daily Maze",
    anonymous: "Anonymous"
  },
  profile: {
    eyebrow: "Profile",
    fallbackTitle: "Player profile",
    loading: "Loading profile...",
    error: "Unable to load that profile right now.",
    titleSuffix: "'s runs",
    overviewTitle: "Overview",
    recentRunsTitle: "Recent runs",
    noRuns: "No attributed runs yet.",
    actions: {
      backToPlay: "Return to challenge"
    },
    labels: {
      username: "Username",
      joined: "Joined",
      totalRuns: "Total runs",
      daysPlayed: "Days played",
      bestTime: "Best time",
      averageTime: "Average time",
      lastPlayed: "Last played",
      currentStreak: "Current streak",
      bestStreak: "Best streak",
      recentRunsLabel: "Recent player runs",
      recentRunDate: "Date",
      recentRunSeed: "Seed",
      recentRunTime: "Time",
      recentRunMoves: "Moves"
    },
    emptyStats: "No completed runs yet"
  },
  adminReviews: {
    eyebrow: "Internal tooling",
    title: "Suspicious run reviews",
    intro:
      "Review recent submissions with their replay heuristic score and the exact rules that fired. This page is read-only on purpose so we can inspect the signal quality before adding moderation actions.",
    loading: "Loading recent run reviews...",
    authRequiredTitle: "Sign in required",
    authRequiredBody:
      "Internal review pages require an authenticated session. Sign in from the play page, then come back here.",
    forbiddenTitle: "Moderator access required",
    forbiddenBodyPrefix: "Your current role is",
    forbiddenBodySuffix:
      "Only moderator and admin accounts can access internal run reviews.",
    sections: {
      recentSubmissions: "Recent submissions",
      filters: "Filters and sorting"
    },
    actions: {
      returnToChallenge: "Return to challenge",
      challengeArchive: "Challenge archive",
      manageUsers: "Manage users",
      recomputeVerification: "Recompute verification",
      recomputing: "Recomputing...",
      goToSignIn: "Go to sign-in",
      inspectRun: "Inspect run"
    },
    summary: {
      queueHealthLabel: "Verification queue health",
      pending: "Pending",
      verified: "Verified",
      suspicious: "Suspicious",
      invalid: "Invalid",
      stalePending: "Stale pending"
    },
    filters: {
      verificationState: "Verification state",
      search: "Search",
      searchPlaceholder: "Username, date, or seed",
      moderatorStatus: "Moderator status",
      sortBy: "Sort by",
      staleOnly: "Show only stale pending runs",
      legend: "Review filters and sorting controls",
      allStates: "All states",
      allReviewStates: "All review states",
      pending: "Pending",
      verified: "Verified",
      suspicious: "Suspicious",
      invalid: "Invalid",
      unreviewed: "Unreviewed",
      reviewedClean: "Reviewed clean",
      confirmedSuspicious: "Confirmed suspicious",
      highestRisk: "Highest risk",
      newestFirst: "Newest first",
      oldestPendingFirst: "Oldest pending first"
    },
    table: {
      verification: "Verification",
      score: "Score",
      player: "Player",
      challenge: "Challenge",
      time: "Time",
      moves: "Moves",
      review: "Review",
      reasons: "Reasons",
      accepted: "Accepted"
    },
    resultsShown: "Showing {count} run review{suffix}.",
    noMatches: "No run reviews match the current filters.",
    signedInAs: "Signed in as",
    sortHint: "Highest verification risk and suspicion scores are shown first.",
    stalePending: "stale pending",
    anonymous: "Anonymous",
    none: "None",
    notRecorded: "Not recorded",
    reviewer: "Reviewer",
    reviewed: "Reviewed",
    started: "Started",
    finished: "Finished",
    attemptsLabel: "Attempts",
    recomputeMessage: "Recomputed {updated} runs and skipped {skipped}.",
    recomputeError: "Unable to recompute run reviews.",
    statuses: {
      verification: {
        pending: "Pending",
        verified: "Verified",
        suspicious: "Suspicious",
        invalid: "Invalid"
      },
      review: {
        unreviewed: "Unreviewed",
        reviewedClean: "Reviewed clean",
        confirmedSuspicious: "Confirmed suspicious"
      },
      reasons: {
        replayLengthMismatch: "Replay length mismatch",
        timestampDrift: "Timestamp drift",
        highActionDensity: "High action density",
        rapidRepeatedTurns: "Rapid repeated turns",
        blockedMoveAttempts: "Blocked move attempts",
        replayDoesNotReachExit: "Replay does not reach the exit",
        actionsAfterExit: "Actions after exit"
      },
      notes: {
        simulationNeverReachedExit: "Simulation never reached the exit",
        simulationDetectedBlockedMoves: "Simulation detected blocked moves",
        simulationDetectedActionsAfterExit: "Simulation detected actions after exit",
        simulationMatchesExpectedOutcome: "Simulation matches the expected outcome"
      }
    }
  },
  adminReviewDetail: {
    eyebrow: "Internal tooling",
    title: "Run review detail",
    intro:
      "Inspect a single submission, including its replay trace, without mutating any review state.",
    loading: "Loading run review detail...",
    error: "Unable to load this run review.",
    authRequiredTitle: "Sign in required",
    authRequiredBody: "Internal review detail pages require an authenticated session.",
    forbiddenTitle: "Moderator access required",
    forbiddenBodyPrefix: "Your current role is",
    forbiddenBodySuffix:
      "Only moderator and admin accounts can inspect individual run reviews.",
    roleLabels: {
      user: "User",
      moderator: "Moderator",
      admin: "Admin"
    },
    sections: {
      submissionOverview: "Submission overview",
      moderatorReview: "Moderator review",
      replayComparison: "Reconstruction comparison",
      replayTimeline: "Replay trace",
      replayViewer: "Replay viewer",
      simulation: "Server simulation"
    },
    actions: {
      backToReviews: "Back to reviews",
      returnToChallenge: "Return to challenge",
      requeueVerification: "Requeue verification",
      requeueing: "Requeueing...",
      saveReview: "Save review",
      saving: "Saving...",
      first: "First",
      previous: "Previous",
      next: "Next",
      last: "Last"
    },
    metadata: {
      verification: "Verification",
      player: "Player",
      challenge: "Challenge",
      seed: "Seed",
      time: "Time",
      moves: "Moves",
      accepted: "Accepted",
      verificationStarted: "Verification started",
      verifiedAt: "Verified at",
      attempts: "Attempts",
      reasons: "Reasons",
      verificationNotes: "Verification notes",
      workerError: "Worker error",
      reviewStatus: "Review status",
      reviewedAt: "Reviewed at",
      reviewedBy: "Reviewed by"
    },
    moderation: {
      intro: "Record a human decision and any follow-up notes for this run.",
      fieldsetLegend: "Moderator review controls",
      statusLabel: "Review status",
      notesLabel: "Review notes",
      notesPlaceholder: "Add any human review notes or follow-up context.",
      unreviewed: "Unreviewed",
      reviewedClean: "Reviewed clean",
      confirmedSuspicious: "Confirmed suspicious"
    },
    statuses: {
      verification: {
        pending: "Pending",
        verified: "Verified",
        suspicious: "Suspicious",
        invalid: "Invalid"
      },
      review: {
        unreviewed: "Unreviewed",
        reviewedClean: "Reviewed clean",
        confirmedSuspicious: "Confirmed suspicious"
      },
      reasons: {
        replayLengthMismatch: "Replay length mismatch",
        timestampDrift: "Timestamp drift",
        highActionDensity: "High action density",
        rapidRepeatedTurns: "Rapid repeated turns",
        blockedMoveAttempts: "Blocked move attempts",
        replayDoesNotReachExit: "Replay does not reach the exit",
        actionsAfterExit: "Actions after exit"
      },
      notes: {
        simulationNeverReachedExit: "Simulation never reached the exit",
        simulationDetectedBlockedMoves: "Simulation detected blocked moves",
        simulationDetectedActionsAfterExit: "Simulation detected actions after exit",
        simulationMatchesExpectedOutcome: "Simulation matches the expected outcome"
      }
    },
    comparison: {
      intro: "Cross-check the frontend replay reconstruction against the backend simulation result.",
      ariaLabel: "Replay comparison",
      check: "Check",
      frontendReconstruction: "Frontend reconstruction",
      backendSimulation: "Backend simulation",
      status: "Status",
      finalPosition: "Final position",
      finalFacing: "Final facing",
      exitReached: "Exit reached",
      yes: "Yes",
      no: "No",
      match: "Match",
      mismatch: "Mismatch",
      unavailable: "Simulation unavailable"
    },
    simulation: {
      intro: "Deterministic backend replay of the submitted trace against the canonical maze for this day.",
      reachedExit: "Reached exit",
      didNotFinish: "Did not finish",
      unavailable: "Simulation unavailable",
      unavailableBody:
        "This run does not have a server-side simulation payload yet. That can happen for older stored reviews or while local services are out of sync.",
      blockedMoves: "Blocked moves",
      actionsAfterExit: "Actions after exit",
      firstExitStep: "First exit step",
      finalPosition: "Final position",
      finalFacing: "Final facing",
      unknown: "Unknown",
      never: "Never"
    },
    replay: {
      anonymous: "Anonymous",
      none: "None",
      notRecorded: "Not recorded",
      notAvailable: "Not available",
      viewingRunAs: "Reviewing run",
      asUser: "as",
      visualizerIntro: "Step through the stored trace against the original maze layout.",
      frameProgress: "Frame {current} of {total}",
      stepLabel: "Step",
      elapsedLabel: "Elapsed",
      selectedStep: "Selected step",
      action: "Action",
      position: "Position",
      facing: "Facing",
      exitReached: "Exit reached",
      snapshotAriaLabel: "Replay snapshot in the maze grid",
      traceEmpty: "No replay trace is stored for this run.",
      traceAriaLabel: "Replay trace events",
      requeueMessage:
        "Run {id} requeued as {status}. Attempts remain at {attempts}.",
      requeueError: "Unable to requeue this run.",
      reviewSaved: "Review saved as {status}{reviewedAt}.",
      reviewSavedAt: " at {value}",
      reviewSaveError: "Unable to save this review.",
      actions: {
        moveForward: "Move forward",
        moveBackward: "Move backward",
        turnLeft: "Turn left",
        turnRight: "Turn right"
      }
    }
  },
  adminUsers: {
    eyebrow: "Internal tooling",
    title: "User management",
    intro: "Admins can grant or revoke moderator access and ban or unban accounts.",
    loading: "Loading users...",
    error: "Unable to load admin users.",
    authRequiredTitle: "Sign in required",
    authRequiredBody: "Admin user management requires an authenticated session.",
    forbiddenTitle: "Admin access required",
    forbiddenBodyPrefix: "Your current role is",
    forbiddenBodySuffix: "Only admins can manage user roles and bans.",
    usersTitle: "Accounts",
    searchLabel: "Search users",
    searchPlaceholder: "Search by username, role, or status",
    listLabel: "Managed users",
    signedInAs: "Signed in as",
    resultsShown: "{count} user{suffix} shown",
    actions: {
      reviewQueue: "Review queue",
      backToPlay: "Return to challenge",
      saveRole: "Save role",
      ban: "Ban",
      unban: "Unban"
    },
    labels: {
      user: "User",
      role: "Role",
      status: "Status",
      created: "Created",
      actions: "Actions",
      active: "active",
      banned: "banned",
      admin: "Admin",
      moderator: "Moderator",
      standardUser: "User"
    },
    selectorLabels: {
      roleForUser: "Role for {username}"
    },
    rowMessages: {
      roleUpdated: "Role updated to {role}.",
      roleError: "Unable to update user role.",
      userBanned: "User banned and active sessions cleared.",
      userUnbanned: "User unbanned.",
      banError: "Unable to update ban state."
    },
    timestamps: {
      since: "Since",
      notRecorded: "Not recorded"
    }
  },
  play: {
    eyebrow: "daily3dmaze.exe",
    title: "Daily 3D Maze",
    systemBar: "Ready",
    loadingMaze: "Loading daily maze...",
    loadingLeaderboard: "Loading leaderboard...",
    leaderboardError: "Unable to load the leaderboard right now.",
    mazeError:
      "Unable to load the daily maze metadata. Make sure the API is running on http://localhost:8080.",
    archiveViewing: "Viewing archived challenge",
    archiveStatusToday: "Today",
    archiveStatusPrefix: "Archive",
    archivePanelTitle: "Archive navigation",
    archiveTitle: "Archive navigator",
    archiveBody: "Move through archived daily challenges without leaving the maze viewer.",
    archiveActions: {
      previousDay: "Previous day",
      nextDay: "Next day",
      jumpToToday: "Jump to today"
    },
    labels: {
      date: "Date",
      title: "Title",
      seed: "Seed",
      size: "Size",
      start: "Start",
      exit: "Exit",
      moves: "Moves",
      time: "Time",
      facing: "Facing",
      controls: "Controls"
    },
    directions: {
      north: "North",
      east: "East",
      south: "South",
      west: "West"
    },
    actions: {
      resetRun: "Reset run",
      backHome: "Return to desktop",
      challengeArchive: "Challenge archive",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit fullscreen",
      logIn: "Log in",
      createAccount: "Create account",
      logOut: "Log out"
    },
    auth: {
      heading: "Identity",
      modeLegend: "Authentication mode",
      username: "Username",
      password: "Password",
      signedInAs: "Signed in as",
      role: "Role",
      roles: {
        user: "User",
        moderator: "Moderator",
        admin: "Admin"
      },
      signingIn: "Signing in...",
      creatingAccount: "Creating account...",
      loginSuccess: "Signed in successfully.",
      registerSuccess: "Account created and signed in.",
      continueWithGitHub: "Continue with GitHub"
    },
    authHelper:
      "Usernames support letters, numbers, underscores, and hyphens. Passwords must be at least 10 characters long.",
    authErrors: {
      authenticationFailed: "Authentication failed",
      logoutFailed: "Logout failed"
    },
    authLinks: {
      internalReviews: "Internal reviews",
      manageUsers: "Manage users",
      playerPanel: "Player panel",
      signInPanel: "Sign in"
    },
    leaderboard: {
      heading: "Leaderboard",
      empty: "No submitted runs for this day yet.",
      ariaLabel: "Daily leaderboard",
      rank: "Rank",
      player: "Player",
      elapsed: "Time",
      moves: "Moves",
      title: "Leaderboard",
      anonymous: "Anonymous",
      moveSuffix: "moves"
    },
    gameplay: {
      controls: "W/S or Up/Down move · A/D or Left/Right turn · Swipe in the view on touch devices",
      introStatus: "Find the exit and finish the run.",
      winTitle: "Challenge complete",
      submittingRun: "Saving your result...",
      submissionError: "Your result could not be saved online.",
      debugViewLabel: "Daily maze debug view",
      summaryHeading: "Challenge window",
      currentRunStatus: "Current run status",
      statusBar: "Application status bar",
      completionMessage: "Maze complete in {elapsed}.",
      submissionAccepted:
        "Result saved at {acceptedAt}. Verification status: {status}."
    },
    verification: {
      pending: "pending",
      verified: "verified",
      suspicious: "suspicious",
      invalid: "invalid"
    }
  },
  locale: {
    label: "Language",
    english: "English",
    spanish: "Español"
  }
} as const;

export type AppMessages = DeepWidenLiterals<typeof enUSMessages>;
