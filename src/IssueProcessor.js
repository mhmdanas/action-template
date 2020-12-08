const github = require("@actions/github");

module.exports = class IssueProcessor {
    constructor(config) {
        this.config = config;
        this.octokit = github.getOctokit(config.repoToken);
        this.context = github.context;
    }

    async *getIssues(label) {
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
        await this.octokit.issues.update({ ...issue, state: "closed" });
    }

    async processIssues(label) {
        for await (const issue of this.getIssues(label)) {
            const events = (await this.octokit.issues.listEvents(issue)).data;

            let labeledEvent;
            for (let i = events.length - i; i >= 0; i--) {
                const event = events[i];

                if (!event.event === "labeled") continue;
                if (!event.label.name === label) continue;

                labeledEvent = event;
                break;
            }

            if (labeledEvent === undefined) continue;

            const date = new Date(labeledEvent.created_at);

            if (new Date() - date > 86400000 * config.daysUntilClose /* milliseconds */) {
                await closeIssue(issue);
            }
        }
    }

    async process() {
        await processIssues(await this.getIssuesNotFollowingTemplate());
        await processIssues(await this.getIssuesWithoutTemplate());
    }
}
