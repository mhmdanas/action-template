const core = require("@actions/core");
const github = require("@actions/github");
const IssueProcessor = require("./src/IssueProcessor");

// TODO: validate config
function getConfig() {
    const type = core.getInput("type");

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

        core.info(config);

        switch (config.type) {
            case "comment": {
                const octokit = github.getOctokit(config.repoToken);
                const labelName = github.context.payload.label.name;

                core.info(`label name is ${labelName}`);

                switch (labelName) {
                    case config.templateNotUsedLabel:
                        core.info("label is template-not-used-label");
                        await octokit.issues.createComment({
                            ...github.context.issue,
                            body: await interpolateValues(
                                config.templateNotUsedCommentBody
                            ),
                        });
                        break;

                    case config.doesntFollowTemplateLabel:
                        core.info("label is doesnt-follow-template-label");
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
                break;
            }
        }
    } catch (e) {
        core.error(e);
        core.setFailed(e.message);
    }
}

run();
