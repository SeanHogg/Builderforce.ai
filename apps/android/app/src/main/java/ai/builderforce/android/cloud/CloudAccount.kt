package ai.builderforce.android.cloud

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A browser sign-in in progress, as the sign-in card shows it. */
sealed interface SignInState {
  data object Idle : SignInState

  data object Starting : SignInState

  /** Enter [userCode] at [verificationUrl] (opened in the browser). */
  data class Waiting(val userCode: String, val verificationUrl: String) : SignInState

  data class Failed(val reason: Reason) : SignInState {
    enum class Reason { Denied, Expired, Unreachable }
  }
}

/**
 * The app's Builderforce account as its screens show it — Synapse's `bf_cloud::Account`:
 * signed in or not, a browser sign-in in progress, the workspaces and the one in use, and
 * the server (a developer override). The session itself is [session].
 */
class CloudAccount(
  private val scope: CoroutineScope,
  val session: CloudSession,
  private val config: CloudConfig,
) {
  private val deviceSignIn = DeviceSignIn(config)
  private var signInJob: Job? = null

  val signedIn: StateFlow<Boolean> = session.signedIn
  val expired: StateFlow<Boolean> = session.expired
  val workspaceId: StateFlow<Long?> = session.workspaceId
  val baseUrlOverride: StateFlow<String> = config.baseUrlOverride

  private val _signIn = MutableStateFlow<SignInState>(SignInState.Idle)
  val signIn: StateFlow<SignInState> = _signIn.asStateFlow()

  private val _workspaces = MutableStateFlow<List<Workspace>>(emptyList())
  val workspaces: StateFlow<List<Workspace>> = _workspaces.asStateFlow()

  private val _problem = MutableStateFlow<CloudProblem?>(null)
  val problem: StateFlow<CloudProblem?> = _problem.asStateFlow()

  /** Start a browser sign-in: ask for a code pair, then poll until the person decides. */
  fun beginSignIn() {
    signInJob?.cancel()
    _signIn.value = SignInState.Starting
    signInJob =
      scope.launch {
        val start =
          try {
            deviceSignIn.start()
          } catch (_: CloudException) {
            _signIn.value = SignInState.Failed(SignInState.Failed.Reason.Unreachable)
            return@launch
          }
        _signIn.value = SignInState.Waiting(userCode = start.userCode, verificationUrl = start.verificationUriComplete)
        _signIn.value =
          when (val outcome = deviceSignIn.awaitApproval(start)) {
            is SignInOutcome.Approved -> {
              session.adoptKey(outcome.key)
              refreshWorkspaces()
              SignInState.Idle
            }
            SignInOutcome.Denied -> SignInState.Failed(SignInState.Failed.Reason.Denied)
            SignInOutcome.Expired -> SignInState.Failed(SignInState.Failed.Reason.Expired)
          }
      }
  }

  fun cancelSignIn() {
    signInJob?.cancel()
    signInJob = null
    _signIn.value = SignInState.Idle
  }

  /** Sign out here and revoke the key on the platform. */
  fun signOut() {
    scope.launch {
      session.signOut()
      _workspaces.value = emptyList()
      _problem.value = null
    }
  }

  fun refreshWorkspaces() {
    scope.launch {
      try {
        _workspaces.value = session.workspaces()
        _problem.value = null
      } catch (e: CloudException) {
        _problem.value = CloudProblem.of(e)
      }
    }
  }

  /** Work in workspace [id] from now on; chats and agents follow it. */
  fun selectWorkspace(id: Long) {
    scope.launch {
      try {
        session.selectWorkspace(id)
        _problem.value = null
      } catch (e: CloudException) {
        _problem.value = CloudProblem.of(e)
      }
    }
  }

  /** Point the app at another server (blank = production). */
  fun setBaseUrl(value: String) {
    config.setBaseUrlOverride(value)
    session.invalidateToken()
    if (signedIn.value) refreshWorkspaces()
  }
}
