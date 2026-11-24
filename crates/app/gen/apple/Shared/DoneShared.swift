// What the app and its widget extension both need to know, compiled into both
// targets (project.yml lists Shared under each): the Live Activity's shape, and
// where the widgets' data lives.
//
// WHY one file in two targets: ActivityKit matches a running activity to the
// extension's view by the attributes *type*, so both sides must compile the
// very same struct; a copy in each that drifted by one field would show
// nothing on the Dynamic Island, with no error anywhere.
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// The App Group both targets belong to: the only place the extension can
/// read what the app wrote. Declared in both entitlements files (project.yml).
let doneAppGroup = "group.dev.done.app"

/// The widgets' data: written by the app (`done_widget_snapshot`), read by the
/// extension's timeline. A file, not UserDefaults, so one write replaces it
/// whole and a half-written state is never read.
func doneSnapshotURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: doneAppGroup)?
        .appendingPathComponent("widget-snapshot.json")
}

/// What the interface sends (ui/src/lib/widget-snapshot.ts), as stored.
struct DoneSnapshot: Codable {
    struct Task: Codable, Hashable {
        /// The task's id, so two tasks with the same title are two rows.
        let id: Int
        let title: String
        /// "overdue", "today" or "goal": how the row is marked.
        let mark: String
    }
    /// Open tasks left for today, overdue included.
    let left: Int
    /// The first few of them, in the order Today shows them.
    let tasks: [Task]
    /// The running focus block, if any.
    let focus: Focus?
    /// When the app wrote this, in seconds since 1970: the widget says nothing
    /// stale about "today" after midnight (see `isToday`).
    let at: Double

    struct Focus: Codable, Hashable {
        let title: String
        /// When it ends, seconds since 1970; nil while paused.
        let endsAt: Double?
        /// What is left in seconds while paused.
        let remaining: Double?
    }

    static func read() -> DoneSnapshot? {
        guard let url = doneSnapshotURL(), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(DoneSnapshot.self, from: data)
    }

    var isToday: Bool { Calendar.current.isDateInToday(Date(timeIntervalSince1970: at)) }
}

#if canImport(ActivityKit)
/// The focus block shown in the Dynamic Island and on the Lock Screen.
@available(iOS 16.1, *)
struct FocusAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// The task being worked on ("Focus" when none was picked).
        var title: String
        /// When the block ends; nil while paused.
        var endsAt: Date?
        /// Seconds left while paused.
        var remaining: Double?
    }
}
#endif
