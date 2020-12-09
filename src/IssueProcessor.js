const core = require("@actions/core");
const github = require("@actions/github");

module.exports = class IssueProcessor {
    constructor(config) {
        core.info("In IssueProcessor constructor");
        this.config = config;
        this.octokit = github.getOctokit(config.repoToken);
        this.context = github.context;
    }

    async *getIssues(label) {
	core.info("In IssueProcessor#getIssues");
        let page = 1;

        while (true) {
            const issues = (
                await this.octokit.issues.listForRepo({
                    ...this.context.repo,
                    state: "open",
                    sort: "updated",
                    direction: "desc",
                    labels: [label],
                    per_page: 100,
                    page,
                })
            ).data;

            if (issues.length === 0) break;

            yield* issues;
            page++;
        }
    }

    async close(issue) {
	core.info(`Closing #${issue.issue_number}`);
        await this.octokit.issues.update({ ...issue, state: "closed" });
    }

    async processIssues(label) {
	core.info("In IssueProcessor#processIssues");

        for await (const issue of this.getIssues(label)) {
            const events = (await this.octokit.issues.listEvents(issue)).data;

            let labeledEvent;
            for (let i = events.length - 1; i >= 0; i--) {
                const event = events[i];

                if (!event.event === "labeled") continue;
                if (!event.label.name === label) continue;

                labeledEvent = event;
                core.info(`Found event ${event.id}`);
                break;
            }

            if (labeledEvent === undefined) continue;

            const date = new Date(labeledEvent.created_at);

            core.info(`event date is ${date}`);
	    const currentDate = new Date();

	    core.info(`Current date is ${currentDate}`);

            if (currentDate - date > 86400000 * this.config.daysUntilClose /* milliseconds */) {
                await this.close(issue);
            }
        }
    }

    async process() {
        await this.processIssues(this.config.doesntFollowTemplateLabel);
        await this.processIssues(this.config.templateNotUsedLabel);
    }
}
