import { describe, expect, it } from 'vitest'
import { unified, type PluggableList } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { toHtml } from 'hast-util-to-html'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import remarkLatexBracketMath from './remark-latex-bracket-math'
import {
    MARKDOWN_PLUGINS,
    MARKDOWN_PLUGINS_STANDALONE,
    MARKDOWN_PLUGINS_STANDALONE_WITH_BREAKS,
    MARKDOWN_PLUGINS_WITH_BREAKS,
    MARKDOWN_REHYPE_PLUGINS,
} from '@/components/assistant-ui/markdown-text'

function render(markdown: string, plugins: PluggableList = MARKDOWN_PLUGINS): string {
    const processor = unified()
        .use(remarkParse)
        .use(plugins)
        .use(remarkRehype)
        .use(MARKDOWN_REHYPE_PLUGINS)
    const tree = processor.parse(markdown)
    return toHtml(processor.runSync(tree, markdown) as never)
}

const pluginVariants = [
    ['default', MARKDOWN_PLUGINS],
    ['standalone', MARKDOWN_PLUGINS_STANDALONE],
    ['with breaks', MARKDOWN_PLUGINS_WITH_BREAKS],
    ['standalone with breaks', MARKDOWN_PLUGINS_STANDALONE_WITH_BREAKS],
] as const

describe('remarkLatexBracketMath', () => {
    it('is included before remarkMath in every production plugin variant', () => {
        for (const [, plugins] of pluginVariants) {
            const bracketIndex = plugins.indexOf(remarkLatexBracketMath)
            const mathIndex = plugins.findIndex((plugin) => Array.isArray(plugin) && plugin[0] === remarkMath)
            expect(bracketIndex).toBeGreaterThanOrEqual(0)
            expect(mathIndex).toBeGreaterThanOrEqual(0)
            expect(bracketIndex).toBeLessThan(mathIndex)
        }
    })

    it.each(pluginVariants)('renders display bracket math in the %s pipeline', (_, plugins) => {
        const html = render(String.raw`\[E = mc^2\]`, plugins)

        expect(html).toContain('class="katex-display"')
        expect(html).toContain('class="katex"')
        expect(html).not.toContain('\\[E = mc^2\\]')
    })

    it.each(pluginVariants)('renders parenthesized inline math in the %s pipeline', (_, plugins) => {
        const html = render(String.raw`Result: \(x^2 + y^2\).`, plugins)

        expect(html).toContain('class="katex"')
        expect(html).not.toContain('katex-display')
        expect(html).not.toContain('\\(x^2 + y^2\\)')
    })

    it('renders multiline display math before optional hard-break processing', () => {
        const markdown = String.raw`Before

\[
E = mc^2
\]

After`

        for (const [, plugins] of pluginVariants) {
            const html = render(markdown, plugins)
            expect(html).toContain('class="katex-display"')
            expect(html).toContain('Before')
            expect(html).toContain('After')
        }
    })

    it('renders multiple inline formulas in one paragraph', () => {
        const html = render(String.raw`Compare \(a^2\) with \(b^2\).`)

        expect(html.match(/class="katex"/g)).toHaveLength(2)
    })

    it('renders aligned display math with TeX line breaks and indentation', () => {
        const html = render(String.raw`\[
\begin{aligned}
f(x) &= x^2+2x+1 \\
     &= (x+1)^2
\end{aligned}
\]`)

        expect(html).toContain('class="katex-display"')
        expect(html).toContain('class="katex"')
        expect(html).not.toContain('<p>[\\begin{aligned}')
    })

    it('hoists display math out of surrounding prose', () => {
        const html = render(String.raw`Before \[x^2\] after`)

        expect(html).toContain('<p>Before </p>')
        expect(html).toContain('<p> after</p>')
        expect(html).toContain('class="katex-display"')
    })

    it('preserves common LaTeX commands inside display math', () => {
        const html = render(String.raw`\[
\lim_{x\to 0}\frac{\sin x}{x}=1
\]`)

        expect(html).toContain('class="katex-display"')
        expect(html).toContain('mfrac')
    })

    it('renders the multiline transfer-function formulas from the real session', () => {
        const html = render(String.raw`\[
\Phi(s)=
\frac{\dfrac{K^*(s+4)}{s(s+2)(s+3)}}
{1+\dfrac{K^*}{s(s+3)}}
\]

\[
\Phi(s)
=
\frac{K^*(s+4)}
{(s+2)\left[s(s+3)+K^*\right]}
\]

\[
\Phi(s)=
\frac{9(s+4)}
{(s+2)(s^2+3s+9)}
\]

\[
\Phi(s)
=
\frac{9}{s^2+3s+9}
\frac{s+4}{s+2}
\]`)

        expect(html.match(/class="katex"/g)).toHaveLength(4)
        expect(html).not.toContain('<p>[\n')
        expect(html).not.toContain('<h1>[\n')
    })

    it('renders percent and text commands from the real session', () => {
        const html = render(String.raw`标准二阶系统超调量：

\[
\sigma\% =
e^{-\frac{\pi\zeta}{\sqrt{1-\zeta^2}}}\times100\%
\]

\[
t_s\approx\frac{4}{0.5\times3}
\approx2.67\text{ s}
\]`)

        expect(html.match(/class="katex"/g)).toHaveLength(2)
        expect(html).not.toContain('<p>[\n')
        expect(html).not.toContain('<h1>[\n')
    })

    it('recurses through inline formatting while keeping the display node block-level', () => {
        const html = render(String.raw`**Before \(x^2\) after**`)

        expect(html).toContain('<strong>')
        expect(html).toContain('class="katex"')
    })

    it.each([
        ['inline code', 'Use `\\(x^2\\)` here.'],
        ['fenced code', '```latex\n\\[x^2\\]\n```'],
        ['escaped delimiters', String.raw`Literal \\(x^2\\) and \\[y^2\\]`],
        ['unclosed delimiter', String.raw`Literal \(x^2`],
    ])('leaves %s as text', (_, markdown) => {
        const html = render(markdown)

        expect(html).not.toContain('class="katex"')
    })

    it('keeps currency prose literal while preserving existing dollar math', () => {
        const currency = render('The plan is $200/mo and the bill is $80.')
        expect(currency).not.toContain('class="katex"')
        expect(currency).toContain('$200')
        expect(currency).toContain('$80')

        const dollarMath = render(String.raw`$$
E = mc^2
$$`)
        expect(dollarMath).toContain('class="katex-display"')
    })

    it('keeps bracket math after the existing table source repair', () => {
        const markdown = [
            '| A | B | C |',
            '|---|---|',
            '| x | y | z |',
            '',
            String.raw`\[E = mc^2\]`,
        ].join('\n')

        const html = render(markdown)
        expect(html).toContain('<table>')
        expect(html).toContain('class="katex-display"')
    })

    it('does not add hard-break parsing to the default pipeline', () => {
        expect(MARKDOWN_PLUGINS).not.toContain(remarkBreaks)
        expect(MARKDOWN_PLUGINS_WITH_BREAKS).toContain(remarkBreaks)
    })
})
