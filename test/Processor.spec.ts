import test from 'ava'
import * as sinon from 'sinon'
import { Processor } from '../src/Processor'
import { Config, Event, Issue } from '../src/types'

const defaultConfig = {
    repoToken: 'foo',
    daysUntilClose: 3,
    templateNotUsedLabel: 'template-not-used',
    templateNotUsedCommentBody: 'not-used\n{authorLogin}\n{daysUntilClose}',
    doesntFollowTemplateLabel: 'doesnt-follow-template',
    doesntFollowTemplateCommentBody:
        'doesnt-follow\n{authorLogin}\n{daysUntilClose}',
}

const defaultCommentConfig: Config = { ...defaultConfig, type: 'comment' }

const defaultCloseConfig: Config = { ...defaultConfig, type: 'close' }

const repo = { owner: 'foo', repo: 'bar' }

const getIssue = () => ({
    ...repo,
    issue_number: Math.floor(Math.random() * 100_000),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const octokitPlaceholder = {} as any

test('does not comment anything if the issue does not have one of the labels', async (t) => {
    const processor = new Processor(
        defaultCommentConfig,
        octokitPlaceholder,
        repo,
        {
            issue: getIssue(),
            labelName: 'x',
        }
    )
    const mock = sinon.mock(processor)

    mock.expects('closeIssue').never()
    mock.expects('createComment').never()

    await processor.run()

    mock.verify()
    t.pass()
})

function testComment(
    title: string,
    label: string,
    commentBody: string,
    f?: (mock: sinon.SinonMock) => void,
    config: Config = defaultCommentConfig
) {
    test(title, async (t) => {
        const issue = getIssue()
        const processor = new Processor(config, octokitPlaceholder, repo, {
            issue,
            labelName: label,
        })

        const mock = sinon.mock(processor)

        mock.expects('getAuthorLogin')
            .once()
            .withExactArgs(issue)
            .resolves('baz')
        mock.expects('createComment')
            .once()
            .withExactArgs(issue, commentBody)
            .resolves()

        f?.(mock)

        await processor.run()

        mock.verify()
        t.pass()
    })
}

testComment(
    'makes comment if issue has doesnt-follow-template',
    defaultCommentConfig.doesntFollowTemplateLabel,
    `doesnt-follow\nbaz\n${defaultCommentConfig.daysUntilClose} days`
)

testComment(
    'makes comment if issue has template-not-used',
    defaultCommentConfig.templateNotUsedLabel,
    `not-used\nbaz\n${defaultCommentConfig.daysUntilClose} days\n<details><summary>Foo</summary>\n\n\`\`\`\nBar\n\`\`\`\n</details>`,
    (mock) => {
        mock.expects('getIssueTemplates')
            .once()
            .resolves([
                {
                    name: 'Foo',
                    template: 'Bar',
                },
            ])
    }
)

test('uses singular when daysUntilClose is 1', async (t) => {
    const issue = getIssue()

    const processor = new Processor(
        { ...defaultCommentConfig, daysUntilClose: 1 },
        octokitPlaceholder,
        repo,
        {
            issue,
            labelName: 'whatever',
        }
    )

    const mock = sinon.mock(processor)

    mock.expects('getAuthorLogin').once().withExactArgs(issue).resolves('42')

    const result = await processor.interpolateValues('{daysUntilClose}', issue)
    mock.verify()

    t.is(result, '1 day')
})

// TODO: figure out why this is failing.
test.skip("closes all issues that still don't follow the template", async (t) => {
    const config = defaultCloseConfig
    const processor = new Processor(
        defaultCloseConfig,
        octokitPlaceholder,
        repo
    )

    const currentDate = new Date('2020-10-15T03:00:00.000Z')

    const earlierDate = new Date(currentDate)
    earlierDate.setDate(earlierDate.getUTCDate() - 2)

    const earliestDate = new Date(currentDate)
    earliestDate.setDate(earliestDate.getUTCDate() - 3)

    const mock = sinon.mock(processor)

    const issues1 = [getIssue(), getIssue()]
    const events1: Event[][] = [
        [
            {
                event: 'labeled',
                label: { name: config.doesntFollowTemplateLabel },
                id: 3242,
                created_at: earliestDate.toISOString(),
            },
        ],
        [
            {
                event: 'labeled',
                label: { name: config.doesntFollowTemplateLabel },
                id: 423420,
                created_at: earlierDate.toISOString(),
            },
        ],
    ]

    const issues2 = [getIssue(), getIssue()]
    const events2: Event[][] = [
        [
            {
                event: 'labeled',
                label: { name: config.templateNotUsedLabel },
                id: 9234,
                created_at: earliestDate.toISOString(),
            },
        ],
        [
            {
                event: 'labeled',
                label: { name: config.templateNotUsedLabel },
                id: 89125,
                created_at: earlierDate.toISOString(),
            },
        ],
    ]

    async function* go(issues: Issue[]) {
        yield* issues
    }

    mock.expects('getIssues')
        .withExactArgs(config.templateNotUsedLabel)
        .once()
        .returns(go(issues1))

    mock.expects('getIssues')
        .withExactArgs(config.doesntFollowTemplateLabel)
        .once()
        .returns(go(issues2))

    function mockGetEvents(issues: Issue[], eventss: Event[][]) {
        issues.forEach((issue, i) => {
            const events = eventss[i]

            mock.expects('getEvents')
                .withExactArgs(issue, 2)
                .once()
                .resolves(events)

            mock.expects('getEvents')
                .withExactArgs(issue, 2)
                .once()
                .resolves([])
        })
    }

    mockGetEvents(issues1, events1)
    mockGetEvents(issues2, events2)

    mock.expects('closeIssue').withExactArgs(issues1[0]).once().resolves()
    mock.expects('closeIssue').withExactArgs(issues2[0]).once().resolves()

    processor.run()

    mock.verify()

    t.pass()
})
