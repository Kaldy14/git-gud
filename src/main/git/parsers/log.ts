export type GitLogCommit = {
  sha: string;
  parentShas: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  refs: string[];
  subject: string;
  body: string;
};

const LOG_FIELD_COUNT = 9;

export function parseGitLog(output: string): GitLogCommit[] {
  const tokens = output.split('\0');
  const commits: GitLogCommit[] = [];

  if (tokens[tokens.length - 1] === '') {
    tokens.pop();
  }

  for (let index = 0; index + LOG_FIELD_COUNT - 1 < tokens.length; index += LOG_FIELD_COUNT) {
    const [sha, parents, authorName, authorEmail, authoredAt, committedAt, refs, subject, body] = tokens.slice(
      index,
      index + LOG_FIELD_COUNT
    );

    if (!sha) {
      continue;
    }

    commits.push({
      sha,
      parentShas: parents ? parents.split(' ').filter(Boolean) : [],
      authorName,
      authorEmail,
      authoredAt,
      committedAt,
      refs: refs ? refs.split(', ').filter(Boolean) : [],
      subject,
      body
    });
  }

  return commits;
}
