import * as core from "@actions/core";
import * as github from "@actions/github";
import "@octokit/webhooks";
import { Config } from "../index";

export class IssueProcessor {
    private readonly octokit: ReturnType<typeof github.getOctokit>;
    private readonly context: typeof github.context;

    constructor(private config: Config) {
        core.info("In IssueProcessor constructor");
        this.octokit = github.getOctokit(config.repoToken);
        this.context = github.context;
    }

    async *getIssues(labelName: string) {
        core.info("In IssueProcessor#getIssues");
        let page = 1;

        while (true) {
            const issues = (
                await this.octokit.issues.listForRepo({
                    ...this.context.repo,
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
                owner: issue.repository!.owner?.login!,
                repo: issue.repository!.name,
                issue_number: issue.number,
            }));
            page++;
        }
    }

    async processIssues(labelName: string) {
        core.info("In IssueProcessor#processIssues");

        for await (const issue of this.getIssues(labelName)) {
            const events = (await this.octokit.issues.listEvents(issue)).data;

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
                86400000 * this.config.daysUntilClose /* milliseconds */
            ) {
                await this.octokit.issues.update({ ...issue, state: "closed" });
            }
        }
    }

    async process() {
        await this.processIssues(this.config.doesntFollowTemplateLabel);
        await this.processIssues(this.config.templateNotUsedLabel);
    }
}
