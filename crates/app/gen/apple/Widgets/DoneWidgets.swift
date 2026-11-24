// done's widget extension: today's tasks on the Home and Lock Screen, and the
// running focus block in the Dynamic Island and on the Lock Screen.
//
// The extension has no tasks of its own and never talks to the app: the app
// writes a snapshot into the shared App Group container whenever Today
// changes and asks WidgetKit to reload (Sources/done-app/DoneNative.swift);
// the focus countdown is a Live Activity the app starts and updates.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct DoneWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        FocusLiveActivity()
    }
}

// MARK: - Today

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: DoneSnapshot?
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: .now, snapshot: DoneSnapshot(left: 3, tasks: [
            .init(title: "Write the plan", mark: "goal"),
            .init(title: "Call the bank", mark: "today"),
            .init(title: "Reply to Sam", mark: "overdue"),
        ], focus: nil, at: Date.now.timeIntervalSince1970))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : TodayEntry(date: .now, snapshot: DoneSnapshot.read()))
    }

    // One entry now, and another just after midnight: the app is usually not
    // running then, so the widget must stop calling yesterday's list "today"
    // on its own (`isToday` below), until the app writes a new snapshot.
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let snapshot = DoneSnapshot.read()
        let midnight = Calendar.current.startOfDay(for: .now).addingTimeInterval(24 * 3600 + 60)
        completion(Timeline(entries: [
            TodayEntry(date: .now, snapshot: snapshot),
            TodayEntry(date: midnight, snapshot: snapshot),
        ], policy: .never))
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "done.today", provider: TodayProvider()) { entry in
            TodayView(entry: entry).doneWidgetBackground()
        }
        .configurationDisplayName("Today")
        .description("What is left for today in done.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct TodayView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    // Yesterday's snapshot after midnight says nothing about today: shown as
    // "open done" rather than a wrong count.
    private var snapshot: DoneSnapshot? { entry.snapshot.flatMap { Calendar.current.isDate(Date(timeIntervalSince1970: $0.at), inSameDayAs: entry.date) ? $0 : nil } }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(snapshot.map { "\($0.left) left today" } ?? "done")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text(snapshot.map { "\($0.left)" } ?? "–").font(.title2.weight(.semibold))
                    Text("today").font(.caption2)
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(snapshot.map { "\($0.left) left today" } ?? "done").font(.headline)
                ForEach((snapshot?.tasks ?? []).prefix(2), id: \.self) { Text($0.title).lineLimit(1) }
            }
        default:
            list
        }
    }

    private var rows: Int {
        switch family {
        case .systemSmall: return 3
        case .systemMedium: return 4
        default: return 9
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 5 : 7) {
            HStack(alignment: .firstTextBaseline) {
                Text("Today").font(.headline)
                Spacer()
                if let snapshot { Text("\(snapshot.left)").font(.headline).foregroundStyle(.secondary) }
            }
            if let focus = snapshot?.focus { FocusLine(focus: focus) }
            if let snapshot, !snapshot.tasks.isEmpty {
                ForEach(snapshot.tasks.prefix(rows), id: \.self) { task in
                    HStack(spacing: 6) {
                        Circle()
                            .strokeBorder(task.mark == "overdue" ? Color.red : Color.secondary.opacity(0.6), lineWidth: 1.5)
                            .frame(width: 12, height: 12)
                        Text(task.title)
                            .font(family == .systemSmall ? .caption : .subheadline)
                            .fontWeight(task.mark == "goal" ? .semibold : .regular)
                            .lineLimit(1)
                    }
                }
            } else {
                Text(snapshot == nil ? "Open done to see today." : "Nothing left for today.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }
}

struct FocusLine: View {
    let focus: DoneSnapshot.Focus
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "timer")
            if let ends = focus.endsAt.map({ Date(timeIntervalSince1970: $0) }), ends > .now {
                Text(timerInterval: Date.now...ends, countsDown: true).monospacedDigit()
            } else if let left = focus.remaining {
                Text(Duration.seconds(left).formatted(.time(pattern: .minuteSecond)))
            }
            Text(focus.title).lineLimit(1)
        }
        .font(.caption)
        .foregroundStyle(.blue)
    }
}

// MARK: - Focus in the Dynamic Island

struct FocusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusAttributes.self) { context in
            // Lock Screen and the banner on phones without a Dynamic Island.
            HStack(spacing: 12) {
                Image(systemName: "timer").font(.title2).foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.title).font(.headline).lineLimit(1)
                    if let ends = context.state.endsAt { Text("Ends \(ends, style: .time)").font(.caption).foregroundStyle(.secondary) }
                    else { Text("Paused").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                TimeLeft(state: context.state).font(.title.weight(.semibold))
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "timer").font(.title2).foregroundStyle(.blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TimeLeft(state: context.state).font(.title2.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.title).font(.headline).lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(.blue)
            } compactTrailing: {
                // A fixed width: a countdown's text otherwise shrinks and
                // grows the island every second as its digits change.
                TimeLeft(state: context.state).frame(width: 46)
            } minimal: {
                TimeLeft(state: context.state, short: true)
            }
        }
    }
}

/// Counts down by itself while running (`timerInterval`, drawn by the system
/// with the app suspended); still while paused.
struct TimeLeft: View {
    let state: FocusAttributes.ContentState
    var short = false
    var body: some View {
        Group {
            if let ends = state.endsAt, ends > .now {
                Text(timerInterval: Date.now...ends, countsDown: true)
            } else if let left = state.remaining {
                Text(Duration.seconds(left).formatted(.time(pattern: short ? .minuteSecond : .minuteSecond)))
            } else {
                Text("0:00")
            }
        }
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .foregroundStyle(.blue)
    }
}

extension View {
    /// iOS 17 asks every widget for its background; iOS 16 has no such call.
    @ViewBuilder func doneWidgetBackground() -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(.fill.tertiary, for: .widget)
        } else {
            padding()
        }
    }
}
