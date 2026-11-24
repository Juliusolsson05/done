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
import Foundation
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
