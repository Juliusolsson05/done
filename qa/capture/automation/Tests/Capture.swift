import XCTest

final class Capture: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "app.thedone.ios")

    func button(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", title)).allElementsBoundByIndex.first(where: { $0.isHittable }) ?? app.buttons[title]
    }

    func open(_ title: String) {
        let lists = button("Lists")
        if !button(title).isHittable {
            if lists.isHittable { lists.tap() }
            else if button("Toggle Sidebar").isHittable { button("Toggle Sidebar").tap() }
        }
        let target = button(title)
        XCTAssertTrue(target.waitForExistence(timeout: 5), app.debugDescription)
        target.tap()
    }

    func capture(_ name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testScreens() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.activate()
        XCTAssertTrue(button("Sketch the invitation").waitForExistence(timeout: 15), app.debugDescription)
        capture("01-Today")
        open("Notes")
        if button("All notes").isHittable { button("All notes").tap() }
        if button("Garden gathering").isHittable { button("Garden gathering").tap() }
        XCTAssertTrue(button("Sketch the invitation").waitForExistence(timeout: 8), app.debugDescription)
        capture("02-Notes")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(button("Sketch the invitation").waitForExistence(timeout: 8), app.debugDescription)
        capture("landscape-notes-qa")
        XCUIDevice.shared.orientation = .portrait
        open("Focus")
        XCTAssertTrue(button("Start focus").waitForExistence(timeout: 8), app.debugDescription)
        capture("03-Focus")
    }

    func testWriteAndReopen() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        let taskName = "Pick up picnic blankets"
        let noteName = "Picnic packing list"
        let firstTask = app.buttons["Sketch the invitation"].firstMatch
        XCTAssertTrue(firstTask.waitForExistence(timeout: 25), app.debugDescription)
        // Begin on Today, the native default. No touch on a sidebar row is needed.
        button("Add task").tap()
        let task = app.textFields["New task"]
        XCTAssertTrue(task.waitForExistence(timeout: 8), app.debugDescription)
        task.typeText(taskName)
        app.buttons.matching(NSPredicate(format: "label ==[c] %@", "Add task")).firstMatch.tap()
        if app.buttons["Close"].isHittable { app.buttons["Close"].tap() }
        XCTAssertTrue(button(taskName).waitForExistence(timeout: 8), app.debugDescription)
        // Use the app's existing iPad hardware-keyboard shortcut to avoid long-press context menus.
        app.typeKey("8", modifierFlags: [])
        let newNote = app.buttons["New note"].firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 8), app.debugDescription)
        newNote.tap()
        app.typeText(noteName + "\nPacking for Saturday")
        if button("Done").isHittable { button("Done").tap() }
        app.typeKey("2", modifierFlags: [])
        XCTAssertTrue(button(taskName).waitForExistence(timeout: 8), app.debugDescription)
        app.terminate()
        app.launch()
        XCTAssertTrue(button(taskName).waitForExistence(timeout: 15), app.debugDescription)
        app.typeKey("8", modifierFlags: [])
        let note = button(noteName)
        XCTAssertTrue(note.waitForExistence(timeout: 8), app.debugDescription)
        note.tap()
        XCUIDevice.shared.orientation = .landscapeLeft
        let editor = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR value CONTAINS[c] %@", "Note", noteName)).firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 8), app.debugDescription)
        capture("reopened-note-landscape")
    }
}
