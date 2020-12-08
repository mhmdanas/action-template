const core = require("@actions/core");
const github = require("@actions/github");
const IssueProcessor = require("./src/IssueProcessor");

// TODO: validate config
async function getConfig() {
    const repoToken = core.getInput("repo-token", { required: true });

    const daysUntilClose = core.getInput("days-until-close");

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

async function interpolateValues(string, config) {
    const context = github.context;
    const octokit = github.getOctokit(config.repoToken);

    const issue = await octokit.issues.get(context.issue);

    const authorLogin = issue.data.user.login;

    string = string.replace("{authorLogin}", authorLogin);

    let daysUntilClose = config.daysUntilClose;

    if (daysUntilClose === 1) {
        daysUntilClose = "1 day";
    } else {
        daysUntilClose = `${daysUntilClose} days`;
    }

    string = string.replace("{daysUntilClose}", daysUntilClose);

    return string;
}

async function run() {
    try {
        const config = getConfig();

        switch (config.type) {
            case "comment": {
                const octokit = github.getOctokit(config.repoToken);

                switch (github.context.payload.label.name) {
                    case config.templateNotUsedLabel:
                        await octokit.issues.createComment({
                            ...github.context.issue,
                            body: await interpolateValues(
                                config.templateNotUsedCommentBody
                            ),
                        });
                        break;

                    case config.doesntFollowTemplateCommentBody:
                        await octokit.issues.createComment({
                            ...github.context.issue,
                            body: await interpolateValues(
                                config.doesntFollowTemplateCommentBody
                            ),
                        });
                }
                break;
            }

            case "close": {
                await new IssueProcessor(config).process();
            }
        }
    } catch (e) {
        core.error(e);
        core.setFailed(e.message);
    }
}

run();
