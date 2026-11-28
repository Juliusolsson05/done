import XCTest

// Release candidate smoke test, iPhone and iPad alike: add a task and a note,
// relaunch, find both again, then open Settings and find the Account pane.
final class Capture: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "app.thedone.ios")

    func first(_ query: XCUIElementQuery, _ predicate: NSPredicate) -> XCUIElement {
        let all = query.matching(predicate).allElementsBoundByIndex
        return all.first(where: { $0.exists && $0.isHittable }) ?? query.matching(predicate).firstMatch
    }

    func button(_ title: String) -> XCUIElement {
        first(app.buttons, NSPredicate(format: "label BEGINSWITH[c] %@", title))
    }

    func exact(_ title: String) -> XCUIElement {
        first(app.buttons, NSPredicate(format: "label ==[c] %@", title))
    }

    func anything(_ text: String) -> XCUIElement {
        first(app.descendants(matching: .any), NSPredicate(format: "label CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text))
    }

    func wait(_ element: XCUIElement, _ seconds: TimeInterval = 8, _ file: StaticString = #filePath, _ line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: seconds), app.debugDescription, file: file, line: line)
    }

    func capture(_ name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    // A view by name: a tab or sidebar row if it is on screen, else through
    // Lists (iPhone) or the sidebar toggle (iPad).
    func open(_ title: String) {
        for _ in 0..<3 {
            let target = exact(title)
            if target.exists && target.isHittable { target.tap(); return }
            let back = button("Back")
            let lists = exact("Lists")
            if lists.exists && lists.isHittable { lists.tap() }
            else if back.exists && back.isHittable { back.tap() }
            else if button("Toggle Sidebar").exists && button("Toggle Sidebar").isHittable { button("Toggle Sidebar").tap() }
            sleep(1)
        }
        let target = exact(title)
        wait(target)
        // Lists on a phone is taller than the screen: Settings is last, under the tab bar.
        for _ in 0..<4 where !target.isHittable { app.swipeUp(); sleep(1) }
        target.tap()
    }

    func testSmoke() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let taskName = "Pick up picnic blankets"
        let noteName = "Picnic packing list"
        app.launch()
        wait(button("Sketch the invitation"), 25)
        capture("01-Today")

        // A task, from Today: "New Task" on a phone, the "Add task" row on an iPad.
        let newTask = button("New Task")
        if newTask.exists && newTask.isHittable { newTask.tap() } else { button("Add task").tap() }
        let field = app.textFields["New task"]
        wait(field)
        // Return adds it on both (quick-add.tsx); on a phone "Add task" is
        // also the list's own row, behind the sheet, so it is not tapped.
        field.typeText(taskName + "\n")
        sleep(1)
        for name in ["Cancel", "Close"] where exact(name).exists && exact(name).isHittable { exact(name).tap() }
        wait(button(taskName))
        capture("02-Task-added")

        // A note.
        open("Notes")
        let newNote = app.buttons["New note"].firstMatch
        wait(newNote)
        newNote.tap()
        sleep(1)
        app.typeText(noteName + "\nPacking for Saturday")
        sleep(1)
        capture("03-Note-written")
        if exact("Done").exists && exact("Done").isHittable { exact("Done").tap() }
        sleep(2)

        // Both survive a relaunch.
        app.terminate()
        app.launch()
        wait(button(taskName), 20)
        capture("04-Relaunched-Today")
        open("Notes")
        // A phone opens Notes on its folders; the notes are under All notes.
        let all = button("All notes")
        if all.waitForExistence(timeout: 3) && all.isHittable { all.tap() }
        wait(anything(noteName))
        capture("05-Relaunched-Notes")

        // Settings: the Account pane, with its three ways in.
        open("Settings")
        wait(anything("Account"))
        for name in ["Sign in with Apple", "Sign in with Google", "Sign in with a password"] {
            wait(first(app.buttons, NSPredicate(format: "label CONTAINS[c] %@", name)))
        }
        capture("06-Settings-Account")
    }
}
