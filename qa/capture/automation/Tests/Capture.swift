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
}
