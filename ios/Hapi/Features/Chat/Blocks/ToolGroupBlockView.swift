import HapiProtocol
import HapiUI
import SwiftUI

/// Run of adjacent groupable tools (web `ToolGroupCard`): a one-line summary
/// — count + first targets + error/running signals — expanding to the
/// individual `ToolCallBlockView`s. Codex exploration groups honor their
/// `defaultOpen`.
struct ToolGroupBlockView: View {
    let block: ToolGroupBlock
    let basePath: String?

    @State private var expanded: Bool
    private let expansion: Binding<Bool>?
    private let showsTools: Bool
    @Environment(\.hapiTheme) private var theme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .footnote) private var iconWidth: CGFloat = 18

    init(block: ToolGroupBlock, basePath: String?, expansion: Binding<Bool>? = nil, showsTools: Bool = true) {
        self.block = block
        self.basePath = basePath
        _expanded = State(initialValue: block.defaultOpen)
        self.expansion = expansion
        self.showsTools = showsTools
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
            if showsTools && (expansion?.wrappedValue ?? expanded) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(block.tools, id: \.id) { tool in
                        ToolCallBlockView(block: tool, basePath: basePath)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var headerRow: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if let expansion { expansion.wrappedValue.toggle() }
                else { expanded.toggle() }
            }
        } label: {
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(spacing: 8))
            layout {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "wrench.and.screwdriver")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(width: iconWidth)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(theme.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        if !summaryText.isEmpty {
                            Text(summaryText)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
                trailingIndicator
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var title: String {
        if let activityTitle = block.activityTitle {
            return activityTitle
        }
        let count = block.summary.totalTools
        return count == 1
            ? String(localized: "1 tool")
            : String(format: String(localized: "%lld tools"), Int64(count))
    }

    /// "file, other-file +2" digest from the group summary targets.
    private var summaryText: String {
        let summary = block.summary
        let targets = summary.fileTargets + summary.searchTargets
            + summary.commandTargets + summary.urlTargets + summary.otherTargets
        guard !targets.isEmpty else { return "" }
        let shown = targets.prefix(3)
            .map { target -> String in
                let tail = target.split(separator: "/").last.map(String.init) ?? target
                return tail.isEmpty ? target : tail
            }
            .joined(separator: ", ")
        let more = targets.count - 3
        return more > 0 ? "\(shown) +\(more)" : shown
    }

    @ViewBuilder
    private var trailingIndicator: some View {
        if block.summary.runningCount > 0 {
            ProgressView()
                .controlSize(.small)
        } else if block.summary.errorCount > 0 {
            Text("\(block.summary.errorCount) ⚠")
                .font(.footnote)
                .foregroundStyle(.red)
        } else {
            Image(systemName: (expansion?.wrappedValue ?? expanded) ? "chevron.down" : "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
