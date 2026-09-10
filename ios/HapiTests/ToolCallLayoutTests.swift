import HapiUI
import SwiftUI
import UIKit
import XCTest
@testable import Hapi
@testable import HapiProtocol

@MainActor
final class ToolCallLayoutTests: XCTestCase {
    private let prefix = "cat <<'EOF'\nx"
    private var script: String { prefix + String(repeating: "\nx", count: 100) + "\nEOF" }

    private func block(name: String, command: String) -> ToolCallBlock {
        // Cover both string commands and Codex's array representation.
        let input: JSONValue = name == "CodexBash"
            ? .array([.string("cat"), .string(String(command.dropFirst(4)))])
            : .string(command)
        return ToolCallBlock(
            id: "tool", localId: nil, createdAt: 0, invokedAt: nil,
            durationMs: nil, usage: nil, model: nil,
            tool: ChatToolCall(id: "tool", name: name, state: .completed,
                              input: .object(["command": input]), createdAt: 0),
            children: [], meta: nil
        )
    }

    private func height(of block: ToolCallBlock, size: DynamicTypeSize, expanded: Bool = false) -> CGFloat {
        let state = ChatPresentationState()
        state.values[.init(id: block.id, field: "expanded")] = expanded
        let host = UIHostingController(rootView: ToolCallBlockView(block: block, basePath: nil)
            .environment(\.chatPresentationState, state)
            .hapiTypography()
            .environment(\.dynamicTypeSize, size))
        return host.sizeThatFits(in: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude)).height
    }

    func testCollapsedCommandPreviewIsBoundedToTwoLines() {
        for name in ["Bash", "CodexBash"] {
            for size in [DynamicTypeSize.large, .accessibility5] {
                let oneLine = height(of: block(name: name, command: "cat <<'EOF'"), size: size)
                let twoLines = height(of: block(name: name, command: prefix), size: size)
                let longScript = height(of: block(name: name, command: script), size: size)
                XCTAssertGreaterThan(twoLines, oneLine, "\(name), \(size): preview should allow two lines")
                XCTAssertEqual(longScript, twoLines, accuracy: 1, "\(name), \(size): collapsed script must not grow past its preview")
            }
        }
    }

    func testExpandedCommandKeepsTheCompleteScript() {
        for name in ["Bash", "CodexBash"] {
            let longBlock = block(name: name, command: script)
            XCTAssertEqual(toolCardPresentation(longBlock.tool, basePath: nil).subtitle, script)
            XCTAssertEqual(chatTerminalCommand(longBlock.tool.input), script)
            let shortHeight = height(of: block(name: name, command: prefix + "\nEOF"), size: .large, expanded: true)
            let fullHeight = height(of: longBlock, size: .large, expanded: true)
            XCTAssertGreaterThan(fullHeight, shortHeight + 1000, "\(name): expanded body must retain all 100 extra lines")
        }
    }
}
