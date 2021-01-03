// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./js-yaml.d.ts" />

import * as core from '@actions/core'
import { getOctokit } from '@actions/github'
import { context } from '@actions/github/lib/utils'
import '@octokit/webhooks'
import type {
    Config,
    Event,
    Issue,
    Octokit,
    Payload,
    Repo,
    Template,
    Comment,
} from './types'
import { getURLContent } from './utils/https'
import * as yaml from 'js-yaml'

// TODO: validate config
function getConfig(): Config {
    const type = core.getInput('type')

    if (type !== 'comment' && type !== 'close') {
        throw Error('type is not comment or close')
    }

    const repoToken = core.getInput('repo-token', { required: true })

    const daysUntilClose = parseInt(core.getInput('days-until-close'))

    if (isNaN(daysUntilClose)) {
        throw Error('daysUntilClose is not an integer')
    }

    const templateNotUsedLabel = core.getInput('template-not-used-label')

    const templateNotUsedCommentBody = core.getInput(
        'template-not-used-comment-body'
    )

    const doesntFollowTemplateLabel = core.getInput(
        'doesnt-follow-template-label'
    )

    const doesntFollowTemplateCommentBody = core.getInput(
        'doesnt-follow-template-comment-body'
    )

    return {
        type,
        daysUntilClose,
        templateNotUsedLabel,
        templateNotUsedCommentBody,
        doesntFollowTemplateLabel,
        doesntFollowTemplateCommentBody,
        repoToken,
    }
}

const commentIdentifier = '<!--action-template-->'

export class Processor {
    private readonly config: Config

    private readonly octokit: Octokit

    private readonly repo: Repo

    private readonly payload?: Payload

    constructor(
        config?: Config,
        octokit?: Octokit,
        repo?: Repo,
        payload?: Payload
    ) {
        core.info('In Processor constructor')
        this.config = config ?? getConfig()

        this.octokit = octokit ?? getOctokit(this.config.repoToken)

        this.repo = repo ?? context.repo

        if (payload !== undefined) {
            this.payload = payload
        } else if (this.config.type === 'comment') {
            this.payload = {
                issue: {
                    ...this.repo,
                    issue_number: context.issue.number,
                },
                labelName: context.payload.label.name,
            }
        }
    }

    async listComments(issue: Issue, page: number): Promise<Comment[]> {
        return (
            await this.octokit.issues.listComments({
                ...issue,
                page,
            })
        ).data
    }

    async createComment(issue: Issue, body: string): Promise<void> {
        await this.octokit.issues.createComment({ ...issue, body })
    }

    async getAuthorLogin(issue: Issue): Promise<string> {
        const fullIssue = (await this.octokit.issues.get({ ...issue })).data

        if (fullIssue === undefined) {
            throw Error('fullIssue is undefined')
        }

        const result = fullIssue.user?.login

        if (result === undefined) {
            throw Error('Could not get author of issue')
        }

        if (!result) {
            throw Error('Could not get author of issue')
        }

        return result
    }

    processTemplate(template: string): Template {
        const lines = template.split('\n')

        let firstIndex: number | undefined
        let secondIndex: number | undefined

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]

            if (line === '---') {
                if (firstIndex === undefined) {
                    firstIndex = i
                } else {
                    secondIndex = i
                    break
                }
            }
        }

        if (firstIndex === undefined || secondIndex === undefined) {
            throw Error('Could not remove YAML frontmatter successfully')
        }

        let yamlLines = lines.splice(firstIndex, secondIndex - firstIndex + 1)

        yamlLines = yamlLines.slice(1, yamlLines.length - 2)

        const templateYaml = yaml.load(yamlLines.join('\n'))

        if (typeof templateYaml !== 'object') {
            throw Error('Expected template YAML frontmatter to be object')
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const templateName = (templateYaml as any).name as string

        return { template: lines.join('\n').trim(), name: templateName }
    }

    async getIssueTemplates(): Promise<Template[]> {
        const content = (
            await this.octokit.repos.getContent({
                ...this.repo,
                path: '.github/ISSUE_TEMPLATE',
            })
        ).data

        if (!Array.isArray(content)) {
            throw Error('Expected .github/ISSUE_TEMPLATE to be a directory')
        }

        const urls = content
            .filter(({ path }) => path.endsWith('.md'))
            .map((obj) => {
                if (obj.download_url === null) {
                    throw Error(
                        `Did not expect download_url of ${obj.path} to be null`
                    )
                }

                return obj.download_url
            })

        const templates = await Promise.all(
            urls.map(async (url) => {
                const template = await getURLContent(url)

                return this.processTemplate(template)
            })
        )

        return templates
    }

    async closeIssue(issue: Issue): Promise<void> {
        await this.octokit.issues.update({ ...issue, state: 'closed' })
    }

    async getEvents(issue: Issue, page: number): Promise<Event[]> {
        return ((
            await this.octokit.issues.listEvents({
                ...issue,
                per_page: 30,
                page,
            })
        ).data as unknown) as Event[]
    }

    async *getIssues(
        labelName: string
    ): AsyncGenerator<Issue, void, undefined> {
        let page = 1

        for (; ; page++) {
            const issues = (
                await this.octokit.issues.listForRepo({
                    ...this.repo,
                    state: 'open',
                    sort: 'updated',
                    direction: 'desc',
                    labels: labelName,
                    per_page: 100,
                    page,
                })
            ).data

            if (issues.length === 0) break

            yield* issues.map((issue) => ({
                ...this.repo,
                issue_number: issue.number,
            }))
        }
    }

    async processIssue(issue: Issue, labelName: string): Promise<void> {
        core.info('In Processor#processIssue')
        let page = 1

        for (; ; page++) {
            const events = await this.getEvents(issue, page)

            if (events.length === 0) break

            let labeledEvent

            for (let i = events.length - 1; i >= 0; i--) {
                const event = events[i]
                core.info(`Checking event ${event.id} with index ${i}`)

                if (event.event !== 'labeled') continue
                if (((event as unknown) as Event).label.name !== labelName)
                    continue

                labeledEvent = event
                core.info(`Found event ${event.id}`)
                break
            }

            core.info('Inner processIssue loop done')

            if (labeledEvent === undefined) continue

            const date = new Date(labeledEvent.created_at)

            core.info(`event date is ${date}`)
            const currentDate = new Date()

            core.info(`Current date is ${currentDate}`)

            if (
                currentDate.valueOf() - date.valueOf() >
                86400000 * this.config.daysUntilClose /* milliseconds */
            ) {
                await this.closeIssue(issue)
            }
        }

        core.info('Issue#processIssue done')
    }

    async closeInvalidIssues(labelName: string): Promise<void> {
        core.info('In Processor#closeInvalidIssues')

        for await (const issue of this.getIssues(labelName)) {
            await this.processIssue(issue, labelName)
        }
    }

    async interpolateValues(string: string, issue: Issue): Promise<string> {
        const authorLogin = await this.getAuthorLogin(issue)

        string = string.replace('{authorLogin}', authorLogin)

        const daysUntilClose = this.config.daysUntilClose

        let daysUntilCloseString: string

        if (daysUntilClose === 1) {
            daysUntilCloseString = '1 day'
        } else {
            daysUntilCloseString = `${daysUntilClose} days`
        }

        string = string.replace('{daysUntilClose}', daysUntilCloseString)

        return string.trim()
    }

    private addCommentIdentifier(commentBody: string): string {
        return `${commentBody}\n\n${commentIdentifier}`
    }

    async run(): Promise<void> {
        switch (this.config.type) {
            case 'close':
                await this.closeInvalidIssues(
                    this.config.doesntFollowTemplateLabel
                )
                await this.closeInvalidIssues(this.config.templateNotUsedLabel)
                break

            case 'comment': {
                if (this.payload === undefined) {
                    throw Error(
                        'payload should not be undefined when type is comment'
                    )
                }

                const issue = this.payload.issue

                const labelName = this.payload.labelName

                core.info(`label name is ${labelName}`)

                let commentBodyTemplate: string

                switch (labelName) {
                    case this.config.templateNotUsedLabel: {
                        core.info('label is template-not-used-label')
                        commentBodyTemplate = `${this.config.templateNotUsedCommentBody}\n`

                        const templates = await this.getIssueTemplates()

                        for (const template of templates) {
                            commentBodyTemplate += `<details><summary>${template.name}</summary>\n\n\`\`\`\n${template.template}\n\`\`\`\n</details>\n\n`
                        }

                        commentBodyTemplate = commentBodyTemplate.trim()
                        break
                    }

                    case this.config.doesntFollowTemplateLabel:
                        core.info('label is doesnt-follow-template-label')
                        commentBodyTemplate = this.config
                            .doesntFollowTemplateCommentBody
                        break

                    default:
                        return
                }

                const commentBody = this.addCommentIdentifier(
                    await this.interpolateValues(commentBodyTemplate, issue)
                )

                let foundComment: Comment | undefined

                for (let page = 1; ; page++) {
                    const comments = await this.listComments(issue, page)

                    if (comments.length === 0) break

                    for (const comment of comments) {
                        if (
                            comment.user?.login === 'github-actions[bot]' &&
                            (comment.body?.endsWith(commentIdentifier) ?? true)
                        ) {
                            foundComment = comment
                        }
                    }
                }

                if (foundComment?.body !== commentBody) {
                    await this.createComment(issue, commentBody)
                }

                break
            }
        }

        core.info('Done running Processor#run')
    }
}
