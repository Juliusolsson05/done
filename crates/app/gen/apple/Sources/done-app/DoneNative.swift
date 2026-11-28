// The app's native side for the Dynamic Island and the widgets, called from
// Rust (crates/app/src/lib.rs, `extern "C"`).
//
// WHY C functions and not a Tauri plugin: the Rust code is a static library
// linked into this same app binary, so a Swift function exported with
// @_cdecl is an ordinary symbol the Rust side can call; the linker joins them
// when the app is built. One plain boundary, JSON in a C string, and no plugin
// crate, swift-rs or bridging header to keep in step with Tauri.
//
// Both functions copy the string at once (Rust frees it when the call returns)
// and do their work on the main thread, where ActivityKit and WidgetKit expect
// to be called from.
import AuthenticationServices
import Foundation
import UIKit
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// The focus session changed: `json` is `{"title", "endsAt", "remaining"}` in
/// milliseconds, or null when no block is running.
@_cdecl("done_focus")
public func doneFocus(_ json: UnsafePointer<CChar>?) {
    let text = json.map { String(cString: $0) }
    DispatchQueue.main.async { FocusActivity.apply(text) }
}

/// The widgets' data changed: `json` is a `DoneSnapshot`, or `null` when
/// there is nothing to show any more (signed out): the file is removed, so the
/// widgets say "open done" instead of keeping another account's tasks.
@_cdecl("done_widget_snapshot")
public func doneWidgetSnapshot(_ json: UnsafePointer<CChar>) {
    let text = String(cString: json)
    let data = Data(text.utf8)
    DispatchQueue.main.async {
        if text == "null" {
            if let url = doneSnapshotURL() { try? FileManager.default.removeItem(at: url) }
            WidgetCenter.shared.reloadAllTimelines()
            return
        }
        // Checked before it is stored: a snapshot the extension could not
        // decode would leave every widget blank until the next change.
        guard (try? JSONDecoder().decode(DoneSnapshot.self, from: data)) != nil,
              let url = doneSnapshotURL() else { return }
        try? data.write(to: url, options: .atomic)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// The one Live Activity for the running focus block.
enum FocusActivity {
    private struct Session: Decodable {
        let title: String?
        let endsAt: Double?
        let remaining: Double?
    }

    static func apply(_ json: String?) {
        guard #available(iOS 16.2, *) else { return }
        let session = json.flatMap { try? JSONDecoder().decode(Session.self, from: Data($0.utf8)) }
        guard let session, session.endsAt != nil || session.remaining != nil else {
            // No block, or one that has ended: the countdown goes away.
            end()
            return
        }
        let state = FocusAttributes.ContentState(
            title: (session.title?.isEmpty == false ? session.title : nil) ?? "Focus",
            endsAt: session.endsAt.map { Date(timeIntervalSince1970: $0 / 1000) },
            remaining: session.remaining.map { $0 / 1000 }
        )
        // The countdown can only fall to zero; at the end it stays, still,
        // until the window says the block is over, so a stale activity is
        // never left behind by itself.
        let stale = state.endsAt.map { $0.addingTimeInterval(60) }
        let content = ActivityContent(state: state, staleDate: stale)
        // Only a live activity is updated: `activities` also lists ones iOS has
        // ended (after its 8-hour limit, say) that still sit on the Lock
        // Screen, and updating one of those does nothing, so every later
        // focus would go unseen until the app restarted (review of #74).
        let all = Activity<FocusAttributes>.activities
        if let running = all.first(where: { $0.activityState == .active || $0.activityState == .stale }) {
            Task { await running.update(content) }
            return
        }
        for ended in all { Task { await ended.end(nil, dismissalPolicy: .immediate) } }
        // Not allowed (the user switched Live Activities off for done): the
        // in-app timer still runs; nothing to report.
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        _ = try? Activity.request(attributes: FocusAttributes(), content: content, pushType: nil)
    }

    @available(iOS 16.2, *)
    private static func end() {
        for activity in Activity<FocusAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}

// MARK: Sign in with Apple

/// Called from Rust (`apple_sign_in` in crates/app/src/lib.rs) with a C
/// function to answer through, once: `{"token", "name"}` on success, or
/// `{"error"}` (`"cancelled"` when the person closed the sheet).
///
/// WHY native and not Apple's web sign-in: the iPhone app must offer Sign in
/// with Apple next to Google (App Store guideline 4.8), and the native sheet
/// is what Apple expects there: Face ID, no password, and a token made out to
/// this app's bundle id, which the server checks without any Apple secret.
public typealias DoneAnswer = @convention(c) (UnsafePointer<CChar>) -> Void

@_cdecl("done_apple_sign_in")
public func doneAppleSignIn(_ answer: DoneAnswer) {
    DispatchQueue.main.async { AppleSignIn.start(answer) }
}

final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    // The controller keeps its delegate weakly: this holds the one sign-in
    // under way until it has answered.
    private static var current: AppleSignIn?
    private let answer: DoneAnswer

    private init(_ answer: DoneAnswer) { self.answer = answer }

    static func start(_ answer: DoneAnswer) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        let signIn = AppleSignIn(answer)
        current = signIn
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = signIn
        controller.presentationContextProvider = signIn
        controller.performRequests()
    }

    private func finish(_ value: [String: String]) {
        let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{\"error\":\"failed\"}".utf8)
        String(decoding: data, as: UTF8.self).withCString { answer($0) }
        AppleSignIn.current = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            finish(["error": "no token"])
            return
        }
        // Apple gives the name on the first sign-in only; the server keeps it.
        let name = [credential.fullName?.givenName, credential.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
        finish(["token": token, "name": name, "user": credential.user])
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        finish(["error": cancelled ? "cancelled" : error.localizedDescription])
    }
}

/// Apple's notification identifies no user. Check the account this window is
/// signed in to, including when a revocation happened while the app was closed.
private final class AppleCredentialMonitor: NSObject {
    static let shared = AppleCredentialMonitor()
    var watch: (user: String, id: String, ended: DoneAnswer)?

    override init() {
        super.init()
        for name in [ASAuthorizationAppleIDProvider.credentialRevokedNotification, UIApplication.didBecomeActiveNotification] {
            NotificationCenter.default.addObserver(self, selector: #selector(check), name: name, object: nil)
        }
    }

    @objc func check() {
        guard let current = watch else { return }
        ASAuthorizationAppleIDProvider().getCredentialState(forUserID: current.user) { state, error in
            // A failed lookup (including a network error) does not prove revocation.
            guard state == .revoked || (state == .notFound && error == nil) else { return }
            DispatchQueue.main.async {
                guard self.watch?.id == current.id else { return }
                current.id.withCString { current.ended($0) }
            }
        }
    }
}

@_cdecl("done_watch_apple_user")
public func doneWatchAppleUser(_ user: UnsafePointer<CChar>, _ id: UnsafePointer<CChar>, _ ended: DoneAnswer) {
    let subject = String(cString: user)
    let watchID = String(cString: id)
    DispatchQueue.main.async {
        let monitor = AppleCredentialMonitor.shared
        monitor.watch = subject.isEmpty ? nil : (subject, watchID, ended)
        monitor.check()
    }
}
