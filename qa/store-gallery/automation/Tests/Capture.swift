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

    func open(_ title: String, key: String) {
        if UIDevice.current.userInterfaceIdiom == .pad {
            app.typeKey(key, modifierFlags: [])
        } else {
            if !button(title).isHittable && button("Lists").isHittable { button("Lists").tap() }
            button(title).tap()
        }
    }

    func save(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }

    func testBoard() {
        open("Board", key: "5")
        XCTAssertTrue(button("Pick six prints for the front wall").waitForExistence(timeout: 8) ||
                      app.staticTexts["To do"].exists || app.staticTexts["Board"].exists)
        save("Board")
    }

    func testNotes() {
        open("Notes", key: "8")
        if button("All notes").isHittable { button("All notes").tap() }
        if button("Open house run of show").isHittable { button("Open house run of show").tap() }
        XCTAssertTrue(button("Send the open house invitations").waitForExistence(timeout: 8))
        save("Notes")
    }

    func testUpcoming() {
        open("Upcoming", key: "3")
        XCTAssertTrue(button("Choose a cover photograph").waitForExistence(timeout: 8) ||
                      app.staticTexts["Choose a cover photograph"].exists)
        save("Upcoming")
    }
}
