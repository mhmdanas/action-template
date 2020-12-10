import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { context } from "@actions/github/lib/utils";
import "@octokit/webhooks";
import type { Config, Event, Issue, Payload, Repo } from "./types";

// TODO: validate config
function getConfig(): Config {
    const type = core.getInput("type");

    if (type !== "comment" && type !== "close") {
        throw Error("type is not comment or close");
    }

    const repoToken = core.getInput("repo-token", { required: true });

    const daysUntilClose = parseInt(core.getInput("days-until-close"));

    if (isNaN(daysUntilClose)) {
        throw Error("daysUntilClose is not an integer");
    }

    const templateNotUsedLabel = core.getInput("template-not-used-label");

    const templateNotUsedCommentBody = core.getInput(
        "template-not-used-comment-body"
    );

    const doesntFollowTemplateLabel = core.getInput(
        "doesnt-follow-template-label"
    );

    const doesntFollowTemplateCommentBody = core.getInput(
        "doesnt-follow-template-comment-body"
    );

    return {
        type,
        daysUntilClose,
        templateNotUsedLabel,
        templateNotUsedCommentBody,
        doesntFollowTemplateLabel,
        doesntFollowTemplateCommentBody,
        repoToken,
    };
}

export class Processor {
    private readonly config: Config;
    private readonly octokit: ReturnType<typeof getOctokit>;

    private readonly repo: Repo;

    private readonly payload: Payload | undefined;

    async createComment(issue: Issue, body: string) {
        this.octokit.issues.createComment({ ...issue, body });
    }

    async getAuthorLogin(issue: Issue) {
        const fullIssue = (await this.octokit.issues.get({ ...issue })).data;

        const result = fullIssue.user!.login!;

        if (!result) {
            throw Error("Could not get author of issue");
        }

        return result;
    }

    async closeIssue(issue: Issue) {
        await this.octokit.issues.update({ ...issue, state: "closed" });
    }

    async getEvents(issue: Issue, page: number) {
        return ((
            await this.octokit.issues.listEvents({
                ...issue,
                per_page: 30,
                page,
            })
        ).data as unknown) as Event[];
    }

    async *getIssues(labelName: string) {
        let page = 1;

        while (true) {
            const issues = (
                await this.octokit.issues.listForRepo({
                    ...this.repo,
                    state: "open",
                    sort: "updated",
                    direction: "desc",
                    labels: labelName,
                    per_page: 100,
                    page,
                })
            ).data;

            if (issues.length === 0) break;

            yield* issues.map((issue) => ({
                ...this.repo,
                issue_number: issue.number,
            }));
            page++;
        }
    }

    constructor(config?: Config, repo?: Repo, payload?: Payload) {
        core.info("In Processor constructor");
        this.config = config ?? getConfig();

        this.octokit = getOctokit(this.config.repoToken);
        this.repo = repo ?? context.repo;

        if (payload !== undefined) {
            this.payload = payload;
        } else if (this.config.type === "comment") {
            this.payload = {
                issue: {
                    ...this.repo,
                    issue_number: context.issue.number,
                },
                labelName: context.payload.label.name,
            };
        }
    }

    async processIssue(issue: Issue, labelName: string) {
        core.info("In Processor#processIssue");
        let page = 1;

        while (true) {
            const events = await this.getEvents(issue, page);

            if (events.length === 0) break;

            let labeledEvent;

            for (let i = events.length - 1; i >= 0; i--) {
                const event = events[i];

                if (event.event !== "labeled") continue;
                if ((event as any).label.name !== labelName) continue;

                labeledEvent = event;
                core.info(`Found event ${event.id}`);
                break;
            }

            if (labeledEvent === undefined) continue;

            const date = new Date(labeledEvent.created_at);

            core.info(`event date is ${date}`);
            const currentDate = new Date();

            core.info(`Current date is ${currentDate}`);

            if (
                currentDate.valueOf() - date.valueOf() >
                600_000/*86400000 * this.config.daysUntilClose /* milliseconds */
            ) {
                await this.closeIssue(issue);
            }

            page++;
        }
    }

    async closeInvalidIssues(labelName: string) {
        core.info("In Processor#closeInvalidIssues");

        for await (const issue of this.getIssues(labelName)) {
            await this.processIssue(issue, labelName);
        }
    }

    async interpolateValues(string: string, issue: Issue) {
        const authorLogin = await this.getAuthorLogin(issue);

        string = string.replace("{authorLogin}", authorLogin);

        let daysUntilClose = this.config.daysUntilClose;

        let daysUntilCloseString: string;

        if (daysUntilClose === 1) {
            daysUntilCloseString = "1 day";
        } else {
            daysUntilCloseString = `${daysUntilClose} days`;
        }

        string = string.replace("{daysUntilClose}", daysUntilCloseString);

        return string;
    }

    async run() {
        switch (this.config.type) {
            case "close":
                await this.closeInvalidIssues(
                    this.config.doesntFollowTemplateLabel
                );
                await this.closeInvalidIssues(this.config.templateNotUsedLabel);

            case "comment": {
                const issue = this.payload!.issue;

                const labelName = this.payload!.labelName;

                core.info(`label name is ${labelName}`);

                let commentBodyTemplate: string;

                switch (labelName) {
                    case this.config.templateNotUsedLabel:
                        core.info("label is template-not-used-label");
                        commentBodyTemplate = this.config
                            .templateNotUsedCommentBody;
                        break;

                    case this.config.doesntFollowTemplateLabel:
                        core.info("label is doesnt-follow-template-label");
                        commentBodyTemplate = this.config
                            .doesntFollowTemplateCommentBody;
                        break;

                    default:
                        return;
                }

                await this.createComment(
                    issue,
                    await this.interpolateValues(commentBodyTemplate, issue)
                );
                break;
            }
        }
    }
}
