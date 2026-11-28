import XCTest

final class Capture: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "app.thedone.ios")

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.activate()
    }

    func button(_ text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", text))
            .allElementsBoundByIndex.first(where: { $0.isHittable }) ?? app.buttons[text]
    }

    func open(_ title: String) {
        var item = button(title)
        if !item.isHittable {
            let menu = button(UIDevice.current.userInterfaceIdiom == .pad ? "Show sidebar" : "Lists")
            if menu.isHittable {
                menu.tap()
                item = button(title)
            }
        }
        XCTAssertTrue(item.waitForExistence(timeout: 8) && item.isHittable, "Missing navigation: \(title)")
        item.tap()
    }

    func visibleText(_ text: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text))
            .firstMatch
    }

    func save(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }

    func testBoard() {
        open("Board")
        XCTAssertTrue(visibleText("To do").waitForExistence(timeout: 8), "Missing Board To do lane")
        XCTAssertTrue(visibleText("In progress").exists, "Missing Board In progress lane")
        save("Board")
    }

    func testNotes() {
        open("Notes")
        let note = button("Open house run of show")
        if !note.isHittable && button("All notes").isHittable { button("All notes").tap() }
        if note.waitForExistence(timeout: 3) && note.isHittable { note.tap() }
        XCTAssertTrue(visibleText("Ari sets the prints").waitForExistence(timeout: 8), "Missing open house note body")
        save("Notes")
    }

    func testUpcoming() {
        open("Upcoming")
        XCTAssertTrue(visibleText("Choose a cover photograph").waitForExistence(timeout: 8), "Missing tomorrow's cover photograph task")
        save("Upcoming")
    }

    func testFocus() {
        open("Focus")
        XCTAssertTrue(visibleText("What are you working on?").waitForExistence(timeout: 8), "Missing Focus task picker")
        save("Focus")
    }
}
