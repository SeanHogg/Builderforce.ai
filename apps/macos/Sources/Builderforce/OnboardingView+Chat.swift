import Foundation

extension OnboardingView {
    /// The onboarding chat is the Builderforce cloud Brain: opening its page loads the
    /// signed-in state (or the sign-in view). Nothing is sent on the person's behalf.
    func maybeKickoffOnboardingChat(for pageIndex: Int) {
        guard pageIndex == self.onboardingChatPageIndex else { return }
        guard self.showOnboardingChat else { return }
        guard !self.didAutoKickoff else { return }
        self.didAutoKickoff = true
        self.onboardingChatModel.load()
    }
}
