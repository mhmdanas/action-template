export interface Config {
    type: 'comment' | 'close'
    repoToken: string
    daysUntilClose: number

    templateNotUsedLabel: string
    templateNotUsedCommentBody: string

    doesntFollowTemplateLabel: string
    doesntFollowTemplateCommentBody: string
}

export interface Issue {
    owner: string
    repo: string
    issue_number: number
}

export interface Event {
    event: string
    label: { name: string }
    id: number
    created_at: string
}

export interface Repo {
    owner: string
    repo: string
}

export interface Payload {
    issue: Issue
    labelName: string
}
