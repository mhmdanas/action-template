import * as core from "@actions/core";
import * as github from "@actions/github";
import { IssueProcessor } from "./src/IssueProcessor";

export interface Config {
    type: "comment" | "close";
    repoToken: string;
    daysUntilClose: number;

    templateNotUsedLabel: string;
    templateNotUsedCommentBody: string;

    doesntFollowTemplateLabel: string;
    doesntFollowTemplateCommentBody: string;
}

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
async function run() {
    try {
        const config = getConfig();

        const context = github.context;

        const issue = {
            ...context.repo,
            issue_number: context.issue.number,
        };

        const octokit = github.getOctokit(config.repoToken);

        async function interpolateValues(string: string) {
            core.info(`Issue is ${context.issue}`);

            const fullIssue = await octokit.issues.get(issue)!;

            const authorLogin = fullIssue.data!.user!.login;

            string = string.replace("{authorLogin}", authorLogin);

            let daysUntilClose = config.daysUntilClose;

            let daysUntilCloseString: string;

            if (daysUntilClose === 1) {
                daysUntilCloseString = "1 day";
            } else {
                daysUntilCloseString = `${daysUntilClose} days`;
            }

            string = string.replace("{daysUntilClose}", daysUntilCloseString);

            return string;
        }

        switch (config.type) {
            case "comment": {
                const labelName = context.payload.label.name;

                core.info(`label name is ${labelName}`);

                switch (labelName) {
                    case config.templateNotUsedLabel:
                        core.info("label is template-not-used-label");
                        await octokit.issues.createComment({
                            ...issue,
                            body: await interpolateValues(
                                config.templateNotUsedCommentBody
                            ),
                        });
                        break;

                    case config.doesntFollowTemplateLabel:
                        core.info("label is doesnt-follow-template-label");
                        await octokit.issues.createComment({
                            ...issue,
                            body: await interpolateValues(
                                config.doesntFollowTemplateCommentBody
                            ),
                        });
                }
                break;
            }

            case "close": {
                await new IssueProcessor(config).process();
                break;
            }
        }
    } catch (e) {
        core.error(e);
        core.error(e.stack);
        core.setFailed(e.message);
    }
}

run();
